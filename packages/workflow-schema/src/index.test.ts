import { describe, expect, it } from "vitest";

import { createWorkflowSchema, toContractArgs } from "./index.js";

const validWorkflow = {
  recipientId: "recipient.testnet",
  amountYocto: "1000000000000000000000000",
  maxPerRunYocto: "1000000000000000000000000",
  minReserveYocto: "500000000000000000000000",
  intervalMs: 60_000,
  startAtMs: 1_800_000_000_000,
  maxRuns: 3,
  configHash: "sha256:example",
};

describe("createWorkflowSchema", () => {
  it("maps the canonical draft to contract JSON keys", () => {
    expect(toContractArgs(validWorkflow)).toMatchObject({
      recipient_id: "recipient.testnet",
      amount: validWorkflow.amountYocto,
      max_runs: 3,
    });
  });

  it("rejects amount above the per-run policy", () => {
    expect(
      createWorkflowSchema.safeParse({
        ...validWorkflow,
        amountYocto: "1001",
        maxPerRunYocto: "1000",
      }).success,
    ).toBe(false);
  });

  it("rejects unsafe account and schedule values", () => {
    expect(
      createWorkflowSchema.safeParse({
        ...validWorkflow,
        recipientId: "INVALID ACCOUNT",
        intervalMs: 1,
      }).success,
    ).toBe(false);
  });
});
