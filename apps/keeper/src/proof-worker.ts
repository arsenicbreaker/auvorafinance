import assert from "node:assert/strict";

import { readKeeperConfig } from "@auvora/config";
import { createPrismaClient, PrismaKeeperStore } from "@auvora/db";
import { NearClient } from "@auvora/near-client";
import type { KeeperNearClient } from "@auvora/near-client";

import { runKeeperCycle } from "./keeper.js";
import { KeeperRuntimeState } from "./state.js";

async function main() {
  assert(process.send, "PROOF_WORKER_REQUIRES_IPC_PARENT");
  const workflowId = Number(process.argv[2]);
  const instanceId = process.argv[3];
  assert(Number.isSafeInteger(workflowId) && workflowId >= 0);
  assert(instanceId);
  const holdAfterBroadcast = process.argv.includes("--hold-after-broadcast");
  const reconcileOnly = process.argv.includes("--reconcile-only");
  const config = readKeeperConfig(process.env);
  const client = createPrismaClient(config.DATABASE_URL);
  const near = NearClient.testnet({
    rpcUrl: config.NEAR_RPC_URL,
    contractId: config.AUVORA_CONTRACT_ID,
    signerId: config.KEEPER_ACCOUNT_ID,
    privateKey: config.KEEPER_PRIVATE_KEY,
  });
  const start = new Promise<void>((resolve) => {
    process.once("message", (message) => {
      assert.deepEqual(message, { command: "start" });
      resolve();
    });
  });
  try {
    await client.$connect();
    // Reach the parent barrier with a real database connection already open.
    process.send({ event: "ready", pid: process.pid });
    await start;
    const scoped: KeeperNearClient = {
      listWorkflows: async (cursor) => {
        if (reconcileOnly || cursor !== 0) return [];
        const workflow = await near.getWorkflow(workflowId);
        assert(workflow);
        return [workflow];
      },
      getWorkflow: (id) => near.getWorkflow(id),
      prepareExecuteDue: (id) => near.prepareExecuteDue(id),
      broadcastExecuteDue: async (bytes) => {
        await near.broadcastExecuteDue(bytes);
        if (holdAfterBroadcast) {
          process.send!({ event: "broadcast_checkpoint", pid: process.pid });
          // The parent terminates this OS process here, bypassing cycle cleanup.
          await new Promise<void>(() => {});
        }
      },
      waitForFinalExecution: (hash) => near.waitForFinalExecution(hash),
    };
    const stats = await runKeeperCycle({
      network: "testnet",
      contractId: config.AUVORA_CONTRACT_ID,
      signerId: config.KEEPER_ACCOUNT_ID,
      instanceId,
      pageSize: 50,
      leaseMs: holdAfterBroadcast ? 10_000 : 120_000,
      finalityTimeoutMs: 60_000,
      near: scoped,
      store: new PrismaKeeperStore(client),
      state: new KeeperRuntimeState(),
    });
    process.send({ event: "cycle_complete", pid: process.pid, stats });
  } catch (error) {
    if (process.connected)
      process.send({
        event: "worker_failed",
        pid: process.pid,
        errorCode:
          error instanceof assert.AssertionError
            ? error.message
            : error instanceof Error
              ? error.name
              : "UNKNOWN_ERROR",
      });
    process.exitCode = 1;
  } finally {
    await client.$disconnect();
    process.disconnect?.();
  }
}

void main().catch((error) => {
  if (process.connected) {
    process.send?.({
      event: "worker_failed",
      pid: process.pid,
      errorCode:
        error instanceof assert.AssertionError
          ? error.message
          : error instanceof Error
            ? error.name
            : "UNKNOWN_ERROR",
    });
    process.disconnect?.();
  }
  process.exitCode = 1;
});
