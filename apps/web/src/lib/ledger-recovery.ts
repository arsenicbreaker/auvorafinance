import { useCallback, useSyncExternalStore } from "react";
import { isWalletRejection } from "./builder-recovery";
import {
  decodeJournal,
  journalKey,
  type JournalEntry,
} from "./transaction-journal";

type Scope = {
  accountId: string;
  contractId: string;
  rpcUrl: string;
  channel: "ledger";
};
type Attempt = {
  version: 1;
  id: string;
  entry: Omit<JournalEntry, "hash">;
  hash?: string;
};
const EVENT = "auvora:ledger-recovery";
const LOADING = "!loading";
const UNAVAILABLE = "!unavailable";

export function ledgerRecoveryKey(scope: Scope): string {
  return `${journalKey(scope)}:wallet-request`;
}

function decode(raw: string | null, scope: Scope): Attempt | null {
  if (raw === null) return null;
  if (raw.length > 4096) throw new Error("Invalid wallet request");
  const value = JSON.parse(raw) as Attempt;
  if (
    !value ||
    value.version !== 1 ||
    typeof value.id !== "string" ||
    !value.id
  )
    throw new Error("Invalid wallet request");
  const entry = decodeJournal(
    JSON.stringify({
      ...value.entry,
      version: 1,
      hash: value.hash ?? "pending",
    }),
    scope,
  );
  if (!entry) throw new Error("Invalid wallet request");
  return {
    version: 1,
    id: value.id,
    entry,
    ...(value.hash ? { hash: entry.hash } : {}),
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

export function useLedgerRecovery(scope: Scope) {
  const key = ledgerRecoveryKey(scope);
  const snapshot = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return UNAVAILABLE;
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => LOADING);
  let attempt: Attempt | null = null;
  let issue = "";
  try {
    if (raw === UNAVAILABLE) throw new Error("Storage unavailable");
    if (raw !== LOADING) attempt = decode(raw, scope);
  } catch {
    issue =
      "The saved wallet request could not be read. Check wallet activity before repairing browser storage.";
  }
  function read() {
    return decode(localStorage.getItem(key), scope);
  }
  function write(next: Attempt | null) {
    if (next) {
      const encoded = JSON.stringify(next);
      decode(encoded, scope);
      localStorage.setItem(key, encoded);
    } else localStorage.removeItem(key);
    window.dispatchEvent(new Event(EVENT));
  }
  function begin(entry: Omit<JournalEntry, "hash">): string {
    if (read())
      throw new Error(
        "Check the previous wallet request before signing again.",
      );
    const id = crypto.randomUUID();
    write({ version: 1, id, entry });
    return id;
  }
  function submitted(id: string, hash: string) {
    const current = read();
    if (current?.id === id) write({ ...current, hash });
  }
  function reject(id: string, error: unknown) {
    const current = read();
    if (current?.id === id && !current.hash && isWalletRejection(error))
      write(null);
  }
  function clearFinal(hash: string) {
    if (read()?.hash === hash) write(null);
  }
  function acknowledge(id: string) {
    const current = read();
    if (current?.id === id && !current.hash) write(null);
  }
  return {
    attempt,
    issue,
    ready: raw !== LOADING,
    recovered: attempt?.hash ? { ...attempt.entry, hash: attempt.hash } : null,
    begin,
    submitted,
    reject,
    clearFinal,
    acknowledge,
  };
}
