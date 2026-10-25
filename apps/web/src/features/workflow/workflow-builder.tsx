"use client";

import { useMemo, useState } from "react";

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

const YOCTO_PER_NEAR = 1_000_000_000_000_000_000_000_000n;
const ALLOWLIST_DEPOSIT = 1_000_000_000_000_000_000_000n;

function toYocto(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole || "0") * YOCTO_PER_NEAR +
    BigInt((fraction + "0".repeat(24)).slice(0, 24))
  );
}

export function WorkflowBuilder({
  contractId,
  walletSession,
}: {
  contractId: string;
  walletSession: WorkflowWalletSession | null;
}) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [reserve, setReserve] = useState("0.002");
  const [interval, setInterval] = useState("60000");
  const [maxRuns, setMaxRuns] = useState("1");
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [transactionState, setTransactionState] = useState<
    "idle" | "pending" | "sent" | "error"
  >("idle");

  const selectedInterval = INTERVALS.find(
    (option) => String(option.value) === interval,
  );
  const total = useMemo(() => {
    const parsedAmount = Number(amount);
    const parsedReserve = Number(reserve);
    const parsedRuns = Number(maxRuns);
    if (![parsedAmount, parsedReserve, parsedRuns].every(Number.isFinite)) {
      return null;
    }
    return parsedAmount * parsedRuns + parsedReserve;
  }, [amount, maxRuns, reserve]);

  function validateAndReview() {
    const trimmedRecipient = recipient.trim();
    const parsedAmount = Number(amount);
    const parsedReserve = Number(reserve);
    const parsedRuns = Number(maxRuns);

    if (!/^[a-z0-9._-]+\.testnet$/.test(trimmedRecipient)) {
      setError("Use a valid NEAR testnet account, for example shop.testnet.");
      return;
    }
    if (!(parsedAmount > 0) || !(parsedReserve >= 0)) {
      setError("Amount must be above zero and reserve cannot be negative.");
      return;
    }
    if (!Number.isInteger(parsedRuns) || parsedRuns < 1 || parsedRuns > 12) {
      setError("Choose between 1 and 12 runs for this draft.");
      return;
    }
    setError("");
    setDraftState("reviewing");
  }

  function saveDraft() {
    localStorage.setItem(
      "auvora.workflow-draft",
      JSON.stringify({ recipient, amount, reserve, interval, maxRuns }),
    );
    setDraftState("saved");
  }

  async function allowRecipient() {
    if (!walletSession) {
      setError("Connect the contract owner wallet before signing.");
      return;
    }
    setTransactionState("pending");
    setError("");
    try {
      const hash = await walletSession.signFunctionCall({
        methodName: "add_allowed_recipient",
        args: { account_id: recipient.trim() },
        deposit: ALLOWLIST_DEPOSIT,
      });
      setTransactionHash(hash ?? "");
      setTransactionState("sent");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Wallet call failed",
      );
      setTransactionState("error");
    }
  }

  async function createWorkflow() {
    if (!walletSession || !selectedInterval) {
      setError("Connect the owner wallet and review the fields first.");
      return;
    }
    setTransactionState("pending");
    setError("");
    try {
      const hash = await walletSession.signFunctionCall({
        methodName: "create_workflow",
        args: {
          recipient_id: recipient.trim(),
          amount: toYocto(amount).toString(),
          max_per_run: toYocto(amount).toString(),
          min_reserve: toYocto(reserve).toString(),
          interval_ms: selectedInterval.value,
          start_at_ms: Date.now() + selectedInterval.value,
          max_runs: Number(maxRuns),
          config_hash: `auvora-web-${Date.now()}`,
        },
        deposit: toYocto(amount) * BigInt(maxRuns) + toYocto(reserve),
      });
      setTransactionHash(hash ?? "");
      setTransactionState("sent");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : "Wallet call failed",
      );
      setTransactionState("error");
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
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  type="number"
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
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  type="number"
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
            <span>Funding needed</span>
            <strong>
              {total === null ? "Not set" : `${total.toFixed(3)} NEAR`}
            </strong>
          </div>
          <dl>
            <div>
              <dt>Recipient</dt>
              <dd>{recipient || "Not set"}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>{selectedInterval?.label ?? "Not set"}</dd>
            </div>
            <div>
              <dt>Runs</dt>
              <dd>{maxRuns || "Not set"}</dd>
            </div>
            <div>
              <dt>Reserve floor</dt>
              <dd>{reserve || "Not set"} NEAR</dd>
            </div>
          </dl>
          {draftState === "reviewing" ? (
            <div className="review-actions">
              <p>
                Fields are ready. Allow the recipient once, then create the
                workflow with an explicit wallet confirmation.
              </p>
              <button className="secondary" type="button" onClick={saveDraft}>
                Save draft locally
              </button>
              <button
                className="secondary"
                type="button"
                disabled={transactionState === "pending" || !walletSession}
                onClick={() => void allowRecipient()}
              >
                {walletSession ? "Allow recipient" : "Connect owner wallet"}
              </button>
              <button
                type="button"
                disabled={transactionState === "pending" || !walletSession}
                onClick={() => void createWorkflow()}
              >
                {transactionState === "pending"
                  ? "Waiting for wallet"
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
