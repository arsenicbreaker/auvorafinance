export type WorkflowState = "Active" | "Paused" | "Completed" | "Cancelled";

export interface PendingExecutionView {
  run_index: number;
  scheduled_for_ms: number;
  amount: string;
  dispatched_at_ms: number;
}

export interface WorkflowView {
  id: number;
  owner_id: string;
  recipient_id: string;
  amount: string;
  max_per_run: string;
  min_reserve: string;
  interval_ms: number;
  next_run_at_ms: number;
  max_runs: number;
  runs_completed: number;
  available_balance: string;
  state: WorkflowState;
  config_hash: string;
  created_at_ms: number;
  withdrawable: string;
  pending_execution: PendingExecutionView | null;
}

export interface ParsedExecutionEvent {
  event:
    | "execution_dispatched"
    | "execution_skipped"
    | "execution_succeeded"
    | "execution_failed";
  workflowId: number;
  runIndex: number;
  scheduledForMs: number;
  amountYocto: string;
  reasonCode: string | null;
}

export interface FinalizedExecution {
  transactionHash: string;
  status: "Succeeded" | "Failed" | "Skipped" | "Ignored";
  reasonCode: string | null;
  event: ParsedExecutionEvent | null;
  explorerUrl: string;
}

export interface KeeperNearClient {
  listWorkflows(cursor: number, limit: number): Promise<WorkflowView[]>;
  getWorkflow(workflowId: number): Promise<WorkflowView | null>;
  submitExecuteDue(workflowId: number): Promise<string>;
  waitForFinalExecution(transactionHash: string): Promise<FinalizedExecution>;
}
