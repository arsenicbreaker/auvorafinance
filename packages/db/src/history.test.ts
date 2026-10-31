import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "./client.js";
import { closeHistoryConnections, readHistoryRecords } from "./history.js";
vi.mock("./client.js", () => ({ createPrismaClient: vi.fn() }));
const findMany = vi.fn();
const disconnect = vi.fn();
const input = {
  databaseUrl: "postgresql://private",
  contractId: "treasury.testnet",
  workflowIds: [7],
  cursor: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createPrismaClient).mockReturnValue({
    submittedTransaction: { findMany },
    $disconnect: disconnect,
  } as unknown as ReturnType<typeof createPrismaClient>);
  findMany.mockResolvedValue([]);
});
describe("public history database projection", () => {
  afterEach(async () => {
    await closeHistoryConnections();
  });
  it("does not connect for an owner with no authoritative workflows", async () => {
    expect(await readHistoryRecords({ ...input, workflowIds: [] })).toEqual({
      records: [],
      hasMore: false,
    });
    expect(createPrismaClient).not.toHaveBeenCalled();
  });
  it("scopes by chain, contract, owned IDs and execution method without selecting signed bytes", async () => {
    await readHistoryRecords(input);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          network: "testnet",
          contractId: "treasury.testnet",
          workflowId: { in: [7n] },
          method: "execute_due",
        },
        take: 21,
      }),
    );
    expect(findMany.mock.calls[0]![0].select).not.toHaveProperty(
      "signedTransactionBase64",
    );
    expect(findMany.mock.calls[0]![0].select).not.toHaveProperty("errorCode");
    expect(createPrismaClient).toHaveBeenCalledWith(input.databaseUrl, {
      connectionTimeoutMillis: 10000,
      query_timeout: 10000,
      max: 2,
    });
  });
  it("uses a timestamp/hash tie-breaker for older attempts", async () => {
    const cursor = {
      submittedAt: "2026-10-31T00:00:00.000Z",
      hash: "11111111111111111111111111111111",
    };
    await readHistoryRecords({ ...input, cursor });
    expect(findMany.mock.calls[0]![0].where.OR).toEqual([
      { submittedAt: { lt: new Date(cursor.submittedAt) } },
      {
        submittedAt: new Date(cursor.submittedAt),
        transactionHash: { lt: cursor.hash },
      },
    ]);
  });
  it("returns only 20 public rows and retains hasMore", async () => {
    findMany.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({
        transactionHash: String(i),
        workflowId: 7n,
        runIndex: i,
        scheduledForMs: 1800000000000n,
        amountYocto: "1",
        signerId: "keeper.testnet",
        submittedAt: new Date("2026-10-31T00:00:00Z"),
      })),
    );
    const page = await readHistoryRecords(input);
    expect(page.records).toHaveLength(20);
    expect(page.records[0]).toMatchObject({
      workflowId: "7",
      scheduledForMs: "1800000000000",
      submittedAt: "2026-10-31T00:00:00.000Z",
    });
    expect(page.hasMore).toBe(true);
    expect(disconnect).not.toHaveBeenCalled();
  });
  it("keeps the bounded pool available for a later retry after a query fails", async () => {
    findMany.mockRejectedValue(new Error("private error"));
    await expect(readHistoryRecords(input)).rejects.toThrow();
    expect(disconnect).not.toHaveBeenCalled();
    findMany.mockResolvedValue([]);
    expect((await readHistoryRecords(input)).records).toEqual([]);
    expect(createPrismaClient).toHaveBeenCalledOnce();
  });
  it("reuses a bounded pool across reads rather than opening a connection pool per request", async () => {
    await readHistoryRecords(input);
    await readHistoryRecords(input);
    expect(createPrismaClient).toHaveBeenCalledOnce();
    await closeHistoryConnections();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
