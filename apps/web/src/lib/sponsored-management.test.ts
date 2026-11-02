import { describe, expect, it } from "vitest";
import {
  delegatePayload,
  validateSponsorshipResult,
} from "./sponsored-management";
describe("sponsored management transport", () => {
  it.each(["YWJj", { borshSerializedBase64: "YWJj" }])(
    "accepts one canonical signed payload",
    (value) =>
      expect(delegatePayload({ signedDelegateActions: [value] })).toBe("YWJj"),
  );
  it.each([
    {},
    { signedDelegateActions: [] },
    { signedDelegateActions: ["YWJj", "YWJj"] },
    { signedDelegateActions: [{ delegateAction: {} }] },
    { signedDelegateActions: ["not base64"] },
  ])("rejects ambiguous wallet responses", (value) =>
    expect(() => delegatePayload(value)).toThrow(),
  );
  const expected = {
    digest: "a".repeat(64),
    sender: "owner.testnet",
    contractId: "treasury.testnet",
    workflow: 7,
    method: "pause_workflow",
  };
  const valid = {
    ...expected,
    network: "testnet",
    state: "Succeeded",
    hash: "1".repeat(44),
    relayer: "relayer.testnet",
  };
  it("accepts matching service evidence", () =>
    expect(validateSponsorshipResult(valid, expected)).toEqual(valid));
  it.each([
    { sender: "other.testnet" },
    { contractId: "other.testnet" },
    { digest: "b".repeat(64) },
    { network: "mainnet" },
    { workflow: 8 },
    { method: "cancel_workflow" },
    { hash: "<invalid>" },
    { state: "OK" },
  ])("rejects mismatched results", (change) =>
    expect(() =>
      validateSponsorshipResult({ ...valid, ...change }, expected),
    ).toThrow(),
  );
});
