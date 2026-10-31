"use client";

import { useState } from "react";
import { WalletProof } from "../features/wallet/wallet-proof";
import {
  WorkflowBuilder,
  type WorkflowWalletSession,
} from "../features/workflow/workflow-builder";
import { WorkflowLedger } from "../features/workflow/workflow-ledger";
import { TreasuryOutlook } from "../features/treasury/treasury-outlook";

export default function Home() {
  const [walletSession, setWalletSession] =
    useState<WorkflowWalletSession | null>(null);
  const [workflowRefreshToken, setWorkflowRefreshToken] = useState(0);
  const contractId = process.env.NEXT_PUBLIC_AUVORA_CONTRACT_ID ?? "";
  const rpcUrl =
    process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#top" aria-label="Auvora home">
          Auvora
        </a>
        <div className="header-status">
          <div className="network-label" aria-label="Network: NEAR testnet">
            <span aria-hidden="true" /> Testnet
          </div>
          <span className="header-account">
            {walletSession?.accountId ?? "Wallet not connected"}
          </span>
        </div>
      </header>

      <section className="intro" id="top" aria-labelledby="page-title">
        <p className="eyebrow">Recurring payments on NEAR</p>
        <h1 id="page-title">Set it once. Keep every payment visible.</h1>
        <p className="lede">
          Create a funded payment schedule, approve it in your own wallet, and
          track every run from one testnet dashboard.
        </p>
      </section>

      <nav className="journey" aria-label="Payment setup steps">
        <a href="#proof">
          <span>1</span>
          <strong>Connect wallet</strong>
          <small>Use the contract owner account</small>
        </a>
        <a href="#builder">
          <span>2</span>
          <strong>Set payment</strong>
          <small>Choose recipient, amount, and timing</small>
        </a>
        <a href="#workflows">
          <span>3</span>
          <strong>Track workflows</strong>
          <small>Pause, resume, cancel, or withdraw</small>
        </a>
      </nav>

      <WalletProof
        contractId={contractId}
        rpcUrl={rpcUrl}
        onWalletSession={setWalletSession}
      />

      <WorkflowBuilder
        key={`builder:${rpcUrl}:${contractId}:${walletSession?.accountId ?? "signed-out"}`}
        contractId={contractId}
        rpcUrl={rpcUrl}
        walletSession={walletSession}
        onWorkflowSubmitted={() =>
          setWorkflowRefreshToken((current) => current + 1)
        }
      />

      <WorkflowLedger
        key={`ledger:${rpcUrl}:${contractId}:${walletSession?.accountId ?? "signed-out"}`}
        contractId={contractId}
        refreshToken={workflowRefreshToken}
        rpcUrl={rpcUrl}
        walletSession={walletSession}
      />

      <TreasuryOutlook
        key={`outlook:${walletSession?.accountId ?? "public"}`}
        contractId={contractId}
        rpcUrl={rpcUrl}
        initialOwnerId={walletSession?.accountId ?? contractId}
      />

      <footer>
        <p>Testnet only. Never paste a seed phrase or private key here.</p>
        <p>Contract state is read at finality.</p>
      </footer>
    </main>
  );
}
