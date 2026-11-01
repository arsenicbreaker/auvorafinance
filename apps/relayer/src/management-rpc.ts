import { z } from "zod";

import type { ManagementSnapshot } from "./management.js";

const blockSchema = z.object({
  header: z.object({
    hash: z.string().min(1),
    height: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }),
});
const keySchema = z.object({
  block_hash: z.string(),
  nonce: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  permission: z.literal("FullAccess"),
});
const viewSchema = z.object({
  block_hash: z.string(),
  result: z.array(z.number().int().min(0).max(255)).max(65_536),
});
const workflowSchema = z
  .object({
    id: z.number().int().nonnegative(),
    owner_id: z.string().min(2),
  })
  .nullable();

/** Reads only; one deadline covers the final block and both pinned queries. */
export function createManagementSnapshotReader(
  rpcUrl: string,
  contractId: string,
  request: typeof fetch = fetch,
) {
  const url = new URL(rpcUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !["rpc.testnet.near.org", "archival-rpc.testnet.near.org"].includes(
      url.hostname,
    ) ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw new Error(
      "Management RPC requires an official HTTPS NEAR testnet endpoint without URL credentials",
    );
  }
  return async (
    query: Readonly<{
      senderId: string;
      publicKey: string;
      workflowId: number;
    }>,
  ): Promise<ManagementSnapshot> => {
    const signal = AbortSignal.timeout(5_000);
    async function rpc(
      method: string,
      params: Record<string, unknown>,
    ): Promise<unknown> {
      const response = await request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "management-validation",
          method,
          params,
        }),
        signal,
        redirect: "error",
      });
      if (!response.ok) throw new Error("CHAIN_UNAVAILABLE");
      // Bound response memory as well as transport time, including chunked responses.
      const reader = response.body?.getReader();
      if (!reader) throw new Error("CHAIN_UNAVAILABLE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 262_144) throw new Error("CHAIN_UNAVAILABLE");
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !body ||
        typeof body !== "object" ||
        "error" in body ||
        !("result" in body)
      ) {
        throw new Error("CHAIN_UNAVAILABLE");
      }
      return body.result;
    }

    const block = blockSchema.parse(await rpc("block", { finality: "final" }));
    const blockId = block.header.hash;
    const [rawKey, rawView] = await Promise.all([
      rpc("query", {
        request_type: "view_access_key",
        block_id: blockId,
        account_id: query.senderId,
        public_key: query.publicKey,
      }),
      rpc("query", {
        request_type: "call_function",
        block_id: blockId,
        account_id: contractId,
        method_name: "get_workflow",
        args_base64: Buffer.from(
          JSON.stringify({ workflow_id: query.workflowId }),
        ).toString("base64"),
      }),
    ]);
    const key = keySchema.parse(rawKey);
    const view = viewSchema.parse(rawView);
    if (key.block_hash !== blockId || view.block_hash !== blockId)
      throw new Error("INVALID_CHAIN_SNAPSHOT");
    const workflow = workflowSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(view.result),
        ),
      ),
    );
    if (workflow && workflow.id !== query.workflowId)
      throw new Error("INVALID_CHAIN_SNAPSHOT");
    return {
      networkId: "testnet",
      contractId,
      blockHeight: BigInt(block.header.height),
      accessKey: { nonce: BigInt(key.nonce), permission: key.permission },
      workflowOwnerId: workflow?.owner_id ?? null,
    };
  };
}
