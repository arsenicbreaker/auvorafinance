import { Account, JsonRpcProvider, actions } from "near-api-js";

const RECIPIENT_ID = "oceanrelayer.testnet";
const ALLOWLIST_STORAGE_DEPOSIT = 10_000_000_000_000_000_000_000n;
const CREATE_DEPOSIT = 50_000_000_000_000_000_000_000n;
const FUND_DEPOSIT = 5_000_000_000_000_000_000_000n;
const GAS = 30_000_000_000_000n;

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required in .env.deploy.local`);
  return value;
}

async function main() {
  const networkId = requireEnvironment("NEAR_NETWORK_ID");
  const rpcUrl = requireEnvironment("NEAR_RPC_URL");
  const contractId = requireEnvironment("AUVORA_CONTRACT_ID");
  const ownerId = requireEnvironment("OWNER_ACCOUNT_ID");
  const ownerPrivateKey = requireEnvironment("OWNER_PRIVATE_KEY");
  if (
    networkId !== "testnet" ||
    new URL(rpcUrl).hostname !== "rpc.testnet.near.org" ||
    !contractId.endsWith(".testnet")
  ) {
    throw new Error("Phase 1 proof is locked to the official NEAR testnet RPC");
  }
  if (
    ownerId !== contractId ||
    process.env.DEPLOY_CONFIRM?.trim() !== contractId
  ) {
    throw new Error("Owner and DEPLOY_CONFIRM must match the contract account");
  }

  const provider = new JsonRpcProvider({ url: rpcUrl });
  const account = new Account(ownerId, provider, ownerPrivateKey);
  const transactionHashes = {};

  const allowed = await provider.callFunction({
    contractId,
    method: "is_recipient_allowed",
    args: { owner_id: ownerId, account_id: RECIPIENT_ID },
    finality: "final",
  });
  if (!allowed) {
    const outcome = await account.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.functionCall(
          "add_allowed_recipient",
          { account_id: RECIPIENT_ID },
          GAS,
          ALLOWLIST_STORAGE_DEPOSIT,
        ),
      ],
      waitUntil: "FINAL",
      throwOnFailure: true,
    });
    transactionHashes.allowRecipient = outcome.transaction.hash;
  }

  const createOutcome = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actions.functionCall(
        "create_workflow",
        {
          args: {
            recipient_id: RECIPIENT_ID,
            amount: "10000000000000000000000",
            max_per_run: "10000000000000000000000",
            min_reserve: "20000000000000000000000",
            interval_ms: 60000,
            start_at_ms: Date.now() + 3_600_000,
            max_runs: 2,
            config_hash: "sha256:phase1-live-smoke-v1",
          },
        },
        GAS,
        CREATE_DEPOSIT,
      ),
    ],
    waitUntil: "FINAL",
    throwOnFailure: true,
  });
  transactionHashes.create = createOutcome.transaction.hash;

  const workflows = await provider.callFunction({
    contractId,
    method: "list_owner_workflows",
    args: { owner_id: ownerId, cursor: null, limit: 50 },
    finality: "final",
  });
  const workflow = workflows.at(-1);
  if (!workflow)
    throw new Error("Created workflow was not returned by the contract");
  const workflowId = workflow.id;

  for (const [label, method, deposit] of [
    ["fund", "fund_workflow", FUND_DEPOSIT],
    ["pause", "pause_workflow", 0n],
    ["resume", "resume_workflow", 0n],
    ["cancel", "cancel_workflow", 0n],
  ]) {
    const outcome = await account.signAndSendTransaction({
      receiverId: contractId,
      actions: [
        actions.functionCall(method, { workflow_id: workflowId }, GAS, deposit),
      ],
      waitUntil: "FINAL",
      throwOnFailure: true,
    });
    transactionHashes[label] = outcome.transaction.hash;
  }

  const withdrawable = await provider.callFunction({
    contractId,
    method: "get_withdrawable",
    args: { workflow_id: workflowId },
    finality: "final",
  });
  if (BigInt(withdrawable) <= 0n) {
    throw new Error(
      "Cancelled workflow unexpectedly has no withdrawable balance",
    );
  }
  const withdrawOutcome = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [
      actions.functionCall(
        "withdraw_available",
        { workflow_id: workflowId, amount: withdrawable },
        GAS,
        0n,
      ),
    ],
    waitUntil: "FINAL",
    throwOnFailure: true,
  });
  transactionHashes.withdraw = withdrawOutcome.transaction.hash;

  const finalWorkflow = await provider.callFunction({
    contractId,
    method: "get_workflow",
    args: { workflow_id: workflowId },
    finality: "final",
  });
  if (
    finalWorkflow.state !== "Cancelled" ||
    finalWorkflow.available_balance !== "0"
  ) {
    throw new Error(
      "Final workflow state or balance did not match the proof invariant",
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        contractId,
        workflowId,
        recipientId: RECIPIENT_ID,
        transactionHashes,
        finalState: finalWorkflow.state,
        finalAvailableBalance: finalWorkflow.available_balance,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Phase 1 testnet proof failed: ${message}\n`);
  process.exitCode = 1;
});
