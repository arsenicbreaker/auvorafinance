export const KEEPER_ALLOWED_METHOD = "keeper_ping" as const;

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

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${JSON.stringify(getKeeperHealth())}\n`);
}
