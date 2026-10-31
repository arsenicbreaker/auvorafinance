import { afterEach, describe, expect, it, vi } from "vitest";
import { readOwnerWorkflowSnapshot, type WorkflowView } from "./near-rpc";

const block = {
  header: {
    hash: "finalized-block",
    height: 1234,
    timestamp_nanosec: "1800000000000000000",
  },
};
function workflow(id: number): WorkflowView {
  return {
    id,
    owner_id: "owner.testnet",
    recipient_id: "recipient.testnet",
    amount: "10",
    min_reserve: "5",
    available_balance: "25",
    max_runs: 2,
    runs_completed: 0,
    interval_ms: 60000,
    next_run_at_ms: 1800000000000,
    pending_execution: null,
    max_per_run: "10",
    config_hash: "fixture",
    created_at_ms: 1800000000000,
    withdrawable: "0",
    state: "Active",
  };
}
function page(rows: WorkflowView[], changes: Record<string, unknown> = {}) {
  return {
    result: Array.from(new TextEncoder().encode(JSON.stringify(rows))),
    block_hash: block.header.hash,
    block_height: block.header.height,
    ...changes,
  };
}
function rpcSequence(...results: unknown[]) {
  const fetcher = vi.fn();
  for (const result of results)
    fetcher.mockResolvedValueOnce(Response.json({ result }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());

describe("finalized treasury snapshots", () => {
  it("pins every workflow page to the same finalized block", async () => {
    const fetcher = rpcSequence(
      block,
      page(Array.from({ length: 50 }, (_, id) => workflow(id))),
      page([workflow(50)]),
    );
    const snapshot = await readOwnerWorkflowSnapshot(
      "https://rpc.testnet.near.org",
      "treasury.testnet",
      "owner.testnet",
    );
    expect(snapshot).toMatchObject({
      blockHash: "finalized-block",
      blockHeight: 1234,
      timestampMs: 1800000000000,
      ownerId: "owner.testnet",
    });
    expect(snapshot.workflows).toHaveLength(51);
    const requests = fetcher.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(requests[0]).toMatchObject({
      method: "block",
      params: { finality: "final" },
    });
    for (const request of requests.slice(1)) {
      expect(request.method).toBe("query");
      expect(request.params).toMatchObject({
        block_id: "finalized-block",
        method_name: "list_owner_workflows",
      });
      expect(request.params).not.toHaveProperty("finality");
    }
    expect(JSON.parse(atob(requests[2].params.args_base64))).toEqual({
      owner_id: "owner.testnet",
      cursor: 50,
      limit: 50,
    });
  });

  it.each([{ block_hash: "different-block" }, { block_height: 1235 }])(
    "rejects pages from a different block: %j",
    async (changes) => {
      rpcSequence(block, page([workflow(1)], changes));
      await expect(
        readOwnerWorkflowSnapshot("rpc", "treasury.testnet", "owner.testnet"),
      ).rejects.toThrow("RPC_SNAPSHOT_BLOCK_MISMATCH");
    },
  );

  it("rejects duplicate workflow IDs across pages", async () => {
    rpcSequence(
      block,
      page(Array.from({ length: 50 }, (_, id) => workflow(id))),
      page([workflow(0)]),
    );
    await expect(
      readOwnerWorkflowSnapshot("rpc", "treasury.testnet", "owner.testnet"),
    ).rejects.toThrow("RPC_INVALID_WORKFLOW_PAGE");
  });

  it("rejects workflows belonging to another owner", async () => {
    rpcSequence(block, page([{ ...workflow(1), owner_id: "other.testnet" }]));
    await expect(
      readOwnerWorkflowSnapshot("rpc", "treasury.testnet", "owner.testnet"),
    ).rejects.toThrow("RPC_INVALID_WORKFLOW_PAGE");
  });

  it.each([
    { hash: "" },
    { height: 1.5 },
    { timestamp_nanosec: "not-a-number" },
  ])("rejects malformed block metadata: %j", async (changes) => {
    rpcSequence({ header: { ...block.header, ...changes } });
    await expect(
      readOwnerWorkflowSnapshot("rpc", "treasury.testnet", "owner.testnet"),
    ).rejects.toThrow("RPC_INVALID_SNAPSHOT_BLOCK");
  });

  it.each(["owner.near", "owner.testnet/extra", ""])(
    "rejects invalid testnet owners before making a request: %s",
    async (owner) => {
      const fetcher = rpcSequence();
      await expect(
        readOwnerWorkflowSnapshot("rpc", "treasury.testnet", owner),
      ).rejects.toThrow("INVALID_TESTNET_OWNER");
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
