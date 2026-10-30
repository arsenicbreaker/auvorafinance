import { describe, expect, it } from "vitest";

import {
  summarizeExecutionEvidence,
  verifyExecutionEvidence,
} from "./evidence.js";

const expected = {
  transactionHash: "11111111111111111111111111111111",
  contractId: "auvora.testnet",
  signerId: "keeper.testnet",
  workflowId: "7",
  runIndex: 0,
  scheduledForMs: "1800000000000",
  amountYocto: "1000000000000000000000",
};

function event(name: string, reasonCode?: string) {
  return `EVENT_JSON:${JSON.stringify({
    standard: "auvora",
    version: "1.0.0",
    event: name,
    data: [
      {
        workflow_id: 7,
        run_index: 0,
        scheduled_for_ms: 1_800_000_000_000,
        amount: expected.amountYocto,
        ...(reasonCode ? { reason_code: reasonCode } : {}),
      },
    ],
  })}`;
}

function fixture() {
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    transaction: {
      hash: expected.transactionHash,
      receiver_id: expected.contractId,
      signer_id: expected.signerId,
      actions: [
        {
          FunctionCall: {
            method_name: "execute_due",
            args: Buffer.from('{"workflow_id":7}').toString("base64"),
            deposit: "0",
            gas: 100_000_000_000_000,
          },
        },
      ],
    },
    transaction_outcome: {
      outcome: { status: { SuccessReceiptId: "dispatch" } },
    },
    receipts_outcome: [
      {
        outcome: {
          executor_id: expected.contractId,
          status: { SuccessReceiptId: "callback" },
          logs: [event("execution_dispatched")],
        },
      },
      {
        outcome: {
          executor_id: expected.contractId,
          status: { SuccessValue: "" },
          logs: [event("execution_succeeded")],
        },
      },
    ],
  };
}

describe("final execution evidence", () => {
  it("verifies final identity, decoded call, dispatch and callback events", () => {
    expect(verifyExecutionEvidence(fixture(), expected)).toMatchObject({
      verified: true,
      method: "execute_due",
      args: { workflow_id: 7 },
      attachedDeposit: "0",
      gas: "100000000000000",
      event: { event: "execution_succeeded", workflowId: 7, runIndex: 0 },
    });
  });

  it.each(["NONE", "EXECUTED_OPTIMISTIC", "EXECUTED", "INCLUDED_FINAL"])(
    "rejects %s even when the cached transaction claims success",
    (final_execution_status) => {
      expect(
        verifyExecutionEvidence(
          { ...fixture(), final_execution_status },
          expected,
        ),
      ).toEqual({ verified: false, reason: "NOT_FINAL" });
    },
  );

  it.each(["hash", "signer_id", "receiver_id"] as const)(
    "rejects a different transaction %s",
    (field) => {
      const outcome = fixture();
      outcome.transaction[field] = "wrong.testnet";
      expect(verifyExecutionEvidence(outcome, expected)).toEqual({
        verified: false,
        reason: "TRANSACTION_IDENTITY_MISMATCH",
      });
    },
  );

  it("rejects attached deposits and action batches", () => {
    const outcome = fixture();
    outcome.transaction.actions[0]!.FunctionCall.deposit = "1";
    expect(verifyExecutionEvidence(outcome, expected)).toMatchObject({
      verified: false,
    });
    outcome.transaction.actions.push(outcome.transaction.actions[0]!);
    expect(verifyExecutionEvidence(outcome, expected)).toEqual({
      verified: false,
      reason: "UNEXPECTED_ACTIONS",
    });
  });

  it("rejects malformed or mismatched workflow arguments", () => {
    for (const args of [
      "not-json",
      '{"workflow_id":8}',
      '{"workflow_id":7,"extra":true}',
    ]) {
      const outcome = fixture();
      outcome.transaction.actions[0]!.FunctionCall.args =
        Buffer.from(args).toString("base64");
      expect(verifyExecutionEvidence(outcome, expected).verified).toBe(false);
    }
  });

  it("ignores lookalike logs emitted by another account", () => {
    const outcome = fixture();
    outcome.receipts_outcome[1]!.outcome.executor_id = "impostor.testnet";
    expect(verifyExecutionEvidence(outcome, expected)).toEqual({
      verified: false,
      reason: "TERMINAL_EVENT_REQUIRED",
    });
  });

  it("rejects events for another slot, schedule, or amount", () => {
    for (const override of [
      { runIndex: 1 },
      { scheduledForMs: "1800000060000" },
      { amountYocto: "1" },
    ]) {
      expect(
        verifyExecutionEvidence(fixture(), { ...expected, ...override }),
      ).toEqual({
        verified: false,
        reason: "EVENT_IDENTITY_MISMATCH",
      });
    }
  });

  it("rejects a failed receipt even if the final callback reports success", () => {
    const outcome = fixture();
    const failed = {
      ...outcome,
      receipts_outcome: [
        ...outcome.receipts_outcome,
        {
          outcome: {
            executor_id: "recipient.testnet",
            logs: [],
            status: { Failure: {} },
          },
        },
      ],
    };
    expect(verifyExecutionEvidence(failed, expected)).toEqual({
      verified: false,
      reason: "RECEIPT_FAILED",
    });
  });

  it("requires exactly one terminal event and a successful dispatch", () => {
    const outcome = fixture();
    outcome.receipts_outcome[0]!.outcome.logs = [];
    expect(verifyExecutionEvidence(outcome, expected)).toEqual({
      verified: false,
      reason: "DISPATCH_EVIDENCE_REQUIRED",
    });
    outcome.receipts_outcome[0]!.outcome.logs = [event("execution_succeeded")];
    expect(verifyExecutionEvidence(outcome, expected)).toEqual({
      verified: false,
      reason: "TERMINAL_EVENT_REQUIRED",
    });
  });

  it("verifies a reserve rejection without requiring a transfer dispatch", () => {
    const outcome = fixture();
    outcome.receipts_outcome = [outcome.receipts_outcome[1]!];
    outcome.receipts_outcome[0]!.outcome.logs = [
      event("execution_skipped", "RESERVE_GUARD"),
    ];
    const evidence = verifyExecutionEvidence(outcome, expected);
    expect(evidence).toMatchObject({
      verified: true,
      event: { reasonCode: "RESERVE_GUARD" },
    });
    expect(
      summarizeExecutionEvidence([
        { transactionHash: expected.transactionHash, evidence },
      ]),
    ).toMatchObject({ reserveRejection: true, twoFinalizedPayments: false });
  });

  it("deduplicates hashes and detects multiple payments for the same run slot", () => {
    const evidence = verifyExecutionEvidence(fixture(), expected);
    const first = { transactionHash: expected.transactionHash, evidence };
    expect(summarizeExecutionEvidence([first, first])).toMatchObject({
      verifiedPaymentSlots: 1,
      duplicateSlots: [],
      twoFinalizedPayments: false,
    });
    expect(
      summarizeExecutionEvidence([
        first,
        { ...first, transactionHash: "other" },
      ]),
    ).toMatchObject({
      twoFinalizedPayments: false,
      duplicateSlots: [{ slot: "7:0" }],
    });
  });

  it("counts two distinct slots and excludes unknown RPC results", () => {
    const evidence = verifyExecutionEvidence(fixture(), expected);
    if (!evidence.verified) throw new Error("Invalid test fixture");
    expect(
      summarizeExecutionEvidence([
        { transactionHash: "first", evidence },
        {
          transactionHash: "second",
          evidence: {
            ...evidence,
            event: { ...evidence.event, runIndex: 1 },
          },
        },
        {
          transactionHash: "unknown",
          evidence: { verified: false, reason: "RPC_UNAVAILABLE" },
        },
      ]),
    ).toMatchObject({
      verifiedPaymentSlots: 2,
      twoFinalizedPayments: true,
      unverifiedTransactions: 1,
    });
  });
});
