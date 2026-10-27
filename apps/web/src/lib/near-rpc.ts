export interface ContractStatus {
  last_keeper: string | null;
  owner_id: string;
  status: string;
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
  state: "Active" | "Paused" | "Completed" | "Cancelled";
  config_hash: string;
  created_at_ms: number;
  withdrawable: string;
  pending_execution: {
    run_index: number;
    scheduled_for_ms: number;
    amount: string;
    dispatched_at_ms: number;
  } | null;
}

interface JsonRpcEnvelope<T> {
  error?: { message?: string };
  result?: T;
}

interface CallFunctionResult {
  result: number[];
}

interface TransactionResult {
  final_execution_status?: string;
  status?: Record<string, unknown>;
  transaction?: { hash?: string };
}

async function rpc<T>(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(rpcUrl, {
    body: JSON.stringify({ id: "auvora-web", jsonrpc: "2.0", method, params }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`RPC_HTTP_${response.status}`);
  }

  const envelope = (await response.json()) as JsonRpcEnvelope<T>;
  if (envelope.error || envelope.result === undefined) {
    throw new Error(envelope.error?.message ?? "RPC_INVALID_RESPONSE");
  }

  return envelope.result;
}

export async function readContractStatus(
  rpcUrl: string,
  contractId: string,
): Promise<ContractStatus> {
  const result = await rpc<CallFunctionResult>(rpcUrl, "query", {
    account_id: contractId,
    args_base64: btoa("{}"),
    finality: "final",
    method_name: "get_status",
    request_type: "call_function",
  });
  const decoded = new TextDecoder().decode(Uint8Array.from(result.result));
  return JSON.parse(decoded) as ContractStatus;
}

export async function readWorkflowStorageCost(
  rpcUrl: string,
  contractId: string,
  ownerId: string,
  recipientId: string,
  configHash: string,
): Promise<bigint> {
  const result = await rpc<CallFunctionResult>(rpcUrl, "query", {
    account_id: contractId,
    args_base64: btoa(
      JSON.stringify({
        owner_id: ownerId,
        recipient_id: recipientId,
        config_hash: configHash,
      }),
    ),
    finality: "final",
    method_name: "estimate_workflow_storage_cost",
    request_type: "call_function",
  });
  const decoded = new TextDecoder().decode(Uint8Array.from(result.result));
  const value: unknown = JSON.parse(decoded);
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("RPC_INVALID_STORAGE_ESTIMATE");
  }
  return BigInt(value);
}

export async function readRecipientAllowed(
  rpcUrl: string,
  contractId: string,
  ownerId: string,
  recipientId: string,
): Promise<boolean> {
  const result = await rpc<CallFunctionResult>(rpcUrl, "query", {
    account_id: contractId,
    args_base64: btoa(
      JSON.stringify({ owner_id: ownerId, account_id: recipientId }),
    ),
    finality: "final",
    method_name: "is_recipient_allowed",
    request_type: "call_function",
  });
  const decoded = new TextDecoder().decode(Uint8Array.from(result.result));
  const value: unknown = JSON.parse(decoded);
  if (typeof value !== "boolean") {
    throw new Error("RPC_INVALID_ALLOWLIST_RESPONSE");
  }
  return value;
}

export async function readOwnerWorkflows(
  rpcUrl: string,
  contractId: string,
  ownerId: string,
): Promise<WorkflowView[]> {
  const workflows: WorkflowView[] = [];
  const pageSize = 50;

  for (let cursor = 0; ; cursor += pageSize) {
    const result = await rpc<CallFunctionResult>(rpcUrl, "query", {
      account_id: contractId,
      args_base64: btoa(
        JSON.stringify({ owner_id: ownerId, cursor, limit: pageSize }),
      ),
      finality: "final",
      method_name: "list_owner_workflows",
      request_type: "call_function",
    });
    const decoded = new TextDecoder().decode(Uint8Array.from(result.result));
    const page: unknown = JSON.parse(decoded);
    if (!Array.isArray(page)) {
      throw new Error("RPC_INVALID_WORKFLOW_LIST");
    }
    const parsed = page.map(parseWorkflowView);
    workflows.push(...parsed);
    if (parsed.length < pageSize) return workflows;
  }
}

function parseWorkflowView(value: unknown): WorkflowView {
  if (!value || typeof value !== "object") {
    throw new Error("RPC_INVALID_WORKFLOW");
  }
  const workflow = value as Partial<WorkflowView>;
  if (
    typeof workflow.id !== "number" ||
    typeof workflow.owner_id !== "string" ||
    typeof workflow.recipient_id !== "string" ||
    typeof workflow.amount !== "string" ||
    typeof workflow.available_balance !== "string" ||
    typeof workflow.withdrawable !== "string" ||
    typeof workflow.max_runs !== "number" ||
    typeof workflow.runs_completed !== "number" ||
    typeof workflow.next_run_at_ms !== "number" ||
    !["Active", "Paused", "Completed", "Cancelled"].includes(
      workflow.state ?? "",
    )
  ) {
    throw new Error("RPC_INVALID_WORKFLOW");
  }
  return value as WorkflowView;
}

export type Finality = "failure" | "pending" | "success";

export function classifyFinalExecution(result: TransactionResult): Finality {
  if (result.final_execution_status !== "FINAL") {
    return "pending";
  }

  if (result.status && "Failure" in result.status) {
    return "failure";
  }

  return "success";
}

export async function readTransactionFinality(
  rpcUrl: string,
  transactionHash: string,
  senderAccountId: string,
): Promise<Finality> {
  const result = await rpc<TransactionResult>(rpcUrl, "tx", {
    sender_account_id: senderAccountId,
    tx_hash: transactionHash,
    wait_until: "FINAL",
  });
  return classifyFinalExecution(result);
}
