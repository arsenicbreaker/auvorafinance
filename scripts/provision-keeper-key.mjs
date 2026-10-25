import { readFile, rename, unlink, writeFile } from "node:fs/promises";

import { Account, JsonRpcProvider, KeyPair } from "near-api-js";

const ENV_PATH = ".env.keeper.local";
const PENDING_ENV_PATH = ".env.keeper.pending.local";
const ALLOWANCE = 250_000_000_000_000_000_000_000n;

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required in ${ENV_PATH}`);
  }
  return value;
}

function transactionHash(outcome) {
  return outcome.transaction.hash;
}

async function main() {
  const networkId = requireEnvironment("NEAR_NETWORK_ID");
  const rpcUrl = requireEnvironment("NEAR_RPC_URL");
  const contractId = requireEnvironment("AUVORA_CONTRACT_ID");
  const keeperId = requireEnvironment("KEEPER_ACCOUNT_ID");
  const fullAccessSecret = requireEnvironment("KEEPER_PRIVATE_KEY");

  if (
    networkId !== "testnet" ||
    new URL(rpcUrl).hostname !== "rpc.testnet.near.org"
  ) {
    throw new Error("Keeper provisioning is locked to NEAR testnet");
  }

  const provider = new JsonRpcProvider({ url: rpcUrl });
  const fullAccessKey = KeyPair.fromString(fullAccessSecret);
  const currentAccess = await provider.viewAccessKey({
    accountId: keeperId,
    publicKey: fullAccessKey.getPublicKey(),
    finalityQuery: { finality: "final" },
  });

  if (currentAccess.permission !== "FullAccess") {
    throw new Error(
      "Current KEEPER_PRIVATE_KEY must be a valid full-access key for one-time provisioning",
    );
  }

  const restrictedKey = KeyPair.fromRandom("ed25519");
  const originalEnvironment = await readFile(ENV_PATH, "utf8");
  const restrictedEnvironment = originalEnvironment.replace(
    /^KEEPER_PRIVATE_KEY=.*$/m,
    `KEEPER_PRIVATE_KEY=${restrictedKey.toString()}`,
  );

  await writeFile(PENDING_ENV_PATH, restrictedEnvironment, {
    encoding: "utf8",
    flag: "wx",
  });

  try {
    const keeper = new Account(keeperId, provider, fullAccessSecret);
    const addKeyOutcome = await keeper.addFunctionCallAccessKey({
      publicKey: restrictedKey.getPublicKey(),
      contractId,
      methodNames: ["execute_due"],
      allowance: ALLOWANCE,
    });

    const permission = await provider.viewAccessKey({
      accountId: keeperId,
      publicKey: restrictedKey.getPublicKey(),
      finalityQuery: { finality: "final" },
    });

    await rename(PENDING_ENV_PATH, ENV_PATH);

    const status = await provider.callFunction({
      contractId,
      method: "get_status",
      args: {},
      finality: "final",
    });

    process.stdout.write(
      `${JSON.stringify(
        {
          keeperId,
          contractId,
          addKeyTransactionHash: transactionHash(addKeyOutcome),
          permission: permission.permission,
          status,
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    await unlink(PENDING_ENV_PATH).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Keeper key provisioning failed: ${message}\n`);
  process.exitCode = 1;
});
