import { readKeeperConfig } from "@auvora/config";
import { createPrismaClient, PrismaKeeperStore } from "@auvora/db";
import { NearClient } from "@auvora/near-client";

import { createHealthServer } from "./health.js";
import { runKeeperCycle } from "./keeper.js";
import { KeeperRuntimeState } from "./state.js";

export async function startKeeper(): Promise<void> {
  const config = readKeeperConfig(process.env);
  const client = createPrismaClient(config.DATABASE_URL);
  const store = new PrismaKeeperStore(client);
  const near = NearClient.testnet({
    rpcUrl: config.NEAR_RPC_URL,
    contractId: config.AUVORA_CONTRACT_ID,
    signerId: config.KEEPER_ACCOUNT_ID,
    privateKey: config.KEEPER_PRIVATE_KEY,
  });
  const state = new KeeperRuntimeState();
  const healthServer = createHealthServer({
    identity: {
      networkId: config.NEAR_NETWORK_ID,
      contractId: config.AUVORA_CONTRACT_ID,
      signerId: config.KEEPER_ACCOUNT_ID,
      instanceId: config.KEEPER_INSTANCE_ID,
    },
    state,
    port: config.KEEPER_HEALTH_PORT,
    staleAfterMs: config.KEEPER_POLL_INTERVAL_MS * 3,
  });
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    while (!stopping) {
      try {
        const stats = await runKeeperCycle({
          network: "testnet",
          contractId: config.AUVORA_CONTRACT_ID,
          signerId: config.KEEPER_ACCOUNT_ID,
          instanceId: config.KEEPER_INSTANCE_ID,
          pageSize: config.KEEPER_PAGE_SIZE,
          leaseMs: config.KEEPER_LEASE_MS,
          finalityTimeoutMs: config.KEEPER_FINALITY_TIMEOUT_MS,
          near,
          store,
          state,
        });
        process.stdout.write(
          `${JSON.stringify({ event: "keeper_cycle", ...stats })}\n`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(
          `${JSON.stringify({ event: "keeper_cycle_failed", message })}\n`,
        );
      }
      if (!stopping) await delay(config.KEEPER_POLL_INTERVAL_MS);
    }
  } finally {
    healthServer.close();
    await store.disconnect();
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
