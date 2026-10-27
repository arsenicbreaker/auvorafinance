export interface WorkflowSnapshotInput {
  network: "testnet";
  contractId: string;
  workflowId: bigint;
  ownerId: string;
  recipientId: string;
  amountYocto: string;
  minReserveYocto: string;
  availableYocto: string;
  intervalMs: bigint;
  nextRunAtMs: bigint;
  maxRuns: number;
  runsCompleted: number;
  state: string;
  pendingRunIndex: number | null;
  observedAt: Date;
}

export interface PendingTransaction {
  network: "testnet";
  transactionHash: string;
  contractId: string;
  workflowId: bigint;
  runIndex: number;
  scheduledForMs: bigint;
  amountYocto: string;
  signerId: string;
  signedTransactionBase64: string | null;
}

export interface TransactionSubmission extends PendingTransaction {
  method: "execute_due";
  submittedAt: Date;
}

export type RecordedExecutionStatus =
  | "Succeeded"
  | "Failed"
  | "Skipped"
  | "Ignored";

export interface TransactionFinalization {
  network: "testnet";
  transactionHash: string;
  contractId: string;
  workflowId: bigint;
  runIndex: number;
  scheduledForMs: bigint;
  amountYocto: string;
  status: RecordedExecutionStatus;
  reasonCode: string | null;
  finalizedAt: Date;
}

export interface HeartbeatInput {
  serviceId: string;
  network: "testnet";
  version: string;
  lastPollStartedAt: Date;
  lastSuccessfulPollAt: Date | null;
  lastErrorCode: string | null;
}

export interface KeeperStore {
  upsertWorkflowSnapshot(input: WorkflowSnapshotInput): Promise<void>;
  acquireLease(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    holderId: string;
    now: Date;
    expiresAt: Date;
  }): Promise<boolean>;
  releaseLease(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    holderId: string;
  }): Promise<void>;
  hasPendingTransaction(input: {
    network: "testnet";
    contractId: string;
    workflowId: bigint;
    runIndex: number;
  }): Promise<boolean>;
  listPendingTransactions(input: {
    network: "testnet";
    contractId: string;
    signerId: string;
  }): Promise<PendingTransaction[]>;
  recordSubmission(input: TransactionSubmission): Promise<void>;
  finalizeTransaction(input: TransactionFinalization): Promise<void>;
  recordHeartbeat(input: HeartbeatInput): Promise<void>;
  disconnect(): Promise<void>;
}
