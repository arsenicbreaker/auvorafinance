import { afterEach, describe, expect, it, vi } from "vitest";

import { classifyFinalExecution, readTransactionFinality } from "./near-rpc";

function finalOutcome() {
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    transaction: {
      hash: "signed-hash",
      signer_id: "owner.testnet",
      receiver_id: "treasury.testnet",
    },
    transaction_outcome: {
      outcome: { status: { SuccessReceiptId: "receipt" } },
    },
    receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("classifyFinalExecution", () => {
  it("does not claim success before finality", () => {
    expect(classifyFinalExecution({ final_execution_status: "EXECUTED" })).toBe(
      "pending",
    );
  });

  it("reports a finalized failure", () => {
    expect(
      classifyFinalExecution({
        final_execution_status: "FINAL",
        status: { Failure: { error_message: "denied" } },
      }),
    ).toBe("failure");
  });

  it("reports success only after finality", () => {
    expect(classifyFinalExecution(finalOutcome())).toBe("success");
  });

  it.each([{}, { SuccessReceiptId: "receipt" }, { SuccessValue: null }])(
    "keeps malformed or unresolved final status pending: %j",
    (status) => {
      expect(classifyFinalExecution({ ...finalOutcome(), status })).toBe(
        "pending",
      );
    },
  );

  it("does not accept a final label without execution outcomes", () => {
    expect(
      classifyFinalExecution({
        final_execution_status: "FINAL",
        status: { SuccessValue: "" },
      }),
    ).toBe("pending");
  });

  it("reports a failed transfer even when its callback returns successfully", () => {
    expect(
      classifyFinalExecution({
        ...finalOutcome(),
        receipts_outcome: [
          {
            outcome: {
              status: { Failure: { ActionError: "transfer failed" } },
            },
          },
          { outcome: { status: { SuccessValue: "ZmFsc2U=" } } },
        ],
      }),
    ).toBe("failure");
  });

  it("keeps incomplete receipt outcomes pending", () => {
    expect(
      classifyFinalExecution({
        ...finalOutcome(),
        receipts_outcome: [{ outcome: {} }],
      }),
    ).toBe("pending");
  });
});

describe("readTransactionFinality", () => {
  function mockRpc(result: unknown) {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ result })));
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it("queries the original signed hash at FINAL with a bounded request", async () => {
    const fetcher = mockRpc(finalOutcome());
    await expect(
      readTransactionFinality(
        "https://rpc.testnet.near.org",
        "signed-hash",
        "owner.testnet",
        "treasury.testnet",
      ),
    ).resolves.toBe("success");
    const request = fetcher.mock.calls[0]![1];
    expect(JSON.parse(request.body)).toMatchObject({
      method: "tx",
      params: {
        tx_hash: "signed-hash",
        sender_account_id: "owner.testnet",
        wait_until: "FINAL",
      },
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    { hash: "other-hash" },
    { signer_id: "other.testnet" },
    { receiver_id: "other.testnet" },
  ])("rejects a mismatched transaction identity: %j", async (altered) => {
    const outcome = finalOutcome();
    mockRpc({
      ...outcome,
      transaction: { ...outcome.transaction, ...altered },
    });
    await expect(
      readTransactionFinality(
        "https://rpc.testnet.near.org",
        "signed-hash",
        "owner.testnet",
        "treasury.testnet",
      ),
    ).rejects.toThrow("RPC_TRANSACTION_IDENTITY_MISMATCH");
  });

  it("keeps a transaction unconfirmed when the RPC times out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")),
    );
    await expect(
      readTransactionFinality(
        "https://rpc.testnet.near.org",
        "signed-hash",
        "owner.testnet",
      ),
    ).rejects.toThrow("Timed out");
  });
});
