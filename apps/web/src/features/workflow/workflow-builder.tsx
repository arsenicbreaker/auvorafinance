"use client";

import { useEffect, useMemo, useState } from "react";
import { formatNear, parseNear } from "@auvora/domain";
import {
  aiWorkflowParserResultSchema,
  type AiWorkflowDraft,
  type AiWorkflowPartialDraft,
} from "@auvora/workflow-schema";
import {
  readRecipientAllowed,
  readTransactionFinality,
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
  { label: "Every week", value: 604_800_000 },
] as const;

const ALLOWLIST_DEPOSIT = 1_000_000_000_000_000_000_000n;
const MAX_U128 = (1n << 128n) - 1n;

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
  const [startAt, setStartAt] = useState("");
  const [instruction, setInstruction] = useState("");
  const [parserState, setParserState] = useState<
    "clarification" | "error" | "idle" | "loading" | "ready" | "rejected"
  >("idle");
  const [parserNotes, setParserNotes] = useState<string[]>([]);
  const [draftState, setDraftState] = useState<DraftState>("idle");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [submittedTransaction, setSubmittedTransaction] = useState<{
    hash: string;
    actionName: "Recipient authorization" | "Workflow creation";
    sender: string;
  } | null>(null);
  const [reviewedSchedule, setReviewedSchedule] = useState<{
    intervalMs: number;
    startAtMs: number;
  } | null>(null);
  const [reviewedDraftKey, setReviewedDraftKey] = useState<string | null>(null);
  const [contractCheckAttempt, setContractCheckAttempt] = useState(0);
  const [allowlistCheck, setAllowlistCheck] = useState<{
    key: string;
    state: "allowed" | "not-allowed" | "error";
  } | null>(null);
  const [storageQuote, setStorageQuote] = useState<
    | { cost: bigint; key: string; state: "ready" }
    | { key: string; state: "error" }
    | null
  >(null);
  const [transactionState, setTransactionState] = useState<
    "error" | "finalizing" | "idle" | "pending" | "submitted" | "success"
  >("idle");
  const transactionBusy =
    transactionState === "pending" ||
    transactionState === "finalizing" ||
    transactionState === "submitted";

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
    startAt,
  ]);
  const isDraftReviewed = reviewedDraftKey === currentDraftKey;
  const storageQuoteKey = `${contractId}:${ownerId}:${recipient.trim()}`;
  const currentStorageQuote =
    storageQuote?.key === storageQuoteKey && storageQuote.state === "ready"
      ? storageQuote.cost
      : null;
  const storageQuoteState =
    draftState !== "reviewing" || !ownerId || !contractId
      ? "idle"
      : storageQuote?.key !== storageQuoteKey
        ? "loading"
        : storageQuote.state;
  const allowlistState =
    draftState !== "reviewing" || !ownerId || !contractId
      ? "unknown"
      : allowlistCheck?.key !== storageQuoteKey
        ? "checking"
        : allowlistCheck.state;

  useEffect(() => {
    if (draftState !== "reviewing" || !ownerId || !contractId) {
      return;
    }

    let active = true;
    void readWorkflowStorageCost(
      rpcUrl,
      contractId,
      ownerId,
      recipient.trim(),
      "auvora-web-0000000000000",
    )
      .then((cost) => {
        if (!active) return;
        setStorageQuote({ cost, key: storageQuoteKey, state: "ready" });
      })
      .catch(() => {
        if (!active) return;
        setStorageQuote({ key: storageQuoteKey, state: "error" });
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
      return;
    }

    let active = true;
    void readRecipientAllowed(rpcUrl, contractId, ownerId, recipient.trim())
      .then((allowed) => {
        if (!active) return;
        setAllowlistCheck({
          key: storageQuoteKey,
          state: allowed ? "allowed" : "not-allowed",
        });
      })
      .catch(() => {
        if (active) {
          setAllowlistCheck({ key: storageQuoteKey, state: "error" });
        }
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
    const parsedStartAt = Date.parse(`${startAt}:00Z`);

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
    if (!startAt || !Number.isFinite(parsedStartAt)) {
      throw new Error("Choose the first run time in UTC.");
    }
    if (parsedStartAt <= Date.now() + 60_000) {
      throw new Error("The first run must be at least one minute from now.");
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
      startAtMs: parsedStartAt,
      deposit,
    };
  }

  function validateAndReview() {
    try {
      const draft = validateDraft();
      setReviewedDraftKey(currentDraftKey);
      setAllowlistCheck(null);
      setStorageQuote(null);
      setReviewedSchedule({
        intervalMs: draft.intervalMs,
        startAtMs: draft.startAtMs,
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
      JSON.stringify({
        recipient,
        amount,
        reserve,
        interval,
        maxRuns,
        startAt,
      }),
    );
    setDraftState("saved");
  }

  async function allowRecipient() {
    if (transactionBusy) return;
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
    setTransactionHash("");
    setError("");
    try {
      const hash = await walletSession.signFunctionCall({
        methodName: "add_allowed_recipient",
        args: { account_id: draft.recipientId },
        deposit: ALLOWLIST_DEPOSIT,
      });
      if (!hash) throw new Error("WALLET_TRANSACTION_HASH_MISSING");
      setTransactionHash(hash);
      if (await confirmFinality(hash, "Recipient authorization")) {
        setAllowlistCheck(null);
        setContractCheckAttempt((attempt) => attempt + 1);
      }
    } catch (nextError) {
      setTransactionState("error");
      setError(
        nextError instanceof Error ? nextError.message : "Wallet call failed",
      );
    }
  }

  async function parseInstruction() {
    setParserState("loading");
    setParserNotes([]);
    setError("");
    try {
      const response = await fetch("/api/ai/workflow-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: instruction,
          ownerAccountId: walletSession?.accountId,
        }),
      });
      if (!response.ok) {
        throw new Error(
          response.status === 429
            ? "Too many parser requests. Wait a minute and try again."
            : "The payment instruction could not be parsed.",
        );
      }
      const result = aiWorkflowParserResultSchema.safeParse(
        await response.json(),
      );
      if (!result.success) throw new Error("The parser response was invalid.");

      if (result.data.status === "rejected") {
        setParserState("rejected");
        setParserNotes([result.data.message]);
        return;
      }

      applyParsedFields(
        result.data.status === "ready"
          ? result.data.draft
          : result.data.partialDraft,
      );
      setReviewedDraftKey(null);
      setReviewedSchedule(null);
      setDraftState("idle");
      setAllowlistCheck(null);
      setStorageQuote(null);

      if (result.data.status === "clarification") {
        setParserState("clarification");
        setParserNotes([...result.data.questions, ...result.data.warnings]);
        return;
      }

      setParserState("ready");
      setParserNotes([
        result.data.draft.explanation,
        ...result.data.draft.warnings,
      ]);
    } catch (nextError) {
      setParserState("error");
      setParserNotes([
        nextError instanceof Error
          ? nextError.message
          : "The payment instruction could not be parsed.",
      ]);
    }
  }

  function applyParsedFields(draft: AiWorkflowDraft | AiWorkflowPartialDraft) {
    if (draft.recipient !== undefined) setRecipient(draft.recipient);
    if (draft.amountNear !== undefined) setAmount(draft.amountNear);
    if (draft.minReserveNear !== undefined) setReserve(draft.minReserveNear);
    if (draft.intervalSeconds !== undefined) {
      setInterval(String(draft.intervalSeconds * 1_000));
    }
    if (draft.maxRuns !== undefined) setMaxRuns(String(draft.maxRuns));
    if (draft.startAt !== undefined) {
      setStartAt(toUtcLocalInput(draft.startAt));
    }
  }

  async function createWorkflow(currentTimeMs: number) {
    if (transactionBusy) return;
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
        reviewedSchedule.startAtMs <= currentTimeMs + 60_000
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
      if (!hash) throw new Error("WALLET_TRANSACTION_HASH_MISSING");
      setTransactionHash(hash);
      if (await confirmFinality(hash, "Workflow creation")) {
        onWorkflowSubmitted?.();
      }
    } catch (nextError) {
      setTransactionState("error");
      setTransactionHash("");
      setError(
        nextError instanceof Error ? nextError.message : "Wallet call failed",
      );
    }
  }

  async function confirmFinality(
    transactionHash: string,
    actionName: "Recipient authorization" | "Workflow creation",
    sender = walletSession?.accountId,
  ): Promise<boolean> {
    if (!sender) return false;
    setSubmittedTransaction({ hash: transactionHash, actionName, sender });
    setTransactionState("finalizing");
    try {
      const finality = await readTransactionFinality(
        rpcUrl,
        transactionHash,
        sender,
        contractId,
      );
      if (finality === "failure") {
        setSubmittedTransaction(null);
        setTransactionState("error");
        setError(`${actionName} failed at finality.`);
        return false;
      }
      if (finality === "pending") {
        setTransactionState("submitted");
        setError(
          `${actionName} was submitted, but finality is not confirmed yet.`,
        );
        return false;
      }
      setTransactionState("success");
      setSubmittedTransaction(null);
      setError("");
      return true;
    } catch {
      setTransactionState("submitted");
      setError(
        `${actionName} was submitted, but the finality check is unavailable. Inspect the transaction before retrying.`,
      );
      return false;
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
          <p className="step-label">Step 2 of 3</p>
          <h2 id="builder-title">Set up a recurring payment</h2>
        </div>
        <p>
          Choose who gets paid, how much they receive, and when the schedule
          stops. You will review the full amount before your wallet opens.
        </p>
      </div>

      <form
        className="instruction-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void parseInstruction();
        }}
      >
        <label htmlFor="payment-instruction">Describe the payment</label>
        <div className="instruction-entry">
          <textarea
            id="payment-instruction"
            maxLength={1_000}
            placeholder="Pay 2 NEAR to recipient.testnet every week, starting 2026-11-03T10:00:00Z, maximum 4 times, and keep a 5 NEAR reserve."
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
          />
          <button
            type="submit"
            disabled={
              instruction.trim().length < 8 || parserState === "loading"
            }
          >
            {parserState === "loading"
              ? "Reading instruction"
              : "Fill payment fields"}
          </button>
        </div>
        <p>
          This only fills the editable form below. It cannot open your wallet or
          submit a transaction.
        </p>
        {parserState !== "idle" && parserState !== "loading" ? (
          <div
            className={`parser-result parser-result-${parserState}`}
            role={
              parserState === "error" || parserState === "rejected"
                ? "alert"
                : "status"
            }
          >
            <strong>
              {parserState === "ready"
                ? "Draft fields filled"
                : parserState === "clarification"
                  ? "More detail needed"
                  : parserState === "rejected"
                    ? "Instruction not supported"
                    : "Parser unavailable"}
            </strong>
            {parserNotes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
      </form>

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
          <label>
            First run (UTC)
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
            />
          </label>
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
          <button type="submit">Review payment</button>
          <p className="builder-note">
            This only prepares a preview. Nothing is signed yet.
          </p>
        </form>

        <aside className="review-sheet" aria-live="polite">
          <p className="step-label">Payment summary</p>
          <div className="review-total">
            <span>Total sent to the contract</span>
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
                    : storageQuoteState === "loading"
                      ? "Estimating storage"
                      : walletSession
                        ? "Review payment first"
                        : "Connect wallet"
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
                        : walletSession
                          ? "Review payment first"
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
                  transactionBusy ||
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
                  transactionBusy ||
                  !walletSession ||
                  !isDraftReviewed ||
                  allowlistState !== "allowed" ||
                  currentStorageQuote === null ||
                  storageQuoteState !== "ready"
                }
                onClick={() => void createWorkflow(Date.now())}
              >
                {transactionState === "pending"
                  ? "Waiting for wallet"
                  : transactionState === "finalizing"
                    ? "Checking finality"
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
                                  : "Create payment schedule"}
              </button>
            </div>
          ) : null}
          {draftState === "saved" ? (
            <p className="saved-note" role="status">
              Draft saved on this device. No funds moved.
            </p>
          ) : null}
          {transactionHash ? (
            <p className="saved-note" role="status">
              {transactionState === "success"
                ? "Transaction finalized"
                : transactionState === "error"
                  ? "Transaction failed at finality"
                  : "Transaction submitted"}
              {transactionHash ? `: ${transactionHash}` : ""}.
              {transactionHash ? (
                <>
                  {" "}
                  <a
                    href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(transactionHash)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Inspect on NearBlocks
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {submittedTransaction && transactionState === "submitted" ? (
            <button
              className="secondary"
              type="button"
              onClick={() => {
                void confirmFinality(
                  submittedTransaction.hash,
                  submittedTransaction.actionName,
                  submittedTransaction.sender,
                ).then((confirmed) => {
                  if (!confirmed) return;
                  if (submittedTransaction.actionName === "Workflow creation")
                    onWorkflowSubmitted?.();
                  else setContractCheckAttempt((attempt) => attempt + 1);
                });
              }}
            >
              Check transaction status
            </button>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function isValidRunCount(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 12;
}

function toUtcLocalInput(value: string): string {
  return new Date(value).toISOString().slice(0, 16);
}
