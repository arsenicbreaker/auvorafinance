"use client";

import { useEffect, useRef, useState } from "react";
import { formatNear } from "@auvora/domain";
import {
  parseExecutionHistoryPage,
  type ExecutionHistoryPage,
} from "../../lib/execution-history";

export function ExecutionHistory({
  initialOwnerId,
}: {
  initialOwnerId: string;
}) {
  const [owner, setOwner] = useState(initialOwnerId);
  const [page, setPage] = useState<ExecutionHistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function read(older = false) {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    if (!older) setPage(null);
    try {
      const params = new URLSearchParams({ owner: owner.trim() });
      if (older && page?.nextCursor) params.set("cursor", page.nextCursor);
      const response = await fetch(`/api/executions?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      });
      const result = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        const messages: Record<string, string> = {
          NOT_CONFIGURED:
            "Execution history is not connected yet. Known transaction hashes can still be inspected on NearBlocks.",
          INVALID_REQUEST:
            "Enter a full NEAR testnet owner account, for example owner.testnet.",
          RATE_LIMITED: "History is busy. Wait a minute, then try again.",
        };
        throw new Error(
          messages[result.error] ??
            "History could not be verified. Check the connection and try again.",
        );
      }
      const next = parseExecutionHistoryPage(result);
      if (next.ownerId !== owner.trim())
        throw new Error("History owner did not match the requested account.");
      setPage((previous) =>
        older && previous
          ? {
              ...next,
              rows: [
                ...previous.rows,
                ...next.rows.filter(
                  (row) =>
                    !previous.rows.some((item) => item.hash === row.hash),
                ),
              ],
            }
          : next,
      );
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "History is unavailable. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <section
      className="history-shell"
      id="history"
      aria-labelledby="history-title"
    >
      <div className="ledger-heading">
        <div>
          <p className="step-label">Execution record · testnet</p>
          <h2 id="history-title">Follow the proof of each run.</h2>
          <p className="section-intro">
            Read recorded attempts and check their final RPC evidence. No wallet
            signature is required.
          </p>
        </div>
      </div>
      <form
        className="history-form"
        onSubmit={(event) => {
          event.preventDefault();
          void read();
        }}
      >
        <label htmlFor="history-owner">
          History owner account
          <input
            id="history-owner"
            value={owner}
            maxLength={64}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(event) => {
              request.current?.abort();
              setOwner(event.target.value);
              setPage(null);
              setLoading(false);
              setError("");
            }}
          />
        </label>
        <button type="submit" disabled={loading || !owner.trim()}>
          {loading ? "Checking execution evidence" : "Read execution history"}
        </button>
      </form>
      <div className="history-content" aria-busy={loading}>
        {error ? (
          <p role="alert" className="builder-error">
            {error}
          </p>
        ) : null}
        {!page && !loading && !error ? (
          <p className="section-intro">
            Read an owner account to see keeper-recorded attempts. No example
            transactions are included.
          </p>
        ) : null}
        {loading ? (
          <p role="status">
            Checking recorded hashes against finalized RPC outcomes…
          </p>
        ) : null}
        {page ? (
          <>
            <p className="control-note">
              Ownership checked at block {page.blockHeight}. Evidence checked{" "}
              {page.observedAt} · {page.contractId}. This list covers
              keeper-recorded attempts; older or external transactions may be
              absent.
            </p>
            {page.rows.length ? (
              <div
                className="history-table-wrap"
                role="region"
                aria-label="Execution history, scroll horizontally for all columns"
                tabIndex={0}
              >
                <table className="history-table">
                  <caption>Recorded execution attempts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Workflow / run</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Evidence</th>
                      <th scope="col">Submitted (UTC)</th>
                      <th scope="col">Transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((row) => (
                      <tr key={row.hash}>
                        <th scope="row">
                          #{row.workflowId} / {row.runIndex + 1}
                        </th>
                        <td>{formatNear(BigInt(row.amountYocto))} NEAR</td>
                        <td>
                          <strong>{row.status}</strong>
                          {row.reason ? (
                            <small>{reasonLabel(row.reason)}</small>
                          ) : null}
                        </td>
                        <td>
                          <time dateTime={row.submittedAt}>
                            {row.submittedAt}
                          </time>
                        </td>
                        <td>
                          <a
                            href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(row.hash)}`}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Inspect transaction for workflow ${row.workflowId} run ${row.runIndex + 1}`}
                          >
                            {row.hash.slice(0, 7)}…{row.hash.slice(-5)}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p role="status">
                No keeper-recorded attempts were found for this owner. This does
                not prove that no on-chain execution occurred.
              </p>
            )}
            <p className="control-note">
              Succeeded, Failed, and Skipped require a matching finalized call
              and contract event. Pending is unresolved; Unverified means the
              available RPC evidence could not establish the outcome. Recorded
              amounts are payment amounts, not a wallet balance.
            </p>
            {page.nextCursor ? (
              <button
                className="secondary"
                type="button"
                disabled={loading}
                onClick={() => void read(true)}
              >
                Load older attempts
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    RESERVE_GUARD: "Minimum reserve protected.",
    RPC_UNAVAILABLE: "Status check unavailable; try refreshing.",
    IDENTITY_MISMATCH: "Transaction details did not match the record.",
    RECEIPT_FAILED: "A receipt failed; inspect the transaction.",
    NOT_DUE: "The scheduled time had not arrived.",
    WORKFLOW_INACTIVE: "The workflow was inactive.",
  };
  return labels[reason] ?? "Inspect the transaction for more detail.";
}
