import { describe, expect, it } from "vitest";

import { readPublicConfig } from "./index.js";

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
