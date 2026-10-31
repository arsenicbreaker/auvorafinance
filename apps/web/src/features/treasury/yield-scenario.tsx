"use client";

import { useState } from "react";
import { formatNear, parseNear } from "@auvora/domain";
import {
  parseApyBasisPoints,
  simulateAnnualYield,
} from "@auvora/domain/treasury";

export function YieldScenario({
  uncommitted,
  blocked,
}: {
  uncommitted: bigint;
  blocked: boolean;
}) {
  const [principal, setPrincipal] = useState("0");
  const [apy, setApy] = useState("0");
  let error = "";
  let scenario: ReturnType<typeof simulateAnnualYield> | null = null;
  if (!blocked) {
    try {
      const amount = parseNear(principal);
      if (amount > uncommitted)
        throw new Error(
          "Keep the simulation principal within the uncommitted funds shown above.",
        );
      scenario = simulateAnnualYield(
        amount,
        uncommitted,
        parseApyBasisPoints(apy),
      );
    } catch (cause) {
      error =
        cause instanceof Error &&
        cause.message.startsWith("Keep the simulation")
          ? cause.message
          : "Enter a nonnegative NEAR amount and an assumed APY from 0 to 100, with at most two decimal places.";
    }
  }
  return (
    <details className="yield-scenario">
      <summary>Model a hypothetical one-year return</summary>
      <div className="yield-body">
        <p className="simulation-notice">
          Simulation only. No provider is connected and no deposit, staking, or
          lending action is available.
        </p>
        {blocked ? (
          <p role="status">
            Wait for pending transfers to resolve before modeling a return.
          </p>
        ) : (
          <>
            <div className="outlook-assumptions">
              <label>
                Simulation principal (NEAR)
                <input
                  value={principal}
                  inputMode="decimal"
                  onChange={(event) => setPrincipal(event.target.value)}
                />
              </label>
              <label>
                Assumed APY (%)
                <input
                  value={apy}
                  inputMode="decimal"
                  onChange={(event) => setApy(event.target.value)}
                />
              </label>
            </div>
            <p className="outlook-note">
              Principal limit: {formatNear(uncommitted)} NEAR after all approved
              obligations, reserves, and fee buffers. The rate is your
              assumption, not a market quote.
            </p>
            {error ? (
              <p className="outlook-error" role="alert">
                {error}
              </p>
            ) : null}
            {scenario ? (
              <dl className="outlook-metrics" aria-live="polite">
                <div>
                  <dt>Hypothetical one-year gain</dt>
                  <dd>{formatNear(scenario.hypotheticalGain)} NEAR</dd>
                </div>
                <div>
                  <dt>Hypothetical ending amount</dt>
                  <dd>{formatNear(scenario.hypotheticalEndingBalance)} NEAR</dd>
                </div>
              </dl>
            ) : null}
            <p className="outlook-note">
              These amounts are not on-chain balances or guaranteed returns.
              Rates may change; strategies may lose value or restrict
              withdrawals. Gains are rounded down to whole yoctoNEAR.
            </p>
          </>
        )}
      </div>
    </details>
  );
}
