import { describe, expect, it } from "vitest";

import { readKeeperConfig, readPublicConfig } from "./index.js";

describe("readPublicConfig", () => {
  it("accepts only the MVP testnet network", () => {
    expect(
      readPublicConfig({
        AUVORA_CONTRACT_ID: "auvora.testnet",
        NEAR_NETWORK_ID: "testnet",
        NEAR_RPC_URL: "https://rpc.testnet.near.org",
      }),
    ).toMatchObject({ NEAR_NETWORK_ID: "testnet" });
  });

  it("rejects mainnet", () => {
    expect(() =>
      readPublicConfig({
        AUVORA_CONTRACT_ID: "auvora.near",
        NEAR_NETWORK_ID: "mainnet",
        NEAR_RPC_URL: "https://rpc.mainnet.near.org",
      }),
    ).toThrow();
  });
});

describe("readKeeperConfig", () => {
  it("applies bounded scheduler defaults", () => {
    expect(
      readKeeperConfig({
        AUVORA_CONTRACT_ID: "auvora.testnet",
        DATABASE_URL: "postgresql://keeper:secret@localhost:5432/auvora",
        KEEPER_ACCOUNT_ID: "keeper.testnet",
        KEEPER_PRIVATE_KEY: "ed25519:test-only-placeholder",
        NEAR_NETWORK_ID: "testnet",
        NEAR_RPC_URL: "https://rpc.testnet.near.org",
      }),
    ).toMatchObject({
      KEEPER_HEALTH_PORT: 3001,
      KEEPER_LEASE_MS: 60_000,
      KEEPER_PAGE_SIZE: 20,
      KEEPER_POLL_INTERVAL_MS: 15_000,
    });
  });
});
