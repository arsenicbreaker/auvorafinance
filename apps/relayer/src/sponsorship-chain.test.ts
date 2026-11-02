import { describe, expect, it, vi } from "vitest";
import {
  KeyPair,
  createTransaction,
  decodeSignedTransaction,
  encodeSignedDelegate,
  PublicKey,
} from "near-api-js";
import { Near, generateKey, type PrivateKey } from "near-kit";
import { SponsorshipChain } from "./sponsorship-chain.js";
import { verifyDelegatePayload } from "./delegate.js";
import type { SponsoredRequest } from "./sponsorship-store.js";

const row: SponsoredRequest = {
  digest: "digest",
  sender: "owner.testnet",
  workflow: 7,
  method: "pause_workflow",
  hash: "hash",
  signed: "bytes",
  state: "Pending",
};
function chain() {
  return new SponsorshipChain(
    "https://test.rpc.fastnear.com",
    "relayer.testnet",
    KeyPair.fromRandom("ed25519").toString(),
    "treasury.testnet",
  );
}
function outcome(event = "workflow_paused", executor = "treasury.testnet") {
  return {
    final_execution_status: "FINAL",
    transaction: {
      hash: "hash",
      signer_id: "relayer.testnet",
      receiver_id: "owner.testnet",
    },
    status: { SuccessValue: "" },
    receipts_outcome: [
      {
        outcome: {
          executor_id: executor,
          status: { SuccessValue: "" },
          logs: [
            `EVENT_JSON:${JSON.stringify({ standard: "auvora", event, data: [{ workflow_id: 7 }] })}`,
          ],
        },
      },
    ],
  };
}

describe("sponsored transaction proof", () => {
  it("requires matching final identity and contract event", async () => {
    const c = chain();
    vi.spyOn(c, "rpc").mockResolvedValue(outcome());
    await expect(c.status(row)).resolves.toBe("Succeeded");
  });
  it.each([
    outcome("workflow_cancelled"),
    outcome("workflow_paused", "attacker.testnet"),
    { ...outcome(), final_execution_status: "EXECUTED" },
  ])("does not promote unrelated or nonfinal evidence", async (result) => {
    const c = chain();
    vi.spyOn(c, "rpc").mockResolvedValue(result);
    await expect(c.status(row)).resolves.toBe("Pending");
  });
  it("rejects a mismatched transaction identity", async () => {
    const c = chain();
    vi.spyOn(c, "rpc").mockResolvedValue({
      ...outcome(),
      transaction: { hash: "other" },
    });
    await expect(c.status(row)).rejects.toThrow("IDENTITY");
  });
  it("reports withdrawal restoration as failure despite successful callback execution", async () => {
    const c = chain();
    vi.spyOn(c, "rpc").mockResolvedValue(outcome("workflow_withdrawal_failed"));
    await expect(
      c.status({ ...row, method: "withdraw_available" }),
    ).resolves.toBe("Failed");
  });
  it("reports a failed receipt", async () => {
    const c = chain();
    const result = outcome();
    result.receipts_outcome[0]!.outcome.status = { Failure: {} } as never;
    vi.spyOn(c, "rpc").mockResolvedValue(result);
    await expect(c.status(row)).resolves.toBe("Failed");
  });
  it("wraps the original signed delegate without changing its signature or arguments", async () => {
    const key = generateKey();
    const owner = new Near({
      network: "testnet",
      defaultSignerId: "owner.testnet",
      privateKey: key.secretKey as PrivateKey,
    });
    const signed = await owner
      .transaction("owner.testnet")
      .functionCall(
        "treasury.testnet",
        "pause_workflow",
        { workflow_id: 7 },
        { gas: "30 Tgas", attachedDeposit: 0n },
      )
      .delegate({
        nonce: 2n,
        maxBlockHeight: 200n,
        payloadFormat: "base64",
        publicKey: key.publicKey,
      });
    const c = chain();
    vi.spyOn(c, "rpc").mockResolvedValue({ gas_price: "100000000" });
    vi.spyOn(c.account, "createTransaction").mockImplementation(async (args) =>
      createTransaction(
        "relayer.testnet",
        PublicKey.from(args.publicKey),
        args.receiverId,
        10n,
        args.actions,
        new Uint8Array(32),
      ),
    );
    const prepared = await c.prepare(
      signed.payload,
      30_000_000_000_000_000_000_000n,
    );
    const decoded = decodeSignedTransaction(
      Buffer.from(prepared.signed, "base64"),
    );
    expect(decoded.transaction.receiverId).toBe("owner.testnet");
    const inner = decoded.transaction.actions[0]!.signedDelegate!;
    const encoded = Buffer.from(encodeSignedDelegate(inner)).toString("base64");
    expect(encoded).toBe(signed.payload);
    expect(
      (
        await verifyDelegatePayload(encoded, {
          networkId: "testnet",
          contractId: "treasury.testnet",
          allowedMethods: new Set(["pause_workflow"]),
          currentBlockHeight: 100n,
          maxGasPerRequest: 30_000_000_000_000n,
        })
      ).allowed,
    ).toBe(true);
  });
  it("rejects high gas prices before signing", async () => {
    const c = chain();
    vi.spyOn(c, "rpc").mockResolvedValue({ gas_price: "100000001" });
    const sign = vi.spyOn(c.account, "createTransaction");
    await expect(
      c.prepare("unused", 30_000_000_000_000_000_000_000n),
    ).rejects.toThrow("GAS_PRICE");
    expect(sign).not.toHaveBeenCalled();
  });
});
