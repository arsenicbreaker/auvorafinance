import { readHistoryRecords, type HistoryCursor } from "@auvora/db/history";
import { verifyExecutionEvidence } from "@auvora/near-client/evidence";
import { readOwnerWorkflowSnapshot } from "../lib/near-rpc";
import type {
  ExecutionHistoryPage,
  ExecutionHistoryRow,
} from "../lib/execution-history";

export class HistoryError extends Error {
  constructor(
    public code: "INVALID_REQUEST" | "NOT_CONFIGURED" | "HISTORY_UNAVAILABLE",
  ) {
    super(code);
  }
}

export function parseHistoryRequest(url: string): {
  owner: string;
  cursor: HistoryCursor | null;
} {
  const params = new URL(url).searchParams;
  const owner = params.get("owner") ?? "";
  if (
    owner.length > 64 ||
    !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(owner) ||
    [...params.keys()].some((key) => !["owner", "cursor"].includes(key)) ||
    params.getAll("owner").length !== 1 ||
    params.getAll("cursor").length > 1
  )
    throw new HistoryError("INVALID_REQUEST");
  const raw = params.get("cursor");
  if (raw === null) return { owner, cursor: null };
  try {
    if (raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const cursor = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as HistoryCursor;
    if (
      !cursor ||
      typeof cursor.submittedAt !== "string" ||
      !Number.isFinite(Date.parse(cursor.submittedAt)) ||
      new Date(cursor.submittedAt).toISOString() !== cursor.submittedAt ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(cursor.hash)
    )
      throw new Error();
    return {
      owner,
      cursor: { submittedAt: cursor.submittedAt, hash: cursor.hash },
    };
  } catch {
    throw new HistoryError("INVALID_REQUEST");
  }
}

export async function loadExecutionHistory(
  request: { owner: string; cursor: HistoryCursor | null },
  environment: Record<string, string | undefined> = process.env,
): Promise<ExecutionHistoryPage> {
  const databaseUrl = environment.AUVORA_HISTORY_DATABASE_URL;
  const contractId = environment.NEXT_PUBLIC_AUVORA_CONTRACT_ID;
  const rpcUrl =
    environment.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
  if (
    !databaseUrl ||
    !contractId?.endsWith(".testnet") ||
    !rpcUrl.startsWith("https://")
  )
    throw new HistoryError("NOT_CONFIGURED");
  let stage = "ownership";
  try {
    const snapshot = await readOwnerWorkflowSnapshot(
      rpcUrl,
      contractId,
      request.owner,
    );
    stage = "database";
    const page = await readHistoryRecords({
      databaseUrl,
      contractId,
      workflowIds: snapshot.workflows.map((workflow) => workflow.id),
      cursor: request.cursor,
    });
    stage = "verification";
    const rows: ExecutionHistoryRow[] = [];
    // Four verification requests at a time bound the public RPC load per page.
    for (let start = 0; start < page.records.length; start += 4) {
      rows.push(
        ...(await Promise.all(
          page.records.slice(start, start + 4).map(async (record) => {
            const row: ExecutionHistoryRow = {
              hash: record.transactionHash,
              workflowId: record.workflowId,
              runIndex: record.runIndex,
              amountYocto: record.amountYocto,
              submittedAt: record.submittedAt,
              status: "Unverified",
              reason: "RPC_UNAVAILABLE",
            };
            if (
              !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(record.transactionHash) ||
              !/^\d{1,39}$/.test(record.amountYocto) ||
              BigInt(record.amountYocto) > (1n << 128n) - 1n ||
              !snapshot.workflows.some(
                (workflow) => String(workflow.id) === record.workflowId,
              ) ||
              !Number.isSafeInteger(record.runIndex) ||
              record.runIndex < 0
            )
              throw new HistoryError("HISTORY_UNAVAILABLE");
            try {
              const response = await fetch(rpcUrl, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  jsonrpc: "2.0",
                  id: "auvora-history",
                  method: "tx",
                  params: {
                    tx_hash: record.transactionHash,
                    sender_account_id: record.signerId,
                    wait_until: "FINAL",
                  },
                }),
                redirect: "error",
                signal: AbortSignal.timeout(5000),
                cache: "no-store",
              });
              if (!response.ok) return row;
              const body = (await response.json()) as {
                error?: unknown;
                result?: unknown;
              };
              if (body.error || !body.result) return row;
              const outcome = body.result as {
                final_execution_status?: string;
                transaction?: {
                  hash?: string;
                  signer_id?: string;
                  receiver_id?: string;
                };
              };
              if (
                outcome.transaction?.hash !== record.transactionHash ||
                outcome.transaction.signer_id !== record.signerId ||
                outcome.transaction.receiver_id !== contractId
              )
                return { ...row, reason: "IDENTITY_MISMATCH" };
              if (outcome.final_execution_status !== "FINAL")
                return { ...row, status: "Pending" as const, reason: null };
              const evidence = verifyExecutionEvidence(outcome, {
                transactionHash: record.transactionHash,
                contractId,
                signerId: record.signerId,
                workflowId: record.workflowId,
                runIndex: record.runIndex,
                scheduledForMs: record.scheduledForMs,
                amountYocto: record.amountYocto,
              });
              if (!evidence.verified)
                return { ...row, reason: evidence.reason };
              const status = {
                execution_succeeded: "Succeeded",
                execution_failed: "Failed",
                execution_skipped: "Skipped",
                execution_ignored: "Skipped",
                execution_dispatched: "Pending",
              } as const;
              return {
                ...row,
                status: status[evidence.event.event],
                reason: evidence.event.reasonCode,
              };
            } catch {
              return row;
            }
          }),
        )),
      );
    }
    const last = page.records.at(-1);
    return {
      ownerId: request.owner,
      contractId,
      observedAt: new Date().toISOString(),
      blockHeight: snapshot.blockHeight,
      rows,
      nextCursor:
        page.hasMore && last
          ? Buffer.from(
              JSON.stringify({
                submittedAt: last.submittedAt,
                hash: last.transactionHash,
              }),
            ).toString("base64url")
          : null,
    };
  } catch (error) {
    if (error instanceof HistoryError) throw error;
    console.warn("AUVORA_HISTORY_READ_FAILED", { stage });
    throw new HistoryError("HISTORY_UNAVAILABLE");
  }
}
