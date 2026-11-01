import {
  Near,
  decodeSignedDelegateAction,
  encodeSignedDelegateAction,
  generateKey,
  type PrivateKey,
} from "near-kit";
import { describe, expect, it, vi } from "vitest";

import {
  validateManagementDelegate,
  type ManagementPolicy,
  type ManagementSnapshot,
} from "./management.js";

const policy: ManagementPolicy = {
  networkId: "testnet",
  contractId: "auvora.testnet",
  maxGasPerRequest: 30_000_000_000_000n,
  maxBlockHeightTtl: 100n,
};
const snapshot: ManagementSnapshot = {
  networkId: "testnet",
  contractId: "auvora.testnet",
  blockHeight: 100n,
  accessKey: { nonce: 1n, permission: "FullAccess" },
  workflowOwnerId: "owner.testnet",
};

async function signed(
  options: {
    method?: string;
    args?: Record<string, unknown>;
    deposit?: bigint;
    receiver?: string;
    height?: bigint;
    nonce?: bigint;
    batch?: boolean;
  } = {},
): Promise<string> {
  const key = generateKey();
  const near = new Near({
    defaultSignerId: "owner.testnet",
    network: "testnet",
    privateKey: key.secretKey as PrivateKey,
  });
  const tx = near
    .transaction("owner.testnet")
    .functionCall(
      options.receiver ?? policy.contractId,
      options.method ?? "pause_workflow",
      options.args ?? { workflow_id: 5 },
      { gas: "30 Tgas", attachedDeposit: options.deposit ?? 0n },
    );
  if (options.batch)
    tx.functionCall(policy.contractId, "cancel_workflow", { workflow_id: 5 });
  const result = await tx.delegate({
    maxBlockHeight: options.height ?? 120n,
    nonce: options.nonce ?? 2n,
    payloadFormat: "base64",
    publicKey: key.publicKey,
  });
  return result.payload;
}

describe("management delegate admission", () => {
  it.each([
    "pause_workflow",
    "resume_workflow",
    "cancel_workflow",
    "withdraw_available",
  ])(
    "admits owner-signed %s with exact arguments and final state",
    async (method) => {
      const payload = await signed({
        method,
        args:
          method === "withdraw_available"
            ? { workflow_id: 5, amount: "1" }
            : { workflow_id: 5 },
      });
      const read = vi.fn(async () => snapshot);
      const result = await validateManagementDelegate(payload, policy, read);
      expect(result).toMatchObject({
        allowed: true,
        senderId: "owner.testnet",
        methodName: method,
        workflowId: 5,
        nonce: 2n,
        maxBlockHeight: 120n,
        gas: 30_000_000_000_000n,
      });
      expect(read).toHaveBeenCalledOnce();
      expect(read).toHaveBeenCalledWith({
        senderId: "owner.testnet",
        workflowId: 5,
        publicKey: expect.stringMatching(/^ed25519:/),
      });
      expect(await validateManagementDelegate(payload, policy, read)).toEqual(
        result,
      );
      expect(
        JSON.stringify(result, (_key, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      ).not.toContain(payload);
    },
  );

  it.each([
    ["deposit", { deposit: 1n }, "ATTACHED_DEPOSIT_FORBIDDEN"],
    ["receiver", { receiver: "other.testnet" }, "RECEIVER_NOT_ALLOWED"],
    ["funding", { method: "fund_workflow" }, "METHOD_NOT_ALLOWED"],
    ["callback", { method: "on_withdraw_complete" }, "METHOD_NOT_ALLOWED"],
    ["batch", { batch: true }, "INVALID_REQUEST"],
    [
      "extra argument",
      { args: { workflow_id: 5, owner_id: "owner.testnet" } },
      "INVALID_ARGUMENTS",
    ],
    ["string ID", { args: { workflow_id: "5" } }, "INVALID_ARGUMENTS"],
    [
      "unsafe ID",
      { args: { workflow_id: Number.MAX_SAFE_INTEGER + 1 } },
      "INVALID_ARGUMENTS",
    ],
    ["negative ID", { args: { workflow_id: -1 } }, "INVALID_ARGUMENTS"],
    ["fractional ID", { args: { workflow_id: 0.5 } }, "INVALID_ARGUMENTS"],
    ["missing ID", { args: {} }, "INVALID_ARGUMENTS"],
    [
      "withdraw zero",
      { method: "withdraw_available", args: { workflow_id: 5, amount: "0" } },
      "INVALID_ARGUMENTS",
    ],
    [
      "withdraw numeric",
      { method: "withdraw_available", args: { workflow_id: 5, amount: 1 } },
      "INVALID_ARGUMENTS",
    ],
    [
      "withdraw overflow",
      {
        method: "withdraw_available",
        args: { workflow_id: 5, amount: (2n ** 128n).toString() },
      },
      "INVALID_ARGUMENTS",
    ],
    [
      "withdraw missing amount",
      { method: "withdraw_available" },
      "INVALID_ARGUMENTS",
    ],
  ] as const)("rejects %s before RPC", async (_label, options, code) => {
    const read = vi.fn(async () => snapshot);
    expect(
      await validateManagementDelegate(await signed(options), policy, read),
    ).toEqual({ allowed: false, code });
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", { height: 100n }, snapshot, "DELEGATE_EXPIRED"],
    ["long expiry", { height: 201n }, snapshot, "DELEGATE_TTL_EXCEEDED"],
    ["replayed nonce", { nonce: 1n }, snapshot, "INVALID_NONCE"],
    ["old nonce", { nonce: 0n }, snapshot, "INVALID_NONCE"],
    [
      "missing key",
      {},
      { ...snapshot, accessKey: null },
      "ACCESS_KEY_NOT_ALLOWED",
    ],
    [
      "different owner",
      {},
      { ...snapshot, workflowOwnerId: "attacker.testnet" },
      "WORKFLOW_NOT_OWNED",
    ],
    [
      "missing workflow",
      {},
      { ...snapshot, workflowOwnerId: null },
      "WORKFLOW_NOT_OWNED",
    ],
    [
      "wrong contract snapshot",
      {},
      { ...snapshot, contractId: "other.testnet" },
      "INVALID_CHAIN_SNAPSHOT",
    ],
    [
      "missing block",
      {},
      { ...snapshot, blockHeight: 0n },
      "INVALID_CHAIN_SNAPSHOT",
    ],
  ] as const)(
    "rejects %s using authoritative state",
    async (_label, options, state, code) => {
      expect(
        await validateManagementDelegate(
          await signed(options),
          policy,
          async () => state,
        ),
      ).toEqual({ allowed: false, code });
    },
  );

  it("accepts the expiry boundary and exact U128 maximum without rounding", async () => {
    expect(
      await validateManagementDelegate(
        await signed({
          method: "withdraw_available",
          height: 200n,
          args: { workflow_id: 0, amount: (2n ** 128n - 1n).toString() },
        }),
        policy,
        async () => snapshot,
      ),
    ).toMatchObject({ allowed: true, workflowId: 0 });
  });

  it("rejects signature tampering without chain access", async () => {
    const decoded = decodeSignedDelegateAction(await signed());
    decoded.signedDelegate.delegateAction.nonce = 9n;
    const read = vi.fn(async () => snapshot);
    expect(
      await validateManagementDelegate(
        encodeSignedDelegateAction(decoded),
        policy,
        read,
      ),
    ).toEqual({ allowed: false, code: "INVALID_SIGNATURE" });
    expect(read).not.toHaveBeenCalled();
  });

  it("does not leak RPC errors or accept an outage", async () => {
    expect(
      await validateManagementDelegate(await signed(), policy, async () => {
        throw new Error("private connection details");
      }),
    ).toEqual({ allowed: false, code: "CHAIN_UNAVAILABLE" });
  });

  it.each([null, {}, "", "!", "a".repeat(16_388), "YWJj\n"])(
    "rejects malformed intake without RPC",
    async (payload) => {
      const read = vi.fn(async () => snapshot);
      expect(await validateManagementDelegate(payload, policy, read)).toEqual({
        allowed: false,
        code: "INVALID_REQUEST",
      });
      expect(read).not.toHaveBeenCalled();
    },
  );
});
