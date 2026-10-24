export interface ContractStatus {
  last_keeper: string | null;
  owner_id: string;
  status: string;
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
