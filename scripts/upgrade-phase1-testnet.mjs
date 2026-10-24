import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Account, JsonRpcProvider, actions } from "near-api-js";

const ZERO_CODE_HASH = "11111111111111111111111111111111";
const DEFAULT_WASM_PATH =
  "target/wasm32-unknown-unknown/release/auvora_treasury.wasm";

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in .env.deploy.local`);
  return value;
}

function assertTestnetConfiguration({ networkId, rpcUrl, contractId }) {
  if (networkId !== "testnet") throw new Error("Upgrade is locked to testnet");
  const url = new URL(rpcUrl);
  if (url.protocol !== "https:" || url.hostname !== "rpc.testnet.near.org") {
    throw new Error("NEAR_RPC_URL must be https://rpc.testnet.near.org");
  }
  if (!contractId.endsWith(".testnet")) {
    throw new Error("AUVORA_CONTRACT_ID must be a .testnet account");
  }
  if (process.env.DEPLOY_CONFIRM?.trim() !== contractId) {
    throw new Error("DEPLOY_CONFIRM must exactly match AUVORA_CONTRACT_ID");
  }
}

async function main() {
  const networkId = requireEnvironment("NEAR_NETWORK_ID");
  const rpcUrl = requireEnvironment("NEAR_RPC_URL");
  const contractId = requireEnvironment("AUVORA_CONTRACT_ID");
  const ownerId = requireEnvironment("OWNER_ACCOUNT_ID");
  const ownerPrivateKey = requireEnvironment("OWNER_PRIVATE_KEY");
  assertTestnetConfiguration({ networkId, rpcUrl, contractId });
  if (ownerId !== contractId) {
    throw new Error(
      "Phase 1 upgrade requires the contract account full-access key",
    );
  }

  const provider = new JsonRpcProvider({ url: rpcUrl });
  const account = new Account(contractId, provider, ownerPrivateKey);
  const state = await account.getState();
  if (state.codeHash === ZERO_CODE_HASH) {
    throw new Error(`${contractId} has no existing contract to upgrade`);
  }

  try {
    await provider.callFunction({
      contractId,
      method: "get_workflow",
      args: { workflow_id: 0 },
      finality: "final",
    });
    throw new Error(
      "Phase 1 interface is already deployed; refusing to migrate twice",
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("already deployed")) {
      throw error;
    }
  }

  const wasmPath = resolve(process.env.WASM_PATH?.trim() || DEFAULT_WASM_PATH);
  const wasm = new Uint8Array(await readFile(wasmPath));
  const outcome = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actions.deployContract(wasm),
      actions.functionCall("migrate", {}, 30_000_000_000_000n, 0n),
      actions.functionCall(
        "set_status",
        { status: "phase-1-ready" },
        10_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
    throwOnFailure: true,
  });

  const [status, workflow] = await Promise.all([
    provider.callFunction({
      contractId,
      method: "get_status",
      args: {},
      finality: "final",
    }),
    provider.callFunction({
      contractId,
      method: "get_workflow",
      args: { workflow_id: 0 },
      finality: "final",
    }),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        contractId,
        transactionHash: outcome.transaction.hash,
        status,
        emptyWorkflowLookup: workflow,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Phase 1 testnet upgrade failed: ${message}\n`);
  process.exitCode = 1;
});
