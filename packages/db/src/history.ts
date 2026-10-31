import { createPrismaClient } from "./client.js";

const connections = new Map<string, ReturnType<typeof createPrismaClient>>();

export async function closeHistoryConnections(): Promise<void> {
  const clients = [...connections.values()];
  connections.clear();
  await Promise.all(clients.map((client) => client.$disconnect()));
}

export interface HistoryCursor {
  submittedAt: string;
  hash: string;
}
export interface HistoryRecord {
  transactionHash: string;
  workflowId: string;
  runIndex: number;
  scheduledForMs: string;
  amountYocto: string;
  signerId: string;
  submittedAt: string;
}

export async function readHistoryRecords(input: {
  databaseUrl: string;
  contractId: string;
  workflowIds: number[];
  cursor: HistoryCursor | null;
}): Promise<{ records: HistoryRecord[]; hasMore: boolean }> {
  if (!input.workflowIds.length) return { records: [], hasMore: false };
  let client = connections.get(input.databaseUrl);
  if (!client) {
    client = createPrismaClient(input.databaseUrl, {
      connectionTimeoutMillis: 10000,
      query_timeout: 10000,
      max: 2,
    });
    connections.set(input.databaseUrl, client);
  }
  const rows = await client.submittedTransaction.findMany({
    where: {
      network: "testnet",
      contractId: input.contractId,
      method: "execute_due",
      workflowId: { in: input.workflowIds.map(BigInt) },
      ...(input.cursor
        ? {
            OR: [
              { submittedAt: { lt: new Date(input.cursor.submittedAt) } },
              {
                submittedAt: new Date(input.cursor.submittedAt),
                transactionHash: { lt: input.cursor.hash },
              },
            ],
          }
        : {}),
    },
    orderBy: [{ submittedAt: "desc" }, { transactionHash: "desc" }],
    take: 21,
    select: {
      transactionHash: true,
      workflowId: true,
      runIndex: true,
      scheduledForMs: true,
      amountYocto: true,
      signerId: true,
      submittedAt: true,
    },
  });
  return {
    records: rows.slice(0, 20).map((row) => ({
      ...row,
      workflowId: row.workflowId.toString(),
      scheduledForMs: row.scheduledForMs.toString(),
      submittedAt: row.submittedAt.toISOString(),
    })),
    hasMore: rows.length > 20,
  };
}
