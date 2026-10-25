import { describe, expect, it } from "vitest";

import {
  EXECUTION_REASON_CODES,
  createWorkflowSchema,
  executionEventSchema,
  toContractArgs,
} from "./index.js";

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

describe("execution event contract", () => {
  it("parses a Phase 2 reserve skip event", () => {
    expect(
      executionEventSchema.parse({
        standard: "auvora",
        version: "1.0.0",
        event: "execution_skipped",
        data: [
          {
            workflow_id: 7,
            run_index: 1,
            scheduled_for_ms: 1_800_000_000_000,
            amount: "10000000000000000000000",
            reason_code: "RESERVE_GUARD",
          },
        ],
      }),
    ).toMatchObject({ event: "execution_skipped" });
  });

  it("keeps callback replay and transfer failure as stable reason codes", () => {
    expect(EXECUTION_REASON_CODES).toContain("TRANSFER_FAILED");
    expect(EXECUTION_REASON_CODES).toContain("CALLBACK_ALREADY_RESOLVED");
  });

  it("rejects an unknown execution reason", () => {
    expect(
      executionEventSchema.safeParse({
        standard: "auvora",
        version: "1.0.0",
        event: "execution_failed",
        data: [
          {
            workflow_id: 7,
            run_index: 1,
            scheduled_for_ms: 1_800_000_000_000,
            amount: "10",
            reason_code: "UNKNOWN_REASON",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
