import { readFile } from "node:fs/promises";

import {
  Account,
  JsonRpcProvider,
  actions,
  encodeSignedDelegate,
} from "near-api-js";

import { verifyDelegatePayload } from "../apps/relayer/dist/delegate.js";

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required in .env.relayer.local`);
  }
  return value;
}

function parseEnvironment(text) {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

async function main() {
  const networkId = requireEnvironment("NEAR_NETWORK_ID");
  const rpcUrl = requireEnvironment("NEAR_RPC_URL");
  const contractId = requireEnvironment("AUVORA_CONTRACT_ID");
  const relayerId = requireEnvironment("RELAYER_ACCOUNT_ID");
  const relayerPrivateKey = requireEnvironment("RELAYER_PRIVATE_KEY");
  const maxGas = BigInt(requireEnvironment("RELAYER_MAX_GAS_PER_REQUEST"));
  const ownerEnvironment = parseEnvironment(
    await readFile(".env.deploy.local", "utf8"),
  );
  const ownerId = ownerEnvironment.OWNER_ACCOUNT_ID?.trim();
  const ownerPrivateKey = ownerEnvironment.OWNER_PRIVATE_KEY?.trim();

  if (!ownerId || !ownerPrivateKey) {
    throw new Error("Owner credentials are required in .env.deploy.local");
  }
  if (
    networkId !== "testnet" ||
    new URL(rpcUrl).hostname !== "rpc.testnet.near.org"
  ) {
    throw new Error("Relayer proof is locked to NEAR testnet");
  }
  if (ownerId !== contractId) {
    throw new Error("Owner and contract must match for the Phase 0 proof");
  }

  const provider = new JsonRpcProvider({ url: rpcUrl });
  const owner = new Account(ownerId, provider, ownerPrivateKey);
  const relayer = new Account(relayerId, provider, relayerPrivateKey);
  const ownerBefore = await owner.getState();
  const relayerBefore = await relayer.getState();
  const block = await provider.viewBlock({ finality: "final" });
  const gas = 30_000_000_000_000n;

  const signed = await owner.createSignedMetaTransaction({
    receiverId: contractId,
    actions: [
      actions.functionCall(
        "set_status",
        { status: "relayed-call-confirmed" },
        gas,
        0n,
      ),
    ],
    blockHeightTtl: 200,
  });

  const decision = await verifyDelegatePayload(
    encodeSignedDelegate(signed.signedDelegate),
    {
      allowedMethods: new Set(["set_status"]),
      contractId,
      currentBlockHeight: BigInt(block.header.height),
      maxGasPerRequest: maxGas,
      networkId: "testnet",
    },
  );

  if (!decision.allowed) {
    throw new Error(`Relayer policy rejected payload: ${decision.code}`);
  }

  const optimistic = await relayer.relayMetaTransaction(signed.signedDelegate);
  const transactionHash = optimistic.transaction.hash;
  const finalOutcome = await provider.viewTransactionStatus({
    txHash: transactionHash,
    accountId: relayerId,
    waitUntil: "FINAL",
  });
  const ownerAfter = await owner.getState();
  const relayerAfter = await relayer.getState();
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
        ownerId,
        relayerId,
        transactionHash,
        finalExecutionStatus: finalOutcome.final_execution_status,
        policyDecision: decision,
        ownerTotalBalanceDelta:
          ownerAfter.balance.total - ownerBefore.balance.total,
        relayerTotalBalanceDelta:
          relayerAfter.balance.total - relayerBefore.balance.total,
        status,
      },
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Relayer proof failed: ${message}\n`);
  process.exitCode = 1;
});
