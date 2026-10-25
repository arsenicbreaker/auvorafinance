import { describe, expect, it } from "vitest";

import { nearblocksTransactionUrl, parseExecutionEvents } from "./index.js";

describe("execution event parsing", () => {
  it("parses only valid Auvora execution events", () => {
    const events = parseExecutionEvents([
      "unrelated log",
      'EVENT_JSON:{"standard":"auvora","version":"1.0.0","event":"execution_skipped","data":[{"workflow_id":4,"run_index":1,"scheduled_for_ms":1800000000000,"amount":"10","reason_code":"RESERVE_GUARD"}]}',
      "EVENT_JSON:not-json",
    ]);
    expect(events).toEqual([
      {
        event: "execution_skipped",
        workflowId: 4,
        runIndex: 1,
        scheduledForMs: 1_800_000_000_000,
        amountYocto: "10",
        reasonCode: "RESERVE_GUARD",
      },
    ]);
  });

  it("builds only validated testnet explorer links", () => {
    const hash = "11111111111111111111111111111111";
    expect(nearblocksTransactionUrl(hash)).toBe(
      `https://testnet.nearblocks.io/txns/${hash}`,
    );
    expect(() => nearblocksTransactionUrl("bad/hash")).toThrow(
      "INVALID_TRANSACTION_HASH",
    );
  });
});
