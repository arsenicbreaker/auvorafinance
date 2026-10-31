import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHealthServer,
  getHealthPayload,
  type KeeperIdentity,
} from "./health.js";
import { KeeperRuntimeState } from "./state.js";

const identity: KeeperIdentity = {
  networkId: "testnet",
  contractId: "treasury.testnet",
  signerId: "keeper.testnet",
  instanceId: "keeper-1",
};
const NOW = 1793440800000;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

function health(state: KeeperRuntimeState, now = NOW, staleAfterMs = 30000) {
  return getHealthPayload({
    identity,
    state,
    now: new Date(now),
    staleAfterMs,
  });
}

async function openHealth(state: KeeperRuntimeState) {
  const server = createHealthServer({
    identity,
    state,
    port: 0,
    staleAfterMs: 30000,
  });
  servers.push(server);
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("keeper readiness state", () => {
  it("reports starting until the first successful poll", () => {
    const state = new KeeperRuntimeState();
    expect(health(state)).toMatchObject({
      healthVersion: 1,
      identity,
      live: true,
      ready: false,
      readinessReason: "starting",
      lastSuccessfulPollAt: null,
    });
    state.startPoll(new Date(NOW));
    expect(health(state)).toMatchObject({
      ready: false,
      pollRunning: true,
      readinessReason: "starting",
    });
  });

  it("becomes ready after success and keeps public identity separate from polling", () => {
    const state = new KeeperRuntimeState();
    state.startPoll(new Date(NOW - 1000));
    state.completePoll(new Date(NOW));
    expect(health(state)).toMatchObject({
      ready: true,
      readinessReason: "ready",
      pollRunning: false,
      identity,
      lastPollStartedAt: new Date(NOW - 1000).toISOString(),
      lastSuccessfulPollAt: new Date(NOW).toISOString(),
    });
  });

  it("keeps a failed poll unready throughout retry until success", () => {
    const state = new KeeperRuntimeState();
    state.completePoll(new Date(NOW - 1000));
    state.failPoll("DatabaseError");
    expect(health(state)).toMatchObject({
      ready: false,
      readinessReason: "poll_failed",
      lastErrorCode: "DatabaseError",
    });
    state.startPoll(new Date(NOW));
    expect(health(state)).toMatchObject({
      ready: false,
      pollRunning: true,
      readinessReason: "poll_failed",
      lastErrorCode: "DatabaseError",
    });
    state.completePoll(new Date(NOW));
    expect(health(state)).toMatchObject({
      ready: true,
      readinessReason: "ready",
      lastErrorCode: null,
    });
  });

  it("keeps a normal next poll ready while the last successful poll is fresh", () => {
    const state = new KeeperRuntimeState();
    state.completePoll(new Date(NOW - 1000));
    state.startPoll(new Date(NOW));
    expect(health(state)).toMatchObject({ ready: true, pollRunning: true });
    expect(health(state, NOW + 30000)).toMatchObject({
      ready: false,
      readinessReason: "stale",
    });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid stale threshold %s",
    (threshold) => {
      const state = new KeeperRuntimeState();
      state.completePoll(new Date(NOW));
      expect(health(state, NOW, threshold).ready).toBe(false);
    },
  );

  it("treats the exact staleness boundary as fresh and the next millisecond as stale", () => {
    const state = new KeeperRuntimeState();
    state.completePoll(new Date(NOW - 30000));
    expect(health(state).ready).toBe(true);
    expect(health(state, NOW + 1)).toMatchObject({
      ready: false,
      readinessReason: "stale",
    });
  });

  it("rejects future success timestamps and invalid clocks", () => {
    const state = new KeeperRuntimeState();
    state.completePoll(new Date(NOW + 1));
    expect(health(state)).toMatchObject({
      ready: false,
      readinessReason: "clock_skew",
    });
    expect(health(state, Number.NaN).ready).toBe(false);
    state.completePoll(new Date(Number.NaN));
    expect(health(state)).toMatchObject({
      ready: false,
      readinessReason: "clock_skew",
      lastSuccessfulPollAt: null,
    });
  });
});

describe("keeper HTTP health", () => {
  it("keeps liveness 200 and readiness 503 before polling, with no-store headers", async () => {
    const base = await openHealth(new KeeperRuntimeState());
    const live = await fetch(`${base}/live`);
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("no-store");
    expect(await live.json()).toEqual({
      live: true,
      service: "auvora-keeper",
      healthVersion: 1,
      identity,
    });
    const ready = await fetch(`${base}/ready`);
    expect(ready.status).toBe(503);
    expect(ready.headers.get("cache-control")).toBe("no-store");
    expect(await ready.json()).toMatchObject({
      ready: false,
      readinessReason: "starting",
      identity,
    });
  });

  it("changes 200 to 503 after failure and restores 200 only after successful retry", async () => {
    const state = new KeeperRuntimeState();
    state.completePoll(new Date());
    const base = await openHealth(state);
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    state.failPoll("RpcError");
    state.startPoll(new Date());
    const failed = await fetch(`${base}/ready`);
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      pollRunning: true,
      readinessReason: "poll_failed",
      lastErrorCode: "RpcError",
    });
    state.completePoll(new Date());
    expect((await fetch(`${base}/ready`)).status).toBe(200);
  });

  it("returns stale 503 and allows HEAD without returning a body", async () => {
    const state = new KeeperRuntimeState();
    state.completePoll(new Date(Date.now() - 31000));
    const base = await openHealth(state);
    const stale = await fetch(`${base}/ready`);
    expect(stale.status).toBe(503);
    expect(await stale.json()).toMatchObject({ readinessReason: "stale" });
    const head = await fetch(`${base}/live`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("rejects unsupported methods and unknown paths", async () => {
    const base = await openHealth(new KeeperRuntimeState());
    const post = await fetch(`${base}/ready`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect((await fetch(`${base}/missing`)).status).toBe(404);
  });
});
