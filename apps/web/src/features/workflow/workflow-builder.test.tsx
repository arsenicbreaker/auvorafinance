// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readRecipientAllowed,
  readTransactionFinality,
  readWorkflowStorageCost,
} from "../../lib/near-rpc";
import { WorkflowBuilder } from "./workflow-builder";

vi.mock("../../lib/near-rpc", () => ({
  readRecipientAllowed: vi.fn(),
  readTransactionFinality: vi.fn(),
  readWorkflowStorageCost: vi.fn(),
}));
const signFunctionCall = vi.fn();
const onWorkflowSubmitted = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readRecipientAllowed).mockResolvedValue(true);
  vi.mocked(readWorkflowStorageCost).mockResolvedValue(1000n);
  signFunctionCall.mockResolvedValue("creation-hash");
});
afterEach(cleanup);

async function reviewWorkflow() {
  render(
    <WorkflowBuilder
      contractId="treasury.testnet"
      rpcUrl="https://rpc.testnet.near.org"
      walletSession={{ accountId: "owner.testnet", signFunctionCall }}
      onWorkflowSubmitted={onWorkflowSubmitted}
    />,
  );
  fireEvent.change(screen.getByLabelText("Recipient account"), {
    target: { value: "recipient.testnet" },
  });
  fireEvent.change(screen.getByLabelText("First run (UTC)"), {
    target: {
      value: new Date(Date.now() + 3600000).toISOString().slice(0, 16),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review payment" }));
  const create = await screen.findByRole("button", {
    name: "Create payment schedule",
  });
  await waitFor(() => expect(create).toHaveProperty("disabled", false));
  return create;
}

describe("workflow creation finality", () => {
  it("keeps an unknown creation blocked until the original hash is finalized", async () => {
    vi.mocked(readTransactionFinality)
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce("success");
    fireEvent.click(await reviewWorkflow());
    const recheck = await screen.findByRole("button", {
      name: "Check transaction status",
    });
    expect(
      screen.getByRole("button", { name: "Create payment schedule" }),
    ).toHaveProperty("disabled", true);
    expect(onWorkflowSubmitted).not.toHaveBeenCalled();
    expect(screen.queryByText(/Transaction finalized/)).toBeNull();
    fireEvent.click(recheck);
    await waitFor(() => expect(onWorkflowSubmitted).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Transaction finalized/)).toBeTruthy();
    expect(signFunctionCall).toHaveBeenCalledTimes(1);
    expect(readTransactionFinality).toHaveBeenLastCalledWith(
      "https://rpc.testnet.near.org",
      "creation-hash",
      "owner.testnet",
      "treasury.testnet",
    );
  });

  it("does not announce creation after wallet rejection", async () => {
    signFunctionCall.mockRejectedValue(new Error("User rejected"));
    fireEvent.click(await reviewWorkflow());
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "User rejected",
    );
    expect(onWorkflowSubmitted).not.toHaveBeenCalled();
    expect(readTransactionFinality).not.toHaveBeenCalled();
  });

  it("keeps a failed creation hash available for inspection", async () => {
    vi.mocked(readTransactionFinality).mockResolvedValue("failure");
    fireEvent.click(await reviewWorkflow());
    expect(
      await screen.findByText(/Transaction failed at finality/),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Inspect on NearBlocks" })
        .getAttribute("href"),
    ).toContain("creation-hash");
    expect(onWorkflowSubmitted).not.toHaveBeenCalled();
  });
});
