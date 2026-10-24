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
type ActionState = "error" | "idle" | "pending" | Finality;

interface WalletProofProps {
  contractId: string;
  rpcUrl: string;
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

export function WalletProof({ contractId, rpcUrl }: WalletProofProps) {
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
        unsubscribe = nextSelector.store.observable.subscribe((state) => {
          setAccounts(state.accounts);
        }).unsubscribe;
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
    if (!transactionHash || !activeAccount || callState !== "pending") return;
    void readTransactionFinality(rpcUrl, transactionHash, activeAccount)
      .then(async (finality) => {
        setCallState(finality);
        if (finality === "success") await readStatus();
      })
      .catch((error: unknown) => {
        setMessage(
          error instanceof Error ? error.message : "Finality check failed",
        );
        setCallState("error");
      });
  }, [activeAccount, callState, readStatus, rpcUrl, transactionHash]);

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
    if (!selector || !activeAccount || !isOwner) return;
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

      if (!outcome) return;
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
          <p className="step-label">Live proof sequence</p>
          <h2 id="proof-title">Wallet and contract checkpoint</h2>
        </div>
        <StateMark state={setupState} />
      </div>

      <ol className="proof-list">
        <li>
          <div className="sequence">01</div>
          <div className="proof-copy">
            <h3>Connect the signer</h3>
            <p>
              The wallet remains in user custody. Auvora receives only the
              active testnet account ID.
            </p>
            <dl>
              <div>
                <dt>Account</dt>
                <dd>{activeAccount || "No wallet connected"}</dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>testnet</dd>
              </div>
            </dl>
          </div>
          <div className="proof-action">
            {activeAccount ? (
              <button
                className="secondary"
                type="button"
                onClick={() => void disconnect()}
              >
                Disconnect wallet
              </button>
            ) : (
              <button
                type="button"
                disabled={!modal || setupState !== "ready"}
                onClick={() => modal?.show()}
              >
                {setupState === "loading"
                  ? "Preparing wallets"
                  : "Choose testnet wallet"}
              </button>
            )}
          </div>
        </li>

        <li>
          <div className="sequence">02</div>
          <div className="proof-copy">
            <h3>Read final contract state</h3>
            <p>
              Queries <code>get_status</code> at finality without asking the
              wallet to sign.
            </p>
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
          </div>
          <div className="proof-action">
            <button
              className="secondary"
              type="button"
              disabled={viewState === "pending"}
              onClick={() => void readStatus()}
            >
              {viewState === "pending"
                ? "Reading final state"
                : "Refresh contract"}
            </button>
          </div>
        </li>

        <li>
          <div className="sequence">03</div>
          <div className="proof-copy">
            <h3>Sign a harmless owner call</h3>
            <p>
              Sets the Phase 0 status marker. It attaches zero deposit and
              cannot create a workflow or move funds.
            </p>
            <dl>
              <div>
                <dt>Method</dt>
                <dd>set_status</dd>
              </div>
              <div>
                <dt>Deposit</dt>
                <dd>0 NEAR</dd>
              </div>
              <div>
                <dt>Finality</dt>
                <dd>{callState === "idle" ? "Not submitted" : callState}</dd>
              </div>
            </dl>
            {explorerUrl ? (
              <a
                className="transaction-link"
                href={explorerUrl}
                target="_blank"
                rel="noreferrer"
              >
                Inspect transaction on NearBlocks
              </a>
            ) : null}
          </div>
          <div className="proof-action">
            <button
              type="button"
              disabled={!isOwner || callState === "pending"}
              onClick={() => void signProof()}
            >
              {callState === "pending"
                ? "Waiting for finality"
                : "Sign owner proof"}
            </button>
            {activeAccount && !isOwner ? (
              <p className="action-note">Connect the contract owner account.</p>
            ) : null}
          </div>
        </li>
      </ol>

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
      ? "Wallet path ready"
      : state === "error"
        ? "Setup failed"
        : "Preparing";
  return (
    <div className={`state-mark state-${state}`} role="status">
      <span aria-hidden="true" /> {label}
    </div>
  );
}
