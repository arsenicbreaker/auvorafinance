import { parseExecutionEvents } from "./events.js";
import type { ParsedExecutionEvent } from "./types.js";

export interface ExecutionEvidenceExpectation {
  transactionHash: string;
  contractId: string;
  signerId: string;
  workflowId: string;
  runIndex: number;
  scheduledForMs: string;
  amountYocto: string;
}

export type ExecutionEvidence =
  | { verified: false; reason: string }
  | {
      verified: true;
      event: ParsedExecutionEvent;
      method: "execute_due";
      args: { workflow_id: number };
      attachedDeposit: "0";
      gas: string;
    };

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function succeeded(value: unknown): boolean {
  const status = record(value);
  return "SuccessValue" in status || "SuccessReceiptId" in status;
}

/** Verify RPC evidence independently of the keeper's cached database status. */
export function verifyExecutionEvidence(
  value: unknown,
  expected: ExecutionEvidenceExpectation,
): ExecutionEvidence {
  const reject = (reason: string): ExecutionEvidence => ({
    verified: false,
    reason,
  });
  const outcome = record(value);
  if (outcome.final_execution_status !== "FINAL") return reject("NOT_FINAL");
  if (!succeeded(outcome.status)) return reject("TRANSACTION_FAILED");

  const tx = record(outcome.transaction);
  if (
    tx.hash !== expected.transactionHash ||
    tx.receiver_id !== expected.contractId ||
    tx.signer_id !== expected.signerId
  ) {
    return reject("TRANSACTION_IDENTITY_MISMATCH");
  }
  if (!Array.isArray(tx.actions) || tx.actions.length !== 1) {
    return reject("UNEXPECTED_ACTIONS");
  }
  const call = record(record(tx.actions[0]).FunctionCall);
  if (call.method_name !== "execute_due" || call.deposit !== "0") {
    return reject("UNEXPECTED_CALL");
  }
  let args: Record<string, unknown>;
  try {
    if (typeof call.args !== "string") return reject("INVALID_ARGUMENTS");
    args = record(
      JSON.parse(Buffer.from(call.args, "base64").toString("utf8")),
    );
  } catch {
    return reject("INVALID_ARGUMENTS");
  }
  if (
    !Number.isSafeInteger(args.workflow_id) ||
    String(args.workflow_id) !== expected.workflowId ||
    Object.keys(args).length !== 1
  ) {
    return reject("WORKFLOW_MISMATCH");
  }
  const gas =
    typeof call.gas === "number" && Number.isSafeInteger(call.gas)
      ? String(call.gas)
      : call.gas;
  if (typeof gas !== "string" || !/^[1-9]\d*$/.test(gas)) {
    return reject("INVALID_GAS");
  }

  if (
    !succeeded(record(record(outcome.transaction_outcome).outcome).status) ||
    !Array.isArray(outcome.receipts_outcome) ||
    outcome.receipts_outcome.length === 0
  ) {
    return reject("MISSING_OR_FAILED_OUTCOMES");
  }
  const contractLogs: string[] = [];
  for (const receipt of outcome.receipts_outcome) {
    const execution = record(record(receipt).outcome);
    if (!succeeded(execution.status)) return reject("RECEIPT_FAILED");
    if (execution.executor_id === expected.contractId) {
      if (!Array.isArray(execution.logs)) return reject("MISSING_LOGS");
      contractLogs.push(
        ...execution.logs.filter(
          (log): log is string => typeof log === "string",
        ),
      );
    }
  }
  const events = parseExecutionEvents(contractLogs);
  if (
    events.some(
      (event) =>
        String(event.workflowId) !== expected.workflowId ||
        event.runIndex !== expected.runIndex ||
        String(event.scheduledForMs) !== expected.scheduledForMs ||
        event.amountYocto !== expected.amountYocto,
    )
  ) {
    return reject("EVENT_IDENTITY_MISMATCH");
  }
  const terminal = events.filter(
    (event) => event.event !== "execution_dispatched",
  );
  if (terminal.length !== 1) return reject("TERMINAL_EVENT_REQUIRED");
  const event = terminal[0]!;
  if (
    event.event === "execution_succeeded" &&
    (event.reasonCode !== null ||
      events.filter((item) => item.event === "execution_dispatched").length !==
        1)
  ) {
    return reject("DISPATCH_EVIDENCE_REQUIRED");
  }
  return {
    verified: true,
    event,
    method: "execute_due",
    args: { workflow_id: args.workflow_id as number },
    attachedDeposit: "0",
    gas,
  };
}

export function summarizeExecutionEvidence(
  rows: Array<{ transactionHash: string; evidence: ExecutionEvidence }>,
) {
  const slots = new Map<string, Set<string>>();
  const reserveRejections = new Set<string>();
  for (const { transactionHash, evidence } of rows) {
    if (!evidence.verified) continue;
    const event = evidence.event;
    if (event.event === "execution_succeeded") {
      const key = `${event.workflowId}:${event.runIndex}`;
      const hashes = slots.get(key) ?? new Set<string>();
      hashes.add(transactionHash);
      slots.set(key, hashes);
    }
    if (
      event.event === "execution_skipped" &&
      event.reasonCode === "RESERVE_GUARD"
    ) {
      reserveRejections.add(transactionHash);
    }
  }
  const duplicateSlots = [...slots]
    .filter(([, hashes]) => hashes.size > 1)
    .map(([slot, hashes]) => ({ slot, transactionHashes: [...hashes] }));
  return {
    verifiedPaymentSlots: slots.size,
    twoFinalizedPayments: slots.size >= 2 && duplicateSlots.length === 0,
    verifiedReserveRejections: reserveRejections.size,
    reserveRejection: reserveRejections.size > 0,
    duplicateSlots,
    unverifiedTransactions: rows.filter((row) => !row.evidence.verified).length,
  };
}
