import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Account, JsonRpcProvider, KeyPair, actions } from "near-api-js";

const ZERO_CODE_HASH = "11111111111111111111111111111111";
const DEFAULT_WASM_PATH =
  "target/wasm32-unknown-unknown/release/auvora_treasury.wasm";

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required in .env.deploy.local`);
  }
  return value;
}

function assertTestnetConfiguration({ networkId, rpcUrl, contractId }) {
  if (networkId !== "testnet") {
    throw new Error("Deployment is locked to NEAR testnet");
  }

  const parsedRpcUrl = new URL(rpcUrl);
  if (
    parsedRpcUrl.protocol !== "https:" ||
    parsedRpcUrl.hostname !== "rpc.testnet.near.org"
  ) {
    throw new Error("NEAR_RPC_URL must be https://rpc.testnet.near.org");
  }

  if (!contractId.endsWith(".testnet")) {
    throw new Error("AUVORA_CONTRACT_ID must be a .testnet account");
  }

  if (process.env.DEPLOY_CONFIRM?.trim() !== contractId) {
    throw new Error(
      "DEPLOY_CONFIRM must exactly match AUVORA_CONTRACT_ID before deployment",
    );
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
      "This Phase 0 deployment expects OWNER_ACCOUNT_ID and AUVORA_CONTRACT_ID to match",
    );
  }

  const keyPair = KeyPair.fromString(ownerPrivateKey);
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const account = new Account(contractId, provider, ownerPrivateKey);
  const state = await account.getState();

  if (state.codeHash !== ZERO_CODE_HASH) {
    throw new Error(
      `${contractId} already has contract code; refusing to overwrite it`,
    );
  }

  await account.getAccessKey(keyPair.getPublicKey());

  const wasmPath = resolve(process.env.WASM_PATH?.trim() || DEFAULT_WASM_PATH);
  const wasm = new Uint8Array(await readFile(wasmPath));

  const outcome = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actions.deployContract(wasm),
      actions.functionCall(
        "new",
        { owner_id: ownerId },
        30_000_000_000_000n,
        0n,
      ),
    ],
    waitUntil: "FINAL",
    throwOnFailure: true,
  });

  const status = await provider.callFunction({
    contractId,
    method: "get_status",
    args: {},
    finality: "final",
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        contractId,
        transactionHash: outcome.transaction.hash,
        status,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Testnet deployment failed: ${message}\n`);
  process.exitCode = 1;
});
