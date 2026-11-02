import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { readRelayerConfig } from "@auvora/config";
import {
  validateManagementDelegate,
  type ManagementPolicy,
} from "./management.js";
import { createManagementSnapshotReader } from "./management-rpc.js";
import {
  SponsorshipStore,
  sponsorshipSchema,
  type SponsoredRequest,
} from "./sponsorship-store.js";
import { SponsorshipChain } from "./sponsorship-chain.js";

const config = readRelayerConfig(process.env);
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 10000,
  query_timeout: 15000,
});
pool.on("error", () =>
  process.stderr.write("sponsorship_database_unavailable\n"),
);
const scope = `testnet:${config.AUVORA_CONTRACT_ID}:${config.RELAYER_ACCOUNT_ID}`;
const store = new SponsorshipStore(pool, scope);
const chain = new SponsorshipChain(
  config.NEAR_RPC_URL,
  config.RELAYER_ACCOUNT_ID,
  config.RELAYER_PRIVATE_KEY,
  config.AUVORA_CONTRACT_ID,
);
const policy: ManagementPolicy = {
  networkId: "testnet",
  contractId: config.AUVORA_CONTRACT_ID,
  maxGasPerRequest: config.RELAYER_MAX_GAS_PER_REQUEST,
  maxBlockHeightTtl: 300n,
};
const readSnapshot = createManagementSnapshotReader(
  config.NEAR_RPC_URL,
  config.AUVORA_CONTRACT_ID,
);
const reservation = 30_000_000_000_000_000_000_000n;
const origins = new Set(["http://127.0.0.1:3013", "http://localhost:3013"]);
const publicRow = (row: SponsoredRequest) => ({
  digest: row.digest,
  sender: row.sender,
  workflow: row.workflow,
  method: row.method,
  hash: row.hash,
  state: row.state,
  relayer: config.RELAYER_ACCOUNT_ID,
  contractId: config.AUVORA_CONTRACT_ID,
  network: "testnet",
});
const allowedErrors = new Set([
  "RELAYER_RECONCILING",
  "SPONSOR_BUDGET_EXHAUSTED",
  "OWNER_DAILY_LIMIT",
  "DELEGATE_REPLAY",
  "GAS_PRICE_EXCEEDS_RESERVATION",
]);

async function reconcile(row: SponsoredRequest) {
  if (row.state !== "Pending") return row;
  try {
    const state = await chain.status(row);
    if (state !== "Pending") {
      await store.finalize(row.digest, state);
      return { ...row, state };
    }
  } catch {
    /* A missing status cannot justify a newly signed transaction. */
  }
  try {
    await chain.broadcast(row);
  } catch {
    /* Reconcile the same persisted hash next time. */
  }
  return row;
}

async function main() {
  if (process.argv.includes("--migrate")) {
    await pool.query(sponsorshipSchema);
    await pool.end();
    console.log("Sponsorship tables ready");
    return;
  }
  const network = (await chain.rpc("status", [])) as { chain_id: string };
  if (
    network.chain_id !== "testnet" ||
    !config.AUVORA_CONTRACT_ID.endsWith(".testnet") ||
    !config.RELAYER_ACCOUNT_ID.endsWith(".testnet") ||
    config.RELAYER_ACCOUNT_ID === config.AUVORA_CONTRACT_ID
  )
    throw new Error("INVALID_RELAYER_NETWORK_OR_IDENTITY");
  await pool.query("SELECT digest FROM auvora_sponsorship LIMIT 0");
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const row of await store.pending()) await reconcile(row);
    } catch {
      process.stderr.write("sponsorship_reconciliation_unavailable\n");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 10000);
  let requests = 0;
  let windowStart = Date.now();
  let inFlight = 0;
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Vary", "Origin");
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) {
      res.writeHead(403).end('{"error":"ORIGIN_NOT_ALLOWED"}');
      return;
    }
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (Date.now() - windowStart > 60000) {
      requests = 0;
      windowStart = Date.now();
    }
    if (++requests > 60 || inFlight >= 3) {
      res.writeHead(429).end('{"error":"RATE_LIMITED"}');
      return;
    }
    inFlight++;
    try {
      if (req.method === "GET" && req.url === "/health") {
        await pool.query("SELECT 1");
        res.end(
          JSON.stringify({
            network: "testnet",
            contractId: config.AUVORA_CONTRACT_ID,
            relayer: config.RELAYER_ACCOUNT_ID,
            maxGas: config.RELAYER_MAX_GAS_PER_REQUEST.toString(),
            maxBlockHeightTtl: 300,
          }),
        );
        return;
      }
      const match = /^\/requests\/([a-f0-9]{64})$/.exec(req.url ?? "");
      if (req.method === "GET" && match) {
        const row = await store.find(match[1]!);
        if (!row) {
          res.writeHead(404).end('{"error":"REQUEST_NOT_FOUND"}');
          return;
        }
        res.end(JSON.stringify(publicRow(row)));
        return;
      }
      if (req.method !== "POST" || req.url !== "/requests") {
        res.writeHead(404).end('{"error":"NOT_FOUND"}');
        return;
      }
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        res.writeHead(415).end('{"error":"JSON_REQUIRED"}');
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 18000) {
          res.writeHead(413).end('{"error":"REQUEST_TOO_LARGE"}');
          return;
        }
        chunks.push(Buffer.from(chunk));
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString());
      } catch {
        res.writeHead(400).end('{"error":"INVALID_JSON"}');
        return;
      }
      if (
        !body ||
        typeof body !== "object" ||
        !("payload" in body) ||
        typeof body.payload !== "string" ||
        Object.keys(body).length !== 1
      ) {
        res.writeHead(400).end('{"error":"INVALID_REQUEST"}');
        return;
      }
      const payload = body.payload;
      const digest = createHash("sha256")
        .update(Buffer.from(payload, "base64"))
        .digest("hex");
      const existing = await store.find(digest);
      if (existing) {
        res.end(JSON.stringify(publicRow(existing)));
        return;
      }
      const decision = await validateManagementDelegate(
        payload,
        policy,
        readSnapshot,
      );
      if (!decision.allowed) {
        res.writeHead(400).end(JSON.stringify({ error: decision.code }));
        return;
      }
      const row = await store.reserve(
        {
          digest: decision.requestDigest,
          sender: decision.senderId,
          publicKey: decision.publicKey,
          nonce: decision.nonce,
          workflow: decision.workflowId,
          method: decision.methodName,
          reserved: reservation,
          dailyBudget: config.RELAYER_DAILY_BUDGET,
        },
        () => chain.prepare(payload, reservation),
      );
      // The database commit above is the boundary before any broadcast.
      try {
        await chain.broadcast(row);
      } catch {
        /* A lost response remains pending with the same hash. */
      }
      res.writeHead(202).end(JSON.stringify(publicRow(row)));
    } catch (error) {
      const code =
        error instanceof Error && allowedErrors.has(error.message)
          ? error.message
          : "SERVICE_UNAVAILABLE";
      if (!res.headersSent) res.writeHead(503);
      res.end(JSON.stringify({ error: code }));
    } finally {
      inFlight--;
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(3002, "127.0.0.1", () =>
    console.log("Sponsorship service: http://127.0.0.1:3002"),
  );
  const stop = () => {
    clearInterval(timer);
    server.close(() => void pool.end());
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  await tick();
}
main().catch(() => {
  console.error(
    "Sponsorship startup failed. Check testnet configuration and run the sponsorship migration.",
  );
  void pool.end();
  process.exitCode = 1;
});
