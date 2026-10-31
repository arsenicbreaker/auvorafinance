const DAY_MS = 86_400_000;
const MAX_U128 = (1n << 128n) - 1n;

export interface ForecastWorkflow {
  id: number;
  state: "Active" | "Paused" | "Completed" | "Cancelled";
  amount: string;
  min_reserve: string;
  available_balance: string;
  max_runs: number;
  runs_completed: number;
  interval_ms: number;
  next_run_at_ms: number;
  pending_execution: { amount: string; run_index: number } | null;
}

export interface ForecastRow {
  id: number;
  state: ForecastWorkflow["state"];
  available: bigint;
  pending: bigint;
  obligations: bigint;
  reserve: bigint;
  fees: bigint;
  upcomingPayments: bigint;
  upcomingRuns: number;
  uncommitted: bigint;
  fundingGap: bigint;
  horizonHeadroom: bigint;
  uncertain: boolean;
}

export interface TreasuryForecast {
  rows: ForecastRow[];
  available: bigint;
  pending: bigint;
  obligations: bigint;
  reserve: bigint;
  fees: bigint;
  upcomingPayments: bigint;
  upcomingRuns: number;
  uncommitted: bigint;
  fundingGap: bigint;
  horizonHeadroom: bigint | null;
  uncertainWorkflows: number;
}

function atomic(value: string): bigint {
  if (typeof value !== "string" || !/^\d{1,39}$/.test(value)) {
    throw new Error("INVALID_FORECAST_AMOUNT");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_U128) throw new Error("INVALID_FORECAST_AMOUNT");
  return parsed;
}

function nonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function aboveZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

export function forecastTreasury(
  workflows: readonly ForecastWorkflow[],
  assumptions: { asOfMs: number; horizonDays: number; feePerRun: bigint },
): TreasuryForecast {
  const { asOfMs, horizonDays, feePerRun } = assumptions;
  const endMs = asOfMs + horizonDays * DAY_MS;
  if (
    !nonnegativeInteger(asOfMs) ||
    !Number.isSafeInteger(horizonDays) ||
    horizonDays < 1 ||
    horizonDays > 365 ||
    !Number.isSafeInteger(endMs) ||
    feePerRun < 0n ||
    feePerRun > MAX_U128
  )
    throw new Error("INVALID_FORECAST_ASSUMPTIONS");

  const ids = new Set<number>();
  const rows = workflows.map((workflow): ForecastRow => {
    if (
      !nonnegativeInteger(workflow.id) ||
      ids.has(workflow.id) ||
      !["Active", "Paused", "Completed", "Cancelled"].includes(
        workflow.state,
      ) ||
      !nonnegativeInteger(workflow.max_runs) ||
      workflow.max_runs === 0 ||
      workflow.max_runs > 1_000 ||
      !nonnegativeInteger(workflow.runs_completed) ||
      workflow.runs_completed > workflow.max_runs ||
      !nonnegativeInteger(workflow.interval_ms) ||
      workflow.interval_ms < 60_000 ||
      workflow.interval_ms > 31_536_000_000 ||
      !nonnegativeInteger(workflow.next_run_at_ms)
    )
      throw new Error("INVALID_FORECAST_WORKFLOW");
    if (
      (workflow.state === "Completed" &&
        workflow.runs_completed !== workflow.max_runs) ||
      ((workflow.state === "Active" || workflow.state === "Paused") &&
        workflow.runs_completed === workflow.max_runs)
    ) {
      throw new Error("INVALID_FORECAST_WORKFLOW");
    }
    ids.add(workflow.id);
    const amount = atomic(workflow.amount);
    const available = atomic(workflow.available_balance);
    const minimumReserve = atomic(workflow.min_reserve);
    if (amount === 0n) throw new Error("INVALID_FORECAST_WORKFLOW");
    const execution = workflow.pending_execution;
    if (
      execution !== null &&
      (!execution ||
        atomic(execution.amount) !== amount ||
        execution.run_index !== workflow.runs_completed ||
        workflow.runs_completed >= workflow.max_runs ||
        workflow.state === "Completed")
    )
      throw new Error("INVALID_FORECAST_PENDING_EXECUTION");
    const uncertain = execution !== null;
    const committed =
      workflow.state === "Active" || workflow.state === "Paused";
    const remainingRuns = committed
      ? workflow.max_runs - workflow.runs_completed - Number(uncertain)
      : 0;
    const obligations = amount * BigInt(remainingRuns);
    const reserve = committed ? minimumReserve : 0n;
    const fees = feePerRun * BigInt(remainingRuns);
    const firstRunMs = Math.max(asOfMs, workflow.next_run_at_ms);
    const upcomingRuns =
      workflow.state === "Active" && !uncertain && firstRunMs < endMs
        ? Math.min(
            remainingRuns,
            Math.floor((endMs - 1 - firstRunMs) / workflow.interval_ms) + 1,
          )
        : 0;
    const upcomingPayments = amount * BigInt(upcomingRuns);
    const required = obligations + reserve + fees;
    return {
      id: workflow.id,
      state: workflow.state,
      available,
      pending: uncertain ? amount : 0n,
      obligations,
      reserve,
      fees,
      upcomingPayments,
      upcomingRuns,
      uncommitted: aboveZero(available - required),
      fundingGap: aboveZero(required - available),
      horizonHeadroom: aboveZero(
        available -
          upcomingPayments -
          reserve -
          feePerRun * BigInt(upcomingRuns),
      ),
      uncertain,
    };
  });

  const sum = (
    field:
      | "available"
      | "pending"
      | "obligations"
      | "reserve"
      | "fees"
      | "upcomingPayments"
      | "uncommitted"
      | "fundingGap"
      | "horizonHeadroom",
  ) => rows.reduce((total, row) => total + row[field], 0n);
  const uncertainWorkflows = rows.filter((row) => row.uncertain).length;
  return {
    rows,
    available: sum("available"),
    pending: sum("pending"),
    obligations: sum("obligations"),
    reserve: sum("reserve"),
    fees: sum("fees"),
    upcomingPayments: sum("upcomingPayments"),
    upcomingRuns: rows.reduce((total, row) => total + row.upcomingRuns, 0),
    uncommitted: sum("uncommitted"),
    fundingGap: sum("fundingGap"),
    horizonHeadroom: uncertainWorkflows ? null : sum("horizonHeadroom"),
    uncertainWorkflows,
  };
}

export function parseApyBasisPoints(value: string): number {
  if (!/^(0|[1-9]\d{0,2})(\.\d{1,2})?$/.test(value))
    throw new Error("INVALID_APY_ASSUMPTION");
  const [whole = "0", fraction = ""] = value.split(".");
  const basisPoints = Number(
    BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0"),
  );
  if (basisPoints > 10_000) throw new Error("INVALID_APY_ASSUMPTION");
  return basisPoints;
}

export function simulateAnnualYield(
  principal: bigint,
  uncommitted: bigint,
  apyBasisPoints: number,
) {
  if (
    principal < 0n ||
    uncommitted < 0n ||
    principal > uncommitted ||
    !nonnegativeInteger(apyBasisPoints) ||
    apyBasisPoints > 10_000
  ) {
    throw new Error("INVALID_YIELD_ASSUMPTIONS");
  }
  const hypotheticalGain = (principal * BigInt(apyBasisPoints)) / 10_000n;
  return {
    principal,
    hypotheticalGain,
    hypotheticalEndingBalance: principal + hypotheticalGain,
  };
}
