import {
  WORKFLOW_PARSER_SYSTEM_PROMPT,
  workflowParserUserPrompt,
} from "./prompt-contract";

type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
};

export function readProviderConfig(): ProviderConfig | null {
  const apiKey = process.env.NEAR_AI_API_KEY?.trim() ?? "";
  const baseUrl = process.env.NEAR_AI_BASE_URL?.trim() ?? "";
  const model = process.env.AI_MODEL?.trim() ?? "";
  if (!apiKey || !baseUrl || !model) return null;

  const parsedUrl = new URL(baseUrl);
  const localDevelopment = ["localhost", "127.0.0.1"].includes(
    parsedUrl.hostname,
  );
  if (parsedUrl.protocol !== "https:" && !localDevelopment) {
    throw new Error("AI_PROVIDER_URL_MUST_USE_HTTPS");
  }

  const configuredTimeout = Number(process.env.AI_TIMEOUT_MS ?? "8000");
  const timeoutMs = Number.isFinite(configuredTimeout)
    ? Math.min(Math.max(configuredTimeout, 1_000), 15_000)
    : 8_000;

  return { apiKey, baseUrl: parsedUrl.toString(), model, timeoutMs };
}

export async function requestProviderJson(
  config: ProviderConfig,
  prompt: string,
  repairFeedback?: string,
): Promise<unknown> {
  const endpoint = new URL("/v1/chat/completions", config.baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 800,
      store: false,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: WORKFLOW_PARSER_SYSTEM_PROMPT },
        {
          role: "user",
          content: workflowParserUserPrompt(prompt, repairFeedback),
        },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`AI_PROVIDER_HTTP_${response.status}`);
  }

  const payload: unknown = await response.json();
  const content = readCompletionContent(payload);
  return JSON.parse(stripJsonFence(content));
}

function readCompletionContent(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    throw new Error("AI_PROVIDER_RESPONSE_INVALID");
  }
  const firstChoice = payload.choices[0];
  if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
    throw new Error("AI_PROVIDER_RESPONSE_INVALID");
  }
  const content = firstChoice.message.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("AI_PROVIDER_RESPONSE_EMPTY");
  }
  return content;
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
