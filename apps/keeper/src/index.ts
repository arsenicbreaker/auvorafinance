import { pathToFileURL } from "node:url";

export { createHealthServer, getHealthPayload } from "./health.js";
export { runKeeperCycle } from "./keeper.js";
export { InMemoryKeeperStore } from "./memory-store.js";
export { KeeperRuntimeState } from "./state.js";
export type { KeeperCycleOptions, KeeperCycleStats } from "./keeper.js";

export const KEEPER_ALLOWED_METHOD = "execute_due" as const;

export type KeeperHealth = Readonly<{
  networkId: "testnet";
  service: "auvora-keeper";
  status: "ready";
}>;

export function getKeeperHealth(): KeeperHealth {
  return {
    networkId: "testnet",
    service: "auvora-keeper",
    status: "ready",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void import("./runtime.js")
    .then(({ startKeeper }) => startKeeper())
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`Keeper failed to start: ${message}\n`);
      process.exitCode = 1;
    });
}
