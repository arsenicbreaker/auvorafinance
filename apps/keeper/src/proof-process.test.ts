import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readKeeperConfig } from "@auvora/config";

const mocked = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocked.spawn }));

import { spawnProofProcess } from "./proof-process.js";

function setup() {
  const child = Object.assign(new EventEmitter(), {
    pid: 12345,
    connected: true,
    stderr: new EventEmitter(),
    send: vi.fn(),
    kill: vi.fn(() => true),
  });
  mocked.spawn.mockReturnValueOnce(child);
  const config = readKeeperConfig({
    NEAR_NETWORK_ID: "testnet",
    NEAR_RPC_URL: "https://rpc.testnet.near.org",
    AUVORA_CONTRACT_ID: "auvora.testnet",
    DATABASE_URL: "postgresql://fixture:password@localhost/fixture",
    KEEPER_ACCOUNT_ID: "keeper.testnet",
    KEEPER_PRIVATE_KEY: "keeper-fixture-secret",
  });
  const worker = spawnProofProcess({
    config,
    workflowId: 4,
    instanceId: "fixture-worker",
  });
  return { child, config, worker };
}

afterEach(() => {
  vi.unstubAllEnvs();
  mocked.spawn.mockReset();
});

describe("keeper proof process boundary", () => {
  it("waits at the IPC start barrier and excludes owner credentials", async () => {
    vi.stubEnv("OWNER_PRIVATE_KEY", "owner-fixture-secret");
    vi.stubEnv("RELAYER_PRIVATE_KEY", "relayer-fixture-secret");
    const { child, config, worker } = setup();
    expect(child.send).not.toHaveBeenCalled();
    const options = mocked.spawn.mock.calls[0]![2];
    expect(options.env.OWNER_PRIVATE_KEY).toBeUndefined();
    expect(options.env.RELAYER_PRIVATE_KEY).toBeUndefined();
    expect(options.env.KEEPER_PRIVATE_KEY).toBe(config.KEEPER_PRIVATE_KEY);
    expect(options.windowsHide).toBe(true);
    child.emit("message", { event: "ready", pid: child.pid });
    await worker.ready();
    worker.start();
    expect(child.send).toHaveBeenCalledExactlyOnceWith({ command: "start" });
    child.emit("close", 0, null);
    expect(await worker.completion).toMatchObject({ pid: 12345, exitCode: 0 });
  });

  it("rejects readiness when the OS process exits before connecting", async () => {
    const { child, worker } = setup();
    child.emit("close", 1, null);
    await expect(worker.ready()).rejects.toThrow("WORKER_EXITED_BEFORE_READY");
    expect(await worker.completion).toMatchObject({ exitCode: 1, stats: null });
  });

  it("records an actual forced termination after the broadcast checkpoint", async () => {
    const { child, worker } = setup();
    child.emit("message", { event: "broadcast_checkpoint", pid: child.pid });
    await worker.checkpoint();
    expect(worker.kill()).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", null, "SIGKILL");
    expect(await worker.completion).toMatchObject({
      signal: "SIGKILL",
      exitCode: null,
      stats: null,
    });
  });

  it("redacts credentials even when stderr splits a secret across chunks", async () => {
    const { child, config, worker } = setup();
    child.stderr.emit("data", Buffer.from("error keeper-fixture-"));
    child.stderr.emit("data", Buffer.from(`secret ${config.DATABASE_URL}`));
    child.emit("message", {
      event: "worker_failed",
      pid: child.pid,
      errorCode: "RPC_UNAVAILABLE",
    });
    child.emit("close", 1, null);
    const result = await worker.completion;
    expect(result.errorCode).toBe("RPC_UNAVAILABLE");
    expect(result.stderr).toBe("error [redacted] [redacted]");
  });
});
