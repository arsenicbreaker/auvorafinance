"use client";

import { useState } from "react";
import { WalletProof } from "../features/wallet/wallet-proof";
import {
  WorkflowBuilder,
  type WorkflowWalletSession,
} from "../features/workflow/workflow-builder";

export default function Home() {
  const [walletSession, setWalletSession] =
    useState<WorkflowWalletSession | null>(null);
  const contractId = process.env.NEXT_PUBLIC_AUVORA_CONTRACT_ID ?? "";
  const rpcUrl =
    process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://rpc.testnet.near.org";

  return (
    <main>
      <header className="masthead">
        <a className="wordmark" href="#proof" aria-label="Auvora proof console">
          Auvora
        </a>
        <div className="network-label" aria-label="Network: NEAR testnet">
          <span aria-hidden="true" /> NEAR testnet
        </div>
      </header>

      <section className="intro" aria-labelledby="page-title">
        <p className="eyebrow">Phase 0 / wallet path</p>
        <h1 id="page-title">Prove every signature before automating a cent.</h1>
        <p className="lede">
          Connect a user-controlled testnet wallet, inspect the deployed
          contract, then shape one recurring payment. The draft below stays
          local until you review it and connect the owner wallet.
        </p>
      </section>

      <WalletProof
        contractId={contractId}
        rpcUrl={rpcUrl}
        onWalletSession={setWalletSession}
      />

      <WorkflowBuilder
        contractId={contractId}
        rpcUrl={rpcUrl}
        walletSession={walletSession}
      />

      <footer>
        <p>Testnet only. Never paste a seed phrase or private key here.</p>
        <p>Contract state is read at finality.</p>
      </footer>
    </main>
  );
}
