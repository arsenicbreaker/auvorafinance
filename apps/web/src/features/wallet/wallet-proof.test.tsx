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
  readContractStatus,
  readTransactionFinality,
} from "../../lib/near-rpc";
import { WalletProof } from "./wallet-proof";

const { signAndSendTransaction, hideModal, unsubscribe } = vi.hoisted(() => ({
  signAndSendTransaction: vi.fn(),
  hideModal: vi.fn(),
  unsubscribe: vi.fn(function (this: { closed: boolean }) {
    this.closed = true;
  }),
}));
vi.mock("@near-wallet-selector/core", () => ({
  setupWalletSelector: vi.fn().mockResolvedValue({
    wallet: async () => ({ signAndSendTransaction }),
    store: {
      getState: () => ({ accounts: [{ accountId: "owner.testnet" }] }),
      observable: { subscribe: () => ({ closed: false, unsubscribe }) },
    },
  }),
}));
vi.mock("@near-wallet-selector/modal-ui", () => ({
  setupModal: () => ({ show: () => {}, hide: hideModal }),
}));
vi.mock("@near-wallet-selector/meteor-wallet", () => ({
  setupMeteorWallet: () => ({}),
}));
vi.mock("@near-wallet-selector/my-near-wallet", () => ({
  setupMyNearWallet: () => ({}),
}));
vi.mock("../../lib/near-rpc", () => ({
  readContractStatus: vi.fn(),
  readTransactionFinality: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  signAndSendTransaction.mockReset();
  vi.mocked(readTransactionFinality).mockReset();
  vi.mocked(readContractStatus).mockResolvedValue({
    owner_id: "owner.testnet",
    status: "phase-2-ready",
    last_keeper: null,
  });
});
afterEach(cleanup);

async function openProof() {
  render(
    <WalletProof
      contractId="treasury.testnet"
      rpcUrl="https://rpc.testnet.near.org"
    />,
  );
  fireEvent.click(screen.getByText("Contract connection details"));
  const proof = screen.getByRole("button", {
    name: "Sign test proof",
    hidden: true,
  });
  await waitFor(() => expect(proof).toHaveProperty("disabled", false));
  return proof;
}

describe("wallet proof outcomes", () => {
  it("unsubscribes with the original subscription as its receiver", async () => {
    const view = render(
      <WalletProof
        contractId="treasury.testnet"
        rpcUrl="https://rpc.testnet.near.org"
      />,
    );
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
    expect(() => view.unmount()).not.toThrow();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(unsubscribe.mock.contexts[0]).toHaveProperty("closed", true);
  });

  it("closes the wallet selector with Escape and removes the listener on unmount", async () => {
    const view = render(
      <WalletProof
        contractId="treasury.testnet"
        rpcUrl="https://rpc.testnet.near.org"
      />,
    );
    await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(hideModal).toHaveBeenCalledTimes(1);
    view.unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(hideModal).toHaveBeenCalledTimes(1);
  });

  it("leaves the waiting state when the wallet returns no transaction hash", async () => {
    signAndSendTransaction.mockResolvedValue(undefined);
    fireEvent.click(await openProof());
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("No proof has been confirmed"),
    );
    expect(
      screen.getByRole("button", { name: "Sign test proof", hidden: true }),
    ).toHaveProperty("disabled", false);
    expect(readTransactionFinality).not.toHaveBeenCalled();
  });

  it("does not reuse a previous successful hash when the next signature is rejected", async () => {
    signAndSendTransaction
      .mockResolvedValueOnce({ transaction: { hash: "old-hash" } })
      .mockRejectedValueOnce(new Error("User rejected"));
    vi.mocked(readTransactionFinality).mockResolvedValue("success");
    fireEvent.click(await openProof());
    expect(
      await screen.findByText("Proof transaction finalized."),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Sign test proof", hidden: true }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("User rejected"),
    );
    expect(screen.queryByText("Proof transaction finalized.")).toBeNull();
    expect(readTransactionFinality).toHaveBeenCalledTimes(1);
  });

  it("rechecks an unavailable result without opening the wallet again", async () => {
    signAndSendTransaction.mockResolvedValue({
      transaction: { hash: "proof-hash" },
    });
    vi.mocked(readTransactionFinality)
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce("failure");
    fireEvent.click(await openProof());
    const recheck = await screen.findByRole("button", {
      name: "Check transaction status",
      hidden: true,
    });
    expect(screen.queryByText("Proof transaction finalized.")).toBeNull();
    fireEvent.click(recheck);
    expect(
      await screen.findByText("Proof transaction failed at finality."),
    ).toBeTruthy();
    expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
    expect(readTransactionFinality).toHaveBeenLastCalledWith(
      "https://rpc.testnet.near.org",
      "proof-hash",
      "owner.testnet",
      "treasury.testnet",
    );
  });
});
