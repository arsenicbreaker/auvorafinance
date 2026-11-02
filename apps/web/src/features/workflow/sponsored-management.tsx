"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { formatNear } from "@auvora/domain";
import { readOwnerWorkflows, type WorkflowView } from "../../lib/near-rpc";
import { isWalletRejection } from "../../lib/builder-recovery";
import {
  delegatePayload,
  payloadDigest,
  validateSponsorshipResult,
  type SponsorshipResult,
} from "../../lib/sponsored-management";

type RequestRecord = {
  workflow: number;
  method: string;
  payload?: string;
  digest?: string;
};
const EVENT = "auvora:sponsored-request";
function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function SponsoredManagement({
  ownerId,
  contractId,
  rpcUrl,
  serviceUrl,
  onChanged,
}: {
  ownerId: string;
  contractId: string;
  rpcUrl: string;
  serviceUrl: string;
  onChanged: () => void;
}) {
  const [workflows, setWorkflows] = useState<WorkflowView[]>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [method, setMethod] = useState("pause_workflow");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<SponsorshipResult | null>(null);
  const lock = useRef(false);
  const key = `auvora.sponsored.v1:${JSON.stringify(["testnet", serviceUrl, contractId, ownerId])}`;
  const snapshot = useCallback(() => {
    try {
      return localStorage.getItem(key);
    } catch {
      return "!unavailable";
    }
  }, [key]);
  const raw = useSyncExternalStore(subscribe, snapshot, () => "!loading");
  let saved: RequestRecord | null = null;
  let storageIssue = false;
  if (raw && raw !== "!loading") {
    try {
      saved = JSON.parse(raw) as RequestRecord;
      if (
        !saved ||
        !Number.isSafeInteger(saved.workflow) ||
        saved.workflow < 0 ||
        ![
          "pause_workflow",
          "resume_workflow",
          "cancel_workflow",
          "withdraw_available",
        ].includes(saved.method) ||
        (saved.payload &&
          (typeof saved.payload !== "string" ||
            saved.payload.length > 16384)) ||
        (saved.digest && !/^[a-f0-9]{64}$/.test(saved.digest))
      )
        throw new Error();
    } catch {
      saved = null;
      storageIssue = true;
    }
  }
  function save(record: RequestRecord | null) {
    if (record) localStorage.setItem(key, JSON.stringify(record));
    else localStorage.removeItem(key);
    window.dispatchEvent(new Event(EVENT));
  }
  const selected = workflows.find((w) => String(w.id) === workflowId);
  const eligible =
    selected &&
    (method === "pause_workflow"
      ? selected.state === "Active"
      : method === "resume_workflow"
        ? selected.state === "Paused"
        : method === "cancel_workflow"
          ? ["Active", "Paused"].includes(selected.state)
          : BigInt(selected.withdrawable) > 0n);

  async function request(path: string, body?: unknown) {
    const response = await fetch(`${serviceUrl}${path}`, {
      method: body ? "POST" : "GET",
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        typeof data.error === "string" ? data.error : "Sponsorship unavailable",
      );
    return data;
  }
  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const health = await request("/health");
      if (health.network !== "testnet" || health.contractId !== contractId)
        throw new Error("Relayer network or contract does not match.");
      const wallet = await import("@fastnear/wallet");
      const session = await wallet.connect({
        network: "testnet",
        features: {
          signDelegateActions: true,
          signDelegateActionsWithTtl: true,
        },
      });
      if (
        !session ||
        session.accountId !== ownerId ||
        wallet.getActiveNetwork() !== "testnet"
      )
        throw new Error(`Connect ${ownerId} on testnet for sponsorship.`);
      setConnected(true);
      setWorkflows(await readOwnerWorkflows(rpcUrl, contractId, ownerId));
      setMessage(
        "Delegate signing connected. Review one workflow action below.",
      );
    } catch (error) {
      setConnected(false);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not connect sponsored management.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function inspect(record: RequestRecord, submit: boolean) {
    if (!record.digest || !record.payload)
      throw new Error(
        "No signed delegate was saved. Check wallet activity first.",
      );
    const digest = await payloadDigest(record.payload);
    if (digest !== record.digest)
      throw new Error("Saved delegate does not match its digest.");
    const data = await request(
      submit ? "/requests" : `/requests/${digest}`,
      submit ? { payload: record.payload } : undefined,
    );
    const verified = validateSponsorshipResult(data, {
      digest,
      sender: ownerId,
      contractId,
      workflow: record.workflow,
      method: record.method,
    });
    setResult(verified);
    setMessage(
      verified.state === "Pending"
        ? "Submitted. Check this same request until finality is confirmed."
        : verified.state === "Succeeded"
          ? "Sponsored action finalized. The relayer paid transaction gas."
          : "Sponsored action failed at finality. Review the workflow before trying again.",
    );
    if (verified.state !== "Pending") {
      save(null);
      onChanged();
      setWorkflows(await readOwnerWorkflows(rpcUrl, contractId, ownerId));
    }
  }
  async function sign() {
    if (!selected || !eligible || saved || storageIssue || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    setResult(null);
    let opened = false;
    try {
      const wallet = await import("@fastnear/wallet");
      if (wallet.accountId({ network: "testnet" }) !== ownerId)
        throw new Error(
          "Wallet account changed. Reconnect sponsored management.",
        );
      const fresh = (
        await readOwnerWorkflows(rpcUrl, contractId, ownerId)
      ).find((w) => w.id === selected.id);
      if (!fresh) throw new Error("Workflow not found.");
      if (
        method === "withdraw_available" &&
        fresh.withdrawable !== selected.withdrawable
      )
        throw new Error(
          "Withdrawable balance changed. Reconnect to review the new amount.",
        );
      const record: RequestRecord = { workflow: selected.id, method };
      save(record);
      opened = true;
      const response = await wallet.signDelegateActions({
        network: "testnet",
        delegateActions: [
          {
            receiverId: contractId,
            blockHeightTtl: 200,
            actions: [
              {
                type: "FunctionCall",
                params: {
                  methodName: method,
                  args:
                    method === "withdraw_available"
                      ? {
                          workflow_id: selected.id,
                          amount: selected.withdrawable,
                        }
                      : { workflow_id: selected.id },
                  gas: "30000000000000",
                  deposit: "0",
                },
              },
            ],
          },
        ],
      });
      const payload = delegatePayload(response);
      const ready = {
        ...record,
        payload,
        digest: await payloadDigest(payload),
      };
      save(ready);
      await inspect(ready, true);
    } catch (error) {
      if (opened && isWalletRejection(error)) save(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Sponsorship outcome unknown. Check the saved request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function retry(submit: boolean) {
    if (!saved || busy) return;
    setBusy(true);
    try {
      await inspect(saved, submit);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Status unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="ledger-shell"
      id="sponsorship"
      aria-labelledby="sponsorship-title"
    >
      <div className="ledger-heading">
        <div>
          <h2 id="sponsorship-title">Sponsored workflow controls</h2>
          <p>
            Sign one management action with your wallet. The relayer pays gas;
            no deposit is attached. Creation and funding still use the ordinary
            wallet flow above.
          </p>
        </div>
      </div>
      {!ownerId ? (
        <p>Connect the owner wallet above first.</p>
      ) : (
        <>
          <p>
            Owner: {ownerId}. Contract: {contractId}. Network: testnet.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy || !!saved || storageIssue}
            onClick={() => void connect()}
          >
            Connect sponsored management
          </button>
          {connected && !saved ? (
            <div className="review-actions">
              <label>
                Workflow for sponsored action
                <select
                  value={workflowId}
                  onChange={(e) => setWorkflowId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Select workflow</option>
                  {workflows.map((w) => (
                    <option key={w.id} value={w.id}>
                      WF-{w.id}: {w.state}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Sponsored action
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  disabled={busy}
                >
                  <option value="pause_workflow">Pause</option>
                  <option value="resume_workflow">Resume</option>
                  <option value="cancel_workflow">Cancel</option>
                  <option value="withdraw_available">
                    Withdraw available funds
                  </option>
                </select>
              </label>
              {selected ? (
                <p>
                  WF-{selected.id}: {selected.state}.{" "}
                  {method === "withdraw_available"
                    ? `Withdraw ${formatNear(BigInt(selected.withdrawable))} NEAR to ${ownerId}.`
                    : method === "cancel_workflow"
                      ? "Cancellation permanently stops future runs for this workflow."
                      : "Review the selected action before signing."}
                </p>
              ) : null}
              <button
                type="button"
                disabled={
                  busy || !eligible || storageIssue || raw === "!loading"
                }
                onClick={() => void sign()}
              >
                Sign sponsored action
              </button>
            </div>
          ) : null}
          {saved ? (
            <div className="ledger-message" role="status">
              <p>
                Saved {saved.method} request for WF-{saved.workflow}.{" "}
                {saved.payload
                  ? "Check or resubmit this exact signed request without another wallet signature."
                  : "No signed delegate was saved. Its outcome is unknown; check Meteor activity before clearing it."}
              </p>
              {saved.payload ? (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void retry(false)}
                  >
                    Check sponsored request
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void retry(true)}
                  >
                    Submit saved delegate
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    try {
                      save(null);
                    } catch {
                      setMessage("Browser storage unavailable.");
                    }
                  }}
                >
                  I checked wallet activity; no transaction is pending
                </button>
              )}
            </div>
          ) : null}
          {storageIssue ? (
            <p role="alert">
              Saved sponsorship data could not be read. Check wallet activity
              before repairing browser storage.
            </p>
          ) : null}
          {message ? <p role="status">{message}</p> : null}
          {result ? (
            <p>
              <a
                href={`https://testnet.nearblocks.io/txns/${result.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                Inspect sponsored transaction
              </a>{" "}
              · {result.state}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
