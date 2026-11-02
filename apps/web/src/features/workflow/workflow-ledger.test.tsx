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
  readOwnerWorkflows,
  readTransactionFinality,
  type WorkflowView,
} from "../../lib/near-rpc";
import { WorkflowLedger } from "./workflow-ledger";
import { journalKey } from "../../lib/transaction-journal";

vi.mock("../../lib/near-rpc", () => ({
  readOwnerWorkflows: vi.fn(),
  readTransactionFinality: vi.fn(),
}));

const workflow: WorkflowView = {
  id: 7,
  owner_id: "owner.testnet",
  recipient_id: "recipient.testnet",
  amount: "1000000000000000000000",
  max_per_run: "1000000000000000000000",
  min_reserve: "2000000000000000000000",
  interval_ms: 60000,
  next_run_at_ms: 1793404800000,
  max_runs: 2,
  runs_completed: 0,
  available_balance: "5000000000000000000000",
  withdrawable: "1000000000000000000000",
  state: "Active",
  config_hash: "test",
  created_at_ms: 1793404700000,
  pending_execution: null,
};
const signFunctionCall = vi.fn();

beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(readOwnerWorkflows).mockResolvedValue([workflow]);
  signFunctionCall.mockResolvedValue("original-hash");
});
afterEach(cleanup);

async function openLedger() {
  render(
    <WorkflowLedger
      contractId="treasury.testnet"
      rpcUrl="https://rpc.testnet.near.org"
      refreshToken={0}
      walletSession={{ accountId: "owner.testnet", signFunctionCall }}
    />,
  );
  return screen.findByRole("button", { name: "Pause future runs" });
}

describe("owner transaction outcomes", () => {
  it("persists an unanswered wallet request across remount and recovers a late hash", async () => {
    let resolveWallet!: (hash: string) => void;
    signFunctionCall.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveWallet = resolve;
        }),
    );
    vi.mocked(readTransactionFinality).mockResolvedValue("pending");
    fireEvent.click(await openLedger());
    await screen.findByText(/outcome is unknown/);
    cleanup();
    expect(await openLedger()).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Pause future runs" }));
    expect(signFunctionCall).toHaveBeenCalledTimes(1);
    resolveWallet("late-hash");
    await screen.findByRole("button", { name: "Check transaction status" });
    expect(
      screen
        .getByRole("link", { name: "Inspect transaction" })
        .getAttribute("href"),
    ).toContain("late-hash");
    expect(signFunctionCall).toHaveBeenCalledTimes(1);
  });

  it("keeps an ambiguous wallet error blocked after remount until reviewed", async () => {
    signFunctionCall.mockRejectedValue(new Error("Wallet connection lost"));
    fireEvent.click(await openLedger());
    await screen.findByRole("alert");
    cleanup();
    expect(await openLedger()).toHaveProperty("disabled", true);
    fireEvent.click(
      screen.getByRole("button", {
        name: "I checked wallet activity; no transaction is pending",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Pause future runs" }),
    ).toHaveProperty("disabled", false);
    expect(signFunctionCall).toHaveBeenCalledTimes(1);
  });

  it("allows another reviewed request after explicit wallet rejection", async () => {
    signFunctionCall.mockRejectedValue(new Error("User cancelled the action"));
    fireEvent.click(await openLedger());
    await screen.findByRole("alert");
    cleanup();
    expect(await openLedger()).toHaveProperty("disabled", false);
  });

  it("never opens the wallet to withdraw a fully locked balance", async () => {
    vi.mocked(readOwnerWorkflows).mockResolvedValue([
      { ...workflow, withdrawable: "0" },
    ]);
    await openLedger();
    const withdraw = screen.getByRole("button", {
      name: "Withdraw available funds",
    });
    expect(withdraw).toHaveProperty("disabled", true);
    fireEvent.click(withdraw);
    expect(signFunctionCall).not.toHaveBeenCalled();
  });

  it("submits only the contract-reported withdrawable amount", async () => {
    vi.mocked(readTransactionFinality).mockResolvedValue("success");
    await openLedger();
    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw available funds" }),
    );
    await screen.findByText(/finalized on NEAR testnet/);
    expect(signFunctionCall).toHaveBeenCalledWith({
      methodName: "withdraw_available",
      args: { workflow_id: 7, amount: workflow.withdrawable },
      deposit: 0n,
    });
  });

  it.each(["pause", "resume", "cancel", "withdraw"] as const)(
    "reconciles a saved %s without signing",
    async (kind) => {
      localStorage.setItem(
        journalKey({
          accountId: "owner.testnet",
          contractId: "treasury.testnet",
          rpcUrl: "https://rpc.testnet.near.org",
          channel: "ledger",
        }),
        JSON.stringify({
          version: 1,
          hash: "saved-hash",
          sender: "owner.testnet",
          action: kind,
          workflowId: 7,
        }),
      );
      const pause = await openLedger();
      expect(pause).toHaveProperty("disabled", true);
      vi.mocked(readTransactionFinality).mockResolvedValue("success");
      fireEvent.click(
        screen.getByRole("button", { name: "Check transaction status" }),
      );
      await screen.findByText(new RegExp("finalized on NEAR testnet"));
      expect(signFunctionCall).not.toHaveBeenCalled();
      expect(readTransactionFinality).toHaveBeenCalledWith(
        "https://rpc.testnet.near.org",
        "saved-hash",
        "owner.testnet",
        "treasury.testnet",
      );
    },
  );

  it("blocks owner actions and explains corrupt recovery data", async () => {
    localStorage.setItem(
      journalKey({
        accountId: "owner.testnet",
        contractId: "treasury.testnet",
        rpcUrl: "https://rpc.testnet.near.org",
        channel: "ledger",
      }),
      "{",
    );
    expect(await openLedger()).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toContain(
      "saved transaction record could not be read",
    );
    expect(signFunctionCall).not.toHaveBeenCalled();
  });
  it.each(["success", "failure"] as const)(
    "recovers a pause after remount and clears only after final %s",
    async (outcome) => {
      vi.mocked(readTransactionFinality).mockResolvedValueOnce("pending");
      fireEvent.click(await openLedger());
      await screen.findByRole("button", { name: "Check transaction status" });
      cleanup();
      const pause = await openLedger();
      expect(pause).toHaveProperty("disabled", true);
      expect(
        screen.getByText(/Recovered a submitted transaction/),
      ).toBeTruthy();
      expect(readTransactionFinality).toHaveBeenCalledTimes(1);
      vi.mocked(readTransactionFinality).mockResolvedValueOnce(outcome);
      fireEvent.click(
        screen.getByRole("button", { name: "Check transaction status" }),
      );
      if (outcome === "success")
        await screen.findByText("Pause finalized on NEAR testnet.");
      else await screen.findByText(/Pause failed at finality/);
      expect(signFunctionCall).toHaveBeenCalledTimes(1);
      expect(readTransactionFinality).toHaveBeenLastCalledWith(
        "https://rpc.testnet.near.org",
        "original-hash",
        "owner.testnet",
        "treasury.testnet",
      );
      expect(
        screen
          .getByRole("link", { name: "Inspect transaction" })
          .getAttribute("href"),
      ).toContain("original-hash");
      cleanup();
      const restoredPause = await openLedger();
      expect(restoredPause).toHaveProperty("disabled", false);
      expect(
        screen.queryByText(/Recovered a submitted transaction/),
      ).toBeNull();
    },
  );
  it.each([new Error("User rejected the request"), new Error("Wallet closed")])(
    "never shows success after wallet rejection or abandonment: %s",
    async (error) => {
      signFunctionCall.mockRejectedValue(error);
      fireEvent.click(await openLedger());
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        error.message,
      );
      expect(readTransactionFinality).not.toHaveBeenCalled();
      expect(screen.queryByText(/finalized on NEAR testnet/)).toBeNull();
    },
  );

  it("does not treat a missing wallet hash as success", async () => {
    signFunctionCall.mockResolvedValue(undefined);
    fireEvent.click(await openLedger());
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "WALLET_TRANSACTION_HASH_MISSING",
    );
    expect(readTransactionFinality).not.toHaveBeenCalled();
  });

  it.each(["pending", "unavailable"])(
    "keeps %s transactions and rechecks the same hash without signing again",
    async (mode) => {
      if (mode === "pending")
        vi.mocked(readTransactionFinality).mockResolvedValueOnce("pending");
      else
        vi.mocked(readTransactionFinality).mockRejectedValueOnce(
          new Error("RPC unavailable"),
        );
      const pause = await openLedger();
      fireEvent.click(pause);
      const recheck = await screen.findByRole("button", {
        name: "Check transaction status",
      });
      expect(pause).toHaveProperty("disabled", true);
      expect(screen.queryByText(/finalized on NEAR testnet/)).toBeNull();
      expect(
        screen
          .getByRole("link", { name: "Inspect transaction" })
          .getAttribute("href"),
      ).toContain("original-hash");

      fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
      await waitFor(() => expect(screen.queryByText("Refreshing")).toBeNull());
      expect(
        screen.getByRole("button", { name: "Pause future runs" }),
      ).toHaveProperty("disabled", true);
      expect(
        screen
          .getByRole("link", { name: "Inspect transaction" })
          .getAttribute("href"),
      ).toContain("original-hash");

      vi.mocked(readTransactionFinality).mockResolvedValueOnce("success");
      fireEvent.click(recheck);
      expect(
        await screen.findByText("Pause finalized on NEAR testnet."),
      ).toBeTruthy();
      expect(signFunctionCall).toHaveBeenCalledTimes(1);
      expect(readTransactionFinality).toHaveBeenLastCalledWith(
        "https://rpc.testnet.near.org",
        "original-hash",
        "owner.testnet",
        "treasury.testnet",
      );
    },
  );

  it("shows a finalized failure with the original hash", async () => {
    vi.mocked(readTransactionFinality).mockResolvedValue("failure");
    fireEvent.click(await openLedger());
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("failed at finality"),
    );
    expect(
      screen
        .getByRole("link", { name: "Inspect transaction" })
        .getAttribute("href"),
    ).toContain("original-hash");
    expect(screen.queryByText(/finalized on NEAR testnet/)).toBeNull();
  });
});
