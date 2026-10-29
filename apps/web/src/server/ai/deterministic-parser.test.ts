import { describe, expect, it } from "vitest";

import { parseDeterministicWorkflow } from "./deterministic-parser.js";

describe("deterministic workflow parser", () => {
  it("parses the complete weekly native NEAR corpus prompt", () => {
    const result = parseDeterministicWorkflow(
      "Pay 2 NEAR to recipient.testnet every week starting 2026-11-03T10:00:00Z, maximum 4 times, and keep a 5 NEAR reserve.",
    );

    expect(result).toMatchObject({
      status: "ready",
      source: "deterministic",
      draft: {
        recipient: "recipient.testnet",
        amountNear: "2",
        intervalSeconds: 604_800,
        maxRuns: 4,
        minReserveNear: "5",
      },
    });
  });

  it("asks for the account ID and start time in the PRD hero prompt", () => {
    const result = parseDeterministicWorkflow(
      "Bayar 2 NEAR ke kontributor setiap minggu, maksimal 4 kali, dan sisakan sedikitnya 5 NEAR.",
    );

    expect(result).toMatchObject({
      status: "clarification",
      missingFields: expect.arrayContaining(["recipient", "startAt"]),
    });
  });

  it("rejects non-native assets", () => {
    expect(
      parseDeterministicWorkflow("Pay 2 USDC to recipient.testnet every week."),
    ).toMatchObject({ status: "rejected", code: "UNSUPPORTED_ASSET" });
  });
});
