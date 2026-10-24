import { describe, expect, it } from "vitest";

import { classifyFinalExecution } from "./near-rpc";

describe("classifyFinalExecution", () => {
  it("does not claim success before finality", () => {
    expect(classifyFinalExecution({ final_execution_status: "EXECUTED" })).toBe(
      "pending",
    );
  });

  it("reports a finalized failure", () => {
    expect(
      classifyFinalExecution({
        final_execution_status: "FINAL",
        status: { Failure: { error_message: "denied" } },
      }),
    ).toBe("failure");
  });

  it("reports success only after finality", () => {
    expect(
      classifyFinalExecution({
        final_execution_status: "FINAL",
        status: { SuccessValue: "" },
      }),
    ).toBe("success");
  });
});
