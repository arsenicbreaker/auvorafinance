// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  readOwnerWorkflowSnapshot,
  type OwnerWorkflowSnapshot,
} from "../../lib/near-rpc";
import { DashboardOverview } from "./overview";

vi.mock("../../lib/near-rpc", () => ({ readOwnerWorkflowSnapshot: vi.fn() }));
const props = {
  contractId: "contract.testnet",
  rpcUrl: "https://rpc.testnet.near.org",
  refreshToken: 0,
  search: "",
  recipientsOnly: true,
};
const snapshot = (ownerId: string): OwnerWorkflowSnapshot => ({
  ownerId,
  blockHash: "final",
  blockHeight: 1,
  timestampMs: 1800000000000,
  workflows: [],
});
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

it("does not request owner data while disconnected, including search", () => {
  render(<DashboardOverview {...props} accountId="" search="recipient" />);
  expect(
    screen.getByRole("heading", {
      name: "Connect your wallet to see your data",
    }),
  ).toBeTruthy();
  expect(readOwnerWorkflowSnapshot).not.toHaveBeenCalled();
  expect(screen.queryByRole("table")).toBeNull();
});

it("loads only the connected account and clears its data on disconnect", async () => {
  vi.mocked(readOwnerWorkflowSnapshot).mockResolvedValue(
    snapshot("alice.testnet"),
  );
  const view = render(
    <DashboardOverview {...props} accountId="alice.testnet" />,
  );
  await screen.findByText("alice.testnet");
  expect(readOwnerWorkflowSnapshot).toHaveBeenCalledWith(
    props.rpcUrl,
    props.contractId,
    "alice.testnet",
  );
  view.rerender(<DashboardOverview {...props} accountId="" />);
  expect(screen.queryByText("alice.testnet")).toBeNull();
  expect(
    screen.getByRole("heading", {
      name: "Connect your wallet to see your data",
    }),
  ).toBeTruthy();
  expect(readOwnerWorkflowSnapshot).toHaveBeenCalledTimes(1);
});

it("ignores the previous wallet's pending response after switching accounts", async () => {
  let resolveAlice!: (value: OwnerWorkflowSnapshot) => void;
  vi.mocked(readOwnerWorkflowSnapshot)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAlice = resolve;
        }),
    )
    .mockResolvedValueOnce(snapshot("bob.testnet"));
  const view = render(
    <DashboardOverview {...props} accountId="alice.testnet" />,
  );
  view.rerender(<DashboardOverview {...props} accountId="bob.testnet" />);
  await screen.findByText("bob.testnet");
  await act(async () => resolveAlice(snapshot("alice.testnet")));
  expect(screen.queryByText("alice.testnet")).toBeNull();
  expect(screen.getByText("bob.testnet")).toBeTruthy();
});

it("rejects a snapshot belonging to a different owner", async () => {
  vi.mocked(readOwnerWorkflowSnapshot).mockResolvedValue(
    snapshot("other.testnet"),
  );
  render(<DashboardOverview {...props} accountId="alice.testnet" />);
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect(screen.queryByText("other.testnet")).toBeNull();
});
