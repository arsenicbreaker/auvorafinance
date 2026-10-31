"use client";

import type { Account, WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { actionCreators } from "@near-js/transactions";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  readContractStatus,
  readTransactionFinality,
  type ContractStatus,
  type Finality,
} from "../../lib/near-rpc";

type SetupState = "error" | "loading" | "missing-config" | "ready";
type ActionState = "error" | "idle" | "pending" | "submitted" | Finality;

interface WalletProofProps {
  contractId: string;
  rpcUrl: string;
  onWalletSession?: (session: WalletSession | null) => void;
}

export interface WalletSession {
  accountId: string;
  signFunctionCall: (input: {
    methodName: string;
    args: Record<string, unknown>;
    deposit: bigint;
  }) => Promise<string | undefined>;
}

const proofStatus = "wallet-proof-confirmed";

function callbackTransactionHash(): string {
  if (typeof window === "undefined") return "";
  return (
    new URLSearchParams(window.location.search)
      .get("transactionHashes")
      ?.split(",")[0] ?? ""
  );
}

export function WalletProof({
  contractId,
  rpcUrl,
  onWalletSession,
}: WalletProofProps) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [setupState, setSetupState] = useState<SetupState>(
    contractId ? "loading" : "missing-config",
  );
  const [message, setMessage] = useState("");
  const [contractStatus, setContractStatus] = useState<ContractStatus | null>(
    null,
  );
  const [viewState, setViewState] = useState<ActionState>("idle");
  const [callState, setCallState] = useState<ActionState>(() =>
    callbackTransactionHash() ? "pending" : "idle",
  );
  const [transactionHash, setTransactionHash] = useState(
    callbackTransactionHash,
  );

  const activeAccount = accounts[0]?.accountId ?? "";
  const isOwner =
    Boolean(activeAccount) && contractStatus?.owner_id === activeAccount;

  useEffect(() => {
    if (!selector || !activeAccount) {
      onWalletSession?.(null);
      return;
    }
    onWalletSession?.({
      accountId: activeAccount,
      signFunctionCall: async ({ methodName, args, deposit }) => {
        const wallet = await selector.wallet();
        const outcome = await wallet.signAndSendTransaction({
          actions: [
            actionCreators.functionCall(
              methodName,
              args,
              30_000_000_000_000n,
              deposit,
            ),
          ],
          receiverId: contractId,
          signerId: activeAccount,
        });
        return outcome?.transaction.hash;
      },
    });
    return () => onWalletSession?.(null);
  }, [activeAccount, contractId, onWalletSession, selector]);

  const readStatus = useCallback(async () => {
    if (!contractId) return;
    setViewState("pending");
    setMessage("");
    try {
      setContractStatus(await readContractStatus(rpcUrl, contractId));
      setViewState("success");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Contract read failed",
      );
      setViewState("error");
    }
  }, [contractId, rpcUrl]);

  useEffect(() => {
    if (!contractId) return;

    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    void setupWalletSelector({
      modules: [setupMeteorWallet(), setupMyNearWallet()],
      network: {
        explorerUrl: "https://testnet.nearblocks.io",
        helperUrl: "https://helper.testnet.near.org",
        indexerUrl: "https://api.testnet.near.org",
        networkId: "testnet",
        nodeUrl: rpcUrl,
      },
    })
      .then((nextSelector) => {
        if (!mounted) return;
        const nextModal = setupModal(nextSelector, { contractId });
        setSelector(nextSelector);
        setModal(nextModal);
        setAccounts(nextSelector.store.getState().accounts);
        const subscription = nextSelector.store.observable.subscribe(
          (state) => {
            setAccounts(state.accounts);
          },
        );
        unsubscribe = () => subscription.unsubscribe();
        setSetupState("ready");
        void readStatus();
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setMessage(
          error instanceof Error ? error.message : "Wallet setup failed",
        );
        setSetupState("error");
      });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [contractId, readStatus, rpcUrl]);

  useEffect(() => {
    if (!modal) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") modal.hide();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [modal]);

  useEffect(() => {
    if (!transactionHash || !activeAccount || callState !== "pending") return;
    let active = true;
    void readTransactionFinality(
      rpcUrl,
      transactionHash,
      activeAccount,
      contractId,
    )
      .then(async (finality) => {
        if (!active) return;
        setCallState(finality === "pending" ? "submitted" : finality);
        if (finality === "success") await readStatus();
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(
          error instanceof Error ? error.message : "Finality check failed",
        );
        setCallState("submitted");
      });
    return () => {
      active = false;
    };
  }, [
    activeAccount,
    callState,
    contractId,
    readStatus,
    rpcUrl,
    transactionHash,
  ]);

  const explorerUrl = useMemo(
    () =>
      transactionHash
        ? `https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`
        : "",
    [transactionHash],
  );

  async function disconnect() {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
    setCallState("idle");
    setTransactionHash("");
  }

  async function signProof() {
    if (
      !selector ||
      !activeAccount ||
      !isOwner ||
      callState === "pending" ||
      callState === "submitted"
    )
      return;
    setTransactionHash("");
    setCallState("pending");
    setMessage("");
    try {
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        actions: [
          actionCreators.functionCall(
            "set_status",
            { status: proofStatus },
            30_000_000_000_000n,
            0n,
          ),
        ],
        receiverId: contractId,
        signerId: activeAccount,
      });

      if (!outcome?.transaction.hash) {
        throw new Error(
          "The wallet returned no transaction hash. No proof has been confirmed.",
        );
      }
      const hash = outcome.transaction.hash;
      setTransactionHash(hash);
      setCallState("pending");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Signed call failed");
      setCallState("error");
    }
  }

  if (setupState === "missing-config") {
    return (
      <section
        className="proof-shell config-state"
        id="proof"
        aria-labelledby="proof-title"
      >
        <p className="step-label">Configuration required</p>
        <h2 id="proof-title">Add the deployed testnet contract ID.</h2>
        <p>
          Set <code>NEXT_PUBLIC_AUVORA_CONTRACT_ID</code> in an untracked local
          environment file. The web shell intentionally stays disconnected until
          the deployment target is explicit.
        </p>
      </section>
    );
  }

  return (
    <section className="proof-shell" id="proof" aria-labelledby="proof-title">
      <div className="proof-heading">
        <div>
          <p className="step-label">Step 1 of 3</p>
          <h2 id="proof-title">Connect the owner wallet</h2>
          <p className="section-intro">
            Auvora only asks your wallet to sign when an on-chain action needs
            your approval.
          </p>
        </div>
        <StateMark state={setupState} />
      </div>

      <div className="wallet-primary">
        <div>
          <span className="field-caption">Connected account</span>
          <strong>{activeAccount || "No wallet connected"}</strong>
          <p>
            {activeAccount
              ? isOwner
                ? "This account can create and manage workflows."
                : "This is not the contract owner account."
              : "Connect oceanear.testnet to continue with this deployment."}
          </p>
        </div>
        {activeAccount ? (
          <button
            className="secondary"
            type="button"
            onClick={() => void disconnect()}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            disabled={!modal || setupState !== "ready"}
            onClick={() => modal?.show()}
          >
            {setupState === "loading" ? "Preparing wallets" : "Connect wallet"}
          </button>
        )}
      </div>

      <details className="technical-details">
        <summary>Contract connection details</summary>
        <div className="technical-details-body">
          <dl>
            <div>
              <dt>Contract</dt>
              <dd>{contractId}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{contractStatus?.owner_id ?? "Not loaded"}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{contractStatus?.status ?? "Not loaded"}</dd>
            </div>
          </dl>
          <div className="technical-actions">
            <button
              className="secondary"
              type="button"
              disabled={viewState === "pending"}
              onClick={() => void readStatus()}
            >
              {viewState === "pending"
                ? "Reading contract"
                : "Refresh contract"}
            </button>
            <button
              className="secondary"
              type="button"
              disabled={
                !isOwner || callState === "pending" || callState === "submitted"
              }
              onClick={() => void signProof()}
            >
              {callState === "pending"
                ? "Waiting for finality"
                : "Sign test proof"}
            </button>
          </div>
          <p className="action-note">
            The test proof calls <code>set_status</code> with 0 NEAR. It does
            not create a workflow or move funds.
          </p>
          {explorerUrl ? (
            <a
              className="transaction-link"
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
            >
              View proof transaction
            </a>
          ) : null}
          {transactionHash ? (
            <p role="status">
              {callState === "success"
                ? "Proof transaction finalized."
                : callState === "failure"
                  ? "Proof transaction failed at finality."
                  : "Proof transaction submitted. Finality has not been confirmed."}
            </p>
          ) : null}
          {callState === "submitted" ? (
            <button
              className="secondary"
              type="button"
              onClick={() => {
                setMessage("");
                setCallState("pending");
              }}
            >
              Check transaction status
            </button>
          ) : null}
        </div>
      </details>

      {message ? (
        <div className="error-message" role="alert">
          <strong>Proof interrupted.</strong> {message}
        </div>
      ) : null}
    </section>
  );
}

function StateMark({ state }: { state: SetupState }) {
  const label =
    state === "ready"
      ? "Ready"
      : state === "error"
        ? "Setup failed"
        : "Preparing";
  return (
    <div className={`state-mark state-${state}`} role="status">
      <span aria-hidden="true" /> {label}
    </div>
  );
}
