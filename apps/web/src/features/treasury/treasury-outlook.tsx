"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatNear, parseNear } from "@auvora/domain";
import {
  forecastTreasury,
  type TreasuryForecast,
} from "@auvora/domain/treasury";
import {
  readOwnerWorkflowSnapshot,
  type OwnerWorkflowSnapshot,
} from "../../lib/near-rpc";
import { YieldScenario } from "./yield-scenario";

export function TreasuryOutlook({
  contractId,
  rpcUrl,
  initialOwnerId,
}: {
  contractId: string;
  rpcUrl: string;
  initialOwnerId: string;
}) {
  const [owner, setOwner] = useState(initialOwnerId);
  const [snapshot, setSnapshot] = useState<OwnerWorkflowSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [horizon, setHorizon] = useState("30");
  const [fee, setFee] = useState("0");
  const requestId = useRef(0);
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );

  const current = snapshot?.ownerId === owner.trim() ? snapshot : null;
  const calculation = useMemo<{
    forecast: TreasuryForecast | null;
    error: string;
  }>(() => {
    if (!current) return { forecast: null, error: "" };
    try {
      return {
        forecast: forecastTreasury(current.workflows, {
          asOfMs: current.timestampMs,
          horizonDays: Number(horizon),
          feePerRun: parseNear(fee),
        }),
        error: "",
      };
    } catch {
      return {
        forecast: null,
        error:
          "The snapshot or assumptions cannot be calculated. Use a valid nonnegative fee amount, or refresh the finalized data.",
      };
    }
  }, [current, horizon, fee]);
  const forecast = calculation.forecast;

  async function loadSnapshot() {
    const id = ++requestId.current;
    setSnapshot(null);
    setLoadError("");
    setLoading(true);
    try {
      const next = await readOwnerWorkflowSnapshot(
        rpcUrl,
        contractId,
        owner.trim(),
      );
      if (requestId.current === id) setSnapshot(next);
    } catch (error) {
      if (requestId.current === id)
        setLoadError(
          error instanceof Error && error.message === "INVALID_TESTNET_OWNER"
            ? "Use a full NEAR testnet account, for example owner.testnet."
            : "Finalized balances could not be verified. Check the owner account and connection, then try again.",
        );
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }

  return (
    <section
      className="outlook-shell"
      id="outlook"
      aria-labelledby="outlook-title"
    >
      <div className="outlook-heading">
        <p className="step-label">Treasury outlook · Read-only planning</p>
        <h2 id="outlook-title">Plan around your payment commitments.</h2>
        <p>
          Read finalized workflow ledgers, protect approved payments and
          reserves, then model a separate hypothetical return.
        </p>
      </div>
      <div className="outlook-body">
        <form
          className="outlook-account"
          onSubmit={(event) => {
            event.preventDefault();
            void loadSnapshot();
          }}
        >
          <label>
            Read-only owner account
            <input
              value={owner}
              placeholder="owner.testnet"
              autoComplete="off"
              onChange={(event) => {
                requestId.current += 1;
                setLoading(false);
                setLoadError("");
                setSnapshot(null);
                setOwner(event.target.value);
              }}
            />
          </label>
          <button
            type="submit"
            disabled={loading || !contractId || !owner.trim()}
          >
            {loading ? "Reading finalized balances" : "Read finalized balances"}
          </button>
        </form>
        <p className="outlook-note">
          Public testnet data from {contractId || "an unconfigured contract"}.
          No wallet connection or signature is required.
        </p>
        {loading ? (
          <p role="status" aria-busy="true">
            Loading one finalized block and its workflow pages.
          </p>
        ) : null}
        {loadError ? (
          <p className="outlook-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {!current && !loading && !loadError ? (
          <p className="outlook-empty" role="status">
            Read an owner account to calculate the outlook. No example funds are
            included.
          </p>
        ) : null}
        {current ? (
          <>
            <p className="snapshot-reference">
              Final block {current.blockHeight} ·{" "}
              {new Date(current.timestampMs).toISOString()}
              <br />
              <span>{current.blockHash}</span>
            </p>
            {!current.workflows.length ? (
              <p className="outlook-empty" role="status">
                No workflows found for this owner. All forecast amounts are
                zero.
              </p>
            ) : null}
            <div className="outlook-assumptions">
              <label>
                Forecast horizon
                <select
                  value={horizon}
                  onChange={(event) => setHorizon(event.target.value)}
                >
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">365 days</option>
                </select>
              </label>
              <label>
                Planning fee buffer (NEAR per run)
                <input
                  value={fee}
                  inputMode="decimal"
                  onChange={(event) => setFee(event.target.value)}
                />
              </label>
            </div>
            <p className="outlook-note">
              The fee buffer is an assumption. Scheduled execution gas is
              sponsored by the keeper and is not deducted from these workflow
              ledgers.
            </p>
            {calculation.error ? (
              <p className="outlook-error" role="alert">
                {calculation.error}
              </p>
            ) : null}
            {forecast ? (
              <>
                <dl
                  className="outlook-metrics"
                  aria-label="Finalized balances and protected commitments"
                >
                  <div>
                    <dt>On-chain available ledgers</dt>
                    <dd>{formatNear(forecast.available)} NEAR</dd>
                  </div>
                  <div>
                    <dt>All approved future payments</dt>
                    <dd>{formatNear(forecast.obligations)} NEAR</dd>
                  </div>
                  <div>
                    <dt>Protected minimum reserves</dt>
                    <dd>{formatNear(forecast.reserve)} NEAR</dd>
                  </div>
                  <div>
                    <dt>Assumed fees for remaining runs</dt>
                    <dd>{formatNear(forecast.fees)} NEAR</dd>
                  </div>
                </dl>
                <div className="outlook-projection" aria-live="polite">
                  <div>
                    <span>Uncommitted after all obligations</span>
                    <strong>{formatNear(forecast.uncommitted)} NEAR</strong>
                  </div>
                  <p>
                    Within {horizon} days:{" "}
                    {forecast.uncertainWorkflows
                      ? "schedule unresolved"
                      : `${formatNear(forecast.upcomingPayments)} NEAR across ${forecast.upcomingRuns} possible runs`}
                    . Protected headroom after those payments:{" "}
                    {forecast.horizonHeadroom === null
                      ? "unavailable"
                      : `${formatNear(forecast.horizonHeadroom)} NEAR`}
                    .
                  </p>
                </div>
                {forecast.uncertainWorkflows ? (
                  <p className="outlook-warning" role="status">
                    {forecast.uncertainWorkflows} workflow(s) have an unresolved
                    transfer totaling {formatNear(forecast.pending)} NEAR,
                    excluded from available ledgers. Refresh after finality; the
                    horizon and yield scenario are unavailable.
                  </p>
                ) : null}
                {forecast.fundingGap > 0n ? (
                  <p className="outlook-warning" role="status">
                    Funding gap across individual workflows:{" "}
                    {formatNear(forecast.fundingGap)} NEAR. Review the affected
                    ledgers, fund them explicitly, or replace a schedule.
                    Surplus in another workflow does not cover this gap
                    automatically.
                  </p>
                ) : null}
                <p className="outlook-note">
                  Paused workflows retain their obligations and reserves but
                  schedule no payments. Timing assumes immediate confirmations
                  and no burst catch-up; actual payments can occur later.
                  Horizon headroom may still be needed for payments beyond the
                  horizon.
                </p>
                {forecast.rows.length ? (
                  <div
                    className="outlook-table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Workflow forecast amounts in NEAR"
                  >
                    <table className="outlook-table">
                      <caption>
                        Per-workflow commitments · all amounts in NEAR
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Workflow</th>
                          <th scope="col">State</th>
                          <th scope="col">Future payments</th>
                          <th scope="col">Reserve</th>
                          <th scope="col">Uncommitted</th>
                          <th scope="col">Funding gap</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecast.rows.map((row) => (
                          <tr key={row.id}>
                            <th scope="row">WF-{row.id}</th>
                            <td>
                              {row.state}
                              {row.uncertain ? " · pending" : ""}
                            </td>
                            <td>{formatNear(row.obligations)}</td>
                            <td>{formatNear(row.reserve)}</td>
                            <td>{formatNear(row.uncommitted)}</td>
                            <td>{formatNear(row.fundingGap)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                <YieldScenario
                  key={`${current.ownerId}:${current.blockHash}`}
                  uncommitted={forecast.uncommitted}
                  blocked={forecast.uncertainWorkflows > 0}
                />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
