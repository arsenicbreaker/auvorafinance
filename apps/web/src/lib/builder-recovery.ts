import { useCallback, useSyncExternalStore } from "react";

export interface BuilderFields {
  recipient: string;
  amount: string;
  reserve: string;
  interval: string;
  maxRuns: string;
  startAt: string;
}
interface RecoveryRecord {
  version: 1;
  fields: BuilderFields;
  attemptId: string;
  action: "Recipient authorization" | "Workflow creation";
  status: "draft" | "awaiting-wallet" | "rejected" | "unknown" | "submitted";
  hash?: string;
}
const EVENT = "auvora:builder-recovery";
const LOADING = "!loading";
const UNAVAILABLE = "!unavailable";

export function builderRecoveryKey(scope: {
  owner: string;
  contractId: string;
  rpcUrl: string;
}): string {
  return `auvora.builder-recovery.v1:${JSON.stringify(["testnet", scope.rpcUrl, scope.contractId, scope.owner])}`;
}

export function isWalletRejection(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; message?: unknown };
  return (
    value.code === 4001 ||
    value.code === "USER_REJECTED" ||
    value.code === "USER_CANCELLED" ||
    (typeof value.message === "string" &&
      /user (rejected|cancelled|canceled)|rejected by (the )?user|cancelled by (the )?user|canceled by (the )?user/i.test(
        value.message,
      ))
  );
}

function decode(raw: string | null): RecoveryRecord | null {
  if (!raw) return null;
  if (raw.length > 4096) throw new Error("Invalid recovery record");
  const value = JSON.parse(raw) as RecoveryRecord;
  if (
    !value ||
    value.version !== 1 ||
    !value.fields ||
    typeof value.attemptId !== "string" ||
    !["Recipient authorization", "Workflow creation"].includes(value.action) ||
    !["draft", "awaiting-wallet", "rejected", "unknown", "submitted"].includes(
      value.status,
    ) ||
    ["recipient", "amount", "reserve", "interval", "maxRuns", "startAt"].some(
      (key) =>
        typeof value.fields[key as keyof BuilderFields] !== "string" ||
        value.fields[key as keyof BuilderFields].length > 128,
    ) ||
    (value.status === "submitted" &&
      (typeof value.hash !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(value.hash)))
  )
    throw new Error("Invalid recovery record");
  return {
    version: 1,
    fields: {
      recipient: value.fields.recipient,
      amount: value.fields.amount,
      reserve: value.fields.reserve,
      interval: value.fields.interval,
      maxRuns: value.fields.maxRuns,
      startAt: value.fields.startAt,
    },
    attemptId: value.attemptId,
    action: value.action,
    status: value.status,
    ...(value.status === "submitted" ? { hash: value.hash! } : {}),
  };
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(EVENT, listener);
  };
}

export function useBuilderRecovery(scope: {
  owner: string;
  contractId: string;
  rpcUrl: string;
}) {
  const key = builderRecoveryKey(scope);
  const snapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return UNAVAILABLE;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => LOADING);
  let record: RecoveryRecord | null = null;
  let issue = "";
  if (raw === UNAVAILABLE)
    issue =
      "Browser storage is unavailable. Enable it before opening your wallet.";
  else if (raw !== LOADING) {
    try {
      record = decode(raw);
    } catch {
      issue =
        "The saved wallet request could not be read. Check Meteor activity before repairing browser storage.";
    }
  }
  function write(next: RecoveryRecord): void {
    const encoded = JSON.stringify(decode(JSON.stringify(next)));
    window.localStorage.setItem(key, encoded);
    window.dispatchEvent(new Event(EVENT));
  }
  function saveDraft(fields: BuilderFields): void {
    const current = decode(window.localStorage.getItem(key));
    if (
      current &&
      ["awaiting-wallet", "unknown", "submitted"].includes(current.status)
    )
      return;
    write({
      version: 1,
      fields,
      attemptId: current?.attemptId ?? "",
      action: current?.action ?? "Workflow creation",
      status: current?.status === "rejected" ? "rejected" : "draft",
    });
  }
  function begin(
    fields: BuilderFields,
    action: RecoveryRecord["action"],
  ): string {
    const current = decode(window.localStorage.getItem(key));
    if (
      current &&
      ["awaiting-wallet", "unknown", "submitted"].includes(current.status)
    )
      throw new Error(
        "Check the previous wallet request before signing again.",
      );
    const attemptId = crypto.randomUUID();
    write({ version: 1, fields, attemptId, action, status: "awaiting-wallet" });
    return attemptId;
  }
  function settle(
    attemptId: string,
    result: { hash: string } | { error: unknown },
  ): void {
    try {
      const current = decode(window.localStorage.getItem(key));
      if (
        !current ||
        current.attemptId !== attemptId ||
        !["awaiting-wallet", "unknown"].includes(current.status)
      )
        return;
      write(
        "hash" in result
          ? { ...current, status: "submitted", hash: result.hash }
          : {
              ...current,
              status: isWalletRejection(result.error) ? "rejected" : "unknown",
            },
      );
    } catch {
      /* The mounted transaction state still retains the returned result. */
    }
  }
  function clearFinal(hash: string): void {
    try {
      const current = decode(window.localStorage.getItem(key));
      if (current?.status === "submitted" && current.hash === hash)
        write({
          version: 1,
          fields: current.fields,
          attemptId: current.attemptId,
          action: current.action,
          status: "draft",
        });
    } catch {
      /* Preserve an unreadable record rather than guess its outcome. */
    }
  }
  function acknowledgeReviewedOutcome(): void {
    const current = decode(window.localStorage.getItem(key));
    if (
      current &&
      ["awaiting-wallet", "unknown"].includes(current.status) &&
      !current.hash
    )
      write({ ...current, status: "draft" });
  }
  return {
    record,
    issue,
    ready: raw !== LOADING,
    saveDraft,
    begin,
    settle,
    clearFinal,
    acknowledgeReviewedOutcome,
  };
}
