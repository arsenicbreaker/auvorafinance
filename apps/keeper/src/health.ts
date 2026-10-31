import { createServer, type Server } from "node:http";

import type { KeeperRuntimeState } from "./state.js";

export interface KeeperIdentity {
  networkId: "testnet";
  contractId: string;
  signerId: string;
  instanceId: string;
}

type ReadinessReason =
  | "starting"
  | "poll_failed"
  | "clock_skew"
  | "stale"
  | "ready";

export function getHealthPayload(options: {
  identity: KeeperIdentity;
  state: KeeperRuntimeState;
  now: Date;
  staleAfterMs: number;
}): {
  live: boolean;
  ready: boolean;
  service: "auvora-keeper";
  healthVersion: 1;
  identity: KeeperIdentity;
  readinessReason: ReadinessReason;
  pollRunning: boolean;
  lastPollStartedAt: string | null;
  lastSuccessfulPollAt: string | null;
  lastErrorCode: string | null;
} {
  const snapshot = options.state.snapshot();
  const lastSuccessMs = snapshot.lastSuccessfulPollAt?.getTime();
  const age = options.now.getTime() - (lastSuccessMs ?? Number.NaN);
  const readinessReason: ReadinessReason =
    snapshot.lastErrorCode !== null
      ? "poll_failed"
      : lastSuccessMs === undefined
        ? "starting"
        : !Number.isFinite(age) || age < 0
          ? "clock_skew"
          : !Number.isFinite(options.staleAfterMs) ||
              options.staleAfterMs <= 0 ||
              age > options.staleAfterMs
            ? "stale"
            : "ready";
  return {
    live: true,
    ready: readinessReason === "ready",
    service: "auvora-keeper",
    healthVersion: 1,
    identity: { ...options.identity },
    readinessReason,
    pollRunning: snapshot.pollRunning,
    lastPollStartedAt: iso(snapshot.lastPollStartedAt),
    lastSuccessfulPollAt: iso(snapshot.lastSuccessfulPollAt),
    lastErrorCode: snapshot.lastErrorCode,
  };
}

export function createHealthServer(options: {
  identity: KeeperIdentity;
  state: KeeperRuntimeState;
  port: number;
  staleAfterMs: number;
}): Server {
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }));
      return;
    }
    const payload = getHealthPayload({
      identity: options.identity,
      state: options.state,
      now: new Date(),
      staleAfterMs: options.staleAfterMs,
    });
    if (request.url === "/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          live: payload.live,
          service: payload.service,
          healthVersion: payload.healthVersion,
          identity: payload.identity,
        }),
      );
      return;
    }
    if (request.url === "/ready") {
      response.writeHead(payload.ready ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(payload));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  server.listen(options.port, "0.0.0.0");
  return server;
}

function iso(value: Date | null): string | null {
  return value && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}
