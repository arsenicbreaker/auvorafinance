// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as wallet from "@fastnear/wallet";
import { readOwnerWorkflows } from "../../lib/near-rpc";
import { SponsoredManagement } from "./sponsored-management";
import { payloadDigest } from "../../lib/sponsored-management";

vi.mock("@fastnear/wallet", () => ({
  connect: vi.fn(),
  accountId: vi.fn(),
  getActiveNetwork: vi.fn(),
  signDelegateActions: vi.fn(),
}));
vi.mock("../../lib/near-rpc", () => ({ readOwnerWorkflows: vi.fn() }));
const key = `auvora.sponsored.v1:${JSON.stringify(["testnet", "http://127.0.0.1:3002", "treasury.testnet", "owner.testnet"])}`;
const changed = vi.fn();
const fetcher = vi.fn<typeof fetch>();
function open() {
  return render(
    <SponsoredManagement
      ownerId="owner.testnet"
      contractId="treasury.testnet"
      rpcUrl="https://test.rpc.fastnear.com"
      serviceUrl="http://127.0.0.1:3002"
      onChanged={changed}
    />,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("fetch", fetcher);
  vi.mocked(wallet.connect).mockResolvedValue({
    accountId: "owner.testnet",
    network: "testnet",
  });
  vi.mocked(wallet.accountId).mockReturnValue("owner.testnet");
  vi.mocked(wallet.getActiveNetwork).mockReturnValue("testnet");
  vi.mocked(wallet.signDelegateActions).mockResolvedValue({
    signedDelegateActions: ["YWJj"],
  });
  vi.mocked(readOwnerWorkflows).mockResolvedValue([
    {
      id: 7,
      owner_id: "owner.testnet",
      recipient_id: "recipient.testnet",
      amount: "1",
      max_per_run: "1",
      min_reserve: "1",
      interval_ms: 60000,
      next_run_at_ms: 1,
      max_runs: 2,
      runs_completed: 0,
      available_balance: "3",
      withdrawable: "0",
      state: "Active",
      config_hash: "x",
      created_at_ms: 1,
      pending_execution: null,
    },
  ]);
  fetcher.mockImplementation(async () =>
    Response.json({ network: "testnet", contractId: "treasury.testnet" }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function connect() {
  open();
  fireEvent.click(
    screen.getByRole("button", { name: "Connect sponsored management" }),
  );
  await screen.findByText(/Delegate signing connected/);
  fireEvent.change(screen.getByLabelText("Workflow for sponsored action"), {
    target: { value: "7" },
  });
}

describe("sponsored controls", () => {
  it("requests the required capabilities and refuses a different account", async () => {
    vi.mocked(wallet.connect).mockResolvedValue({
      accountId: "other.testnet",
      network: "testnet",
    });
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect sponsored management" }),
    );
    await screen.findByText(/Connect owner.testnet on testnet/);
    expect(wallet.connect).toHaveBeenCalledWith({
      network: "testnet",
      features: { signDelegateActions: true, signDelegateActionsWithTtl: true },
    });
    expect(wallet.signDelegateActions).not.toHaveBeenCalled();
  });
  it("persists before posting and reconciles after remount without signing again", async () => {
    const digest = await payloadDigest("YWJj");
    const response = {
      digest,
      sender: "owner.testnet",
      workflow: 7,
      method: "pause_workflow",
      hash: "1".repeat(44),
      state: "Pending",
      relayer: "relayer.testnet",
      contractId: "treasury.testnet",
      network: "testnet",
    };
    await connect();
    fetcher.mockImplementation(async (_url, init) => {
      if (init?.method === "POST")
        expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({
          payload: "YWJj",
          digest,
        });
      return Response.json(response);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Sign sponsored action" }),
    );
    await screen.findByText(/Submitted. Check this same request/);
    expect(wallet.signDelegateActions).toHaveBeenCalledTimes(1);
    cleanup();
    open();
    fetcher.mockResolvedValue(
      Response.json({ ...response, state: "Succeeded" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check sponsored request" }),
    );
    await screen.findByText(/Sponsored action finalized/);
    expect(wallet.signDelegateActions).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(key)).toBeNull();
    expect(changed).toHaveBeenCalledOnce();
  });
  it("keeps an unanswered signing request after reload", async () => {
    vi.mocked(wallet.signDelegateActions).mockImplementation(
      () => new Promise(() => {}),
    );
    await connect();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign sponsored action" }),
    );
    await waitFor(() => expect(localStorage.getItem(key)).not.toBeNull());
    cleanup();
    open();
    expect(screen.getByText(/No signed delegate was saved/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Sign sponsored action" }),
    ).toBeNull();
    expect(wallet.signDelegateActions).toHaveBeenCalledOnce();
  });
  it("does not enable a withdrawal against fully locked funds", async () => {
    await connect();
    fireEvent.change(screen.getByLabelText("Sponsored action"), {
      target: { value: "withdraw_available" },
    });
    expect(
      screen.getByRole("button", { name: "Sign sponsored action" }),
    ).toHaveProperty("disabled", true);
    expect(wallet.signDelegateActions).not.toHaveBeenCalled();
  });
  it("explains when the owner has no eligible sponsored action", async () => {
    vi.mocked(readOwnerWorkflows).mockResolvedValue([
      {
        id: 8,
        owner_id: "owner.testnet",
        recipient_id: "recipient.testnet",
        amount: "1",
        max_per_run: "1",
        min_reserve: "1",
        interval_ms: 60000,
        next_run_at_ms: 1,
        max_runs: 2,
        runs_completed: 2,
        available_balance: "0",
        withdrawable: "0",
        state: "Completed",
        config_hash: "x",
        created_at_ms: 1,
        pending_execution: null,
      },
    ]);
    open();
    fireEvent.click(
      screen.getByRole("button", { name: "Connect sponsored management" }),
    );
    await screen.findByText(/every workflow is completed or cancelled/);
    expect(
      screen.getByRole("button", { name: "Sign sponsored action" }),
    ).toHaveProperty("disabled", true);
  });
});
