import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { KeeperConfig } from "@auvora/config";

import type { KeeperCycleStats } from "./keeper.js";

export interface ProofProcessResult {
  pid: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stats: KeeperCycleStats | null;
  errorCode: string | null;
  stderr: string;
}

export function spawnProofProcess(options: {
  config: KeeperConfig;
  workflowId: number;
  instanceId: string;
  holdAfterBroadcast?: boolean;
  reconcileOnly?: boolean;
}) {
  // Pass only keeper credentials and the OS environment needed to run Node.
  const environment: NodeJS.ProcessEnv = {};
  const systemNames = new Set([
    "path",
    "systemroot",
    "windir",
    "temp",
    "tmp",
    "userprofile",
    "appdata",
    "localappdata",
    "home",
    "comspec",
    "pathext",
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (systemNames.has(key.toLowerCase())) environment[key] = value;
  }
  for (const [key, value] of Object.entries(options.config)) {
    environment[key] = String(value);
  }
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(
        new URL(
          import.meta.url.endsWith(".ts")
            ? "./proof-worker.ts"
            : "./proof-worker.js",
          import.meta.url,
        ),
      ),
      String(options.workflowId),
      options.instanceId,
      ...(options.holdAfterBroadcast ? ["--hold-after-broadcast"] : []),
      ...(options.reconcileOnly ? ["--reconcile-only"] : []),
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: environment,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let resolveReady!: () => void;
  let resolveCheckpoint!: () => void;
  let stats: KeeperCycleStats | null = null;
  let errorCode: string | null = null;
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-4000);
  });
  let readyReached = false;
  let checkpointReached = false;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const checkpoint = new Promise<void>((resolve) => {
    resolveCheckpoint = resolve;
  });
  const completion = new Promise<ProofProcessResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("PROOF_PROCESS_TIMEOUT"));
    }, 180_000);
    child.once("error", () => {
      clearTimeout(timer);
      resolveReady();
      resolveCheckpoint();
      reject(new Error("PROOF_PROCESS_START_FAILED"));
    });
    child.on("message", (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const message = value as {
        event?: string;
        pid?: number;
        stats?: KeeperCycleStats;
        errorCode?: string;
      };
      if (message.pid !== child.pid) return;
      if (message.event === "ready") {
        readyReached = true;
        resolveReady();
      }
      if (message.event === "broadcast_checkpoint") {
        checkpointReached = true;
        resolveCheckpoint();
      }
      if (message.event === "cycle_complete") stats = message.stats ?? null;
      if (message.event === "worker_failed")
        errorCode = message.errorCode ?? "WORKER_FAILED";
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolveReady();
      resolveCheckpoint();
      for (const secret of [
        options.config.KEEPER_PRIVATE_KEY,
        options.config.DATABASE_URL,
      ]) {
        stderr = stderr.split(secret).join("[redacted]");
      }
      resolve({
        pid: child.pid ?? -1,
        exitCode,
        signal,
        stats,
        errorCode,
        stderr: stderr.slice(-2000),
      });
    });
  });
  // The owner may still be waiting for readiness/checkpoint when a child fails.
  void completion.catch(() => {});
  return {
    ready: async () => {
      await ready;
      assert(readyReached, "WORKER_EXITED_BEFORE_READY");
    },
    checkpoint: async () => {
      await checkpoint;
      assert(checkpointReached, "WORKER_EXITED_BEFORE_BROADCAST");
    },
    start: () => {
      assert(child.connected);
      child.send({ command: "start" });
    },
    kill: () => child.kill("SIGKILL"),
    completion,
  };
}
