import { createHash } from "node:crypto";

import { baseEncode } from "near-api-js";
import { decodeSignedDelegateAction } from "near-kit";
import { z } from "zod";

import { verifyDelegatePayload } from "./delegate.js";

const methods = new Set([
  "pause_workflow",
  "resume_workflow",
  "cancel_workflow",
  "withdraw_available",
]);
const workflowIdSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const controlArgs = z.strictObject({ workflow_id: workflowIdSchema });
const withdrawalArgs = controlArgs.extend({
  amount: z
    .string()
    .regex(/^[1-9][0-9]{0,38}$/)
    .refine((v) => BigInt(v) < 2n ** 128n),
});

export type ManagementSnapshot = Readonly<{
  networkId: "testnet";
  contractId: string;
  blockHeight: bigint;
  accessKey: Readonly<{ nonce: bigint; permission: "FullAccess" }> | null;
  workflowOwnerId: string | null;
}>;

export type ManagementPolicy = Readonly<{
  networkId: "testnet";
  contractId: string;
  maxGasPerRequest: bigint;
  maxBlockHeightTtl: bigint;
}>;

type Rejection = Readonly<{ allowed: false; code: string }>;
export type ManagementDecision =
  | Rejection
  | Readonly<{
      allowed: true;
      requestDigest: string;
      senderId: string;
      publicKey: string;
      nonce: bigint;
      maxBlockHeight: bigint;
      workflowId: number;
      methodName: string;
      gas: bigint;
    }>;

/** The server supplies final views pinned to one block; request JSON is never a snapshot. */
export async function validateManagementDelegate(
  payload: unknown,
  policy: ManagementPolicy,
  readFinalSnapshot: (
    query: Readonly<{
      senderId: string;
      publicKey: string;
      workflowId: number;
    }>,
  ) => Promise<ManagementSnapshot>,
): Promise<ManagementDecision> {
  if (
    policy.networkId !== "testnet" ||
    policy.maxBlockHeightTtl <= 0n ||
    policy.maxGasPerRequest <= 0n ||
    typeof payload !== "string" ||
    payload.length > 16_384 ||
    payload.length === 0 ||
    payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  ) {
    return { allowed: false, code: "INVALID_REQUEST" };
  }
  try {
    const bytes = Buffer.from(payload, "base64");
    if (bytes.toString("base64") !== payload) {
      return { allowed: false, code: "INVALID_REQUEST" };
    }
    const decoded = decodeSignedDelegateAction(payload);
    const delegate = decoded.signedDelegate.delegateAction;
    const [action] = delegate.actions;
    if (
      delegate.actions.length !== 1 ||
      !action ||
      !("functionCall" in action)
    ) {
      return { allowed: false, code: "INVALID_REQUEST" };
    }
    const call = action.functionCall;
    if (!methods.has(call.methodName)) {
      return { allowed: false, code: "METHOD_NOT_ALLOWED" };
    }
    const argsText = new TextDecoder("utf-8", { fatal: true }).decode(
      call.args,
    );
    const schema =
      call.methodName === "withdraw_available" ? withdrawalArgs : controlArgs;
    const args = schema.safeParse(JSON.parse(argsText));
    if (!args.success) return { allowed: false, code: "INVALID_ARGUMENTS" };

    // Verify the signature and static limits before spending an RPC query on the request.
    const signature = await verifyDelegatePayload(payload, {
      ...policy,
      allowedMethods: methods,
      currentBlockHeight: 0n,
    });
    if (!signature.allowed) return signature;
    if (!("ed25519Key" in delegate.publicKey)) {
      return { allowed: false, code: "INVALID_SIGNATURE" };
    }
    const publicKey = `ed25519:${baseEncode(Uint8Array.from(delegate.publicKey.ed25519Key.data))}`;
    let snapshot: ManagementSnapshot;
    try {
      snapshot = await readFinalSnapshot({
        senderId: delegate.senderId,
        publicKey,
        workflowId: args.data.workflow_id,
      });
    } catch {
      return { allowed: false, code: "CHAIN_UNAVAILABLE" };
    }
    if (
      snapshot.networkId !== policy.networkId ||
      snapshot.contractId !== policy.contractId ||
      snapshot.blockHeight <= 0n
    )
      return { allowed: false, code: "INVALID_CHAIN_SNAPSHOT" };
    if (delegate.maxBlockHeight <= snapshot.blockHeight) {
      return { allowed: false, code: "DELEGATE_EXPIRED" };
    }
    if (
      delegate.maxBlockHeight >
      snapshot.blockHeight + policy.maxBlockHeightTtl
    ) {
      return { allowed: false, code: "DELEGATE_TTL_EXCEEDED" };
    }
    if (!snapshot.accessKey || snapshot.accessKey.permission !== "FullAccess") {
      return { allowed: false, code: "ACCESS_KEY_NOT_ALLOWED" };
    }
    if (delegate.nonce <= snapshot.accessKey.nonce) {
      return { allowed: false, code: "INVALID_NONCE" };
    }
    if (snapshot.workflowOwnerId !== delegate.senderId) {
      return { allowed: false, code: "WORKFLOW_NOT_OWNED" };
    }
    return {
      allowed: true,
      requestDigest: createHash("sha256").update(bytes).digest("hex"),
      senderId: delegate.senderId,
      publicKey,
      nonce: delegate.nonce,
      maxBlockHeight: delegate.maxBlockHeight,
      workflowId: args.data.workflow_id,
      methodName: call.methodName,
      gas: call.gas,
    };
  } catch {
    return { allowed: false, code: "INVALID_REQUEST" };
  }
}
