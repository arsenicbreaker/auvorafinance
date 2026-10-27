"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNear } from "@auvora/domain";

import { readOwnerWorkflows, type WorkflowView } from "../../lib/near-rpc";
import type { WorkflowWalletSession } from "./workflow-builder";

type LoadState = "empty" | "error" | "loading" | "ready" | "signed-out";

export function WorkflowLedger({
  contractId,
  refreshToken,
  rpcUrl,
  walletSession,
}: {
  contractId: string;
  refreshToken: number;
  rpcUrl: string;
  walletSession: WorkflowWalletSession | null;
}) {
  const [workflows, setWorkflows] = useState<WorkflowView[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("signed-out");
  const [message, setMessage] = useState("");
  const [withdrawingId, setWithdrawingId] = useState<number | null>(null);
  const [transactionHash, setTransactionHash] = useState("");

  const loadWorkflows = useCallback(async () => {
    if (!walletSession || !contractId) {
      setWorkflows([]);
      setLoadState("signed-out");
      return;
    }
    setLoadState("loading");
    setMessage("");
    try {
      const next = await readOwnerWorkflows(
        rpcUrl,
        contractId,
        walletSession.accountId,
      );
      setWorkflows(next);
      setLoadState(next.length ? "ready" : "empty");
    } catch (error) {
      setLoadState("error");
      setMessage(
        error instanceof Error ? error.message : "Workflow read failed",
      );
    }
  }, [contractId, rpcUrl, walletSession]);

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows, refreshToken]);

  const totals = useMemo(
    () => ({
      available: workflows.reduce(
        (sum, workflow) => sum + BigInt(workflow.available_balance),
        0n,
      ),
      completedRuns: workflows.reduce(
        (sum, workflow) => sum + workflow.runs_completed,
        0,
      ),
    }),
    [workflows],
  );

  async function withdraw(workflow: WorkflowView) {
    if (!walletSession || BigInt(workflow.withdrawable) <= 0n) return;
    setWithdrawingId(workflow.id);
    setMessage("");
    setTransactionHash("");
    try {
      const hash = await walletSession.signFunctionCall({
        methodName: "withdraw_available",
        args: { workflow_id: workflow.id, amount: workflow.withdrawable },
        deposit: 0n,
      });
      setTransactionHash(hash ?? "");
      setMessage("Withdrawal submitted. Refresh after the wallet confirms it.");
      await loadWorkflows();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Withdrawal call failed",
      );
    } finally {
      setWithdrawingId(null);
    }
  }

  return (
    <section
      className="ledger-shell"
      id="workflows"
      aria-labelledby="ledger-title"
    >
      <div className="ledger-heading">
        <div>
          <p className="step-label">Live treasury ledger</p>
          <h2 id="ledger-title">Follow the money after signing.</h2>
        </div>
        <button
          className="secondary"
          type="button"
          disabled={!walletSession || loadState === "loading"}
          onClick={() => void loadWorkflows()}
        >
          {loadState === "loading" ? "Reading final state" : "Refresh ledger"}
        </button>
      </div>

      {loadState === "signed-out" ? (
        <LedgerState
          title="Connect the owner wallet."
          detail="The ledger only requests workflows owned by the active testnet account."
        />
      ) : null}
      {loadState === "loading" ? (
        <LedgerState
          title="Reading final contract state."
          detail="Workflow balances and run counters are loading directly from NEAR testnet."
          busy
        />
      ) : null}
      {loadState === "empty" ? (
        <LedgerState
          title="No workflows for this account yet."
          detail="Create one above, approve it in the wallet, then refresh this ledger."
        />
      ) : null}
      {loadState === "error" ? (
        <LedgerState
          title="The ledger could not reach final state."
          detail={message || "Check the RPC connection and try again."}
          error
        />
      ) : null}

      {loadState === "ready" ? (
        <>
          <dl className="ledger-summary">
            <div>
              <dt>Owner</dt>
              <dd>{walletSession?.accountId}</dd>
            </div>
            <div>
              <dt>Workflows</dt>
              <dd>{workflows.length}</dd>
            </div>
            <div>
              <dt>Completed runs</dt>
              <dd>{totals.completedRuns}</dd>
            </div>
            <div>
              <dt>Contract balance</dt>
              <dd>{formatNear(totals.available)} NEAR</dd>
            </div>
          </dl>

          <div className="ledger-list" role="list">
            {workflows
              .slice()
              .reverse()
              .map((workflow) => (
                <article
                  className="ledger-row"
                  key={workflow.id}
                  role="listitem"
                >
                  <div className="ledger-identity">
                    <span className="workflow-number">
                      WF-{String(workflow.id).padStart(3, "0")}
                    </span>
                    <StatusMark state={workflow.state} />
                    <h3>{workflow.recipient_id}</h3>
                    <p>
                      {formatNear(BigInt(workflow.amount))} NEAR every{" "}
                      {formatInterval(workflow.interval_ms)}
                    </p>
                  </div>

                  <dl className="ledger-facts">
                    <div>
                      <dt>Run progress</dt>
                      <dd>
                        {workflow.runs_completed} / {workflow.max_runs}
                      </dd>
                    </div>
                    <div>
                      <dt>Available</dt>
                      <dd>
                        {formatNear(BigInt(workflow.available_balance))} NEAR
                      </dd>
                    </div>
                    <div>
                      <dt>Next scheduled run</dt>
                      <dd>{formatRunTime(workflow)}</dd>
                    </div>
                    <div>
                      <dt>Pending transfer</dt>
                      <dd>
                        {workflow.pending_execution
                          ? `Run ${workflow.pending_execution.run_index + 1}`
                          : "None"}
                      </dd>
                    </div>
                  </dl>

                  <div className="ledger-action">
                    <span>Owner withdrawable</span>
                    <strong>
                      {formatNear(BigInt(workflow.withdrawable))} NEAR
                    </strong>
                    <button
                      className="secondary"
                      type="button"
                      disabled={
                        BigInt(workflow.withdrawable) <= 0n ||
                        withdrawingId !== null
                      }
                      onClick={() => void withdraw(workflow)}
                    >
                      {withdrawingId === workflow.id
                        ? "Waiting for wallet"
                        : "Withdraw available funds"}
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </>
      ) : null}

      {loadState === "ready" && message ? (
        <div className="ledger-message" role="status">
          {message}
          {transactionHash ? (
            <a
              href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`}
              target="_blank"
              rel="noreferrer"
            >
              Inspect transaction
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LedgerState({
  busy = false,
  detail,
  error = false,
  title,
}: {
  busy?: boolean;
  detail: string;
  error?: boolean;
  title: string;
}) {
  return (
    <div
      className={`ledger-state${error ? " ledger-state-error" : ""}`}
      role={error ? "alert" : "status"}
      aria-busy={busy}
    >
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function StatusMark({ state }: { state: WorkflowView["state"] }) {
  return (
    <span className={`workflow-status status-${state.toLowerCase()}`}>
      {state}
    </span>
  );
}

function formatInterval(intervalMs: number): string {
  if (intervalMs === 60_000) return "minute";
  if (intervalMs === 3_600_000) return "hour";
  if (intervalMs === 86_400_000) return "day";
  return `${intervalMs / 60_000} minutes`;
}

function formatRunTime(workflow: WorkflowView): string {
  if (workflow.state === "Completed") return "Completed";
  if (workflow.state === "Cancelled") return "Cancelled";
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(workflow.next_run_at_ms));
}
