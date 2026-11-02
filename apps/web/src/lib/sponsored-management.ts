export type SponsorshipResult = {
  digest: string;
  sender: string;
  workflow: number;
  method: string;
  hash: string;
  state: "Pending" | "Succeeded" | "Failed";
  relayer: string;
  contractId: string;
  network: "testnet";
};

export function delegatePayload(result: unknown): string {
  if (
    !result ||
    typeof result !== "object" ||
    !("signedDelegateActions" in result) ||
    !Array.isArray(result.signedDelegateActions) ||
    result.signedDelegateActions.length !== 1
  )
    throw new Error("Wallet did not return exactly one signed delegate.");
  const delegate: unknown = result.signedDelegateActions[0];
  const payload =
    typeof delegate === "string"
      ? delegate
      : delegate &&
          typeof delegate === "object" &&
          "borshSerializedBase64" in delegate
        ? delegate.borshSerializedBase64
        : null;
  if (
    typeof payload !== "string" ||
    payload.length > 16384 ||
    payload.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  )
    throw new Error("Wallet returned an unsupported delegate format.");
  return payload;
}

export async function payloadDigest(payload: string): Promise<string> {
  const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}

export function validateSponsorshipResult(
  value: unknown,
  expected: {
    digest: string;
    sender: string;
    contractId: string;
    workflow: number;
    method: string;
  },
): SponsorshipResult {
  if (!value || typeof value !== "object")
    throw new Error("Invalid sponsorship response.");
  const row = value as SponsorshipResult;
  if (
    row.digest !== expected.digest ||
    row.sender !== expected.sender ||
    row.contractId !== expected.contractId ||
    row.workflow !== expected.workflow ||
    row.method !== expected.method ||
    row.network !== "testnet" ||
    !["Pending", "Succeeded", "Failed"].includes(row.state) ||
    typeof row.hash !== "string" ||
    !/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(row.hash) ||
    typeof row.relayer !== "string" ||
    !row.relayer.endsWith(".testnet")
  )
    throw new Error("Sponsorship response does not match this request.");
  return row;
}
