import type {
  HeartbeatInput,
  KeeperStore,
  PendingTransaction,
  TransactionFinalization,
  TransactionSubmission,
  WorkflowSnapshotInput,
} from "@auvora/db";

export class InMemoryKeeperStore implements KeeperStore {
  readonly snapshots = new Map<string, WorkflowSnapshotInput>();
  readonly submissions = new Map<string, TransactionSubmission>();
  readonly finalizations = new Map<string, TransactionFinalization>();
  readonly heartbeats = new Map<string, HeartbeatInput>();
  private readonly leases = new Map<
    string,
    { holderId: string; expiresAt: Date }
  >();

  async upsertWorkflowSnapshot(input: WorkflowSnapshotInput): Promise<void> {
    this.snapshots.set(workflowKey(input), input);
  }

  async acquireLease(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    holderId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    const key = workflowKey(input);
    const current = this.leases.get(key);
    if (
      current &&
      current.expiresAt.getTime() > input.now.getTime() &&
      current.holderId !== input.holderId
    ) {
      return false;
    }
    this.leases.set(key, {
      holderId: input.holderId,
      expiresAt: input.expiresAt,
    });
    return true;
  }

  async releaseLease(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    holderId: string;
  }): Promise<void> {
    const key = workflowKey(input);
    if (this.leases.get(key)?.holderId === input.holderId) {
      this.leases.delete(key);
    }
  }

  async hasPendingTransaction(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    runIndex: number;
  }): Promise<boolean> {
    return [...this.submissions.values()].some(
      (submission) =>
        submission.network === input.network &&
        submission.contractId === input.contractId &&
        submission.workflowId === input.workflowId &&
        submission.runIndex === input.runIndex &&
        !this.finalizations.has(submission.transactionHash),
    );
  }

  async listPendingTransactions(input: {
    network: "testnet";
    contractId: string;
    signerId: string;
  }): Promise<PendingTransaction[]> {
    return [...this.submissions.values()].filter(
      (submission) =>
        submission.network === input.network &&
        submission.contractId === input.contractId &&
        submission.signerId === input.signerId &&
        !this.finalizations.has(submission.transactionHash),
    );
  }

  async recordSubmission(input: TransactionSubmission): Promise<void> {
    this.submissions.set(input.transactionHash, input);
  }

  async finalizeTransaction(input: TransactionFinalization): Promise<void> {
    this.finalizations.set(input.transactionHash, input);
  }

  async recordHeartbeat(input: HeartbeatInput): Promise<void> {
    this.heartbeats.set(input.serviceId, input);
  }

  async disconnect(): Promise<void> {}
}

function workflowKey(input: {
  network: string;
  contractId: string;
  workflowId: bigint;
}): string {
  return `${input.network}:${input.contractId}:${input.workflowId}`;
}
