import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { Account, JsonRpcProvider, actions } from "near-api-js";

const ZERO_CODE_HASH = "11111111111111111111111111111111";
const DEFAULT_WASM_PATH = "target/near/auvora_treasury/auvora_treasury.wasm";

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in .env.deploy.local`);
  return value;
}

function assertTestnetConfiguration(networkId, rpcUrl, contractId) {
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
  const previewOnly = process.argv.includes("--preview");
  const networkId = requireEnvironment("NEAR_NETWORK_ID");
  const rpcUrl = requireEnvironment("NEAR_RPC_URL");
  const contractId = requireEnvironment("AUVORA_CONTRACT_ID");
  const ownerId = requireEnvironment("OWNER_ACCOUNT_ID");
  assertTestnetConfiguration(networkId, rpcUrl, contractId);
  if (ownerId !== contractId) {
    throw new Error("Phase 1 migration requires the contract account key");
  }

  const provider = new JsonRpcProvider({ url: rpcUrl });
  const state = await provider.query({
    request_type: "view_account",
    finality: "final",
    account_id: contractId,
  });
  if (state.code_hash === ZERO_CODE_HASH) {
    throw new Error(`${contractId} has no existing contract to migrate`);
  }

  const currentStatus = await provider.callFunction({
    contractId,
    method: "get_status",
    args: {},
    finality: "final",
  });
  let phaseTwoStateAvailable = false;
  try {
    await provider.callFunction({
      contractId,
      method: "get_accounting",
      args: {},
      finality: "final",
    });
    phaseTwoStateAvailable = true;
  } catch {
    phaseTwoStateAvailable = false;
  }
  const expectedStatus = phaseTwoStateAvailable
    ? "phase-2-ready"
    : "wallet-proof-confirmed";
  if (currentStatus.status !== expectedStatus) {
    throw new Error(
      `Expected ${expectedStatus} before contract upgrade, received ${String(currentStatus.status)}`,
    );
  }
  try {
    await provider.callFunction({
      contractId,
      method: "get_workflow",
      args: { workflow_id: 0 },
      finality: "final",
    });
  } catch {
    throw new Error(
      "Expected the deployed state to expose the Phase 1 get_workflow view",
    );
  }

  const wasmPath = resolve(process.env.WASM_PATH?.trim() || DEFAULT_WASM_PATH);
  const wasm = new Uint8Array(await readFile(wasmPath));
  const wasmSha256 = createHash("sha256").update(wasm).digest("hex");
  if (previewOnly) {
    process.stdout.write(
      `${JSON.stringify(
        {
          previewOnly: true,
          transactionSent: false,
          contractId,
          ownerId,
          currentStatus: currentStatus.status,
          currentCodeHash: state.code_hash,
          wasmPath,
          wasmBytes: wasm.byteLength,
          wasmSha256,
          phaseTwoStateAvailable,
          actions: phaseTwoStateAvailable
            ? ["deploy_contract", "set_status:phase-2-ready"]
            : [
                "deploy_contract",
                "migrate_phase_2",
                "set_status:phase-2-ready",
              ],
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const ownerPrivateKey = requireEnvironment("OWNER_PRIVATE_KEY");
  const account = new Account(contractId, provider, ownerPrivateKey);
  const upgradeActions = [actions.deployContract(wasm)];
  if (!phaseTwoStateAvailable) {
    upgradeActions.push(
      actions.functionCall("migrate_phase_2", {}, 30_000_000_000_000n, 0n),
    );
  }
  upgradeActions.push(
    actions.functionCall(
      "set_status",
      { status: "phase-2-ready" },
      10_000_000_000_000n,
      0n,
    ),
  );
  const outcome = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: upgradeActions,
    waitUntil: "FINAL",
    throwOnFailure: true,
  });

  const [status, workflows] = await Promise.all([
    provider.callFunction({
      contractId,
      method: "get_status",
      args: {},
      finality: "final",
    }),
    provider.callFunction({
      contractId,
      method: "list_workflows",
      args: { cursor: 0, limit: 1 },
      finality: "final",
    }),
  ]);
  process.stdout.write(
    `${JSON.stringify(
      {
        contractId,
        phaseTwoStateAvailableBeforeUpgrade: phaseTwoStateAvailable,
        wasmSha256,
        transactionHash: outcome.transaction.hash,
        status,
        discoveredWorkflowCount: workflows.length,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Phase 1 to Phase 3 migration failed: ${message}\n`);
  process.exitCode = 1;
});
