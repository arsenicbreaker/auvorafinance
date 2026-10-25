import { createServer, type Server } from "node:http";

import type { KeeperRuntimeState } from "./state.js";

export function getHealthPayload(options: {
  state: KeeperRuntimeState;
  now: Date;
  staleAfterMs: number;
}): {
  live: boolean;
  ready: boolean;
  service: "auvora-keeper";
  lastSuccessfulPollAt: string | null;
  lastErrorCode: string | null;
} {
  const snapshot = options.state.snapshot();
  const lastSuccessMs = snapshot.lastSuccessfulPollAt?.getTime() ?? 0;
  return {
    live: true,
    ready:
      lastSuccessMs > 0 &&
      options.now.getTime() - lastSuccessMs <= options.staleAfterMs,
    service: "auvora-keeper",
    lastSuccessfulPollAt: snapshot.lastSuccessfulPollAt?.toISOString() ?? null,
    lastErrorCode: snapshot.lastErrorCode,
  };
}

export function createHealthServer(options: {
  state: KeeperRuntimeState;
  port: number;
  staleAfterMs: number;
}): Server {
  const server = createServer((request, response) => {
    const payload = getHealthPayload({
      state: options.state,
      now: new Date(),
      staleAfterMs: options.staleAfterMs,
    });
    if (request.url === "/live") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ live: payload.live, service: payload.service }),
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
