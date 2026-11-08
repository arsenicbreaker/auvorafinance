"use client";

import { useEffect, useState } from "react";
import { formatNear } from "@auvora/domain";
import {
  readOwnerWorkflowSnapshot,
  type OwnerWorkflowSnapshot,
} from "../../lib/near-rpc";
import { DashboardIcon, type DashboardIconName } from "./dashboard-icon";

export function WalletRequired({
  onConnectWallet,
}: { onConnectWallet?: (() => void) | undefined } = {}) {
  return (
    <section
      className="overview-panel overview-empty wallet-empty"
      aria-label="Wallet connection required"
    >
      <span className="empty-calendar">
        <DashboardIcon name="wallet" />
      </span>
      <h2>Connect your wallet to see your data</h2>
      <p>
        Your balances, recipients, and schedules will appear after you connect
        your NEAR wallet.
      </p>
      {onConnectWallet ? (
        <button type="button" onClick={onConnectWallet}>
          Connect wallet
        </button>
      ) : (
        <a href="#proof">Connect wallet</a>
      )}
    </section>
  );
}

export function DashboardOverview(
  props: Parameters<typeof ConnectedDashboardOverview>[0] & {
    onConnectWallet?: (() => void) | undefined;
  },
) {
  if (!props.accountId)
    return <WalletRequired onConnectWallet={props.onConnectWallet} />;
  return (
    <ConnectedDashboardOverview
      key={`${props.accountId}:${props.contractId}:${props.rpcUrl}`}
      {...props}
    />
  );
}

function ConnectedDashboardOverview({
  contractId,
  rpcUrl,
  accountId,
  refreshToken,
  search,
  recipientsOnly = false,
}: {
  contractId: string;
  rpcUrl: string;
  accountId: string;
  refreshToken: number;
  search: string;
  recipientsOnly?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<OwnerWorkflowSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [months, setMonths] = useState(6);
  const [showInsight, setShowInsight] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      setSnapshot(null);
      try {
        if (!contractId)
          throw new Error(
            "Connect a deployed testnet contract to see your overview.",
          );
        const next = await readOwnerWorkflowSnapshot(
          rpcUrl,
          contractId,
          accountId,
        );
        if (next.ownerId !== accountId)
          throw new Error("Unexpected snapshot owner");
        if (!cancelled) setSnapshot(next);
      } catch (failure) {
        if (!cancelled)
          setError(
            failure instanceof Error && !contractId
              ? failure.message
              : "We couldn't load the overview. Check your connection and try again.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, contractId, rpcUrl, refreshToken, reload]);

  const workflows = snapshot?.workflows ?? [];
  const active = workflows.filter(
    (item) => item.state === "Active" && item.runs_completed < item.max_runs,
  );
  const recipients = [...new Set(workflows.map((item) => item.recipient_id))];
  const balance = workflows.reduce(
    (total, item) => total + BigInt(item.available_balance),
    0n,
  );
  const nextTotal = active.reduce(
    (total, item) => total + BigInt(item.amount),
    0n,
  );
  const query = search.trim().toLowerCase();
  const matches = workflows.filter((item) =>
    `${item.recipient_id} ${item.id} ${item.state}`
      .toLowerCase()
      .includes(query),
  );
  const upcoming = active
    .filter((item) =>
      `${item.recipient_id} ${item.id}`.toLowerCase().includes(query),
    )
    .sort((a, b) => a.next_run_at_ms - b.next_run_at_ms);
  const asOf = new Date(snapshot?.timestampMs ?? 0);
  const buckets = Array.from({ length: months }, (_, index) => {
    const start = Date.UTC(
      asOf.getUTCFullYear(),
      asOf.getUTCMonth() - months + index + 1,
      1,
    );
    const end = Date.UTC(
      asOf.getUTCFullYear(),
      asOf.getUTCMonth() - months + index + 2,
      1,
    );
    return {
      label: new Date(start).toLocaleDateString("en-US", {
        month: "short",
        timeZone: "UTC",
      }),
      count: workflows.filter(
        (item) => item.created_at_ms >= start && item.created_at_ms < end,
      ).length,
    };
  });
  const maximum =
    Math.ceil(Math.max(4, ...buckets.map((item) => item.count)) / 4) * 4;
  const stats: {
    label: string;
    value: string;
    note: string;
    icon: DashboardIconName;
    warm?: boolean;
  }[] = [
    {
      label: "Workflow balance",
      value: formatNear(balance),
      note: "NEAR held in workflow ledgers",
      icon: "balance",
    },
    {
      label: "Next scheduled payments",
      value: formatNear(nextTotal),
      note: `${active.length} active payment schedules`,
      icon: "calendar",
      warm: true,
    },
    {
      label: "Active schedules",
      value: String(active.length),
      note: `${workflows.filter((item) => item.state === "Paused").length} paused schedules`,
      icon: "calendar",
    },
    {
      label: "Recipients",
      value: String(recipients.length),
      note: "Across your payment workflows",
      icon: "people",
      warm: true,
    },
  ];

  return (
    <div className="overview-content" aria-busy={loading}>
      <div className="overview-toolbar">
        <button
          className="overview-refresh"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
        >
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </div>
      {error ? (
        <p className="overview-error" role="alert">
          {error}
        </p>
      ) : null}
      {!recipientsOnly && !query ? (
        <>
          <div className="overview-stats">
            {stats.map((stat) => (
              <article className="overview-stat" key={stat.label}>
                <span className={`stat-symbol${stat.warm ? " warm" : ""}`}>
                  <DashboardIcon name={stat.icon} />
                </span>
                <div>
                  <h2>{stat.label}</h2>
                  <p className="stat-value">
                    {loading ? "…" : !snapshot ? "N/A" : stat.value}
                    {(snapshot && !loading && stat.icon === "balance") ||
                    (snapshot &&
                      !loading &&
                      stat.warm &&
                      stat.icon === "calendar") ? (
                      <small> NEAR</small>
                    ) : null}
                  </p>
                  <p className="stat-note">
                    {snapshot
                      ? stat.note
                      : loading
                        ? "Reading finalized data"
                        : "Refresh to load data"}
                  </p>
                </div>
              </article>
            ))}
          </div>
          <div className="overview-panels">
            <section
              className="overview-panel activity-panel"
              aria-labelledby="activity-title"
            >
              <div className="panel-top">
                <h2 id="activity-title">Schedule activity</h2>
                <select
                  aria-label="Activity period"
                  value={months}
                  onChange={(event) => setMonths(Number(event.target.value))}
                >
                  <option value={6}>Last 6 months</option>
                  <option value={3}>Last 3 months</option>
                  <option value={12}>Last 12 months</option>
                </select>
              </div>
              <p className="chart-caption">Schedules created per month · UTC</p>
              {snapshot ? (
                <div
                  className="activity-chart"
                  role="img"
                  aria-label={buckets
                    .map(
                      (bucket) => `${bucket.label}: ${bucket.count} schedules`,
                    )
                    .join(", ")}
                >
                  <div className="chart-scale">
                    {[
                      maximum,
                      Math.ceil(maximum * 0.75),
                      Math.ceil(maximum * 0.5),
                      Math.ceil(maximum * 0.25),
                      0,
                    ].map((value, index) => (
                      <span key={index}>{value}</span>
                    ))}
                  </div>
                  <div className="chart-plot">
                    <div className="chart-grid" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="chart-bars">
                      {buckets.map((bucket, index) => (
                        <div className="chart-column" key={index}>
                          <div
                            className={`chart-bar${index === months - 1 ? " current" : ""}`}
                            style={{
                              height: `${(bucket.count / maximum) * 100}%`,
                            }}
                          >
                            <span>{bucket.count || ""}</span>
                          </div>
                          <span className="chart-month">{bucket.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="overview-empty chart-placeholder">
                  <DashboardIcon name="chart" />
                  <h3>
                    {loading
                      ? "Gathering your schedules"
                      : "Activity is unavailable"}
                  </h3>
                  <p>
                    {loading
                      ? "Your finalized workflow data will appear here."
                      : "Refresh the overview to try again."}
                  </p>
                </div>
              )}
            </section>
            <section
              className="overview-panel upcoming-panel"
              aria-labelledby="upcoming-title"
            >
              <div className="panel-top">
                <h2 id="upcoming-title">Upcoming payments</h2>
                <a href="#workflows">
                  View all <DashboardIcon name="arrow" />
                </a>
              </div>
              {upcoming.length ? (
                <ul className="upcoming-list">
                  {upcoming.slice(0, 5).map((item, index) => (
                    <li key={item.id}>
                      <span
                        className={`payment-symbol${index % 2 ? "" : " warm"}`}
                      >
                        <DashboardIcon name="payment" />
                      </span>
                      <div>
                        <strong>{item.recipient_id}</strong>
                        <small>
                          {new Date(item.next_run_at_ms).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              timeZone: "UTC",
                            },
                          )}{" "}
                          · UTC
                        </small>
                      </div>
                      <b>
                        {formatNear(BigInt(item.amount))}
                        <small>NEAR</small>
                      </b>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="overview-empty">
                  <span className="empty-calendar">
                    <DashboardIcon name="calendar" />
                  </span>
                  <h3>
                    {loading
                      ? "Checking upcoming payments"
                      : !snapshot
                        ? "Payments are unavailable"
                        : "A little room in your calendar."}
                  </h3>
                  <p>
                    {loading
                      ? "Reading your active schedules."
                      : !snapshot
                        ? "Refresh to load your schedules."
                        : "Your next scheduled payments will show up here."}
                  </p>
                  {snapshot ? (
                    <a href={accountId ? "#builder" : "#proof"}>
                      Create a payment <DashboardIcon name="arrow" />
                    </a>
                  ) : null}
                </div>
              )}
            </section>
          </div>
          {showInsight ? (
            <aside className="overview-insight">
              <div className="insight-botanical" aria-hidden="true">
                <svg viewBox="0 0 180 150">
                  <path
                    d="M27 88c4-31 29-53 61-56 31-3 60 14 65 39 6 28-16 53-47 55-31 2-59-14-67-39"
                    fill="none"
                    stroke="#65744c"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M43 76c8-22 29-35 51-32 21 3 37 17 39 35 2 18-13 34-34 37-20 3-40-7-50-24"
                    fill="none"
                    stroke="#a3ad8f"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <circle cx="91" cy="76" r="23" fill="#d8c0a5" />
                  <circle
                    cx="91"
                    cy="76"
                    r="23"
                    fill="none"
                    stroke="#b39a7d"
                    strokeWidth="2"
                  />
                  <path
                    d="M81 77h20M85 70h12M85 83h12"
                    stroke="#65744c"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  <circle cx="27" cy="88" r="5" fill="#b94c08" />
                  <circle cx="153" cy="71" r="5" fill="#b94c08" />
                  <circle cx="106" cy="126" r="5" fill="#b94c08" />
                </svg>
              </div>
              <div>
                <span className="insight-label">
                  A little planning goes a long way
                </span>
                <h2>Find your payment rhythm.</h2>
                <p>
                  Review upcoming commitments and keep room in your treasury.
                </p>
              </div>
              <a className="insight-action" href="#outlook">
                View treasury outlook <DashboardIcon name="arrow" />
              </a>
              <button
                className="insight-dismiss"
                aria-label="Dismiss treasury insight"
                onClick={() => setShowInsight(false)}
              >
                <DashboardIcon name="close" />
              </button>
            </aside>
          ) : null}
        </>
      ) : (
        <section className="overview-panel recipient-panel">
          <div className="panel-top">
            <h2>
              {query ? `Search results for “${search}”` : "Your recipients"}
            </h2>
            <span>{matches.length} schedules</span>
          </div>
          {loading ? (
            <p role="status">Loading workflows…</p>
          ) : !matches.length ? (
            <div className="overview-empty">
              <DashboardIcon name="people" />
              <h3>{query ? "No matching workflows" : "No recipients yet"}</h3>
              <p>
                {query
                  ? "Try a recipient account, workflow number, or status."
                  : "Recipients appear here when you create a workflow."}
              </p>
            </div>
          ) : (
            <div className="recipient-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Workflow</th>
                    <th>Amount per run</th>
                    <th>Status</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((item) => (
                    <tr key={item.id}>
                      <td>{item.recipient_id}</td>
                      <td>#{item.id}</td>
                      <td>{formatNear(BigInt(item.amount))} NEAR</td>
                      <td>
                        <span className="recipient-status">{item.state}</span>
                      </td>
                      <td>
                        <a href="#workflows">View schedule</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
