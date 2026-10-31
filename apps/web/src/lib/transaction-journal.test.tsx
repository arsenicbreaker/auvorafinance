// @vitest-environment happy-dom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeJournal,
  journalKey,
  useTransactionJournal,
} from "./transaction-journal";

const scope = {
  accountId: "owner.testnet",
  contractId: "treasury.testnet",
  rpcUrl: "https://rpc.testnet.near.org",
  channel: "ledger" as const,
};
const entry = {
  hash: "known-hash",
  sender: "owner.testnet",
  action: "pause" as const,
  workflowId: 7,
};
const encoded = JSON.stringify({ version: 1, ...entry });

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("transaction recovery journal", () => {
  it("persists only public transaction identifiers and restores after remount", () => {
    const first = renderHook(() => useTransactionJournal(scope));
    expect(first.result.current.canSign()).toBe(true);
    act(() => {
      expect(first.result.current.save(entry)).toBe(true);
    });
    expect(JSON.parse(localStorage.getItem(journalKey(scope))!)).toEqual({
      version: 1,
      ...entry,
    });
    first.unmount();
    const next = renderHook(() => useTransactionJournal(scope));
    expect(next.result.current.entry).toEqual(entry);
    expect(next.result.current.canSign()).toBe(false);
  });

  it.each([
    { accountId: "other.testnet" },
    { contractId: "other-contract.testnet" },
    { rpcUrl: "https://another-rpc.example" },
    { channel: "builder" as const },
  ])("isolates records for a changed scope: %j", (change) => {
    localStorage.setItem(journalKey(scope), encoded);
    const hook = renderHook(() =>
      useTransactionJournal({ ...scope, ...change }),
    );
    expect(hook.result.current.entry).toBeNull();
    expect(hook.result.current.canSign()).toBe(true);
  });

  it.each([
    "{",
    "null",
    "[]",
    JSON.stringify({ version: 2, ...entry }),
    JSON.stringify({ version: 1, ...entry, sender: "attacker.testnet" }),
    JSON.stringify({ version: 1, ...entry, hash: "javascript:alert(1)" }),
    JSON.stringify({ version: 1, ...entry, action: "Workflow creation" }),
    JSON.stringify({ version: 1, ...entry, workflowId: -1 }),
    JSON.stringify({ version: 1, ...entry, workflowId: 1.5 }),
    "x".repeat(2049),
  ])("blocks signing for a corrupt or mismatched record: %s", (raw) => {
    localStorage.setItem(journalKey(scope), raw);
    const hook = renderHook(() => useTransactionJournal(scope));
    expect(hook.result.current.issue).toContain("could not be read");
    expect(hook.result.current.canSign()).toBe(false);
    expect(localStorage.getItem(journalKey(scope))).toBe(raw);
  });

  it("updates mounted consumers on another tab's storage event", () => {
    const hook = renderHook(() => useTransactionJournal(scope));
    act(() => {
      localStorage.setItem(journalKey(scope), encoded);
      window.dispatchEvent(new Event("storage"));
    });
    expect(hook.result.current.entry).toEqual(entry);
    expect(hook.result.current.canSign()).toBe(false);
  });

  it("checks storage again before signing and never clears a different hash", () => {
    const hook = renderHook(() => useTransactionJournal(scope));
    localStorage.setItem(journalKey(scope), encoded);
    expect(hook.result.current.canSign()).toBe(false);
    expect(hook.result.current.save({ ...entry, hash: "different-hash" })).toBe(
      false,
    );
    expect(hook.result.current.clear("old-hash")).toBe(false);
    expect(localStorage.getItem(journalKey(scope))).toBe(encoded);
    act(() => {
      expect(hook.result.current.clear(entry.hash)).toBe(true);
    });
    expect(hook.result.current.entry).toBeNull();
  });

  it("fails closed when browser storage cannot be read", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    const hook = renderHook(() => useTransactionJournal(scope));
    expect(hook.result.current.issue).toContain("unavailable");
    expect(hook.result.current.canSign()).toBe(false);
  });

  it("prevents signing when writes fail and reports a failed save without throwing", () => {
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
    const hook = renderHook(() => useTransactionJournal(scope));
    expect(hook.result.current.canSign()).toBe(false);
    expect(hook.result.current.save(entry)).toBe(false);
  });

  it("does not expire an unresolved hash based on age", () => {
    const raw = JSON.stringify({ version: 1, ...entry, savedAt: 0 });
    expect(decodeJournal(raw, scope)).toEqual(entry);
  });
});
