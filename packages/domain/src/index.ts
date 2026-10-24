export const YOCTO_PER_NEAR = 10n ** 24n;

export function parseNear(value: string): bigint {
  const normalized = value.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,24})?$/.test(normalized)) {
    throw new Error("INVALID_NEAR_AMOUNT");
  }

  const [whole = "0", fractional = ""] = normalized.split(".");
  return (
    BigInt(whole) * YOCTO_PER_NEAR + BigInt(fractional.padEnd(24, "0") || "0")
  );
}

export function formatNear(value: bigint): string {
  if (value < 0n) throw new Error("NEGATIVE_YOCTO_AMOUNT");
  const whole = value / YOCTO_PER_NEAR;
  const fraction = (value % YOCTO_PER_NEAR)
    .toString()
    .padStart(24, "0")
    .replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

export function remainingObligation(
  amountPerRun: bigint,
  maxRuns: number,
  runsCompleted: number,
): bigint {
  if (
    amountPerRun < 0n ||
    !Number.isSafeInteger(maxRuns) ||
    !Number.isSafeInteger(runsCompleted) ||
    runsCompleted < 0 ||
    runsCompleted > maxRuns
  ) {
    throw new Error("INVALID_OBLIGATION_INPUT");
  }
  return amountPerRun * BigInt(maxRuns - runsCompleted);
}

export function activeWithdrawable(
  available: bigint,
  amountPerRun: bigint,
  minReserve: bigint,
  maxRuns: number,
  runsCompleted: number,
): bigint {
  const locked =
    remainingObligation(amountPerRun, maxRuns, runsCompleted) + minReserve;
  return available > locked ? available - locked : 0n;
}
