"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatNear } from "@auvora/domain";

import {
  readOwnerWorkflows,
  readTransactionFinality,
  type WorkflowView,
} from "../../lib/near-rpc";
import type { WorkflowWalletSession } from "./workflow-builder";

type LoadState = "empty" | "error" | "loading" | "ready" | "signed-out";
type OwnerAction = "cancel" | "pause" | "resume" | "withdraw";
type ActionState = {
  kind: OwnerAction;
  phase: "finality" | "wallet";
  workflowId: number;
} | null;
type SubmittedAction = {
  kind: OwnerAction;
  workflowId: number;
  hash: string;
  sender: string;
};

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
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<
    "error" | "pending" | "success"
  >("success");
  const [actionState, setActionState] = useState<ActionState>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<number | null>(null);
  const [transactionHash, setTransactionHash] = useState("");
  const [submittedAction, setSubmittedAction] =
    useState<SubmittedAction | null>(null);
  const actionLock = useRef(false);
  const actionsBlocked = actionState !== null || submittedAction !== null;

  const loadWorkflows = useCallback(async () => {
    if (!walletSession || !contractId) {
      setWorkflows([]);
      setLoadState("signed-out");
      return;
    }
    setLoadState("loading");
    setLoadError("");
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
      setLoadError(
        error instanceof Error ? error.message : "Workflow read failed",
      );
    }
  }, [contractId, rpcUrl, walletSession]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void loadWorkflows();
    });
    return () => {
      active = false;
    };
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

  async function submitOwnerAction(workflow: WorkflowView, kind: OwnerAction) {
    if (!walletSession || actionLock.current || submittedAction) return;
    if (kind === "withdraw" && BigInt(workflow.withdrawable) <= 0n) return;
    actionLock.current = true;
    const methodName = `${kind}_workflow`;
    setActionState({ kind, phase: "wallet", workflowId: workflow.id });
    setMessage("");
    setMessageTone("success");
    setTransactionHash("");
    setConfirmCancelId(null);
    try {
      const hash = await walletSession.signFunctionCall({
        methodName: kind === "withdraw" ? "withdraw_available" : methodName,
        args:
          kind === "withdraw"
            ? { workflow_id: workflow.id, amount: workflow.withdrawable }
            : { workflow_id: workflow.id },
        deposit: 0n,
      });
      if (!hash) {
        throw new Error("WALLET_TRANSACTION_HASH_MISSING");
      }
      setTransactionHash(hash);
      const submitted = {
        hash,
        kind,
        workflowId: workflow.id,
        sender: walletSession.accountId,
      };
      setSubmittedAction(submitted);
      await confirmOwnerAction(submitted);
    } catch (error) {
      setMessageTone("error");
      setMessage(
        error instanceof Error ? error.message : `${actionLabel(kind)} failed`,
      );
    } finally {
      actionLock.current = false;
      setActionState(null);
    }
  }

  async function confirmOwnerAction(submitted: SubmittedAction) {
    setActionState({
      kind: submitted.kind,
      phase: "finality",
      workflowId: submitted.workflowId,
    });
    try {
      const finality = await readTransactionFinality(
        rpcUrl,
        submitted.hash,
        submitted.sender,
        contractId,
      );
      if (finality === "pending") {
        setMessageTone("pending");
        setMessage(
          `${actionLabel(submitted.kind)} was submitted, but finality is not confirmed yet.`,
        );
        return;
      }
      setSubmittedAction(null);
      if (finality === "failure") {
        setMessageTone("error");
        setMessage(
          `${actionLabel(submitted.kind)} failed at finality. Refresh the ledger to inspect the current balance.`,
        );
        return;
      }
      await loadWorkflows();
      setMessageTone("success");
      setMessage(`${actionLabel(submitted.kind)} finalized on NEAR testnet.`);
    } catch {
      setMessageTone("pending");
      setMessage(
        `${actionLabel(submitted.kind)} was submitted, but the finality check is unavailable. Check this transaction again before signing another action.`,
      );
    } finally {
      setActionState(null);
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
          <p className="step-label">Step 3 of 3</p>
          <h2 id="ledger-title">Track your payment schedules</h2>
          <p className="section-intro">
            See what runs next, manage active schedules, and withdraw funds that
            are no longer reserved.
          </p>
        </div>
        <button
          className="secondary"
          type="button"
          disabled={!walletSession || loadState === "loading"}
          onClick={() => void loadWorkflows()}
        >
          {loadState === "loading" ? "Refreshing" : "Refresh"}
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
          detail={loadError || "Check the RPC connection and try again."}
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
                    <div className="ledger-control-group">
                      <span>Workflow control</span>
                      {workflow.state === "Active" ? (
                        <button
                          className="secondary"
                          type="button"
                          disabled={actionsBlocked}
                          onClick={() =>
                            void submitOwnerAction(workflow, "pause")
                          }
                        >
                          {actionButtonLabel(actionState, workflow.id, "pause")}
                        </button>
                      ) : null}
                      {workflow.state === "Paused" ? (
                        <button
                          type="button"
                          disabled={actionsBlocked}
                          onClick={() =>
                            void submitOwnerAction(workflow, "resume")
                          }
                        >
                          {actionButtonLabel(
                            actionState,
                            workflow.id,
                            "resume",
                          )}
                        </button>
                      ) : null}
                      {workflow.state === "Active" ||
                      workflow.state === "Paused" ? (
                        confirmCancelId === workflow.id ? (
                          <div
                            className="cancel-confirm"
                            role="group"
                            aria-label={`Confirm cancellation of workflow ${workflow.id}`}
                          >
                            <p>
                              Stops future runs. A pending transfer cannot be
                              reversed.
                            </p>
                            <button
                              className="danger"
                              type="button"
                              disabled={actionsBlocked}
                              onClick={() =>
                                void submitOwnerAction(workflow, "cancel")
                              }
                            >
                              {actionButtonLabel(
                                actionState,
                                workflow.id,
                                "cancel",
                              )}
                            </button>
                            <button
                              className="quiet"
                              type="button"
                              disabled={actionsBlocked}
                              onClick={() => setConfirmCancelId(null)}
                            >
                              Keep workflow
                            </button>
                          </div>
                        ) : (
                          <button
                            className="quiet danger-text"
                            type="button"
                            disabled={actionsBlocked}
                            onClick={() => setConfirmCancelId(workflow.id)}
                          >
                            Cancel workflow
                          </button>
                        )
                      ) : (
                        <p className="control-note">
                          No further runs can be scheduled in this state.
                        </p>
                      )}
                    </div>

                    <div className="ledger-control-group withdraw-control">
                      <span>Owner withdrawable</span>
                      <strong>
                        {formatNear(BigInt(workflow.withdrawable))} NEAR
                      </strong>
                      <button
                        className="secondary"
                        type="button"
                        disabled={
                          BigInt(workflow.withdrawable) <= 0n || actionsBlocked
                        }
                        onClick={() =>
                          void submitOwnerAction(workflow, "withdraw")
                        }
                      >
                        {actionButtonLabel(
                          actionState,
                          workflow.id,
                          "withdraw",
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
          </div>
        </>
      ) : null}

      {message ? (
        <div
          className={`ledger-message ledger-message-${messageTone}`}
          role={messageTone === "error" ? "alert" : "status"}
        >
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
          {submittedAction ? (
            <button
              className="secondary"
              type="button"
              disabled={actionState !== null}
              onClick={() => void confirmOwnerAction(submittedAction)}
            >
              {actionState ? "Checking finality" : "Check transaction status"}
            </button>
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

function actionLabel(kind: OwnerAction): string {
  if (kind === "pause") return "Pause";
  if (kind === "resume") return "Resume";
  if (kind === "cancel") return "Cancellation";
  return "Withdrawal";
}

function actionButtonLabel(
  state: ActionState,
  workflowId: number,
  kind: OwnerAction,
): string {
  if (state?.workflowId === workflowId && state.kind === kind) {
    return state.phase === "wallet"
      ? "Waiting for wallet"
      : "Checking finality";
  }
  if (kind === "pause") return "Pause future runs";
  if (kind === "resume") return "Resume scheduled runs";
  if (kind === "cancel") return "Confirm cancellation";
  return "Withdraw available funds";
}
