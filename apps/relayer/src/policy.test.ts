import { describe, expect, it } from "vitest";

import { evaluateSponsorship, type SponsorshipPolicy } from "./policy.js";

const policy: SponsorshipPolicy = {
  allowedMethods: new Set(["set_status"]),
  contractId: "auvora.testnet",
  currentBlockHeight: 100n,
  maxGasPerRequest: 30_000_000_000_000n,
  networkId: "testnet",
};

const validCall = {
  attachedDeposit: "0",
  gas: "30000000000000",
  maxBlockHeight: "120",
  methodName: "set_status",
  receiverId: "auvora.testnet",
};

describe("evaluateSponsorship", () => {
  it("allows an exact, nonpayable contract call", () => {
    expect(evaluateSponsorship(validCall, policy)).toEqual({ allowed: true });
  });

  it.each([
    [
      "wrong receiver",
      { ...validCall, receiverId: "attacker.testnet" },
      "RECEIVER_NOT_ALLOWED",
    ],
    [
      "unknown method",
      { ...validCall, methodName: "delete_account" },
      "METHOD_NOT_ALLOWED",
    ],
    [
      "attached deposit",
      { ...validCall, attachedDeposit: "1" },
      "ATTACHED_DEPOSIT_FORBIDDEN",
    ],
    [
      "expired delegate",
      { ...validCall, maxBlockHeight: "100" },
      "DELEGATE_EXPIRED",
    ],
    [
      "excessive gas",
      { ...validCall, gas: "30000000000001" },
      "GAS_LIMIT_EXCEEDED",
    ],
  ])("rejects %s", (_label, input, code) => {
    expect(evaluateSponsorship(input, policy)).toEqual({
      allowed: false,
      code,
    });
  });
});
