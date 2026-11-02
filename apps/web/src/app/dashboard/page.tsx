"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import {
  DashboardOverview,
  WalletRequired,
} from "../../features/dashboard/overview";
import {
  DashboardIcon,
  type DashboardIconName,
} from "../../features/dashboard/dashboard-icon";
import "./dashboard.css";

type DashboardPage = {
  id: string;
  title: string;
  description: string;
  icon: DashboardIconName;
};
const pages: [DashboardPage, ...DashboardPage[]] = [
  {
    id: "overview",
    title: "Overview",
    description: "Here's what's happening with your recurring payments.",
    icon: "home",
  },
  {
    id: "builder",
    title: "Payments",
    description:
      "Give your next payment a schedule. Review it before you sign.",
    icon: "payment",
  },
  {
    id: "workflows",
    title: "Schedules",
    description: "Keep track of your schedules and manage each workflow.",
    icon: "calendar",
  },
  {
    id: "recipients",
    title: "Recipients",
    description: "The accounts on the other side of your payment workflows.",
    icon: "people",
  },
  {
    id: "history",
    title: "Reports",
    description: "Follow the recorded execution evidence for your payments.",
    icon: "chart",
  },
  {
    id: "outlook",
    title: "Treasury",
    description: "A clearer view of your balances and payment commitments.",
    icon: "balance",
  },
  {
    id: "proof",
    title: "Wallet",
    description: "Connect your wallet to start setting up payments.",
    icon: "wallet",
  },
  {
    id: "sponsorship",
    title: "Sponsored controls",
    description: "Manage existing workflows with sponsored gas.",
    icon: "payment",
  },
];
function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
function readHash() {
  return window.location.hash.slice(1) || "overview";
}
function serverHash() {
  return "overview";
}

export default function Dashboard() {
  const [walletSession, setWalletSession] =
    useState<WorkflowWalletSession | null>(null);
  const [workflowRefreshToken, setWorkflowRefreshToken] = useState(0);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const hash = useSyncExternalStore(subscribeToHash, readHash, serverHash);
  const current = pages.find((page) => page.id === hash) ?? pages[0];
  const contractId = process.env.NEXT_PUBLIC_AUVORA_CONTRACT_ID ?? "";
  const rpcUrl =
    process.env.NEXT_PUBLIC_NEAR_RPC_URL ?? "https://test.rpc.fastnear.com";
  const sponsorUrl = process.env.NEXT_PUBLIC_SPONSOR_URL;
  const isSearching = Boolean(search.trim());
  const show = (id: string) => !isSearching && current.id === id;
  const account = walletSession?.accountId;

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (
        event.key === "Escape" &&
        document.activeElement === searchInput.current
      )
        setSearch("");
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  return (
    <main className="dashboard dashboard-v2" id="top">
      <a className="skip-link" href="#dashboard-content">
        Skip to dashboard content
      </a>
      <aside className="app-sidebar" aria-label="Dashboard navigation">
        <Link href="/" className="app-brand" aria-label="Auvora home">
          Auvora
        </Link>
        <nav aria-label="Workspace">
          {pages
            .filter((page) => page.id !== "sponsorship" || sponsorUrl)
            .map((page) => (
              <a
                key={page.id}
                href={`#${page.id}`}
                aria-label={page.title}
                title={page.title}
                className={
                  current.id === page.id && !isSearching ? "selected" : ""
                }
                aria-current={
                  current.id === page.id && !isSearching ? "page" : undefined
                }
                onClick={() => setSearch("")}
              >
                <DashboardIcon name={page.icon} />
                <span>{page.title}</span>
              </a>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <a
            className="sidebar-account"
            href="#proof"
            onClick={() => setSearch("")}
          >
            <span className="account-avatar">
              {account ? (
                account.slice(0, 2).toUpperCase()
              ) : (
                <DashboardIcon name="wallet" />
              )}
            </span>
            <span>
              <strong>{account ?? "Your wallet"}</strong>
              <small>
                {account ? "NEAR testnet" : "Connect to get started"}
              </small>
            </span>
            <DashboardIcon name="arrow" />
          </a>
        </div>
      </aside>
      <div className="app-main">
        <Link href="/" className="mobile-brand" aria-label="Auvora home">
          Auvora
        </Link>
        <header className="app-topbar">
          <div className="topbar-network">
            <span />
            NEAR testnet
          </div>
          <div className="dashboard-search">
            <DashboardIcon name="search" />
            <input
              ref={searchInput}
              aria-label="Search payments, recipients, or schedules"
              placeholder="Search recipients, schedules, or status..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search ? (
              <button aria-label="Clear search" onClick={() => setSearch("")}>
                <DashboardIcon name="close" />
              </button>
            ) : (
              <kbd>Ctrl K</kbd>
            )}
          </div>
          <a
            className="topbar-wallet"
            href="#proof"
            aria-label={account ? `Wallet: ${account}` : "Connect wallet"}
            onClick={() => setSearch("")}
          >
            {account ? (
              account.slice(0, 2).toUpperCase()
            ) : (
              <DashboardIcon name="wallet" />
            )}
          </a>
        </header>
        <div className="app-content" id="dashboard-content">
          <div className="app-page-heading">
            <div>
              <h1>{isSearching ? "Search" : current.title}</h1>
              <p>
                {isSearching
                  ? "Find a recipient, workflow number, or schedule status."
                  : current.description}
              </p>
            </div>
            <a
              className="new-payment"
              href={account ? "#builder" : "#proof"}
              onClick={() => setSearch("")}
            >
              <DashboardIcon name="plus" />
              New payment
            </a>
          </div>
          <div
            hidden={
              !isSearching &&
              current.id !== "overview" &&
              current.id !== "recipients"
            }
          >
            <DashboardOverview
              key={`${account ?? "public"}:${contractId}:${rpcUrl}`}
              accountId={account ?? ""}
              contractId={contractId}
              rpcUrl={rpcUrl}
              refreshToken={workflowRefreshToken}
              search={search}
              recipientsOnly={current.id === "recipients"}
            />
          </div>
          <div hidden={!show("proof") && !show("builder")}>
            <nav className="setup-steps" aria-label="Payment setup steps">
              <a
                href="#proof"
                aria-current={show("proof") ? "step" : undefined}
              >
                <span>{account ? "✓" : "1"}</span>Connect wallet
              </a>
              <a
                href="#builder"
                aria-current={show("builder") ? "step" : undefined}
              >
                <span>2</span>Set payment
              </a>
              <a href="#workflows">
                <span>3</span>Track schedules
              </a>
            </nav>
          </div>
          <div hidden={!show("proof")}>
            <WalletProof
              contractId={contractId}
              rpcUrl={rpcUrl}
              onWalletSession={setWalletSession}
            />
            {account ? (
              <a className="new-payment continue-setup" href="#builder">
                Continue to payment setup <DashboardIcon name="arrow" />
              </a>
            ) : null}
          </div>
          <div hidden={!show("builder")}>
            {!account ? (
              <div className="connect-reminder">
                <DashboardIcon name="wallet" />
                <p>Connect your wallet to fund and approve this payment.</p>
                <a href="#proof">Connect wallet</a>
              </div>
            ) : null}
            <WorkflowBuilder
              key={`builder:${rpcUrl}:${contractId}:${account ?? "signed-out"}`}
              contractId={contractId}
              rpcUrl={rpcUrl}
              walletSession={walletSession}
              onWorkflowSubmitted={() =>
                setWorkflowRefreshToken((current) => current + 1)
              }
            />
          </div>
          <div hidden={!show("workflows")}>
            <WorkflowLedger
              key={`ledger:${rpcUrl}:${contractId}:${account ?? "signed-out"}`}
              contractId={contractId}
              refreshToken={workflowRefreshToken}
              rpcUrl={rpcUrl}
              walletSession={walletSession}
            />
          </div>
          <div hidden={!show("sponsorship")}>
            {sponsorUrl ? (
              <SponsoredManagement
                key={`${account ?? ""}:${contractId}:${rpcUrl}`}
                ownerId={account ?? ""}
                contractId={contractId}
                rpcUrl={rpcUrl}
                serviceUrl={sponsorUrl}
                onChanged={() => setWorkflowRefreshToken((value) => value + 1)}
              />
            ) : (
              <p>Sponsored controls are not configured for this deployment.</p>
            )}
          </div>
          <div hidden={!show("history")}>
            {account ? (
              <ExecutionHistory
                key={`history:${account}`}
                initialOwnerId={account}
              />
            ) : (
              <WalletRequired />
            )}
          </div>
          <div hidden={!show("outlook")}>
            {account ? (
              <TreasuryOutlook
                key={`outlook:${account}`}
                contractId={contractId}
                rpcUrl={rpcUrl}
                initialOwnerId={account}
              />
            ) : (
              <WalletRequired />
            )}
          </div>
          <footer className="app-footer">
            <span>Built for a calmer payment routine.</span>
            <span>Testnet only · Amounts in NEAR</span>
          </footer>
        </div>
      </div>
    </main>
  );
}
