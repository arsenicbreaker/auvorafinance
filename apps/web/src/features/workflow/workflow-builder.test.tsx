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
import { journalKey } from "../../lib/transaction-journal";

vi.mock("../../lib/near-rpc", () => ({
  readRecipientAllowed: vi.fn(),
  readTransactionFinality: vi.fn(),
  readWorkflowStorageCost: vi.fn(),
}));
const signFunctionCall = vi.fn();
const onWorkflowSubmitted = vi.fn();

beforeEach(() => {
  localStorage.clear();
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
  it("recovers recipient authorization without carrying over approval of a workflow", async () => {
    localStorage.setItem(
      journalKey({
        accountId: "owner.testnet",
        contractId: "treasury.testnet",
        rpcUrl: "https://rpc.testnet.near.org",
        channel: "builder",
      }),
      JSON.stringify({
        version: 1,
        hash: "authorization-hash",
        sender: "owner.testnet",
        action: "Recipient authorization",
      }),
    );
    const create = await reviewWorkflowForRecovery();
    expect(create).toHaveProperty("disabled", true);
    vi.mocked(readTransactionFinality).mockResolvedValue("success");
    fireEvent.click(
      screen.getByRole("button", { name: "Check transaction status" }),
    );
    await screen.findByText(/Transaction finalized/);
    expect(signFunctionCall).not.toHaveBeenCalled();
    expect(onWorkflowSubmitted).not.toHaveBeenCalled();
    expect(readTransactionFinality).toHaveBeenLastCalledWith(
      "https://rpc.testnet.near.org",
      "authorization-hash",
      "owner.testnet",
      "treasury.testnet",
    );
  });

  it("retains the hash and warns if storage stops accepting writes after signing", async () => {
    vi.mocked(readTransactionFinality).mockResolvedValue("pending");
    signFunctionCall.mockImplementationOnce(async () => {
      const storage = window.localStorage;
      vi.spyOn(window, "localStorage", "get").mockReturnValue({
        length: storage.length,
        clear: storage.clear.bind(storage),
        key: storage.key.bind(storage),
        getItem: storage.getItem.bind(storage),
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: storage.removeItem.bind(storage),
      } as Storage);
      return "creation-hash";
    });
    fireEvent.click(await reviewWorkflow());
    await screen.findByText(/submitted hash could not be saved/);
    expect(
      screen.getByRole("button", { name: "Create payment schedule" }),
    ).toHaveProperty("disabled", true);
    expect(
      screen
        .getByRole("link", { name: "Inspect on NearBlocks" })
        .getAttribute("href"),
    ).toContain("creation-hash");
    vi.restoreAllMocks();
  });
  it("recovers an unresolved creation after remount without restoring approval or signing again", async () => {
    vi.mocked(readTransactionFinality).mockResolvedValueOnce("pending");
    fireEvent.click(await reviewWorkflow());
    await screen.findByRole("button", { name: "Check transaction status" });
    cleanup();
    render(
      <WorkflowBuilder
        contractId="treasury.testnet"
        rpcUrl="https://rpc.testnet.near.org"
        walletSession={{ accountId: "owner.testnet", signFunctionCall }}
        onWorkflowSubmitted={onWorkflowSubmitted}
      />,
    );
    expect(
      await screen.findByText(/Recovered a submitted transaction/),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Create payment schedule" }),
    ).toBeNull();
    expect(
      screen
        .getByRole("link", { name: "Inspect on NearBlocks" })
        .getAttribute("href"),
    ).toContain("creation-hash");
    expect(readTransactionFinality).toHaveBeenCalledTimes(1);
    vi.mocked(readTransactionFinality).mockResolvedValueOnce("success");
    fireEvent.click(
      screen.getByRole("button", { name: "Check transaction status" }),
    );
    await waitFor(() => expect(onWorkflowSubmitted).toHaveBeenCalledTimes(1));
    expect(signFunctionCall).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("link", { name: "Inspect on NearBlocks" })
        .getAttribute("href"),
    ).toContain("creation-hash");
    cleanup();
    render(
      <WorkflowBuilder
        contractId="treasury.testnet"
        rpcUrl="https://rpc.testnet.near.org"
        walletSession={{ accountId: "owner.testnet", signFunctionCall }}
      />,
    );
    expect(screen.queryByText(/Recovered a submitted transaction/)).toBeNull();
  });

  it("keeps recovered creation locked when the RPC remains unavailable", async () => {
    vi.mocked(readTransactionFinality).mockResolvedValueOnce("pending");
    fireEvent.click(await reviewWorkflow());
    await screen.findByRole("button", { name: "Check transaction status" });
    cleanup();
    const create = await reviewWorkflowForRecovery();
    expect(create).toHaveProperty("disabled", true);
    vi.mocked(readTransactionFinality).mockRejectedValueOnce(
      new Error("offline"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check transaction status" }),
    );
    await screen.findByText(/finality check is unavailable/);
    expect(create).toHaveProperty("disabled", true);
    expect(signFunctionCall).toHaveBeenCalledTimes(1);
  });
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

async function reviewWorkflowForRecovery() {
  render(
    <WorkflowBuilder
      contractId="treasury.testnet"
      rpcUrl="https://rpc.testnet.near.org"
      walletSession={{ accountId: "owner.testnet", signFunctionCall }}
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
  return screen.findByRole("button", { name: "Create payment schedule" });
}
