import { describe, expect, it, vi } from "vitest";

import { createManagementSnapshotReader } from "./management-rpc.js";

const query = {
  senderId: "owner.testnet",
  publicKey: "ed25519:test",
  workflowId: 5,
};
function fixture(
  overrides: { key?: unknown; view?: unknown; block?: unknown } = {},
) {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const { method, params } = JSON.parse(String(init?.body));
    const result =
      method === "block"
        ? (overrides.block ?? { header: { hash: "final-block", height: 100 } })
        : params.request_type === "view_access_key"
          ? (overrides.key ?? {
              block_hash: "final-block",
              nonce: 1,
              permission: "FullAccess",
            })
          : (overrides.view ?? {
              block_hash: "final-block",
              result: [
                ...Buffer.from(
                  JSON.stringify({ id: 5, owner_id: "owner.testnet" }),
                ),
              ],
            });
    return Response.json({ result });
  });
  return {
    fetcher,
    read: createManagementSnapshotReader(
      "https://rpc.testnet.near.org",
      "auvora.testnet",
      fetcher,
    ),
  };
}

describe("management final snapshot reader", () => {
  it("pins access key and workflow to one final block with a shared deadline", async () => {
    const { fetcher, read } = fixture();
    await expect(read(query)).resolves.toEqual({
      networkId: "testnet",
      contractId: "auvora.testnet",
      blockHeight: 100n,
      accessKey: { nonce: 1n, permission: "FullAccess" },
      workflowOwnerId: "owner.testnet",
    });
    const calls = fetcher.mock.calls.map(([, init]) => ({
      init,
      body: JSON.parse(String(init?.body)),
    }));
    expect(calls[0]?.body.params).toEqual({ finality: "final" });
    expect(calls.slice(1).map((call) => call.body.params.block_id)).toEqual([
      "final-block",
      "final-block",
    ]);
    expect(
      calls.every((call) => call.init?.signal === calls[0]?.init?.signal),
    ).toBe(true);
    expect(calls.every((call) => call.init?.redirect === "error")).toBe(true);
  });

  it.each([
    { key: { block_hash: "other", nonce: 1, permission: "FullAccess" } },
    {
      key: {
        block_hash: "final-block",
        nonce: 1,
        permission: { FunctionCall: {} },
      },
    },
    {
      key: {
        block_hash: "final-block",
        nonce: Number.MAX_SAFE_INTEGER + 1,
        permission: "FullAccess",
      },
    },
    { view: { block_hash: "other", result: [...Buffer.from("null")] } },
    {
      view: {
        block_hash: "final-block",
        result: [...Buffer.from('{"id":6,"owner_id":"owner.testnet"}')],
      },
    },
    { view: { block_hash: "final-block", result: [255] } },
    { block: { header: { hash: "final-block", height: 0 } } },
  ])(
    "fails closed on invalid or mismatched chain data: %j",
    async (overrides) => {
      await expect(fixture(overrides).read(query)).rejects.toThrow();
    },
  );

  it("returns a missing workflow without inventing an owner", async () => {
    const { read } = fixture({
      view: { block_hash: "final-block", result: [...Buffer.from("null")] },
    });
    await expect(read(query)).resolves.toMatchObject({ workflowOwnerId: null });
  });

  it.each([
    () => new Response("unavailable", { status: 503 }),
    () => Response.json({ error: { message: "unknown key" } }),
    () => new Response("x".repeat(262_145)),
  ])("rejects unavailable or oversized responses", async (response) => {
    const fetcher = vi.fn<typeof fetch>(async () => response());
    const read = createManagementSnapshotReader(
      "https://rpc.testnet.near.org",
      "auvora.testnet",
      fetcher,
    );
    await expect(read(query)).rejects.toThrow("CHAIN_UNAVAILABLE");
  });

  it.each([
    "http://rpc.testnet.near.org",
    "https://user:pass@rpc.testnet.near.org",
    "https://rpc.mainnet.near.org",
    "https://rpc.testnet.near.org.attacker.example",
  ])("rejects invalid endpoint %s", (url) => {
    expect(() =>
      createManagementSnapshotReader(url, "auvora.testnet"),
    ).toThrow();
  });
});
