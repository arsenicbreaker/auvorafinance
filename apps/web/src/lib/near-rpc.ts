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
  block_hash?: string;
  block_height?: number;
}

export interface OwnerWorkflowSnapshot {
  ownerId: string;
  blockHash: string;
  blockHeight: number;
  timestampMs: number;
  workflows: WorkflowView[];
}

interface TransactionResult {
  final_execution_status?: string;
  status?: Record<string, unknown>;
  transaction?: { hash?: string; signer_id?: string; receiver_id?: string };
  transaction_outcome?: { outcome?: { status?: Record<string, unknown> } };
  receipts_outcome?: Array<{ outcome?: { status?: Record<string, unknown> } }>;
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
    signal: AbortSignal.timeout(15_000),
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
  atBlock?: { hash: string; height: number },
): Promise<WorkflowView[]> {
  const workflows: WorkflowView[] = [];
  const pageSize = 50;
  const seen = new Set<number>();

  for (let cursor = 0; ; cursor += pageSize) {
    const result = await rpc<CallFunctionResult>(rpcUrl, "query", {
      account_id: contractId,
      args_base64: btoa(
        JSON.stringify({ owner_id: ownerId, cursor, limit: pageSize }),
      ),
      ...(atBlock ? { block_id: atBlock.hash } : { finality: "final" }),
      method_name: "list_owner_workflows",
      request_type: "call_function",
    });
    if (
      atBlock &&
      (result.block_hash !== atBlock.hash ||
        result.block_height !== atBlock.height)
    ) {
      throw new Error("RPC_SNAPSHOT_BLOCK_MISMATCH");
    }
    const decoded = new TextDecoder().decode(Uint8Array.from(result.result));
    const page: unknown = JSON.parse(decoded);
    if (!Array.isArray(page)) {
      throw new Error("RPC_INVALID_WORKFLOW_LIST");
    }
    const parsed = page.map(parseWorkflowView);
    if (parsed.length > pageSize) throw new Error("RPC_INVALID_WORKFLOW_PAGE");
    for (const workflow of parsed) {
      if (workflow.owner_id !== ownerId || seen.has(workflow.id))
        throw new Error("RPC_INVALID_WORKFLOW_PAGE");
      seen.add(workflow.id);
    }
    workflows.push(...parsed);
    if (parsed.length < pageSize) return workflows;
  }
}

export async function readOwnerWorkflowSnapshot(
  rpcUrl: string,
  contractId: string,
  ownerId: string,
): Promise<OwnerWorkflowSnapshot> {
  if (
    !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(ownerId) ||
    ownerId.length > 64
  ) {
    throw new Error("INVALID_TESTNET_OWNER");
  }
  const block = await rpc<{
    header: { hash: string; height: number; timestamp_nanosec: string };
  }>(rpcUrl, "block", { finality: "final" });
  const header = block?.header;
  if (
    !header ||
    typeof header.hash !== "string" ||
    !header.hash ||
    !Number.isSafeInteger(header.height) ||
    header.height < 0 ||
    typeof header.timestamp_nanosec !== "string" ||
    !/^\d{1,22}$/.test(header.timestamp_nanosec)
  ) {
    throw new Error("RPC_INVALID_SNAPSHOT_BLOCK");
  }
  const timestampMs = Number(BigInt(header.timestamp_nanosec) / 1_000_000n);
  if (!Number.isSafeInteger(timestampMs) || timestampMs > 8_640_000_000_000_000)
    throw new Error("RPC_INVALID_SNAPSHOT_BLOCK");
  const workflows = await readOwnerWorkflows(rpcUrl, contractId, ownerId, {
    hash: header.hash,
    height: header.height,
  });
  return {
    ownerId,
    blockHash: header.hash,
    blockHeight: header.height,
    timestampMs,
    workflows,
  };
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

  const statuses = [
    result.status,
    result.transaction_outcome?.outcome?.status,
    ...(result.receipts_outcome ?? []).map(
      (receipt) => receipt.outcome?.status,
    ),
  ];
  if (statuses.some((status) => status && "Failure" in status)) {
    return "failure";
  }

  if (
    typeof result.status?.SuccessValue !== "string" ||
    !result.receipts_outcome?.length ||
    statuses.some(
      (status) =>
        !status ||
        !(
          typeof status.SuccessValue === "string" ||
          typeof status.SuccessReceiptId === "string"
        ),
    )
  ) {
    return "pending";
  }
  return "success";
}

export async function readTransactionFinality(
  rpcUrl: string,
  transactionHash: string,
  senderAccountId: string,
  receiverAccountId?: string,
): Promise<Finality> {
  const result = await rpc<TransactionResult>(rpcUrl, "tx", {
    sender_account_id: senderAccountId,
    tx_hash: transactionHash,
    wait_until: "FINAL",
  });
  if (
    result.transaction?.hash !== transactionHash ||
    result.transaction.signer_id !== senderAccountId ||
    (receiverAccountId !== undefined &&
      result.transaction.receiver_id !== receiverAccountId)
  ) {
    throw new Error("RPC_TRANSACTION_IDENTITY_MISMATCH");
  }
  return classifyFinalExecution(result);
}
