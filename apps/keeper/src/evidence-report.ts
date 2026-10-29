import { createPrismaClient } from "@auvora/db";

const network = "testnet" as const;
const databaseUrl = requiredEnvironment("DATABASE_URL");
const contractId = requiredEnvironment("AUVORA_CONTRACT_ID");
const rpcUrl = new URL(requiredEnvironment("NEAR_RPC_URL"));

if (rpcUrl.protocol !== "https:") {
  throw new Error("NEAR_RPC_URL must use HTTPS");
}
if (!contractId.endsWith(".testnet")) {
  throw new Error("AUVORA_CONTRACT_ID must be a testnet account");
}

const client = createPrismaClient(databaseUrl);

try {
  const [status, accounting, workflows, transactions, executions] =
    await Promise.all([
      viewCall("get_status", {}),
      viewCall("get_accounting", {}),
      viewCall("list_workflows", { cursor: null, limit: 50 }),
      client.submittedTransaction.findMany({
        where: { network, contractId },
        orderBy: { submittedAt: "asc" },
        select: {
          transactionHash: true,
          workflowId: true,
          runIndex: true,
          method: true,
          signerId: true,
          submittedAt: true,
          finalState: true,
          errorCode: true,
          finalizedAt: true,
        },
      }),
      client.execution.findMany({
        where: { network, contractId },
        orderBy: [{ workflowId: "asc" }, { runIndex: "asc" }],
        select: {
          workflowId: true,
          runIndex: true,
          status: true,
          reasonCode: true,
          transactionHash: true,
          dispatchedAt: true,
          finalizedAt: true,
        },
      }),
    ]);

  process.stdout.write(
    `${JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        network,
        contractId,
        chain: { status, accounting, workflows },
        keeper: {
          transactions: transactions.map((transaction) => ({
            ...transaction,
            workflowId: transaction.workflowId.toString(),
            explorerUrl: `https://testnet.nearblocks.io/txns/${transaction.transactionHash}`,
          })),
          executions: executions.map((execution) => ({
            ...execution,
            workflowId: execution.workflowId.toString(),
          })),
        },
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await client.$disconnect();
}

async function viewCall(
  methodName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "auvora-evidence-report",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: contractId,
        method_name: methodName,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);

  const payload = (await response.json()) as {
    error?: unknown;
    result?: { result?: number[] };
  };
  if (payload.error || !payload.result?.result) {
    throw new Error(`RPC_VIEW_FAILED_${methodName}`);
  }

  return JSON.parse(Buffer.from(payload.result.result).toString("utf8"));
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
