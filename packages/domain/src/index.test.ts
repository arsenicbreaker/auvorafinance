import { describe, expect, it } from "vitest";

import {
  activeWithdrawable,
  formatNear,
  parseNear,
  YOCTO_PER_NEAR,
} from "./index.js";

describe("NEAR atomic amount conversion", () => {
  it("round-trips values without floating point", () => {
    const amount = "12.345678901234567890123456";
    expect(formatNear(parseNear(amount))).toBe(amount);
  });

  it("preserves a single yoctoNEAR", () => {
    expect(parseNear("0.000000000000000000000001")).toBe(1n);
    expect(formatNear(YOCTO_PER_NEAR + 1n)).toBe("1.000000000000000000000001");
  });

  it("rejects excess precision and exponent notation", () => {
    expect(() => parseNear("0.0000000000000000000000001")).toThrow();
    expect(() => parseNear("1e3")).toThrow();
  });
});

describe("activeWithdrawable", () => {
  it("uses an exact conservative boundary", () => {
    expect(activeWithdrawable(25n, 10n, 5n, 2, 0)).toBe(0n);
    expect(activeWithdrawable(26n, 10n, 5n, 2, 0)).toBe(1n);
  });
});
