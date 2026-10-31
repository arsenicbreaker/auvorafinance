import { describe, expect, it } from "vitest";
import {
  forecastTreasury,
  parseApyBasisPoints,
  simulateAnnualYield,
  type ForecastWorkflow,
} from "./treasury.js";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const assumptions = { asOfMs: NOW, horizonDays: 1, feePerRun: 0n };
function workflow(changes: Partial<ForecastWorkflow> = {}): ForecastWorkflow {
  return {
    id: 1,
    state: "Active",
    amount: "10",
    min_reserve: "5",
    available_balance: "25",
    max_runs: 2,
    runs_completed: 0,
    interval_ms: DAY,
    next_run_at_ms: NOW,
    pending_execution: null,
    ...changes,
  };
}

describe("treasury forecast", () => {
  it("locks every remaining obligation and reserve to one yoctoNEAR precision", () => {
    expect(forecastTreasury([workflow()], assumptions)).toMatchObject({
      available: 25n,
      obligations: 20n,
      reserve: 5n,
      uncommitted: 0n,
      fundingGap: 0n,
    });
    expect(
      forecastTreasury([workflow({ available_balance: "26" })], assumptions)
        .uncommitted,
    ).toBe(1n);
    expect(
      forecastTreasury([workflow({ available_balance: "24" })], assumptions)
        .fundingGap,
    ).toBe(1n);
  });

  it("does not net a funded workflow against another workflow's deficit", () => {
    const result = forecastTreasury(
      [
        workflow({ available_balance: "35" }),
        workflow({ id: 2, available_balance: "15" }),
      ],
      assumptions,
    );
    expect(result.uncommitted).toBe(10n);
    expect(result.fundingGap).toBe(10n);
    expect(result.horizonHeadroom).toBe(20n);
  });

  it("counts the start boundary and excludes the end boundary", () => {
    const result = forecastTreasury([workflow()], assumptions);
    expect(result.upcomingRuns).toBe(1);
    expect(result.upcomingPayments).toBe(10n);
    expect(result.horizonHeadroom).toBe(10n);
    expect(
      forecastTreasury([workflow({ next_run_at_ms: NOW + DAY })], assumptions)
        .upcomingRuns,
    ).toBe(0);
  });

  it("does not burst through missed intervals", () => {
    const result = forecastTreasury(
      [workflow({ next_run_at_ms: NOW - 20 * DAY, max_runs: 100 })],
      assumptions,
    );
    expect(result.upcomingRuns).toBe(1);
  });

  it("keeps paused obligations and reserves protected without scheduling payments", () => {
    expect(
      forecastTreasury([workflow({ state: "Paused" })], assumptions),
    ).toMatchObject({
      upcomingRuns: 0,
      obligations: 20n,
      reserve: 5n,
      uncommitted: 0n,
    });
  });

  it.each(["Completed", "Cancelled"] as const)(
    "unlocks the available ledger for %s workflows",
    (state) => {
      expect(
        forecastTreasury(
          [workflow({ state, runs_completed: state === "Completed" ? 2 : 0 })],
          {
            ...assumptions,
            feePerRun: 100n,
          },
        ),
      ).toMatchObject({
        obligations: 0n,
        reserve: 0n,
        fees: 0n,
        uncommitted: 25n,
        upcomingRuns: 0,
      });
    },
  );

  it("never double-subtracts pending funds or fabricates their future schedule", () => {
    const result = forecastTreasury(
      [
        workflow({
          available_balance: "15",
          pending_execution: { amount: "10", run_index: 0 },
        }),
      ],
      assumptions,
    );
    expect(result).toMatchObject({
      available: 15n,
      pending: 10n,
      obligations: 10n,
      reserve: 5n,
      uncommitted: 0n,
      fundingGap: 0n,
      horizonHeadroom: null,
      uncertainWorkflows: 1,
    });
  });

  it("keeps cancelled in-flight value separate from the unlocked ledger", () => {
    expect(
      forecastTreasury(
        [
          workflow({
            state: "Cancelled",
            available_balance: "15",
            pending_execution: { amount: "10", run_index: 0 },
          }),
        ],
        assumptions,
      ),
    ).toMatchObject({
      available: 15n,
      pending: 10n,
      obligations: 0n,
      reserve: 0n,
      uncommitted: 15n,
      horizonHeadroom: null,
    });
  });

  it("budgets fees for all remaining runs while the horizon includes only due runs", () => {
    expect(
      forecastTreasury([workflow()], { ...assumptions, feePerRun: 1n }),
    ).toMatchObject({
      fees: 2n,
      fundingGap: 2n,
      upcomingRuns: 1,
      horizonHeadroom: 9n,
    });
  });

  it("returns an empty, exact forecast without fabricated balances", () => {
    expect(forecastTreasury([], assumptions)).toMatchObject({
      available: 0n,
      uncommitted: 0n,
      fundingGap: 0n,
      rows: [],
      horizonHeadroom: 0n,
    });
  });

  it.each(["NaN", "1e24", "-1", "0.1", (1n << 128n).toString()])(
    "rejects invalid atomic balances: %s",
    (available_balance) => {
      expect(() =>
        forecastTreasury([workflow({ available_balance })], assumptions),
      ).toThrow("INVALID_FORECAST_AMOUNT");
    },
  );

  it("rejects duplicate workflows and inconsistent pending slots", () => {
    expect(() =>
      forecastTreasury([workflow(), workflow()], assumptions),
    ).toThrow("INVALID_FORECAST_WORKFLOW");
    expect(() =>
      forecastTreasury(
        [workflow({ pending_execution: { amount: "9", run_index: 0 } })],
        assumptions,
      ),
    ).toThrow("INVALID_FORECAST_PENDING_EXECUTION");
    expect(() =>
      forecastTreasury(
        [workflow({ pending_execution: { amount: "10", run_index: 1 } })],
        assumptions,
      ),
    ).toThrow("INVALID_FORECAST_PENDING_EXECUTION");
  });

  it.each([
    { state: "Completed", runs_completed: 0 },
    { state: "Active", runs_completed: 2 },
    { interval_ms: 1 },
    { interval_ms: 31_536_000_001 },
    { max_runs: 1_001 },
  ] satisfies Partial<ForecastWorkflow>[])(
    "rejects inconsistent contract policy: %j",
    (changes) => {
      expect(() => forecastTreasury([workflow(changes)], assumptions)).toThrow(
        "INVALID_FORECAST_WORKFLOW",
      );
    },
  );

  it.each([
    { horizonDays: 0 },
    { horizonDays: 366 },
    { horizonDays: 1.5 },
    { feePerRun: -1n },
    { asOfMs: NaN },
  ])("rejects invalid forecast assumptions", (changes) => {
    expect(() =>
      forecastTreasury([workflow()], { ...assumptions, ...changes }),
    ).toThrow("INVALID_FORECAST_ASSUMPTIONS");
  });
});

describe("hypothetical one-year yield", () => {
  it("uses an editable APY assumption without floating-point money", () => {
    expect(parseApyBasisPoints("2.35")).toBe(235);
    expect(simulateAnnualYield(100_000n, 100_000n, 235)).toEqual({
      principal: 100_000n,
      hypotheticalGain: 2_350n,
      hypotheticalEndingBalance: 102_350n,
    });
  });

  it("rounds fractional yoctoNEAR down and never invents gains at zero APY", () => {
    expect(simulateAnnualYield(1n, 1n, 9999).hypotheticalGain).toBe(0n);
    expect(simulateAnnualYield(100n, 100n, 0).hypotheticalGain).toBe(0n);
  });

  it("cannot use protected obligations or a negative principal", () => {
    expect(() => simulateAnnualYield(11n, 10n, 100)).toThrow();
    expect(() => simulateAnnualYield(-1n, 10n, 100)).toThrow();
  });

  it.each(["-1", "100.01", "1e2", "1.001", "NaN", "Infinity"])(
    "rejects unsupported APY assumptions: %s",
    (value) => {
      expect(() => parseApyBasisPoints(value)).toThrow(
        "INVALID_APY_ASSUMPTION",
      );
    },
  );
});
