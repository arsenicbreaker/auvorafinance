import {
  aiWorkflowParserResultSchema,
  type AiWorkflowParserResult,
} from "@auvora/workflow-schema";

import { parseDeterministicWorkflow } from "./deterministic-parser";
import { readProviderConfig, requestProviderJson } from "./provider";

export async function parseWorkflowInstruction(
  prompt: string,
): Promise<AiWorkflowParserResult> {
  let config: ReturnType<typeof readProviderConfig>;
  try {
    config = readProviderConfig();
  } catch {
    return parseDeterministicWorkflow(
      prompt,
      "The configured AI endpoint was rejected. Deterministic parsing was used.",
    );
  }

  if (!config) return parseDeterministicWorkflow(prompt);

  let validationFeedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const candidate = await requestProviderJson(
        config,
        prompt,
        attempt === 1 ? validationFeedback : undefined,
      );
      const parsed = aiWorkflowParserResultSchema.safeParse({
        ...(isRecord(candidate) ? candidate : {}),
        source: "provider",
      });
      if (parsed.success) return parsed.data;
      validationFeedback = parsed.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
    } catch (error) {
      validationFeedback =
        error instanceof Error ? error.message : "Invalid provider response";
    }
  }

  return parseDeterministicWorkflow(
    prompt,
    "The AI provider did not return a valid draft. Deterministic parsing was used.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
