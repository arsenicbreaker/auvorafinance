import { beforeEach, describe, expect, it, vi } from "vitest";
import { readHistoryRecords } from "@auvora/db/history";
import { readOwnerWorkflowSnapshot } from "../lib/near-rpc";
import { loadExecutionHistory, parseHistoryRequest } from "./execution-history";
vi.mock("@auvora/db/history", () => ({ readHistoryRecords: vi.fn() }));
vi.mock("../lib/near-rpc", () => ({ readOwnerWorkflowSnapshot: vi.fn() }));
const hash = "11111111111111111111111111111111";
const record = {
  transactionHash: hash,
  workflowId: "7",
  runIndex: 0,
  scheduledForMs: "1800000000000",
  amountYocto: "1000000000000000000000",
  signerId: "keeper.testnet",
  submittedAt: "2026-10-31T00:00:00.000Z",
};
const environment = {
  AUVORA_HISTORY_DATABASE_URL: "postgresql://secret",
  NEXT_PUBLIC_AUVORA_CONTRACT_ID: "treasury.testnet",
};
const fetchMock = vi.fn();
function event(name: string, reason?: string) {
  return `EVENT_JSON:${JSON.stringify({ standard: "auvora", version: "1.0.0", event: name, data: [{ workflow_id: 7, run_index: 0, scheduled_for_ms: 1800000000000, amount: record.amountYocto, ...(reason ? { reason_code: reason } : {}) }] })}`;
}
function outcome() {
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    transaction: {
      hash,
      signer_id: record.signerId,
      receiver_id: "treasury.testnet",
      actions: [
        {
          FunctionCall: {
            method_name: "execute_due",
            args: Buffer.from('{"workflow_id":7}').toString("base64"),
            deposit: "0",
            gas: "100000000000000",
          },
        },
      ],
    },
    transaction_outcome: { outcome: { status: { SuccessReceiptId: "a" } } },
    receipts_outcome: [
      {
        outcome: {
          executor_id: "treasury.testnet",
          status: { SuccessValue: "" },
          logs: [event("execution_dispatched"), event("execution_succeeded")],
        },
      },
    ],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(readOwnerWorkflowSnapshot).mockResolvedValue({
    ownerId: "owner.testnet",
    blockHeight: 100,
    workflows: [{ id: 7 }],
  } as Awaited<ReturnType<typeof readOwnerWorkflowSnapshot>>);
  vi.mocked(readHistoryRecords).mockResolvedValue({
    records: [record],
    hasMore: false,
  });
  fetchMock.mockImplementation(async () =>
    Response.json({ result: outcome() }),
  );
});
describe("execution history evidence", () => {
  it("shows success only for exact final call and contract-event evidence", async () => {
    const page = await loadExecutionHistory(
      { owner: "owner.testnet", cursor: null },
      environment,
    );
    expect(page.rows[0]).toMatchObject({
      status: "Succeeded",
      reason: null,
      hash,
    });
    expect(readHistoryRecords).toHaveBeenCalledWith({
      databaseUrl: environment.AUVORA_HISTORY_DATABASE_URL,
      contractId: "treasury.testnet",
      workflowIds: [7],
      cursor: null,
    });
    expect(JSON.stringify(page)).not.toContain("secret");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).method).toBe("tx");
  });
  it("keeps a nonfinal outcome pending", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        result: { ...outcome(), final_execution_status: "EXECUTED" },
      }),
    );
    expect(
      (
        await loadExecutionHistory(
          { owner: "owner.testnet", cursor: null },
          environment,
        )
      ).rows[0]?.status,
    ).toBe("Pending");
  });
  it.each(["hash", "signer_id", "receiver_id"])(
    "does not accept mismatched %s",
    async (field) => {
      const value = outcome();
      (value.transaction as Record<string, unknown>)[field] = "wrong";
      fetchMock.mockResolvedValue(Response.json({ result: value }));
      expect(
        (
          await loadExecutionHistory(
            { owner: "owner.testnet", cursor: null },
            environment,
          )
        ).rows[0],
      ).toMatchObject({ status: "Unverified", reason: "IDENTITY_MISMATCH" });
    },
  );
  it("does not trust a database success when a final receipt failed", async () => {
    const value = outcome();
    value.receipts_outcome[0]!.outcome.status = {
      Failure: "failed",
    } as unknown as { SuccessValue: string };
    fetchMock.mockResolvedValue(Response.json({ result: value }));
    expect(
      (
        await loadExecutionHistory(
          { owner: "owner.testnet", cursor: null },
          environment,
        )
      ).rows[0],
    ).toMatchObject({ status: "Unverified", reason: "RECEIPT_FAILED" });
  });
  it("shows a verified reserve skip", async () => {
    const value = outcome();
    value.receipts_outcome[0]!.outcome.logs = [
      event("execution_skipped", "RESERVE_GUARD"),
    ];
    fetchMock.mockResolvedValue(Response.json({ result: value }));
    expect(
      (
        await loadExecutionHistory(
          { owner: "owner.testnet", cursor: null },
          environment,
        )
      ).rows[0],
    ).toMatchObject({ status: "Skipped", reason: "RESERVE_GUARD" });
  });
  it("retains a hash as unverified when RPC is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("private RPC error"));
    expect(
      (
        await loadExecutionHistory(
          { owner: "owner.testnet", cursor: null },
          environment,
        )
      ).rows[0],
    ).toMatchObject({ status: "Unverified", reason: "RPC_UNAVAILABLE", hash });
  });
  it("fails closed when a row is outside the on-chain owner scope", async () => {
    vi.mocked(readHistoryRecords).mockResolvedValue({
      records: [{ ...record, workflowId: "8" }],
      hasMore: false,
    });
    await expect(
      loadExecutionHistory(
        { owner: "owner.testnet", cursor: null },
        environment,
      ),
    ).rejects.toMatchObject({ code: "HISTORY_UNAVAILABLE" });
  });
  it("does not query dependencies when history is not configured", async () => {
    await expect(
      loadExecutionHistory({ owner: "owner.testnet", cursor: null }, {}),
    ).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(readHistoryRecords).not.toHaveBeenCalled();
  });
  it("generates an opaque cursor from the last returned row", async () => {
    vi.mocked(readHistoryRecords).mockResolvedValue({
      records: [record],
      hasMore: true,
    });
    const page = await loadExecutionHistory(
      { owner: "owner.testnet", cursor: null },
      environment,
    );
    expect(
      parseHistoryRequest(
        `https://app.test/api/executions?owner=owner.testnet&cursor=${page.nextCursor}`,
      ).cursor,
    ).toEqual({ submittedAt: record.submittedAt, hash });
  });
  it.each([
    "owner=owner.near",
    "owner=owner.testnet&owner=other.testnet",
    "owner=owner.testnet&cursor=bad",
    "owner=owner.testnet&rpc=https://evil.test",
    "",
  ])("rejects invalid owner/cursor/query %s", (query) => {
    expect(() =>
      parseHistoryRequest(`https://app.test/api/executions?${query}`),
    ).toThrow();
  });
});
