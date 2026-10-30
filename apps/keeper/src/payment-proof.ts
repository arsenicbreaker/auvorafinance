import assert from "node:assert/strict";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, actions, baseEncode } from "near-api-js";
import type { KeyPairString } from "near-api-js";

import { readKeeperConfig } from "@auvora/config";
import { createPrismaClient, PrismaKeeperStore } from "@auvora/db";
import { NearClient, verifyExecutionEvidence } from "@auvora/near-client";
import type { KeeperNearClient, WorkflowView } from "@auvora/near-client";

import { runKeeperCycle } from "./keeper.js";
import { KeeperRuntimeState } from "./state.js";
import { spawnProofProcess } from "./proof-process.js";

const config = readKeeperConfig(process.env);
const ownerId = process.env.OWNER_ACCOUNT_ID?.trim();
assert.equal(ownerId, config.AUVORA_CONTRACT_ID, "OWNER_MUST_MATCH_CONTRACT");
assert.equal(
  config.NEAR_RPC_URL,
  "https://rpc.testnet.near.org",
  "OFFICIAL_TESTNET_RPC_REQUIRED",
);
assert(config.AUVORA_CONTRACT_ID.endsWith(".testnet"));
assert(config.KEEPER_ACCOUNT_ID.endsWith(".testnet"));
const recipientId = "oceanrelayer.testnet";
assert.notEqual(
  recipientId,
  config.KEEPER_ACCOUNT_ID,
  "RECIPIENT_MUST_NOT_PAY_GAS",
);
const provider = new JsonRpcProvider({ url: config.NEAR_RPC_URL });
const owner = new Account(
  ownerId,
  provider,
  process.env.OWNER_PRIVATE_KEY as KeyPairString,
);
assert(owner.getSigner(), "OWNER_SIGNER_REQUIRED");
const keeperAccount = new Account(
  config.KEEPER_ACCOUNT_ID,
  provider,
  config.KEEPER_PRIVATE_KEY as KeyPairString,
);
const keeperSigner = keeperAccount.getSigner();
assert(keeperSigner, "KEEPER_SIGNER_REQUIRED");
const accessKey = await provider.viewAccessKey({
  accountId: config.KEEPER_ACCOUNT_ID,
  publicKey: await keeperSigner.getPublicKey(),
  finalityQuery: { finality: "final" },
});
assert(
  typeof accessKey.permission === "object" &&
    "FunctionCall" in accessKey.permission,
  "KEEPER_KEY_MUST_BE_RESTRICTED",
);
assert.equal(
  accessKey.permission.FunctionCall.receiver_id,
  config.AUVORA_CONTRACT_ID,
);
assert.deepEqual(accessKey.permission.FunctionCall.method_names, [
  "execute_due",
]);
assert.notEqual(
  (await owner.getSigner()?.getPublicKey())?.toString(),
  (await keeperSigner.getPublicKey()).toString(),
  "OWNER_AND_KEEPER_KEYS_MUST_DIFFER",
);

const allowed = await view("is_recipient_allowed", {
  owner_id: ownerId,
  account_id: recipientId,
});
assert.equal(typeof allowed, "boolean", "ALLOWLIST_VIEW_REQUIRED");
const deposit = 50_000_000_000_000_000_000_000n;
const amount = 1_000_000_000_000_000_000_000n;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const separateProcesses =
  process.argv.includes("--processes") ||
  process.argv.includes("--resume-process-journal");
let journal = fileURLToPath(
  new URL(`../../../result/phase7-${runId}.jsonl`, import.meta.url),
);
const plan = {
  network: "testnet",
  contractId: config.AUVORA_CONTRACT_ID,
  ownerId,
  keeperId: config.KEEPER_ACCOUNT_ID,
  recipientId,
  allowRecipient: !allowed,
  allowlistDepositYocto: allowed ? "0" : "10000000000000000000000",
  createDepositYoctoPerWorkflow: deposit.toString(),
  maxAttachedDepositYocto: (
    2n * deposit +
    (allowed ? 0n : 10_000_000_000_000_000_000_000n)
  ).toString(),
  payment: {
    amountYocto: amount.toString(),
    minReserveYocto: "2000000000000000000000",
    intervalMs: 60000,
    maxRuns: 2,
  },
  reserveFixture: {
    amountYocto: amount.toString(),
    minReserveYocto: "100000000000000000000000",
    intervalMs: 60000,
    maxRuns: 1,
  },
  schedule:
    "Each fixture starts 30 seconds after its creation request; the second payment waits for the contract's next due time.",
  ownerMethods: [
    ...(allowed ? [] : ["add_allowed_recipient"]),
    "create_workflow",
    "cancel_workflow",
    "withdraw_available",
  ],
  keeperMethods: ["execute_due"],
  cleanup:
    "Cancel the reserve fixture and withdraw remaining balances from both new workflows. Storage and gas remain spent; successful payments total 0.002 NEAR.",
  scope: separateProcesses
    ? "Real OS process termination after persisted broadcast, a new recovery process, then two independent keeper processes released from an IPC start barrier."
    : "Real keeper cycle and PostgreSQL persistence; reconstructs the client and store after a deliberately interrupted finality read. Concurrent cycles use two instance IDs in one process; this does not prove an operating-system process crash.",
};
process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);

if (process.argv.includes("--execute")) {
  assert(
    !process.argv.includes("--cleanup-journal"),
    "CHOOSE_EXECUTION_OR_CLEANUP",
  );
  await main();
} else if (process.argv.includes("--cleanup-journal")) {
  await cleanupFromJournal();
} else if (process.argv.includes("--resume-process-journal")) {
  await resumeProcessProof();
}

async function readProofJournal(flag: string) {
  assert.equal(process.env.DEPLOY_CONFIRM?.trim(), config.AUVORA_CONTRACT_ID);
  const argument = process.argv[process.argv.indexOf(flag) + 1];
  assert(argument, "JOURNAL_PATH_REQUIRED");
  journal = resolve(argument);
  const withinResult = relative(
    fileURLToPath(new URL("../../../result/", import.meta.url)),
    journal,
  );
  assert(
    !withinResult.startsWith("..") &&
      !isAbsolute(withinResult) &&
      withinResult.endsWith(".jsonl"),
    "JOURNAL_MUST_BE_IN_RESULT_DIRECTORY",
  );
  const records = (await readFile(journal, "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line)) as Array<{
    event: string;
    plan?: { contractId: string; ownerId: string; recipientId: string };
    method?: string;
    purpose?: string;
    workflowId?: number;
    transactionHash?: string;
    args?: { args?: { config_hash?: string } };
  }>;
  assert.equal(records[0]?.event, "proof_started");
  assert.equal(records[0].plan?.contractId, config.AUVORA_CONTRACT_ID);
  assert.equal(records[0].plan?.ownerId, ownerId);
  assert.equal(records[0].plan?.recipientId, recipientId);
  return records;
}

async function resumeProcessProof() {
  const records = await readProofJournal("--resume-process-journal");
  const fixtures = records.filter((row) => row.event === "fixture_created");
  assert(fixtures.length >= 1 && fixtures.length <= 2);
  assert.equal(
    records.filter(
      (row) =>
        row.event === "owner_call_started" && row.method === "create_workflow",
    ).length,
    fixtures.length,
    "RECONCILE_UNRECORDED_CREATION_BEFORE_RESUMING",
  );
  for (const signed of records.filter(
    (row) =>
      row.event === "owner_call_signed" && row.method === "create_workflow",
  )) {
    assert(
      records.some(
        (row) =>
          row.event === "owner_call_final" &&
          row.transactionHash === signed.transactionHash,
      ),
      "RECONCILE_OWNER_CREATION_BEFORE_RESUMING",
    );
  }
  const paymentFixture = fixtures.find((row) => row.purpose === "payments");
  assert(typeof paymentFixture?.workflowId === "number");
  const paymentId = paymentFixture.workflowId;
  const existing = await workflow(paymentId);
  const createdHash = records.find(
    (row) =>
      row.event === "owner_call_started" && row.method === "create_workflow",
  )?.args?.args?.config_hash;
  assert.equal(existing.config_hash, createdHash);
  assert.equal(existing.owner_id, ownerId);
  assert.equal(existing.recipient_id, recipientId);
  assert.equal(existing.amount, amount.toString());
  assert.equal(existing.max_per_run, amount.toString());
  assert.equal(existing.min_reserve, "2000000000000000000000");
  assert(BigInt(existing.available_balance) <= deposit);
  assert.equal(existing.max_runs, 2);
  const recovery = await processCycle(paymentId, "resume-reconcile", true);
  assert.equal(recovery.submitted, 0);
  const before = await workflow(paymentId);
  if (before.runs_completed === 1) {
    await waitDue(paymentId);
    const recipientBefore = await balance();
    const ledgerBefore = await workflow(paymentId);
    const contenders = await competingProcesses(paymentId);
    assert.equal(
      contenders.reduce((sum, stats) => sum + stats.submitted, 0),
      1,
      "ONE_PROCESS_SUBMISSION_PER_SLOT",
    );
    await checkDelta(paymentId, ledgerBefore, recipientBefore, amount);
  }
  const completed = await workflow(paymentId);
  assert.equal(completed.state, "Completed");
  assert.equal(completed.runs_completed, 2);
  const previousReserve = fixtures.find((row) => row.purpose === "reserve");
  const reserveId =
    previousReserve?.workflowId ??
    (await createWorkflow(1, "100000000000000000000000", "reserve"));
  const reserve = await workflow(reserveId);
  assert.equal(reserve.owner_id, ownerId);
  assert.equal(reserve.recipient_id, recipientId);
  assert.equal(reserve.amount, amount.toString());
  assert.equal(reserve.min_reserve, "100000000000000000000000");
  assert.equal(reserve.max_runs, 1);
  assert(BigInt(reserve.available_balance) <= deposit);
  if (previousReserve)
    assert.equal(
      reserve.config_hash,
      records.find(
        (row) =>
          row.event === "owner_call_started" &&
          row.method === "create_workflow" &&
          row.args?.args?.config_hash?.startsWith("phase7-reserve-"),
      )?.args?.args?.config_hash,
    );
  const client = createPrismaClient(config.DATABASE_URL);
  try {
    const alreadySkipped = await client.submittedTransaction.count({
      where: {
        network: "testnet",
        contractId: config.AUVORA_CONTRACT_ID,
        workflowId: BigInt(reserveId),
        finalState: "Success",
        errorCode: "RESERVE_GUARD",
      },
    });
    if (alreadySkipped === 0) {
      await waitDue(reserveId);
      const recipientBefore = await balance();
      const reserveBefore = await workflow(reserveId);
      const stats = await processCycle(reserveId, "reserve");
      assert.equal(stats.finalized, 1);
      await checkDelta(reserveId, reserveBefore, recipientBefore, 0n);
    }
    const rows = await client.submittedTransaction.findMany({
      where: {
        network: "testnet",
        contractId: config.AUVORA_CONTRACT_ID,
        workflowId: { in: [BigInt(paymentId), BigInt(reserveId)] },
      },
    });
    assert.equal(rows.length, 3);
    for (const row of rows) {
      const evidence = verifyExecutionEvidence(
        await provider.viewTransactionStatusWithReceipts({
          txHash: row.transactionHash,
          accountId: row.signerId,
          waitUntil: "FINAL",
        }),
        {
          ...row,
          contractId: config.AUVORA_CONTRACT_ID,
          workflowId: row.workflowId.toString(),
          scheduledForMs: row.scheduledForMs.toString(),
        },
      );
      assert(evidence.verified);
      assert.equal(
        evidence.event.event,
        row.workflowId === BigInt(paymentId)
          ? "execution_succeeded"
          : "execution_skipped",
      );
      if (row.workflowId === BigInt(reserveId))
        assert.equal(evidence.event.reasonCode, "RESERVE_GUARD");
      await log({
        event: "verified_process_execution",
        transactionHash: row.transactionHash,
        evidence,
      });
    }
  } finally {
    await client.$disconnect();
  }
  await cleanupFromJournal("--resume-process-journal");
  await log({ event: "process_proof_passed", paymentId, reserveId });
}

async function cleanupFromJournal(flag = "--cleanup-journal") {
  const records = await readProofJournal(flag);

  for (const record of records.filter(
    (row) => row.event === "owner_call_signed",
  )) {
    assert(record.transactionHash);
    const outcome = await provider.viewTransactionStatusWithReceipts({
      txHash: record.transactionHash,
      accountId: ownerId!,
      waitUntil: "FINAL",
    });
    assertFinalOwnerOutcome(outcome);
    await log({
      event: "owner_call_reconciled",
      method: record.method,
      transactionHash: record.transactionHash,
    });
  }

  const fixtures = records.filter((row) => row.event === "fixture_created");
  assert(
    fixtures.length > 0 && fixtures.length <= 2,
    "EXPECTED_ISOLATED_FIXTURES",
  );
  for (const fixture of fixtures) {
    assert(typeof fixture.workflowId === "number");
    assert(fixture.purpose === "payments" || fixture.purpose === "reserve");
    const current = await workflow(fixture.workflowId);
    const createdHash = records.find(
      (row) =>
        row.event === "owner_call_started" &&
        row.method === "create_workflow" &&
        row.args?.args?.config_hash?.startsWith(`phase7-${fixture.purpose}-`),
    )?.args?.args?.config_hash;
    assert(
      createdHash && current.config_hash === createdHash,
      "FIXTURE_IDENTITY_MISMATCH",
    );
    assert.equal(current.owner_id, ownerId);
    assert.equal(current.recipient_id, recipientId);
    assert.equal(
      current.pending_execution,
      null,
      "RECONCILE_PENDING_TRANSFER_FIRST",
    );
    assert(BigInt(current.available_balance) <= deposit);
    if (current.state === "Active" || current.state === "Paused") {
      assert.equal(
        fixture.purpose,
        "reserve",
        "DO_NOT_CANCEL_UNFINISHED_PAYMENTS",
      );
      await ownerCall("cancel_workflow", { workflow_id: current.id });
    } else {
      await log({
        event: "cleanup_existing_state",
        workflowId: current.id,
        state: current.state,
      });
    }
    const before = await workflow(current.id);
    assert(before.state === "Completed" || before.state === "Cancelled");
    assert.equal(before.withdrawable, before.available_balance);
    if (BigInt(before.withdrawable) > 0n)
      await ownerCall("withdraw_available", {
        workflow_id: current.id,
        amount: before.withdrawable,
      });
    assert.equal((await workflow(current.id)).available_balance, "0");
  }
  await log({
    event: "cleanup_passed",
    workflowIds: fixtures.map((row) => row.workflowId),
  });
}

async function main() {
  assert.equal(
    process.env.DEPLOY_CONFIRM?.trim(),
    config.AUVORA_CONTRACT_ID,
    "DEPLOY_CONFIRM_REQUIRED",
  );
  const client = createPrismaClient(config.DATABASE_URL);
  let journalStarted = false;
  try {
    await client.$connect();
    assert.equal(
      await client.submittedTransaction.count({
        where: {
          network: "testnet",
          contractId: config.AUVORA_CONTRACT_ID,
          finalState: "Pending",
        },
      }),
      0,
      "RECONCILE_EXISTING_PENDING_TRANSACTIONS_FIRST",
    );
    await mkdir(fileURLToPath(new URL("../../../result/", import.meta.url)), {
      recursive: true,
    });
    await writeFile(
      journal,
      `${JSON.stringify({ event: "proof_started", plan })}\n`,
      { flag: "wx" },
    );
    journalStarted = true;
    for (let cursor = 0; ; cursor += 50) {
      const workflows = await provider.callFunction<WorkflowView[]>({
        contractId: config.AUVORA_CONTRACT_ID,
        method: "list_owner_workflows",
        args: { owner_id: ownerId, cursor, limit: 50 },
        blockQuery: { finality: "final" },
      });
      assert(Array.isArray(workflows), "WORKFLOW_LIST_REQUIRED");
      assert(
        !workflows.some(
          (item) =>
            item.config_hash.startsWith("phase7-") &&
            (item.state === "Active" ||
              item.state === "Paused" ||
              item.pending_execution !== null),
        ),
        "RESOLVE_PREVIOUS_PHASE7_FIXTURES_FIRST",
      );
      if (workflows.length < 50) break;
    }
    if (!allowed)
      await ownerCall(
        "add_allowed_recipient",
        { account_id: recipientId },
        10_000_000_000_000_000_000_000n,
      );

    const paymentId = await createWorkflow(
      2,
      "2000000000000000000000",
      "payments",
    );
    await waitDue(paymentId);
    const balanceBefore = await balance();
    const workflowBefore = await workflow(paymentId);
    if (separateProcesses) {
      const crashed = spawnProofProcess({
        config,
        workflowId: paymentId,
        instanceId: `proof-${runId}-crashed`,
        holdAfterBroadcast: true,
      });
      try {
        await crashed.ready();
        crashed.start();
        await crashed.checkpoint();
        assert(crashed.kill(), "WORKER_TERMINATION_FAILED");
        const result = await crashed.completion;
        assert(
          result.exitCode !== 0 || result.signal !== null,
          "WORKER_DID_NOT_CRASH",
        );
        await log({ event: "process_terminated_after_broadcast", ...result });
      } finally {
        crashed.kill();
      }
    } else {
      await cycle(paymentId, "interrupted", true);
    }
    const pending = await client.submittedTransaction.findMany({
      where: {
        network: "testnet",
        contractId: config.AUVORA_CONTRACT_ID,
        workflowId: BigInt(paymentId),
        finalState: "Pending",
      },
    });
    assert.equal(pending.length, 1, "EXPECTED_ONE_PERSISTED_HASH");
    const restart = separateProcesses
      ? await processCycle(paymentId, "restarted", true)
      : await cycle(paymentId, "restarted");
    assert.equal(restart.submitted, 0, "RESTART_MUST_NOT_SIGN_NEW_TRANSACTION");
    assert.equal(restart.finalized, 1, "RESTART_MUST_RECONCILE_PERSISTED_HASH");
    await log({
      event: "restart_reconciled",
      transactionHash: pending[0]!.transactionHash,
    });
    await checkDelta(paymentId, workflowBefore, balanceBefore, amount);

    await waitDue(paymentId);
    const secondBalance = await balance();
    const secondWorkflow = await workflow(paymentId);
    const contenders = separateProcesses
      ? await competingProcesses(paymentId)
      : await Promise.all([
          cycle(paymentId, "contender-a"),
          cycle(paymentId, "contender-b"),
        ]);
    assert.equal(
      contenders.reduce((sum, stats) => sum + stats.submitted, 0),
      1,
      "ONE_SUBMISSION_PER_SLOT",
    );
    await checkDelta(paymentId, secondWorkflow, secondBalance, amount);
    const completed = await workflow(paymentId);
    assert.equal(completed.state, "Completed");
    assert.equal(completed.runs_completed, 2);
    assert.equal(completed.pending_execution, null);

    const reserveId = await createWorkflow(
      1,
      "100000000000000000000000",
      "reserve",
    );
    await waitDue(reserveId);
    const reserveBalance = await balance();
    const reserveWorkflow = await workflow(reserveId);
    const skipped = await cycle(reserveId, "reserve");
    assert.equal(skipped.finalized, 1);
    await checkDelta(reserveId, reserveWorkflow, reserveBalance, 0n);

    const rows = await client.submittedTransaction.findMany({
      where: {
        network: "testnet",
        contractId: config.AUVORA_CONTRACT_ID,
        workflowId: { in: [BigInt(paymentId), BigInt(reserveId)] },
      },
      orderBy: { submittedAt: "asc" },
    });
    assert.equal(rows.length, 3, "EXPECTED_TWO_PAYMENTS_AND_ONE_REJECTION");
    for (const row of rows) {
      const evidence = verifyExecutionEvidence(
        await provider.viewTransactionStatusWithReceipts({
          txHash: row.transactionHash,
          accountId: row.signerId,
          waitUntil: "FINAL",
        }),
        {
          ...row,
          contractId: config.AUVORA_CONTRACT_ID,
          workflowId: row.workflowId.toString(),
          scheduledForMs: row.scheduledForMs.toString(),
        },
      );
      assert(
        evidence.verified,
        `UNVERIFIED_${evidence.verified ? "" : evidence.reason}`,
      );
      assert.equal(
        evidence.event.event,
        row.workflowId === BigInt(paymentId)
          ? "execution_succeeded"
          : "execution_skipped",
      );
      if (row.workflowId === BigInt(reserveId))
        assert.equal(evidence.event.reasonCode, "RESERVE_GUARD");
      await log({
        event: "verified_execution",
        transactionHash: row.transactionHash,
        evidence,
      });
    }

    await ownerCall("cancel_workflow", { workflow_id: reserveId });
    for (const id of [paymentId, reserveId]) {
      const remaining = (await workflow(id)).withdrawable;
      if (BigInt(remaining) > 0n)
        await ownerCall("withdraw_available", {
          workflow_id: id,
          amount: remaining,
        });
      assert.equal((await workflow(id)).available_balance, "0");
    }
    await log({ event: "proof_passed", paymentId, reserveId });
  } catch (error) {
    if (journalStarted)
      await log({
        event: "proof_stopped",
        errorCode:
          error instanceof assert.AssertionError
            ? error.message
            : error instanceof Error
              ? error.name
              : "UNKNOWN_ERROR",
        instruction:
          "Inspect the journal and finalized chain state before another run. Do not automatically recreate fixtures or retry an unknown owner transaction.",
      });
    throw new Error(`PHASE7_PROOF_STOPPED: inspect ${journal}`);
  } finally {
    await client.$disconnect();
  }
}

async function cycle(id: number, instance: string, interruptFinality = false) {
  const client = createPrismaClient(config.DATABASE_URL);
  const near = NearClient.testnet({
    rpcUrl: config.NEAR_RPC_URL,
    contractId: config.AUVORA_CONTRACT_ID,
    signerId: config.KEEPER_ACCOUNT_ID,
    privateKey: config.KEEPER_PRIVATE_KEY,
  });
  const scoped: KeeperNearClient = {
    listWorkflows: async (cursor) => (cursor === 0 ? [await workflow(id)] : []),
    getWorkflow: (workflowId) => near.getWorkflow(workflowId),
    prepareExecuteDue: (workflowId) => near.prepareExecuteDue(workflowId),
    broadcastExecuteDue: (bytes) => near.broadcastExecuteDue(bytes),
    waitForFinalExecution: (hash) => {
      if (interruptFinality) throw new Error("PROOF_INTERRUPTED_FINALITY_READ");
      return near.waitForFinalExecution(hash);
    },
  };
  try {
    const stats = await runKeeperCycle({
      network: "testnet",
      contractId: config.AUVORA_CONTRACT_ID,
      signerId: config.KEEPER_ACCOUNT_ID,
      instanceId: `proof-${runId}-${instance}`,
      pageSize: 50,
      leaseMs: 120_000,
      finalityTimeoutMs: 60_000,
      near: scoped,
      store: new PrismaKeeperStore(client),
      state: new KeeperRuntimeState(),
    });
    await log({ event: "keeper_cycle", instance, workflowId: id, ...stats });
    return stats;
  } finally {
    await client.$disconnect();
  }
}

async function processCycle(
  id: number,
  instance: string,
  reconcileOnly = false,
) {
  const worker = spawnProofProcess({
    config,
    workflowId: id,
    instanceId: `proof-${runId}-${instance}`,
    reconcileOnly,
  });
  try {
    await worker.ready();
    worker.start();
    const result = await worker.completion;
    await log({
      event: "process_cycle_result",
      instance,
      workflowId: id,
      ...result,
    });
    assert.equal(result.exitCode, 0, "PROOF_WORKER_FAILED");
    assert(result.stats, "WORKER_STATS_REQUIRED");
    await log({ event: "process_cycle", instance, workflowId: id, ...result });
    return result.stats;
  } catch (error) {
    const result = await worker.completion.catch(() => null);
    await log({
      event: "process_cycle_failed",
      instance,
      workflowId: id,
      result,
    });
    throw error;
  } finally {
    worker.kill();
  }
}

async function competingProcesses(id: number) {
  const workers = ["process-a", "process-b"].map((instance) =>
    spawnProofProcess({
      config,
      workflowId: id,
      instanceId: `proof-${runId}-${instance}`,
    }),
  );
  try {
    await Promise.all(workers.map((worker) => worker.ready()));
    await log({ event: "process_barrier_released", workflowId: id });
    workers.forEach((worker) => worker.start());
    const results = await Promise.all(
      workers.map((worker) => worker.completion),
    );
    assert.notEqual(results[0]!.pid, results[1]!.pid);
    for (const result of results) {
      assert.equal(result.exitCode, 0, "CONTENDING_PROCESS_FAILED");
      assert(result.stats, "WORKER_STATS_REQUIRED");
      await log({
        event: "process_contender_complete",
        workflowId: id,
        ...result,
      });
    }
    return results.map((result) => result.stats!);
  } finally {
    workers.forEach((worker) => worker.kill());
  }
}

async function ownerCall(
  method: string,
  args: Record<string, unknown>,
  attachedDeposit = 0n,
) {
  await log({
    event: "owner_call_started",
    method,
    args,
    attachedDeposit: attachedDeposit.toString(),
  });
  const signer = owner.getSigner();
  assert(signer);
  const transaction = await owner.createTransaction({
    receiverId: config.AUVORA_CONTRACT_ID,
    publicKey: await signer.getPublicKey(),
    actions: [
      actions.functionCall(method, args, 100_000_000_000_000n, attachedDeposit),
    ],
  });
  const signed = await signer.signTransaction(transaction);
  const transactionHash = baseEncode(signed.txHash);
  await log({ event: "owner_call_signed", method, args, transactionHash });
  await provider.sendTransactionUntil(signed.signedTransaction, "NONE");
  const outcome = await provider.viewTransactionStatusWithReceipts({
    txHash: transactionHash,
    accountId: ownerId!,
    waitUntil: "FINAL",
  });
  assertFinalOwnerOutcome(outcome);
  await log({
    event: "owner_call_final",
    method,
    transactionHash: outcome.transaction.hash,
  });
  return outcome;
}

function assertFinalOwnerOutcome(
  outcome: Awaited<
    ReturnType<JsonRpcProvider["viewTransactionStatusWithReceipts"]>
  >,
) {
  assert.equal(outcome.final_execution_status, "FINAL");
  assert(
    typeof outcome.status === "object" &&
      ("SuccessValue" in outcome.status ||
        "SuccessReceiptId" in outcome.status),
    "OWNER_TRANSACTION_FAILED",
  );
  for (const receipt of outcome.receipts_outcome) {
    assert(
      typeof receipt.outcome.status === "object" &&
        !("Failure" in receipt.outcome.status),
    );
  }
}

async function createWorkflow(
  maxRuns: number,
  minReserve: string,
  purpose: string,
) {
  const outcome = await ownerCall(
    "create_workflow",
    {
      args: {
        recipient_id: recipientId,
        amount: amount.toString(),
        max_per_run: amount.toString(),
        min_reserve: minReserve,
        interval_ms: 60_000,
        start_at_ms: Date.now() + 30_000,
        max_runs: maxRuns,
        config_hash: `phase7-${purpose}-${runId}`,
      },
    },
    deposit,
  );
  assert(
    typeof outcome.status === "object" && "SuccessValue" in outcome.status,
  );
  const id: unknown = JSON.parse(
    Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8"),
  );
  assert(typeof id === "number" && Number.isSafeInteger(id));
  await log({ event: "fixture_created", purpose, workflowId: id });
  return id;
}

async function view(method: string, args: Record<string, unknown>) {
  return provider.callFunction({
    contractId: config.AUVORA_CONTRACT_ID,
    method,
    args,
    blockQuery: { finality: "final" },
  });
}

async function workflow(id: number): Promise<WorkflowView> {
  const result = await NearClient.testnet({
    rpcUrl: config.NEAR_RPC_URL,
    contractId: config.AUVORA_CONTRACT_ID,
    signerId: config.KEEPER_ACCOUNT_ID,
    privateKey: config.KEEPER_PRIVATE_KEY,
  }).getWorkflow(id);
  assert(result, "WORKFLOW_NOT_FOUND");
  return result;
}

async function balance() {
  return (
    await provider.viewAccount({
      accountId: recipientId,
      blockQuery: { finality: "final" },
    })
  ).amount;
}

async function checkDelta(
  id: number,
  before: WorkflowView,
  recipientBefore: bigint,
  expectedDelta: bigint,
) {
  const after = await workflow(id);
  const recipientDelta = (await balance()) - recipientBefore;
  const workflowDelta =
    BigInt(before.available_balance) - BigInt(after.available_balance);
  assert.equal(recipientDelta, expectedDelta, "RECIPIENT_DELTA_MISMATCH");
  assert.equal(workflowDelta, expectedDelta, "WORKFLOW_DELTA_MISMATCH");
  assert.equal(after.pending_execution, null);
  await log({
    event: "balance_delta",
    workflowId: id,
    recipientDelta: recipientDelta.toString(),
    workflowDelta: workflowDelta.toString(),
  });
}

async function waitDue(id: number) {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const current = await workflow(id);
    assert.equal(current.state, "Active");
    if (current.next_run_at_ms <= Date.now()) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("DUE_TIME_TIMEOUT");
}

async function log(value: Record<string, unknown>) {
  const line = `${JSON.stringify({ observedAt: new Date().toISOString(), ...value })}\n`;
  await appendFile(journal, line);
  process.stdout.write(line);
}
