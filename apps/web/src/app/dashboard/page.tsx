"use client";

import { useState } from "react";
import Link from "next/link";
import { WalletProof } from "../../features/wallet/wallet-proof";
import {
  WorkflowBuilder,
  type WorkflowWalletSession,
} from "../../features/workflow/workflow-builder";
import { WorkflowLedger } from "../../features/workflow/workflow-ledger";
import { TreasuryOutlook } from "../../features/treasury/treasury-outlook";
import { ExecutionHistory } from "../../features/workflow/execution-history";
import { SponsoredManagement } from "../../features/workflow/sponsored-management";

export default function Dashboard() {
  const [walletSession, setWalletSession] =
    useState<WorkflowWalletSession | null>(null);
  const [workflowRefreshToken, setWorkflowRefreshToken] = useState(0);
  const contractId = process.env.NEXT_PUBLIC_AUVORA_CONTRACT_ID ?? "";
  const rpcUrl =
    process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";

  return (
    <main className="dashboard" id="top">
      <a className="skip-link" href="#dashboard-content">
        Skip to payment setup
      </a>
      <header className="masthead">
        <Link className="wordmark" href="/" aria-label="Auvora home">
          auvora<span>.</span>
        </Link>
        <div className="header-status">
          <div className="network-label" aria-label="Network: NEAR testnet">
            <span aria-hidden="true" /> Testnet
          </div>
          <span className="header-account">
            {walletSession?.accountId ?? "Wallet not connected"}
          </span>
        </div>
      </header>

      <div className="dashboard-layout">
        <aside className="dashboard-sidebar" aria-label="Dashboard navigation">
          <p className="sidebar-caption">Your workspace</p>
          <nav>
            <a href="#dashboard-content">Payment setup</a>
            <a href="#workflows">Workflows</a>
            <a href="#history">Execution history</a>
            <a href="#outlook">Treasury outlook</a>
            {process.env.NEXT_PUBLIC_SPONSOR_URL ? (
              <a href="#sponsorship">Sponsored controls</a>
            ) : null}
          </nav>
          <div className="sidebar-note">
            <span className="network-label">
              <span aria-hidden="true" /> NEAR testnet
            </span>
            <p>A space to test your payment workflows.</p>
          </div>
          <Link className="back-home" href="/">
            Back to home
          </Link>
        </aside>
        <div className="dashboard-content" id="dashboard-content">
          <section className="intro" aria-labelledby="page-title">
            <p className="eyebrow">Your payment workspace</p>
            <h1 id="page-title">
              A little setup.
              <br />
              <span>A clearer routine.</span>
            </h1>
            <p className="lede">
              Start with your wallet. Set a schedule, approve your payment, and
              follow every run here.
            </p>
          </section>

          <nav className="journey" aria-label="Payment setup steps">
            <a href="#proof">
              <span>{walletSession ? "✓" : "01"}</span>
              <strong>Connect wallet</strong>
              <small>Use the contract owner account</small>
            </a>
            <a href="#builder">
              <span>02</span>
              <strong>Set payment</strong>
              <small>Choose recipient, amount, and timing</small>
            </a>
            <a href="#workflows">
              <span>03</span>
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

          {process.env.NEXT_PUBLIC_SPONSOR_URL ? (
            <SponsoredManagement
              key={`${walletSession?.accountId ?? ""}:${contractId}:${rpcUrl}`}
              ownerId={walletSession?.accountId ?? ""}
              contractId={contractId}
              rpcUrl={rpcUrl}
              serviceUrl={process.env.NEXT_PUBLIC_SPONSOR_URL}
              onChanged={() => setWorkflowRefreshToken((value) => value + 1)}
            />
          ) : null}
          <ExecutionHistory
            key={`history:${walletSession?.accountId ?? "public"}`}
            initialOwnerId={walletSession?.accountId ?? contractId}
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
        </div>
      </div>
    </main>
  );
}
