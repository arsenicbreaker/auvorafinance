"use client";

import { useEffect, useState } from "react";
import { formatNear } from "@auvora/domain";
import {
  readContractStatus,
  readOwnerWorkflowSnapshot,
  type OwnerWorkflowSnapshot,
} from "../../lib/near-rpc";
import { DashboardIcon, type DashboardIconName } from "./dashboard-icon";

export function DashboardOverview({
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
        const owner =
          accountId || (await readContractStatus(rpcUrl, contractId)).owner_id;
        const next = await readOwnerWorkflowSnapshot(rpcUrl, contractId, owner);
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
      <div className="overview-source">
        <span className="source-dot" />
        {loading ? (
          "Reading finalized testnet data…"
        ) : snapshot ? (
          <>
            {accountId ? "Your account" : "Read-only overview"}:{" "}
            <strong>{snapshot.ownerId}</strong>
          </>
        ) : (
          "Overview unavailable"
        )}
        <button
          className="overview-refresh"
          onClick={() => setReload((value) => value + 1)}
          disabled={loading}
        >
          Refresh
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
                    d="M89 109c0-35 13-59 22-88M89 109c-4-32-19-42-36-53"
                    fill="none"
                    stroke="#65744c"
                    strokeWidth="3"
                  />
                  <g fill="#74835a">
                    <ellipse
                      cx="107"
                      cy="40"
                      rx="9"
                      ry="24"
                      transform="rotate(30 107 40)"
                    />
                    <ellipse
                      cx="117"
                      cy="67"
                      rx="23"
                      ry="8"
                      transform="rotate(-25 117 67)"
                    />
                    <ellipse
                      cx="76"
                      cy="68"
                      rx="9"
                      ry="24"
                      transform="rotate(-47 76 68)"
                    />
                    <ellipse
                      cx="59"
                      cy="48"
                      rx="8"
                      ry="20"
                      transform="rotate(-47 59 48)"
                    />
                    <ellipse
                      cx="92"
                      cy="83"
                      rx="7"
                      ry="20"
                      transform="rotate(35 92 83)"
                    />
                  </g>
                  <path d="M67 104h46l-7 36H74Z" fill="#d8c0a5" />
                  <path d="M67 104h46" stroke="#b39a7d" strokeWidth="3" />
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
