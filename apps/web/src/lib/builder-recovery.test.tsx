// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  builderRecoveryKey,
  isWalletRejection,
  useBuilderRecovery,
} from "./builder-recovery";

const scope = {
  owner: "owner.testnet",
  contractId: "treasury.testnet",
  rpcUrl: "https://rpc.testnet.near.org",
};
const fields = {
  recipient: "recipient.testnet",
  amount: "0.001",
  reserve: "0.002",
  interval: "60000",
  maxRuns: "2",
  startAt: "2026-11-02T10:00",
};
beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("pre-wallet builder recovery", () => {
  it("restores a reviewed draft after remount without persisting financial approval", () => {
    const hook = renderHook(() => useBuilderRecovery(scope));
    act(() => hook.result.current.saveDraft(fields));
    hook.unmount();
    const restored = renderHook(() => useBuilderRecovery(scope));
    expect(restored.result.current.record?.fields).toEqual(fields);
    expect(restored.result.current.record?.status).toBe("draft");
    const serialized = localStorage.getItem(builderRecoveryKey(scope))!;
    expect(serialized).not.toContain("reviewedDraftKey");
    expect(serialized).not.toContain("instruction");
  });
  it.each([
    { owner: "other.testnet" },
    { contractId: "other.testnet" },
    { rpcUrl: "https://other-rpc.example" },
  ])("isolates recovered data by scope: %j", (change) => {
    const hook = renderHook(() => useBuilderRecovery(scope));
    act(() => hook.result.current.saveDraft(fields));
    const other = renderHook(() => useBuilderRecovery({ ...scope, ...change }));
    expect(other.result.current.record).toBeNull();
  });
  it("persists an attempt before the wallet call and refuses another attempt", () => {
    const hook = renderHook(() => useBuilderRecovery(scope));
    act(() => hook.result.current.begin(fields, "Workflow creation"));
    expect(hook.result.current.record?.status).toBe("awaiting-wallet");
    expect(() =>
      hook.result.current.begin(fields, "Workflow creation"),
    ).toThrow(/previous wallet request/);
    act(() => hook.result.current.saveDraft({ ...fields, amount: "9" }));
    expect(hook.result.current.record?.fields.amount).toBe("0.001");
  });
  it("keeps explicit rejection after remount and allows a fresh reviewed attempt", () => {
    const hook = renderHook(() => useBuilderRecovery(scope));
    let id = "";
    act(() => {
      id = hook.result.current.begin(fields, "Workflow creation");
    });
    act(() =>
      hook.result.current.settle(id, { error: new Error("User rejected") }),
    );
    hook.unmount();
    const next = renderHook(() => useBuilderRecovery(scope));
    expect(next.result.current.record?.status).toBe("rejected");
    act(() => next.result.current.begin(fields, "Workflow creation"));
    expect(next.result.current.record?.status).toBe("awaiting-wallet");
  });
  it("keeps an ambiguous wallet error unknown until the user reviews activity", () => {
    const hook = renderHook(() => useBuilderRecovery(scope));
    let id = "";
    act(() => {
      id = hook.result.current.begin(fields, "Workflow creation");
    });
    act(() =>
      hook.result.current.settle(id, {
        error: new Error("Transport disconnected"),
      }),
    );
    expect(hook.result.current.record?.status).toBe("unknown");
    act(() => hook.result.current.acknowledgeReviewedOutcome());
    expect(hook.result.current.record?.status).toBe("draft");
  });
  it("does not let manual acknowledgement clear a returned hash or downgrade it to rejection", () => {
    const hook = renderHook(() => useBuilderRecovery(scope));
    let id = "";
    act(() => {
      id = hook.result.current.begin(fields, "Workflow creation");
    });
    act(() => hook.result.current.settle(id, { hash: "original-hash" }));
    act(() =>
      hook.result.current.settle(id, { error: new Error("User rejected") }),
    );
    act(() => hook.result.current.acknowledgeReviewedOutcome());
    expect(hook.result.current.record?.status).toBe("submitted");
    act(() => hook.result.current.clearFinal("other-hash"));
    expect(hook.result.current.record?.hash).toBe("original-hash");
    act(() => hook.result.current.clearFinal("original-hash"));
    expect(hook.result.current.record?.status).toBe("draft");
  });
  it("does not let an older attempt overwrite a newer one", () => {
    const hook = renderHook(() => useBuilderRecovery(scope));
    let first = "";
    act(() => {
      first = hook.result.current.begin(fields, "Workflow creation");
    });
    act(() =>
      hook.result.current.settle(first, { error: new Error("User rejected") }),
    );
    act(() => hook.result.current.begin(fields, "Workflow creation"));
    act(() =>
      hook.result.current.settle(first, { error: new Error("User rejected") }),
    );
    expect(hook.result.current.record?.status).toBe("awaiting-wallet");
  });
  it("blocks on corrupt data rather than discard an unresolved attempt", () => {
    localStorage.setItem(builderRecoveryKey(scope), "{");
    const hook = renderHook(() => useBuilderRecovery(scope));
    expect(hook.result.current.issue).toContain("could not be read");
    expect(() =>
      hook.result.current.begin(fields, "Workflow creation"),
    ).toThrow();
  });
  it("does not start a request if storage cannot accept the attempt", () => {
    const store = window.localStorage;
    vi.spyOn(window, "localStorage", "get").mockReturnValue({
      ...store,
      getItem: store.getItem.bind(store),
      setItem: () => {
        throw new Error("quota");
      },
    } as Storage);
    const hook = renderHook(() => useBuilderRecovery(scope));
    expect(() =>
      hook.result.current.begin(fields, "Workflow creation"),
    ).toThrow("quota");
  });
  it.each([
    { code: 4001 },
    { code: "USER_REJECTED" },
    new Error("User cancelled the transaction"),
    new Error("Rejected by user"),
  ])("recognizes explicit rejection: %j", (error) => {
    expect(isWalletRejection(error)).toBe(true);
  });
  it.each([
    new Error("Timeout"),
    new Error("Transaction hash missing"),
    new Error("Wallet closed"),
    "User rejected",
  ])("does not invent rejection for ambiguous errors: %j", (error) => {
    expect(isWalletRejection(error)).toBe(false);
  });
});
