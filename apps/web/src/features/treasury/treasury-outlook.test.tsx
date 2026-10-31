// @vitest-environment happy-dom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseNear } from "@auvora/domain";
import {
  readOwnerWorkflowSnapshot,
  type OwnerWorkflowSnapshot,
} from "../../lib/near-rpc";
import { TreasuryOutlook } from "./treasury-outlook";

vi.mock("../../lib/near-rpc", () => ({ readOwnerWorkflowSnapshot: vi.fn() }));
const NOW = 1_800_000_000_000;
const snapshot: OwnerWorkflowSnapshot = {
  ownerId: "owner.testnet",
  blockHash: "final-block",
  blockHeight: 1234,
  timestampMs: NOW,
  workflows: [
    {
      id: 1,
      owner_id: "owner.testnet",
      recipient_id: "recipient.testnet",
      state: "Active",
      amount: parseNear("10").toString(),
      min_reserve: parseNear("30").toString(),
      available_balance: parseNear("100").toString(),
      max_runs: 2,
      runs_completed: 0,
      interval_ms: 86400000,
      next_run_at_ms: NOW,
      pending_execution: null,
      max_per_run: parseNear("10").toString(),
      config_hash: "fixture",
      created_at_ms: NOW,
      withdrawable: parseNear("50").toString(),
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readOwnerWorkflowSnapshot).mockResolvedValue(snapshot);
});
afterEach(cleanup);

function openOutlook() {
  return render(
    <TreasuryOutlook
      contractId="treasury.testnet"
      rpcUrl="https://rpc.testnet.near.org"
      initialOwnerId="owner.testnet"
    />,
  );
}
async function loadOutlook() {
  const view = openOutlook();
  fireEvent.click(
    screen.getByRole("button", { name: "Read finalized balances" }),
  );
  await screen.findByText("Final block 1234", { exact: false });
  return view;
}
function metric(label: string) {
  return screen
    .getByText(label, { selector: "dt" })
    .parentElement?.querySelector("dd")?.textContent;
}

describe("treasury planning", () => {
  it("starts without fabricated balances and only reads after an explicit request", () => {
    openOutlook();
    expect(screen.getByText(/No example funds are included/)).toBeTruthy();
    expect(readOwnerWorkflowSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Simulation principal (NEAR)")).toBeNull();
  });

  it("shows finalized balances separately from hypothetical returns", async () => {
    await loadOutlook();
    expect(readOwnerWorkflowSnapshot).toHaveBeenCalledWith(
      "https://rpc.testnet.near.org",
      "treasury.testnet",
      "owner.testnet",
    );
    expect(metric("On-chain available ledgers")).toBe("100 NEAR");
    expect(metric("All approved future payments")).toBe("20 NEAR");
    expect(metric("Protected minimum reserves")).toBe("30 NEAR");
    fireEvent.click(screen.getByText("Model a hypothetical one-year return"));
    fireEvent.change(screen.getByLabelText("Simulation principal (NEAR)"), {
      target: { value: "40" },
    });
    fireEvent.change(screen.getByLabelText("Assumed APY (%)"), {
      target: { value: "2.35" },
    });
    expect(metric("Hypothetical one-year gain")).toBe("0.94 NEAR");
    expect(metric("Hypothetical ending amount")).toBe("40.94 NEAR");
    expect(metric("On-chain available ledgers")).toBe("100 NEAR");
    expect(readOwnerWorkflowSnapshot).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: /deposit|stake|lend|sign/i }),
    ).toBeNull();
  });

  it("rejects a principal that would consume obligations or reserves", async () => {
    await loadOutlook();
    fireEvent.click(screen.getByText("Model a hypothetical one-year return"));
    fireEvent.change(screen.getByLabelText("Simulation principal (NEAR)"), {
      target: { value: "50.000000000000000000000001" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "within the uncommitted funds",
    );
    expect(screen.queryByText("Hypothetical one-year gain")).toBeNull();
  });

  it("recalculates editable fee assumptions without changing on-chain balances", async () => {
    await loadOutlook();
    fireEvent.change(
      screen.getByLabelText("Planning fee buffer (NEAR per run)"),
      { target: { value: "1" } },
    );
    expect(metric("Assumed fees for remaining runs")).toBe("2 NEAR");
    expect(screen.getByText("48 NEAR", { selector: "strong" })).toBeTruthy();
    expect(metric("On-chain available ledgers")).toBe("100 NEAR");
    fireEvent.change(
      screen.getByLabelText("Planning fee buffer (NEAR per run)"),
      { target: { value: "1e3" } },
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "cannot be calculated",
    );
    expect(screen.queryByText("Hypothetical one-year gain")).toBeNull();
  });

  it("changes the horizon without releasing longer-term obligations", async () => {
    const original = snapshot.workflows[0]!;
    vi.mocked(readOwnerWorkflowSnapshot).mockResolvedValue({
      ...snapshot,
      workflows: [{ ...original, next_run_at_ms: NOW + 15 * 86400000 }],
    });
    await loadOutlook();
    expect(
      screen.getByText(/Within 30 days: 20 NEAR across 2 possible runs/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Forecast horizon"), {
      target: { value: "7" },
    });
    expect(
      screen.getByText(/Within 7 days: 0 NEAR across 0 possible runs/),
    ).toBeTruthy();
    expect(metric("All approved future payments")).toBe("20 NEAR");
    expect(screen.getByText("50 NEAR", { selector: "strong" })).toBeTruthy();
  });

  it("blocks yield and aggregate timing while a payment is unresolved", async () => {
    const original = snapshot.workflows[0]!;
    vi.mocked(readOwnerWorkflowSnapshot).mockResolvedValue({
      ...snapshot,
      workflows: [
        {
          ...original,
          available_balance: parseNear("90").toString(),
          pending_execution: {
            amount: original.amount,
            run_index: 0,
            scheduled_for_ms: NOW,
            dispatched_at_ms: NOW,
          },
        },
      ],
    });
    await loadOutlook();
    expect(screen.getByText(/schedule unresolved/)).toBeTruthy();
    expect(
      screen.getByText(/totaling 10 NEAR, excluded from available/),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Model a hypothetical one-year return"));
    expect(screen.getByText(/Wait for pending transfers/)).toBeTruthy();
    expect(screen.queryByLabelText("Simulation principal (NEAR)")).toBeNull();
  });

  it("provides error recovery and a genuine empty state", async () => {
    vi.mocked(readOwnerWorkflowSnapshot)
      .mockRejectedValueOnce(new Error("RPC_HTTP_503"))
      .mockResolvedValueOnce({ ...snapshot, workflows: [] });
    openOutlook();
    fireEvent.click(
      screen.getByRole("button", { name: "Read finalized balances" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Finalized balances could not be verified",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Read finalized balances" }),
    );
    expect(
      await screen.findByText(/No workflows found for this owner/),
    ).toBeTruthy();
    expect(metric("On-chain available ledgers")).toBe("0 NEAR");
  });

  it("ignores stale RPC results after the inspected owner changes", async () => {
    let resolveSnapshot!: (value: OwnerWorkflowSnapshot) => void;
    vi.mocked(readOwnerWorkflowSnapshot).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    openOutlook();
    fireEvent.click(
      screen.getByRole("button", { name: "Read finalized balances" }),
    );
    expect(screen.getByText(/Loading one finalized block/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Read-only owner account"), {
      target: { value: "other.testnet" },
    });
    resolveSnapshot(snapshot);
    await waitFor(() =>
      expect(screen.queryByText("On-chain available ledgers")).toBeNull(),
    );
    expect(screen.getByLabelText("Read-only owner account")).toHaveProperty(
      "value",
      "other.testnet",
    );
  });
});
