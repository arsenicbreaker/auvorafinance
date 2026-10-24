import {
  Near,
  decodeSignedDelegateAction,
  encodeSignedDelegateAction,
  generateKey,
  type PrivateKey,
} from "near-kit";
import { describe, expect, it } from "vitest";

import { verifyDelegatePayload } from "./delegate.js";
import type { SponsorshipPolicy } from "./policy.js";

const policy: SponsorshipPolicy = {
  allowedMethods: new Set(["set_status"]),
  contractId: "auvora.testnet",
  currentBlockHeight: 100n,
  maxGasPerRequest: 30_000_000_000_000n,
  networkId: "testnet",
};

async function createSignedPayload(): Promise<string> {
  const ephemeralKey = generateKey();
  const near = new Near({
    defaultSignerId: "user.testnet",
    network: "testnet",
    privateKey: ephemeralKey.secretKey as PrivateKey,
  });

  const result = await near
    .transaction("user.testnet")
    .functionCall(
      "auvora.testnet",
      "set_status",
      { status: "signed-by-user" },
      { attachedDeposit: 0n, gas: "30 Tgas" },
    )
    .delegate({
      maxBlockHeight: 120n,
      nonce: 1n,
      payloadFormat: "base64",
      publicKey: ephemeralKey.publicKey,
    });

  return result.payload;
}

describe("verifyDelegatePayload", () => {
  it("accepts an authentic, policy-compliant NEP-366 payload", async () => {
    const payload = await createSignedPayload();

    await expect(verifyDelegatePayload(payload, policy)).resolves.toEqual({
      allowed: true,
    });
  });

  it("rejects arguments changed after signing", async () => {
    const payload = await createSignedPayload();
    const decoded = decodeSignedDelegateAction(payload);
    const [action] = decoded.signedDelegate.delegateAction.actions;
    if (!action || !("functionCall" in action)) {
      throw new Error("Expected one function call action");
    }
    action.functionCall.args = new TextEncoder().encode(
      JSON.stringify({ status: "tampered-user" }),
    );
    const alteredPayload = encodeSignedDelegateAction(decoded);

    await expect(
      verifyDelegatePayload(alteredPayload, policy),
    ).resolves.toEqual({
      allowed: false,
      code: "INVALID_SIGNATURE",
    });
  });
});
