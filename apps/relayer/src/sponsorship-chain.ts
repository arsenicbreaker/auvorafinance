import {
  Account,
  JsonRpcProvider,
  actions,
  DelegateAction,
  PublicKey,
  Signature,
  baseEncode,
  type KeyPairString,
} from "near-api-js";
import { decodeSignedDelegateAction } from "near-kit";
import type { SponsoredRequest } from "./sponsorship-store.js";

export class SponsorshipChain {
  readonly provider: JsonRpcProvider;
  readonly account: Account;
  constructor(
    readonly rpcUrl: string,
    readonly signerId: string,
    privateKey: string,
    readonly contractId: string,
  ) {
    this.provider = new JsonRpcProvider({ url: rpcUrl });
    this.account = new Account(
      signerId,
      this.provider,
      privateKey as KeyPairString,
    );
  }
  async rpc(method: string, params: unknown): Promise<unknown> {
    const response = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "sponsorship",
        method,
        params,
      }),
      signal: AbortSignal.timeout(12000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("CHAIN_UNAVAILABLE");
    const data = await response.json();
    if (data.error) throw new Error("CHAIN_UNAVAILABLE");
    return data.result;
  }
  async prepare(
    payload: string,
    reservation: bigint,
  ): Promise<{ hash: string; signed: string }> {
    const gasPrice = (await this.rpc("gas_price", [null])) as {
      gas_price: string;
    };
    if (BigInt(gasPrice.gas_price) * 300_000_000_000_000n > reservation)
      throw new Error("GAS_PRICE_EXCEEDS_RESERVATION");
    const { delegateAction: d, signature: s } =
      decodeSignedDelegateAction(payload).signedDelegate;
    if (!("ed25519Key" in d.publicKey) || !("ed25519Signature" in s))
      throw new Error("UNSUPPORTED_KEY");
    const calls = d.actions.map((a) => {
      if (!("functionCall" in a)) throw new Error("INVALID_ACTION");
      return actions.functionCall(
        a.functionCall.methodName,
        Uint8Array.from(a.functionCall.args),
        a.functionCall.gas,
        a.functionCall.deposit,
      );
    });
    const delegateAction = new DelegateAction({
      ...d,
      actions: calls,
      publicKey: PublicKey.fromString(
        `ed25519:${baseEncode(Uint8Array.from(d.publicKey.ed25519Key.data))}`,
      ),
    });
    const signature = new Signature({
      keyType: 0,
      data: Uint8Array.from(s.ed25519Signature.data),
    });
    const signer = this.account.getSigner();
    if (!signer) throw new Error("SIGNER_UNAVAILABLE");
    const transaction = await this.account.createTransaction({
      receiverId: d.senderId,
      actions: [actions.signedDelegate({ delegateAction, signature })],
      publicKey: await signer.getPublicKey(),
    });
    const signed = await signer.signTransaction(transaction);
    return {
      hash: baseEncode(signed.txHash),
      signed: Buffer.from(signed.signedTransaction.encode()).toString("base64"),
    };
  }
  async broadcast(row: SponsoredRequest) {
    await this.rpc("broadcast_tx_async", [row.signed]);
  }
  async status(
    row: SponsoredRequest,
  ): Promise<"Pending" | "Succeeded" | "Failed"> {
    const result = (await this.rpc("EXPERIMENTAL_tx_status", {
      tx_hash: row.hash,
      sender_account_id: this.signerId,
      wait_until: "FINAL",
    })) as {
      final_execution_status?: string;
      transaction?: { hash: string; signer_id: string; receiver_id: string };
      status?: unknown;
      receipts_outcome?: Array<{
        outcome: { status: unknown; executor_id: string; logs: string[] };
      }>;
    };
    if (result.final_execution_status !== "FINAL") return "Pending";
    if (
      result.transaction?.hash !== row.hash ||
      result.transaction.signer_id !== this.signerId ||
      result.transaction.receiver_id !== row.sender
    )
      throw new Error("TRANSACTION_IDENTITY_MISMATCH");
    const failed = (s: unknown) =>
      !!s && typeof s === "object" && "Failure" in s;
    if (
      failed(result.status) ||
      result.receipts_outcome?.some((r) => failed(r.outcome.status))
    )
      return "Failed";
    if (
      !result.status ||
      typeof result.status !== "object" ||
      !("SuccessValue" in result.status) ||
      !result.receipts_outcome?.length
    )
      return "Pending";
    const expected: Record<string, string> = {
      pause_workflow: "workflow_paused",
      resume_workflow: "workflow_resumed",
      cancel_workflow: "workflow_cancelled",
      withdraw_available: "workflow_withdrawn",
    };
    let matched = false;
    for (const receipt of result.receipts_outcome) {
      if (receipt.outcome.executor_id !== this.contractId) continue;
      for (const log of receipt.outcome.logs ?? []) {
        if (!log.startsWith("EVENT_JSON:")) continue;
        try {
          const event = JSON.parse(log.slice(11));
          if (event.standard !== "auvora" || !Array.isArray(event.data))
            continue;
          if (
            !event.data.some(
              (data: { workflow_id?: unknown }) =>
                data.workflow_id === row.workflow,
            )
          )
            continue;
          if (event.event === "workflow_withdrawal_failed") return "Failed";
          if (event.event === expected[row.method]) matched = true;
        } catch {
          /* Other contract logs do not establish this result. */
        }
      }
    }
    return matched ? "Succeeded" : "Pending";
  }
}
