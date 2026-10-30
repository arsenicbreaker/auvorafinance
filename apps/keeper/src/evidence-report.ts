import { createPrismaClient } from "@auvora/db";
import {
  summarizeExecutionEvidence,
  verifyExecutionEvidence,
  workflowViewSchema,
} from "@auvora/near-client";
import type { ExecutionEvidence, WorkflowView } from "@auvora/near-client";

const network = "testnet" as const;
const chainOnly = process.argv.includes("--chain-only");
const requireEvidence = process.argv.includes("--require-evidence");
if (chainOnly && requireEvidence) {
  throw new Error("--require-evidence needs the keeper database");
}
const contractId = requiredEnvironment("AUVORA_CONTRACT_ID");
const rpcUrl = new URL(requiredEnvironment("NEAR_RPC_URL"));

if (rpcUrl.protocol !== "https:") {
  throw new Error("NEAR_RPC_URL must use HTTPS");
}
if (!contractId.endsWith(".testnet")) {
  throw new Error("AUVORA_CONTRACT_ID must be a testnet account");
}
if (requiredEnvironment("NEAR_NETWORK_ID") !== network) {
  throw new Error("Evidence reporting is testnet-only");
}

const client = chainOnly
  ? null
  : createPrismaClient(requiredEnvironment("DATABASE_URL"));

try {
  const [status, accounting, workflows, transactions, executions] =
    await Promise.all([
      viewCall("get_status", {}),
      viewCall("get_accounting", {}),
      listAllWorkflows(),
      client?.submittedTransaction.findMany({
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
          scheduledForMs: true,
          amountYocto: true,
        },
      }) ?? Promise.resolve([]),
      client?.execution.findMany({
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
      }) ?? Promise.resolve([]),
    ]);

  const verifiedTransactions = [];
  for (const transaction of transactions) {
    let evidence: ExecutionEvidence;
    try {
      const outcome = await rpcCall("EXPERIMENTAL_tx_status", {
        tx_hash: transaction.transactionHash,
        sender_account_id: transaction.signerId,
        wait_until: "FINAL",
      });
      evidence = verifyExecutionEvidence(outcome, {
        ...transaction,
        contractId,
        workflowId: transaction.workflowId.toString(),
        scheduledForMs: transaction.scheduledForMs.toString(),
      });
    } catch {
      evidence = { verified: false, reason: "RPC_UNAVAILABLE" };
    }
    verifiedTransactions.push({
      ...transaction,
      workflowId: transaction.workflowId.toString(),
      scheduledForMs: transaction.scheduledForMs.toString(),
      explorerUrl: `https://testnet.nearblocks.io/txns/${transaction.transactionHash}`,
      evidence,
    });
  }
  const evidenceSummary = summarizeExecutionEvidence(verifiedTransactions);

  process.stdout.write(
    `${JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        network,
        contractId,
        chain: { status, accounting, workflows },
        evidence: {
          source: chainOnly ? "chain-only" : "chain-and-keeper-database",
          ...evidenceSummary,
          scope:
            "Verifies final RPC outcomes, exact execute_due calls, and contract-emitted events. Recipient balance deltas, restart, concurrency, and lifecycle proofs require separate evidence.",
        },
        keeper: {
          transactions: verifiedTransactions,
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
  if (
    requireEvidence &&
    (!evidenceSummary.twoFinalizedPayments ||
      !evidenceSummary.reserveRejection ||
      evidenceSummary.unverifiedTransactions > 0)
  ) {
    process.exitCode = 1;
  }
} finally {
  await client?.$disconnect();
}

async function listAllWorkflows(): Promise<WorkflowView[]> {
  const workflows: WorkflowView[] = [];
  const seen = new Set<number>();
  for (let cursor = 0; ; cursor += 50) {
    const page = workflowViewSchema
      .array()
      .parse(await viewCall("list_workflows", { cursor, limit: 50 }));
    for (const workflow of page) {
      if (seen.has(workflow.id)) throw new Error("RPC_REPEATED_WORKFLOW_PAGE");
      seen.add(workflow.id);
      workflows.push(workflow);
    }
    if (page.length < 50) return workflows;
  }
}

async function viewCall(
  methodName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const result = (await rpcCall("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  })) as { result?: number[] };
  if (!Array.isArray(result.result)) {
    throw new Error(`RPC_VIEW_FAILED_${methodName}`);
  }
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}

async function rpcCall(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "auvora-evidence-report",
      method,
      params,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`RPC_HTTP_${response.status}`);

  const payload = (await response.json()) as {
    error?: unknown;
    result?: unknown;
  };
  if (payload.error || payload.result === undefined) {
    throw new Error("RPC_REQUEST_FAILED");
  }

  return payload.result;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
