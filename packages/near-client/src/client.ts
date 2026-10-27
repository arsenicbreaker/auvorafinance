import {
  Account,
  JsonRpcProvider,
  actions,
  baseEncode,
  decodeSignedTransaction,
} from "near-api-js";
import type {
  Action,
  KeyPairString,
  PublicKey,
  Signer,
  Transaction,
} from "near-api-js";

import { collectOutcomeLogs, parseExecutionEvents } from "./events.js";
import { workflowViewSchema } from "./schema.js";
import type {
  FinalizedExecution,
  KeeperNearClient,
  WorkflowView,
} from "./types.js";

interface NearProvider {
  callFunction(request: {
    contractId: string;
    method: string;
    args: Record<string, unknown>;
    blockQuery: { finality: "final" };
  }): Promise<unknown>;
  viewTransactionStatusWithReceipts(request: {
    txHash: string;
    accountId: string;
    waitUntil: "FINAL";
  }): Promise<unknown>;
  sendTransactionUntil(
    signedTransaction: ReturnType<typeof decodeSignedTransaction>,
    waitUntil: "NONE",
  ): Promise<unknown>;
}

interface NearAccount {
  getSigner(): Signer | undefined;
  createTransaction(request: {
    receiverId: string;
    actions: Action[];
    publicKey: PublicKey;
  }): Promise<Transaction>;
}

export interface NearClientOptions {
  contractId: string;
  signerId: string;
  provider: NearProvider;
  account: NearAccount;
}

export class NearClient implements KeeperNearClient {
  private readonly contractId: string;
  private readonly signerId: string;
  private readonly provider: NearProvider;
  private readonly account: NearAccount;

  constructor(options: NearClientOptions) {
    this.contractId = options.contractId;
    this.signerId = options.signerId;
    this.provider = options.provider;
    this.account = options.account;
  }

  static testnet(options: {
    rpcUrl: string;
    contractId: string;
    signerId: string;
    privateKey: string;
  }): NearClient {
    const provider = new JsonRpcProvider({ url: options.rpcUrl });
    const account = new Account(
      options.signerId,
      provider,
      options.privateKey as KeyPairString,
    );
    return new NearClient({
      contractId: options.contractId,
      signerId: options.signerId,
      provider,
      account,
    });
  }

  async listWorkflows(cursor: number, limit: number): Promise<WorkflowView[]> {
    const result = await this.provider.callFunction({
      contractId: this.contractId,
      method: "list_workflows",
      args: { cursor, limit },
      blockQuery: { finality: "final" },
    });
    return workflowViewSchema.array().parse(result);
  }

  async getWorkflow(workflowId: number): Promise<WorkflowView | null> {
    const result = await this.provider.callFunction({
      contractId: this.contractId,
      method: "get_workflow",
      args: { workflow_id: workflowId },
      blockQuery: { finality: "final" },
    });
    return result === null ? null : workflowViewSchema.parse(result);
  }

  async prepareExecuteDue(workflowId: number) {
    const signer = this.account.getSigner();
    if (!signer) throw new Error("KEEPER_SIGNER_REQUIRED");
    const transaction = await this.account.createTransaction({
      receiverId: this.contractId,
      actions: [
        actions.functionCall(
          "execute_due",
          { workflow_id: workflowId },
          100_000_000_000_000n,
          0n,
        ),
      ],
      publicKey: await signer.getPublicKey(),
    });
    const { txHash, signedTransaction } =
      await signer.signTransaction(transaction);
    return {
      transactionHash: baseEncode(txHash),
      signedTransactionBase64: Buffer.from(signedTransaction.encode()).toString(
        "base64",
      ),
    };
  }

  async broadcastExecuteDue(signedTransactionBase64: string): Promise<void> {
    const signedTransaction = decodeSignedTransaction(
      Buffer.from(signedTransactionBase64, "base64"),
    );
    await this.provider.sendTransactionUntil(signedTransaction, "NONE");
  }

  async waitForFinalExecution(
    transactionHash: string,
  ): Promise<FinalizedExecution> {
    const outcome = await this.provider.viewTransactionStatusWithReceipts({
      txHash: transactionHash,
      accountId: this.signerId,
      waitUntil: "FINAL",
    });
    const events = parseExecutionEvents(collectOutcomeLogs(outcome));
    const event = events.at(-1) ?? null;
    const status = event
      ? event.event === "execution_succeeded"
        ? "Succeeded"
        : event.event === "execution_failed"
          ? "Failed"
          : event.event === "execution_skipped"
            ? "Skipped"
            : "Ignored"
      : isFailureOutcome(outcome)
        ? "Failed"
        : "Ignored";
    return {
      transactionHash,
      status,
      reasonCode:
        event === null
          ? status === "Failed"
            ? "RPC_EXECUTION_FAILURE"
            : "EVENT_NOT_FOUND"
          : event.reasonCode,
      event,
      explorerUrl: nearblocksTransactionUrl(transactionHash),
    };
  }
}

function isFailureOutcome(outcome: unknown): boolean {
  if (!outcome || typeof outcome !== "object") return true;
  const status = (outcome as { status?: unknown }).status;
  return Boolean(
    status &&
      typeof status === "object" &&
      "Failure" in (status as Record<string, unknown>),
  );
}

export function nearblocksTransactionUrl(transactionHash: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(transactionHash)) {
    throw new Error("INVALID_TRANSACTION_HASH");
  }
  return `https://testnet.nearblocks.io/txns/${transactionHash}`;
}
