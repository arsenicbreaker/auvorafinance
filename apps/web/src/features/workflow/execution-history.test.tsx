// @vitest-environment happy-dom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionHistory } from "./execution-history";
const fetchMock = vi.fn();
const page = {
  ownerId: "owner.testnet",
  contractId: "treasury.testnet",
  observedAt: "2026-10-31T00:00:00Z",
  blockHeight: 100,
  rows: [
    {
      hash: "11111111111111111111111111111111",
      workflowId: "7",
      runIndex: 0,
      amountYocto: "1000000000000000000000",
      submittedAt: "2026-10-31T00:00:00Z",
      status: "Succeeded",
      reason: null,
    },
  ],
  nextCursor: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () => Response.json(page));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("execution record", () => {
  it("rejects malformed amounts without crashing the ledger", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        ...page,
        rows: [{ ...page.rows[0], amountYocto: "not-an-amount" }],
      }),
    );
    render(<ExecutionHistory initialOwnerId="owner.testnet" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Read execution history" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "unreadable result",
    );
    expect(screen.queryByText("Succeeded")).toBeNull();
  });
  it("does not invent or fetch transactions before an explicit read", () => {
    render(<ExecutionHistory initialOwnerId="owner.testnet" />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Succeeded")).toBeNull();
  });
  it("renders exact payment amounts and verified explorer links without a wallet", async () => {
    render(<ExecutionHistory initialOwnerId="owner.testnet" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Read execution history" }),
    );
    expect(await screen.findByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("0.001 NEAR")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Inspect transaction for workflow 7 run 1" })
        .getAttribute("href"),
    ).toContain(page.rows[0]!.hash);
  });
  it("explains a missing history connection without showing mock data", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ error: "NOT_CONFIGURED" }, { status: 503 }),
    );
    render(<ExecutionHistory initialOwnerId="owner.testnet" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Read execution history" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "not connected yet",
    );
    expect(screen.queryByText("Succeeded")).toBeNull();
  });
  it("distinguishes an empty keeper record from proof of no execution", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...page, rows: [] }));
    render(<ExecutionHistory initialOwnerId="owner.testnet" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Read execution history" }),
    );
    expect(
      await screen.findByText(
        /does not prove that no on-chain execution occurred/,
      ),
    ).toBeTruthy();
  });
  it("drops a late response after the owner changes", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(
      new Promise<Response>((next) => {
        resolve = next;
      }),
    );
    render(<ExecutionHistory initialOwnerId="owner.testnet" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Read execution history" }),
    );
    fireEvent.change(screen.getByLabelText("History owner account"), {
      target: { value: "other.testnet" },
    });
    resolve(Response.json(page));
    await waitFor(() =>
      expect(
        screen.queryByText(
          "Checking recorded hashes against finalized RPC outcomes…",
        ),
      ).toBeNull(),
    );
    expect(screen.queryByText("Succeeded")).toBeNull();
  });
  it("appends older attempts and deduplicates hashes", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ ...page, nextCursor: "older" }))
      .mockResolvedValueOnce(
        Response.json({
          ...page,
          rows: [
            ...page.rows,
            {
              ...page.rows[0],
              hash: "22222222222222222222222222222222",
              runIndex: 1,
            },
          ],
        }),
      );
    render(<ExecutionHistory initialOwnerId="owner.testnet" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Read execution history" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Load older attempts" }),
    );
    expect(await screen.findByText("#7 / 2")).toBeTruthy();
    expect(screen.getAllByText("Succeeded")).toHaveLength(2);
    expect(fetchMock.mock.calls[1]![0]).toContain("cursor=older");
  });
});
