"use client";

import { useEffect, useMemo, useState } from "react";
import { formatNear, parseNear } from "@auvora/domain";
import {
  readRecipientAllowed,
  readWorkflowStorageCost,
} from "../../lib/near-rpc";

export interface WorkflowWalletSession {
  accountId: string;
  signFunctionCall: (input: {
    methodName: string;
    args: Record<string, unknown>;
    deposit: bigint;
  }) => Promise<string | undefined>;
}

type DraftState = "idle" | "reviewing" | "saved";

const INTERVALS = [
  { label: "Every minute", value: 60_000 },
  { label: "Every hour", value: 3_600_000 },
  { label: "Every day", value: 86_400_000 },
] as const;

const ALLOWLIST_DEPOSIT = 1_000_000_000_000_000_000_000n;
const MAX_U128 = (1n << 128n) - 1n;
const MIN_SCHEDULE_LEAD_MS = 5 * 60_000;

export function WorkflowBuilder({
  contractId,
  rpcUrl,
  walletSession,
  onWorkflowSubmitted,
}: {
  contractId: string;
  rpcUrl: string;
  walletSession: WorkflowWalletSession | null;
  onWorkflowSubmitted?: () => void;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [reserve, setReserve] = useState("0.002");
  const [interval, setInterval] = useState("60000");
  const [maxRuns, setMaxRuns] = useState("1");
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [reviewedSchedule, setReviewedSchedule] = useState<{
    intervalMs: number;
    startAtMs: number;
  } | null>(null);
  const [reviewedDraftKey, setReviewedDraftKey] = useState<string | null>(null);
  const [contractCheckAttempt, setContractCheckAttempt] = useState(0);
  const [allowlistState, setAllowlistState] = useState<
    "unknown" | "checking" | "allowed" | "not-allowed" | "error"
  >("unknown");
  const [storageQuote, setStorageQuote] = useState<{
    key: string;
    cost: bigint;
  } | null>(null);
  const [storageQuoteState, setStorageQuoteState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [transactionState, setTransactionState] = useState<
    "idle" | "pending" | "sent" | "error"
  >("idle");

  const selectedInterval = INTERVALS.find(
    (option) => String(option.value) === interval,
  );
  const ownerId = walletSession?.accountId ?? "";
  const currentDraftKey = JSON.stringify([
    recipient.trim(),
    amount,
    reserve,
    interval,
    maxRuns,
  ]);
  const isDraftReviewed = reviewedDraftKey === currentDraftKey;
  const storageQuoteKey = `${contractId}:${ownerId}:${recipient.trim()}`;
  const currentStorageQuote =
    storageQuote?.key === storageQuoteKey ? storageQuote.cost : null;

  useEffect(() => {
    if (draftState !== "reviewing" || !ownerId || !contractId) {
      setStorageQuote(null);
      setStorageQuoteState("idle");
      return;
    }

    let active = true;
    setStorageQuote(null);
    setStorageQuoteState("loading");
    void readWorkflowStorageCost(
      rpcUrl,
      contractId,
      ownerId,
      recipient.trim(),
      "auvora-web-0000000000000",
    )
      .then((cost) => {
        if (!active) return;
        setStorageQuote({ key: storageQuoteKey, cost });
        setStorageQuoteState("ready");
      })
      .catch(() => {
        if (!active) return;
        setStorageQuote(null);
        setStorageQuoteState("error");
      });

    return () => {
      active = false;
    };
  }, [
    contractCheckAttempt,
    contractId,
    draftState,
    ownerId,
    recipient,
    rpcUrl,
    storageQuoteKey,
  ]);

  useEffect(() => {
    if (draftState !== "reviewing" || !ownerId || !contractId) {
      setAllowlistState("unknown");
      return;
    }

    let active = true;
    setAllowlistState("checking");
    void readRecipientAllowed(rpcUrl, contractId, ownerId, recipient.trim())
      .then((allowed) => {
        if (!active) return;
        setAllowlistState(allowed ? "allowed" : "not-allowed");
      })
      .catch(() => {
        if (active) setAllowlistState("error");
      });

    return () => {
      active = false;
    };
  }, [
    contractCheckAttempt,
    contractId,
    draftState,
    ownerId,
    recipient,
    rpcUrl,
    transactionState,
  ]);

  const total = useMemo(() => {
    try {
      const amountYocto = parseNear(amount);
      const reserveYocto = parseNear(reserve);
      const runs = Number(maxRuns);
      const funding = amountYocto * BigInt(runs) + reserveYocto;
      if (
        amountYocto <= 0n ||
        reserveYocto < 0n ||
        !isValidRunCount(runs) ||
        funding > MAX_U128
      ) {
        return null;
      }
      return formatNear(funding);
    } catch {
      return null;
    }
  }, [amount, maxRuns, reserve]);
  const totalWithStorage = useMemo(() => {
    if (total === null || currentStorageQuote === null) return null;
    return formatNear(parseNear(total) + currentStorageQuote);
  }, [currentStorageQuote, total]);

  function validateDraft() {
    const trimmedRecipient = recipient.trim();
    const parsedRuns = Number(maxRuns);

    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(trimmedRecipient)) {
      throw new Error(
        "Use a valid NEAR testnet account, for example shop.testnet.",
      );
    }
    if (!selectedInterval) {
      throw new Error("Choose a supported payment interval.");
    }
    if (!isValidRunCount(parsedRuns)) {
      throw new Error("Choose between 1 and 12 runs for this draft.");
    }

    let amountYocto: bigint;
    let reserveYocto: bigint;
    try {
      amountYocto = parseNear(amount);
      reserveYocto = parseNear(reserve);
    } catch {
      throw new Error(
        "Enter NEAR amounts with up to 24 decimal places and no exponent notation.",
      );
    }
    if (amountYocto <= 0n || reserveYocto < 0n) {
      throw new Error(
        "Amount must be above zero and reserve cannot be negative.",
      );
    }
    const deposit = amountYocto * BigInt(parsedRuns) + reserveYocto;
    if (
      amountYocto > MAX_U128 ||
      reserveYocto > MAX_U128 ||
      deposit > MAX_U128
    ) {
      throw new Error(
        "The workflow funding amount exceeds the contract limit.",
      );
    }

    return {
      recipientId: trimmedRecipient,
      amountYocto,
      reserveYocto,
      intervalMs: selectedInterval.value,
      maxRuns: parsedRuns,
      deposit,
    };
  }

  function validateAndReview() {
    try {
      const draft = validateDraft();
      setReviewedDraftKey(currentDraftKey);
      setReviewedSchedule({
        intervalMs: draft.intervalMs,
        startAtMs:
          Date.now() + Math.max(draft.intervalMs, MIN_SCHEDULE_LEAD_MS),
      });
      setContractCheckAttempt((attempt) => attempt + 1);
      setError("");
      setDraftState("reviewing");
    } catch (nextError) {
      setReviewedDraftKey(null);
      setReviewedSchedule(null);
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Invalid workflow draft.",
      );
    }
  }

  function saveDraft() {
    localStorage.setItem(
      "auvora.workflow-draft",
      JSON.stringify({ recipient, amount, reserve, interval, maxRuns }),
    );
    setDraftState("saved");
  }

  async function allowRecipient() {
    if (allowlistState === "allowed") return;
    let draft: ReturnType<typeof validateDraft>;
    try {
      draft = validateDraft();
    } catch (nextError) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : "Invalid workflow draft.",
      );
      return;
    }
    if (!walletSession) {
      setError("Connect the contract owner wallet before signing.");
      return;
    }
    setTransactionState("pending");
    setError("");
    try {
      const hash = await walletSession.signFunctionCall({
        methodName: "add_allowed_recipient",
        args: { account_id: draft.recipientId },
        deposit: ALLOWLIST_DEPOSIT,
      });
      setTransactionHash(hash ?? "");
      setTransactionState("sent");
    } catch (nextError) {
      setTransactionState("error");
      setError(
        nextError instanceof Error ? nextError.message : "Wallet call failed",
      );
    }
  }

  async function createWorkflow() {
    if (!walletSession) {
      setError("Connect the owner wallet and review the fields first.");
      return;
    }
    if (currentStorageQuote === null || storageQuoteState !== "ready") {
      setError(
        "A current contract storage estimate is required before creation.",
      );
      return;
    }
    if (allowlistState !== "allowed") {
      setError("Allow the recipient and wait for contract confirmation first.");
      return;
    }
    try {
      const draft = validateDraft();
      if (
        !isDraftReviewed ||
        !reviewedSchedule ||
        reviewedSchedule.intervalMs !== draft.intervalMs ||
        reviewedSchedule.startAtMs <= Date.now() + 60_000
      ) {
        setError(
          "Review the current fields and schedule again before creating.",
        );
        return;
      }
      const totalDeposit = draft.deposit + currentStorageQuote;
      if (totalDeposit > MAX_U128) {
        throw new Error(
          "The workflow funding amount exceeds the contract limit.",
        );
      }
      setTransactionState("pending");
      setError("");
      setTransactionHash("");
      const startAtMs = reviewedSchedule.startAtMs;
      const hash = await walletSession.signFunctionCall({
        methodName: "create_workflow",
        args: {
          args: {
            recipient_id: draft.recipientId,
            amount: draft.amountYocto.toString(),
            max_per_run: draft.amountYocto.toString(),
            min_reserve: draft.reserveYocto.toString(),
            interval_ms: draft.intervalMs,
            start_at_ms: startAtMs,
            max_runs: draft.maxRuns,
            config_hash: `auvora-web-${startAtMs}`,
          },
        },
        deposit: totalDeposit,
      });
      setTransactionHash(hash ?? "");
      setTransactionState("sent");
      onWorkflowSubmitted?.();
    } catch (nextError) {
      setTransactionState("error");
      setTransactionHash("");
      setError(
        nextError instanceof Error ? nextError.message : "Wallet call failed",
      );
    }
  }

  return (
    <section
      className="builder-shell"
      id="builder"
      aria-labelledby="builder-title"
    >
      <div className="builder-intro">
        <div>
          <p className="step-label">Phase 5 / workflow draft</p>
          <h2 id="builder-title">Plan one recurring payment.</h2>
        </div>
        <p>
          Start with the exact fields the contract will enforce. This draft
          stays in the browser until you review it and connect an owner wallet.
        </p>
      </div>

      <div className="builder-grid">
        <form
          className="builder-form"
          onSubmit={(event) => {
            event.preventDefault();
            validateAndReview();
          }}
        >
          <label>
            Recipient account
            <input
              autoComplete="off"
              placeholder="recipient.testnet"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
            />
          </label>
          <div className="field-pair">
            <label>
              Amount per run
              <span className="input-with-unit">
                <input
                  autoComplete="off"
                  inputMode="decimal"
                  spellCheck={false}
                  type="text"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <small>NEAR</small>
              </span>
            </label>
            <label>
              Minimum reserve
              <span className="input-with-unit">
                <input
                  autoComplete="off"
                  inputMode="decimal"
                  spellCheck={false}
                  type="text"
                  value={reserve}
                  onChange={(event) => setReserve(event.target.value)}
                />
                <small>NEAR</small>
              </span>
            </label>
          </div>
          <div className="field-pair">
            <label>
              Repeat
              <select
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
              >
                {INTERVALS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Maximum runs
              <input
                inputMode="numeric"
                min="1"
                max="12"
                type="number"
                value={maxRuns}
                onChange={(event) => setMaxRuns(event.target.value)}
              />
            </label>
          </div>
          {error ? (
            <p className="builder-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit">Review contract fields</button>
          <p className="builder-note">
            No wallet request or payment happens at this step.
          </p>
        </form>

        <aside className="review-sheet" aria-live="polite">
          <p className="step-label">Contract preview</p>
          <div className="review-total">
            <span>Workflow funding needed</span>
            <strong>
              {totalWithStorage === null
                ? total === null
                  ? "Not set"
                  : storageQuoteState === "loading"
                    ? "Estimating…"
                    : storageQuoteState === "error"
                      ? "Unavailable"
                      : walletSession
                        ? "Review to estimate"
                        : "Connect wallet"
                : `${totalWithStorage} NEAR`}
            </strong>
          </div>
          <dl>
            <div>
              <dt>Recipient</dt>
              <dd>{recipient || "Not set"}</dd>
            </div>
            <div>
              <dt>Amount per run</dt>
              <dd>{amount || "Not set"} NEAR</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>{selectedInterval?.label ?? "Not set"}</dd>
            </div>
            <div>
              <dt>First scheduled run (UTC)</dt>
              <dd>
                {isDraftReviewed && reviewedSchedule
                  ? new Date(reviewedSchedule.startAtMs).toISOString()
                  : "Review fields to confirm"}
              </dd>
            </div>
            <div>
              <dt>Time zone</dt>
              <dd>UTC</dd>
            </div>
            <div>
              <dt>Runs</dt>
              <dd>{maxRuns || "Not set"}</dd>
            </div>
            <div>
              <dt>Reserve floor</dt>
              <dd>{reserve || "Not set"} NEAR</dd>
            </div>
            <div>
              <dt>Payments plus reserve</dt>
              <dd>{total === null ? "Not set" : `${total} NEAR`}</dd>
            </div>
            <div>
              <dt>Workflow storage estimate</dt>
              <dd>
                {currentStorageQuote === null
                  ? storageQuoteState === "error"
                    ? "Unavailable"
                    : "Waiting for wallet"
                  : `${formatNear(currentStorageQuote)} NEAR`}
              </dd>
            </div>
            <div>
              <dt>Recipient authorization deposit</dt>
              <dd>{formatNear(ALLOWLIST_DEPOSIT)} NEAR; excess refunded</dd>
            </div>
            <div>
              <dt>Recipient allowlist</dt>
              <dd>
                {allowlistState === "allowed"
                  ? "Allowed by contract"
                  : allowlistState === "not-allowed"
                    ? "Authorization required"
                    : allowlistState === "checking"
                      ? "Checking contract…"
                      : allowlistState === "error"
                        ? "Could not read contract"
                        : "Connect owner wallet"}
              </dd>
            </div>
          </dl>
          {draftState === "reviewing" ? (
            <div className="review-actions">
              <p>
                {storageQuoteState === "error"
                  ? "Could not load the contract storage estimate. Check the RPC connection and contract version before creating this workflow."
                  : `The first run is scheduled at least five minutes from review time in UTC. The funding estimate includes payments, reserve, and contract storage. Recipient authorization attaches ${formatNear(ALLOWLIST_DEPOSIT)} NEAR; any excess is refunded.`}
              </p>
              <button className="secondary" type="button" onClick={saveDraft}>
                Save draft locally
              </button>
              <button
                className="secondary"
                type="button"
                disabled={
                  transactionState === "pending" ||
                  !walletSession ||
                  allowlistState === "allowed" ||
                  allowlistState === "checking"
                }
                onClick={() => void allowRecipient()}
              >
                {allowlistState === "allowed"
                  ? "Recipient already allowed"
                  : allowlistState === "checking"
                    ? "Checking recipient"
                    : allowlistState === "error"
                      ? "Allowlist unavailable"
                      : walletSession
                        ? "Allow recipient"
                        : "Connect owner wallet"}
              </button>
              <button
                type="button"
                disabled={
                  transactionState === "pending" ||
                  !walletSession ||
                  !isDraftReviewed ||
                  allowlistState !== "allowed" ||
                  currentStorageQuote === null ||
                  storageQuoteState !== "ready"
                }
                onClick={() => void createWorkflow()}
              >
                {transactionState === "pending"
                  ? "Waiting for wallet"
                  : storageQuoteState === "loading"
                    ? "Estimating storage"
                    : !walletSession
                      ? "Connect owner wallet"
                      : storageQuoteState === "error"
                        ? "Storage estimate unavailable"
                        : !isDraftReviewed
                          ? "Review changed fields"
                          : allowlistState === "checking"
                            ? "Checking recipient"
                            : allowlistState === "error"
                              ? "Allowlist unavailable"
                              : allowlistState !== "allowed"
                                ? "Allow recipient first"
                                : "Create workflow"}
              </button>
            </div>
          ) : null}
          {draftState === "saved" ? (
            <p className="saved-note" role="status">
              Draft saved on this device. No funds moved.
            </p>
          ) : null}
          {transactionState === "sent" ? (
            <p className="saved-note" role="status">
              Transaction submitted
              {transactionHash ? `: ${transactionHash}` : ""}.
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function isValidRunCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 12;
}
