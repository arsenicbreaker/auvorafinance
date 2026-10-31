import type { KeeperStore, PendingTransaction } from "@auvora/db";
import type {
  FinalizedExecution,
  KeeperNearClient,
  PreparedExecutionTransaction,
  WorkflowView,
} from "@auvora/near-client";

import type { KeeperRuntimeState } from "./state.js";

export interface KeeperCycleOptions {
  network: "testnet";
  contractId: string;
  signerId: string;
  instanceId: string;
  pageSize: number;
  leaseMs: number;
  finalityTimeoutMs: number;
  near: KeeperNearClient;
  store: KeeperStore;
  state: KeeperRuntimeState;
  now?: () => Date;
}

export interface KeeperCycleStats {
  discovered: number;
  candidates: number;
  leased: number;
  submitted: number;
  finalized: number;
  reconciliationPending: number;
  submissionErrors: number;
}

export async function runKeeperCycle(
  options: KeeperCycleOptions,
): Promise<KeeperCycleStats> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const stats: KeeperCycleStats = {
    discovered: 0,
    candidates: 0,
    leased: 0,
    submitted: 0,
    finalized: 0,
    reconciliationPending: 0,
    submissionErrors: 0,
  };
  options.state.startPoll(startedAt);

  try {
    const pending = await options.store.listPendingTransactions({
      network: options.network,
      contractId: options.contractId,
      signerId: options.signerId,
    });
    for (const transaction of pending) {
      const reconciled = await reconcileTransaction(options, transaction, now);
      if (reconciled) stats.finalized += 1;
      else stats.reconciliationPending += 1;
    }

    const workflows = await discoverWorkflows(options);
    stats.discovered = workflows.length;
    for (const workflow of workflows) {
      await options.store.upsertWorkflowSnapshot(
        toSnapshot(options, workflow, now()),
      );
      if (!isDueCandidate(workflow, now())) continue;
      stats.candidates += 1;
      if (
        await options.store.hasPendingTransaction({
          network: options.network,
          contractId: options.contractId,
          workflowId: BigInt(workflow.id),
          runIndex: workflow.runs_completed,
        })
      ) {
        continue;
      }

      const leaseAt = now();
      const acquired = await options.store.acquireLease({
        network: options.network,
        contractId: options.contractId,
        workflowId: BigInt(workflow.id),
        holderId: options.instanceId,
        now: leaseAt,
        expiresAt: new Date(leaseAt.getTime() + options.leaseMs),
      });
      if (!acquired) continue;
      stats.leased += 1;

      try {
        const current = await options.near.getWorkflow(workflow.id);
        if (!current) continue;
        await options.store.upsertWorkflowSnapshot(
          toSnapshot(options, current, now()),
        );
        if (!isDueCandidate(current, now())) continue;
        if (
          await options.store.hasPendingTransaction({
            network: options.network,
            contractId: options.contractId,
            workflowId: BigInt(current.id),
            runIndex: current.runs_completed,
          })
        ) {
          continue;
        }

        let prepared: PreparedExecutionTransaction;
        try {
          prepared = await options.near.prepareExecuteDue(current.id);
        } catch {
          stats.submissionErrors += 1;
          continue;
        }

        // Persist the locally computed hash and signed bytes before broadcast.
        // If the RPC accepts the transaction but drops its response, the exact
        // same transaction can be reconciled or safely rebroadcast after restart.
        const submittedAt = now();
        await options.store.recordSubmission({
          network: options.network,
          transactionHash: prepared.transactionHash,
          contractId: options.contractId,
          workflowId: BigInt(current.id),
          runIndex: current.runs_completed,
          scheduledForMs: BigInt(current.next_run_at_ms),
          amountYocto: current.amount,
          signerId: options.signerId,
          signedTransactionBase64: prepared.signedTransactionBase64,
          method: "execute_due",
          submittedAt,
        });
        stats.submitted += 1;

        try {
          await options.near.broadcastExecuteDue(
            prepared.signedTransactionBase64,
          );
        } catch {
          stats.submissionErrors += 1;
          continue;
        }

        try {
          const final = await withTimeout(
            options.near.waitForFinalExecution(prepared.transactionHash),
            options.finalityTimeoutMs,
          );
          await recordFinalization(options, current, final, now());
          stats.finalized += 1;
        } catch {
          stats.submissionErrors += 1;
        }
      } finally {
        await options.store.releaseLease({
          network: options.network,
          contractId: options.contractId,
          workflowId: BigInt(workflow.id),
          holderId: options.instanceId,
        });
      }
    }

    const completedAt = now();
    await options.store.recordHeartbeat({
      serviceId: options.instanceId,
      network: options.network,
      version: "phase-3",
      lastPollStartedAt: startedAt,
      lastSuccessfulPollAt: completedAt,
      lastErrorCode: null,
    });
    options.state.completePoll(completedAt);
    return stats;
  } catch (error) {
    const errorCode =
      error instanceof Error ? error.name : "KEEPER_CYCLE_FAILED";
    options.state.failPoll(errorCode);
    await options.store.recordHeartbeat({
      serviceId: options.instanceId,
      network: options.network,
      version: "phase-3",
      lastPollStartedAt: startedAt,
      lastSuccessfulPollAt: options.state.snapshot().lastSuccessfulPollAt,
      lastErrorCode: errorCode,
    });
    throw error;
  }
}

async function discoverWorkflows(
  options: KeeperCycleOptions,
): Promise<WorkflowView[]> {
  const workflows: WorkflowView[] = [];
  for (let cursor = 0; ; cursor += options.pageSize) {
    const page = await options.near.listWorkflows(cursor, options.pageSize);
    workflows.push(...page);
    if (page.length < options.pageSize) return workflows;
  }
}

async function reconcileTransaction(
  options: KeeperCycleOptions,
  transaction: PendingTransaction,
  now: () => Date,
): Promise<boolean> {
  try {
    const final = await withTimeout(
      options.near.waitForFinalExecution(transaction.transactionHash),
      options.finalityTimeoutMs,
    );
    await options.store.finalizeTransaction({
      network: options.network,
      transactionHash: transaction.transactionHash,
      contractId: transaction.contractId,
      workflowId: transaction.workflowId,
      runIndex: transaction.runIndex,
      scheduledForMs: transaction.scheduledForMs,
      amountYocto: transaction.amountYocto,
      status: final.status,
      reasonCode: final.reasonCode,
      finalizedAt: now(),
    });
    return true;
  } catch {
    if (transaction.signedTransactionBase64) {
      try {
        await options.near.broadcastExecuteDue(
          transaction.signedTransactionBase64,
        );
      } catch {
        // The original transaction may already be accepted, finalized, or have
        // an old nonce. Its known hash remains the source of truth next cycle.
      }
    }
    return false;
  }
}

async function recordFinalization(
  options: KeeperCycleOptions,
  workflow: WorkflowView,
  final: FinalizedExecution,
  finalizedAt: Date,
): Promise<void> {
  await options.store.finalizeTransaction({
    network: options.network,
    transactionHash: final.transactionHash,
    contractId: options.contractId,
    workflowId: BigInt(workflow.id),
    runIndex: workflow.runs_completed,
    scheduledForMs: BigInt(workflow.next_run_at_ms),
    amountYocto: workflow.amount,
    status: final.status,
    reasonCode: final.reasonCode,
    finalizedAt,
  });
}

function isDueCandidate(workflow: WorkflowView, now: Date): boolean {
  return (
    workflow.state === "Active" &&
    workflow.pending_execution === null &&
    workflow.next_run_at_ms <= now.getTime()
  );
}

function toSnapshot(
  options: Pick<KeeperCycleOptions, "network" | "contractId">,
  workflow: WorkflowView,
  observedAt: Date,
) {
  return {
    network: options.network,
    contractId: options.contractId,
    workflowId: BigInt(workflow.id),
    ownerId: workflow.owner_id,
    recipientId: workflow.recipient_id,
    amountYocto: workflow.amount,
    minReserveYocto: workflow.min_reserve,
    availableYocto: workflow.available_balance,
    intervalMs: BigInt(workflow.interval_ms),
    nextRunAtMs: BigInt(workflow.next_run_at_ms),
    maxRuns: workflow.max_runs,
    runsCompleted: workflow.runs_completed,
    state: workflow.state,
    pendingRunIndex: workflow.pending_execution?.run_index ?? null,
    observedAt,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("FINALITY_TIMEOUT")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
