import { beforeEach, describe, expect, it, vi } from "vitest";

const provider = vi.hoisted(() => ({
  readProviderConfig: vi.fn(),
  requestProviderJson: vi.fn(),
}));
vi.mock("./provider", () => provider);

import { parseDeterministicWorkflow } from "./deterministic-parser";
import { parseWorkflowInstruction } from "./parser";

const prompt =
  "Pay 0.001 NEAR to recipient.testnet every minute starting at 2026-10-31T00:00:00Z, maximum 2 times, and keep a 0.002 NEAR reserve.";

beforeEach(() => {
  provider.readProviderConfig.mockReset();
  provider.requestProviderJson.mockReset();
  provider.readProviderConfig.mockReturnValue({
    apiKey: "test-only",
    baseUrl: "https://provider.invalid",
    model: "test",
    timeoutMs: 1000,
  });
});

describe("AI draft provider failure boundary", () => {
  it("keeps the deterministic draft available without provider credentials", async () => {
    provider.readProviderConfig.mockReturnValue(null);
    expect(await parseWorkflowInstruction(prompt)).toMatchObject({
      status: "ready",
      source: "deterministic",
      draft: { recipient: "recipient.testnet", maxRuns: 2 },
    });
    expect(provider.requestProviderJson).not.toHaveBeenCalled();
  });

  it("falls back after provider timeouts without losing reviewed monetary fields", async () => {
    provider.requestProviderJson.mockRejectedValue(
      new DOMException("Request timed out", "TimeoutError"),
    );
    expect(await parseWorkflowInstruction(prompt)).toMatchObject({
      status: "ready",
      source: "deterministic",
      draft: {
        amountNear: "0.001",
        minReserveNear: "0.002",
        warnings: expect.arrayContaining([
          expect.stringContaining("Deterministic parsing"),
        ]),
      },
    });
    expect(provider.requestProviderJson).toHaveBeenCalledTimes(2);
  });

  it("allows one repair and then falls back from invalid provider data", async () => {
    provider.requestProviderJson.mockResolvedValue({
      status: "ready",
      draft: { amountNear: "NaN" },
    });
    expect(await parseWorkflowInstruction(prompt)).toMatchObject({
      status: "ready",
      source: "deterministic",
    });
    expect(provider.requestProviderJson).toHaveBeenCalledTimes(2);
    expect(provider.requestProviderJson.mock.calls[1]![2]).toContain("draft");
  });

  it("accepts a schema-valid repair as editable provider draft data", async () => {
    provider.requestProviderJson
      .mockResolvedValueOnce({ status: "ready" })
      .mockResolvedValueOnce(parseDeterministicWorkflow(prompt));
    expect(await parseWorkflowInstruction(prompt)).toMatchObject({
      status: "ready",
      source: "provider",
      draft: { recipient: "recipient.testnet", asset: "NEAR" },
    });
    expect(provider.requestProviderJson).toHaveBeenCalledTimes(2);
  });

  it("retains clarification requirements when the provider is unavailable", async () => {
    provider.requestProviderJson.mockRejectedValue(
      new SyntaxError("Malformed JSON"),
    );
    expect(
      await parseWorkflowInstruction(
        "Pay 0.001 NEAR every minute, maximum 2 times, and keep a 0.002 NEAR reserve.",
      ),
    ).toMatchObject({
      status: "clarification",
      source: "deterministic",
      missingFields: expect.arrayContaining(["recipient", "startAt"]),
    });
  });
});
