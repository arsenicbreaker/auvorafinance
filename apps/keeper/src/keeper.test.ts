import { describe, expect, it, vi } from "vitest";

import type {
  FinalizedExecution,
  KeeperNearClient,
  WorkflowView,
} from "@auvora/near-client";

import { getHealthPayload } from "./health.js";
import { runKeeperCycle } from "./keeper.js";
import { InMemoryKeeperStore } from "./memory-store.js";
import { KeeperRuntimeState } from "./state.js";

const TRANSACTION_HASH = "11111111111111111111111111111111";
const NOW_MS = 1_800_000_000_000;

class FakeNearClient implements KeeperNearClient {
  submitCount = 0;
  broadcastError = false;
  finalityError = false;

  constructor(public workflow: WorkflowView) {}

  async listWorkflows(cursor: number): Promise<WorkflowView[]> {
    return cursor === 0 ? [this.workflow] : [];
  }

  async getWorkflow(): Promise<WorkflowView> {
    return this.workflow;
  }

  async prepareExecuteDue() {
    return {
      transactionHash: TRANSACTION_HASH,
      signedTransactionBase64: "c2lnbmVkLXRyYW5zYWN0aW9u",
    };
  }

  async broadcastExecuteDue(): Promise<void> {
    this.submitCount += 1;
    if (this.broadcastError) throw new Error("RPC_RESPONSE_LOST");
  }

  async waitForFinalExecution(): Promise<FinalizedExecution> {
    if (this.finalityError) throw new Error("RPC_UNAVAILABLE");
    const event = {
      event: "execution_succeeded" as const,
      workflowId: this.workflow.id,
      runIndex: this.workflow.runs_completed,
      scheduledForMs: this.workflow.next_run_at_ms,
      amountYocto: this.workflow.amount,
      reasonCode: null,
    };
    this.workflow = {
      ...this.workflow,
      runs_completed: this.workflow.runs_completed + 1,
      next_run_at_ms: NOW_MS + 60_000,
    };
    return {
      transactionHash: TRANSACTION_HASH,
      status: "Succeeded",
      reasonCode: null,
      event,
      explorerUrl: `https://testnet.nearblocks.io/txns/${TRANSACTION_HASH}`,
    };
  }
}

describe("keeper cycle", () => {
  it("re-reads, submits, finalizes, and records a heartbeat", async () => {
    const near = new FakeNearClient(dueWorkflow());
    const store = new InMemoryKeeperStore();
    const state = new KeeperRuntimeState();

    const stats = await runKeeperCycle(cycleOptions({ near, store, state }));

    expect(stats).toMatchObject({
      discovered: 1,
      candidates: 1,
      leased: 1,
      submitted: 1,
      finalized: 1,
    });
    expect(near.submitCount).toBe(1);
    expect(store.finalizations.get(TRANSACTION_HASH)?.status).toBe("Succeeded");
    expect(store.heartbeats.get("keeper-a")?.lastErrorCode).toBeNull();
  });

  it("keeps an unresolved hash pending and only rebroadcasts the same transaction", async () => {
    const near = new FakeNearClient(dueWorkflow());
    near.finalityError = true;
    const store = new InMemoryKeeperStore();
    const state = new KeeperRuntimeState();

    const first = await runKeeperCycle(cycleOptions({ near, store, state }));
    const second = await runKeeperCycle(cycleOptions({ near, store, state }));

    expect(first.submitted).toBe(1);
    expect(second.reconciliationPending).toBe(1);
    expect(second.submitted).toBe(0);
    expect(near.submitCount).toBe(2);
  });

  it("persists the signed transaction before a broadcast response is lost", async () => {
    const near = new FakeNearClient(dueWorkflow());
    near.broadcastError = true;
    const store = new InMemoryKeeperStore();

    const stats = await runKeeperCycle(
      cycleOptions({ near, store, state: new KeeperRuntimeState() }),
    );

    expect(stats).toMatchObject({
      submitted: 1,
      finalized: 0,
      submissionErrors: 1,
    });
    expect(store.submissions.get(TRANSACTION_HASH)).toMatchObject({
      transactionHash: TRANSACTION_HASH,
      signedTransactionBase64: "c2lnbmVkLXRyYW5zYWN0aW9u",
    });
  });

  it("reconciles a stored hash after restart before considering submission", async () => {
    const near = new FakeNearClient(dueWorkflow());
    const store = new InMemoryKeeperStore();
    await store.recordSubmission({
      network: "testnet",
      transactionHash: TRANSACTION_HASH,
      contractId: "auvora.testnet",
      workflowId: 0n,
      runIndex: 0,
      scheduledForMs: BigInt(NOW_MS - 1_000),
      amountYocto: "10",
      signerId: "keeper.testnet",
      signedTransactionBase64: "c2lnbmVkLXRyYW5zYWN0aW9u",
      method: "execute_due",
      submittedAt: new Date(NOW_MS - 500),
    });

    const stats = await runKeeperCycle(
      cycleOptions({ near, store, state: new KeeperRuntimeState() }),
    );

    expect(stats.finalized).toBe(1);
    expect(stats.submitted).toBe(0);
    expect(store.finalizations.has(TRANSACTION_HASH)).toBe(true);
  });

  it("does not declare a successful poll until its database heartbeat is persisted", async () => {
    const near = new FakeNearClient({ ...dueWorkflow(), state: "Cancelled" });
    const store = new InMemoryKeeperStore();
    const state = new KeeperRuntimeState();
    const previous = new Date(NOW_MS - 1000);
    state.completePoll(previous);
    const persist = store.recordHeartbeat.bind(store);
    const heartbeat = vi
      .spyOn(store, "recordHeartbeat")
      .mockImplementation(async (input) => {
        expect(state.snapshot().pollRunning).toBe(true);
        expect(state.snapshot().lastSuccessfulPollAt).toEqual(previous);
        await persist(input);
      });
    await runKeeperCycle(cycleOptions({ near, store, state }));
    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(state.snapshot()).toMatchObject({
      pollRunning: false,
      lastErrorCode: null,
      lastSuccessfulPollAt: new Date(NOW_MS),
    });
    expect(near.submitCount).toBe(0);
  });

  it("retains the previous success and failed state when heartbeat persistence fails", async () => {
    const near = new FakeNearClient({ ...dueWorkflow(), state: "Cancelled" });
    const store = new InMemoryKeeperStore();
    const state = new KeeperRuntimeState();
    const previous = new Date(NOW_MS - 1000);
    state.completePoll(previous);
    vi.spyOn(store, "recordHeartbeat").mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(
      runKeeperCycle(cycleOptions({ near, store, state })),
    ).rejects.toThrow("database unavailable");
    expect(state.snapshot()).toMatchObject({
      pollRunning: false,
      lastErrorCode: "Error",
      lastSuccessfulPollAt: previous,
    });
    state.startPoll(new Date(NOW_MS + 1));
    expect(state.snapshot().lastErrorCode).toBe("Error");
    expect(near.submitCount).toBe(0);
  });

  it("exposes readiness only after a recent successful poll", () => {
    const state = new KeeperRuntimeState();
    expect(
      getHealthPayload({
        identity: {
          networkId: "testnet",
          contractId: "auvora.testnet",
          signerId: "keeper.testnet",
          instanceId: "keeper-a",
        },
        state,
        now: new Date(NOW_MS),
        staleAfterMs: 30_000,
      }).ready,
    ).toBe(false);
    state.startPoll(new Date(NOW_MS));
    state.completePoll(new Date(NOW_MS));
    expect(
      getHealthPayload({
        identity: {
          networkId: "testnet",
          contractId: "auvora.testnet",
          signerId: "keeper.testnet",
          instanceId: "keeper-a",
        },
        state,
        now: new Date(NOW_MS + 20_000),
        staleAfterMs: 30_000,
      }).ready,
    ).toBe(true);
  });
});

function cycleOptions(options: {
  near: KeeperNearClient;
  store: InMemoryKeeperStore;
  state: KeeperRuntimeState;
}) {
  return {
    network: "testnet" as const,
    contractId: "auvora.testnet",
    signerId: "keeper.testnet",
    instanceId: "keeper-a",
    pageSize: 20,
    leaseMs: 60_000,
    finalityTimeoutMs: 5_000,
    now: () => new Date(NOW_MS),
    ...options,
  };
}

function dueWorkflow(): WorkflowView {
  return {
    id: 0,
    owner_id: "owner.testnet",
    recipient_id: "recipient.testnet",
    amount: "10",
    max_per_run: "10",
    min_reserve: "5",
    interval_ms: 60_000,
    next_run_at_ms: NOW_MS - 1_000,
    max_runs: 2,
    runs_completed: 0,
    available_balance: "100",
    state: "Active",
    config_hash: "phase-3-test",
    created_at_ms: NOW_MS - 100_000,
    withdrawable: "75",
    pending_execution: null,
  };
}
