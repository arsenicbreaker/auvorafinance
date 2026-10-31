import { useCallback, useSyncExternalStore } from "react";

export type JournalAction =
  | "Recipient authorization"
  | "Workflow creation"
  | "pause"
  | "resume"
  | "cancel"
  | "withdraw";

export interface JournalEntry {
  hash: string;
  sender: string;
  action: JournalAction;
  workflowId?: number;
}

type Scope = {
  accountId: string;
  contractId: string;
  rpcUrl: string;
  channel: "builder" | "ledger";
};

const CHANGE_EVENT = "auvora:transaction-journal";
const UNAVAILABLE = "!unavailable";
const LOADING = "!loading";

export function journalKey(scope: Scope): string {
  return `auvora.pending.v1:${JSON.stringify([
    "testnet",
    scope.rpcUrl,
    scope.contractId,
    scope.accountId,
    scope.channel,
  ])}`;
}

export function decodeJournal(
  raw: string | null,
  scope: Scope,
): JournalEntry | null {
  if (raw === null) return null;
  if (raw.length > 2048) throw new Error("Invalid transaction record");
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (
    !value ||
    value.version !== 1 ||
    value.sender !== scope.accountId ||
    typeof value.hash !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(value.hash)
  )
    throw new Error("Invalid transaction record");
  const builder =
    value.action === "Recipient authorization" ||
    value.action === "Workflow creation";
  const ledger = ["pause", "resume", "cancel", "withdraw"].includes(
    String(value.action),
  );
  if (
    (scope.channel === "builder" && !builder) ||
    (scope.channel === "ledger" &&
      (!ledger ||
        !Number.isSafeInteger(value.workflowId) ||
        Number(value.workflowId) < 0))
  )
    throw new Error("Invalid transaction action");
  return {
    hash: value.hash,
    sender: scope.accountId,
    action: value.action as JournalAction,
    ...(ledger ? { workflowId: value.workflowId as number } : {}),
  };
}

function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function useTransactionJournal(scope: Scope) {
  const key = journalKey(scope);
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return UNAVAILABLE;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => LOADING);
  let entry: JournalEntry | null = null;
  let issue = "";
  if (raw === UNAVAILABLE) {
    issue =
      "Browser storage is unavailable. Enable storage before signing a new transaction. Keep any submitted hash until finality is confirmed.";
  } else if (raw !== LOADING) {
    try {
      entry = decodeJournal(raw, scope);
    } catch {
      issue =
        "The saved transaction record could not be read. Inspect your wallet history and confirm any pending transaction before repairing browser storage.";
    }
  }

  function save(next: JournalEntry): boolean {
    try {
      const current = decodeJournal(window.localStorage.getItem(key), scope);
      if (current && current.hash !== next.hash) return false;
      const encoded = JSON.stringify({ version: 1, ...next });
      decodeJournal(encoded, scope);
      window.localStorage.setItem(key, encoded);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      return false;
    }
  }

  function clear(hash: string): boolean {
    try {
      const current = decodeJournal(window.localStorage.getItem(key), scope);
      if (current && current.hash !== hash) return false;
      window.localStorage.removeItem(key);
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return true;
    } catch {
      return false;
    }
  }

  function canSign(): boolean {
    try {
      // Re-read at signing time; a different tab may have submitted since render.
      if (decodeJournal(window.localStorage.getItem(key), scope)) return false;
      const probeKey = `${key}:probe`;
      window.localStorage.setItem(probeKey, "1");
      window.localStorage.removeItem(probeKey);
      return true;
    } catch {
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return false;
    }
  }

  return { entry, issue, ready: raw !== LOADING, save, clear, canSign };
}
