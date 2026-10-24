import { createHash } from "node:crypto";

import { PublicKey as NearPublicKey, baseEncode } from "near-api-js";
import {
  DelegateAction,
  decodeSignedDelegateAction,
  parsePublicKey,
  serializeDelegateAction,
} from "near-kit";

import {
  evaluateSponsorship,
  type PolicyDecision,
  type SponsorshipPolicy,
} from "./policy.js";

type KeyMaterial = Readonly<{
  publicKey: string;
  signature: Uint8Array;
}>;

function readKeyMaterial(
  publicKey: Record<string, unknown>,
  signature: Record<string, unknown>,
): KeyMaterial | undefined {
  if (
    "ed25519Key" in publicKey &&
    "ed25519Signature" in signature &&
    typeof publicKey.ed25519Key === "object" &&
    publicKey.ed25519Key !== null &&
    typeof signature.ed25519Signature === "object" &&
    signature.ed25519Signature !== null
  ) {
    const keyData = Reflect.get(publicKey.ed25519Key, "data");
    const signatureData = Reflect.get(signature.ed25519Signature, "data");
    if (Array.isArray(keyData) && Array.isArray(signatureData)) {
      return {
        publicKey: `ed25519:${baseEncode(Uint8Array.from(keyData))}`,
        signature: Uint8Array.from(signatureData),
      };
    }
  }

  return undefined;
}

export async function verifyDelegatePayload(
  payload: string | Uint8Array,
  policy: SponsorshipPolicy,
): Promise<PolicyDecision> {
  try {
    const decoded = decodeSignedDelegateAction(payload);
    const signed = decoded.signedDelegate;
    const delegated = signed.delegateAction;

    if (delegated.actions.length !== 1) {
      return { allowed: false, code: "INVALID_REQUEST" };
    }

    const [action] = delegated.actions;
    if (!action || !("functionCall" in action)) {
      return { allowed: false, code: "INVALID_REQUEST" };
    }

    const decision = evaluateSponsorship(
      {
        attachedDeposit: action.functionCall.deposit,
        gas: action.functionCall.gas,
        maxBlockHeight: delegated.maxBlockHeight,
        methodName: action.functionCall.methodName,
        receiverId: delegated.receiverId,
      },
      policy,
    );
    if (!decision.allowed) {
      return decision;
    }

    const keyMaterial = readKeyMaterial(delegated.publicKey, signed.signature);
    if (!keyMaterial) {
      return { allowed: false, code: "INVALID_SIGNATURE" };
    }

    const actions = delegated.actions as unknown as ConstructorParameters<
      typeof DelegateAction
    >[2];
    const delegateAction = new DelegateAction(
      delegated.senderId,
      delegated.receiverId,
      actions,
      delegated.nonce,
      delegated.maxBlockHeight,
      parsePublicKey(keyMaterial.publicKey),
    );
    const serialized = serializeDelegateAction(delegateAction);
    const digest = createHash("sha256").update(serialized).digest();
    const signatureIsValid = NearPublicKey.from(keyMaterial.publicKey).verify(
      digest,
      keyMaterial.signature,
    );

    return signatureIsValid
      ? { allowed: true }
      : { allowed: false, code: "INVALID_SIGNATURE" };
  } catch {
    return { allowed: false, code: "INVALID_REQUEST" };
  }
}
