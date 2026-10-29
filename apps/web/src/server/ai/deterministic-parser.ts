import {
  AI_DRAFT_FIELDS,
  type AiWorkflowParserResult,
  type AiWorkflowPartialDraft,
} from "@auvora/workflow-schema";

const QUESTION_BY_FIELD = {
  recipient: "What is the recipient's full NEAR testnet account ID?",
  amount: "How much native NEAR should be sent per run?",
  interval: "Should the payment repeat every minute, hour, day, or week?",
  startAt: "When should the first run start? Use an ISO time with UTC offset.",
  maxRuns: "What is the maximum number of payment runs?",
  minReserve: "What minimum NEAR reserve must remain in the workflow?",
} as const;

export function parseDeterministicWorkflow(
  prompt: string,
  providerWarning?: string,
): AiWorkflowParserResult {
  if (/\b(?:USDC|USDT|DAI|BTC|ETH|WNEAR)\b/i.test(prompt)) {
    return {
      status: "rejected",
      source: "deterministic",
      code: "UNSUPPORTED_ASSET",
      message: "Only native NEAR is supported in this workflow.",
    };
  }

  const partialDraft: AiWorkflowPartialDraft = { asset: "NEAR" };
  const recipient = prompt.match(
    /\b[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet\b/i,
  )?.[0];
  if (recipient) partialDraft.recipient = recipient.toLowerCase();

  const amount = firstCapture(prompt, [
    /(?:pay|bayar|send|kirim|transfer)\s+([0-9]+(?:[.,][0-9]{1,24})?)\s*NEAR\b/i,
    /([0-9]+(?:[.,][0-9]{1,24})?)\s*NEAR\s+(?:to|ke)\b/i,
  ]);
  if (amount) {
    partialDraft.amountNear = normalizeDecimal(amount);
    partialDraft.maxPerRunNear = partialDraft.amountNear;
  }

  const reserve = firstCapture(prompt, [
    /(?:reserve|sisakan|keep)\s+(?:(?:at\s+least|sedikitnya|minimum|minimal)\s+)?([0-9]+(?:[.,][0-9]{1,24})?)\s*NEAR\b/i,
    /([0-9]+(?:[.,][0-9]{1,24})?)\s*NEAR\s+(?:minimum\s+)?reserve\b/i,
  ]);
  if (reserve) partialDraft.minReserveNear = normalizeDecimal(reserve);

  const intervalMatch = prompt.match(
    /(?:every|setiap)\s+(?:(\d+)\s+)?(minute|minutes|menit|hour|hours|jam|day|days|hari|week|weeks|minggu)\b/i,
  );
  if (intervalMatch) {
    const count = Number(intervalMatch[1] ?? "1");
    const unit = intervalMatch[2]!.toLowerCase();
    const unitSeconds =
      unit.startsWith("minute") || unit === "menit"
        ? 60
        : unit.startsWith("hour") || unit === "jam"
          ? 3_600
          : unit.startsWith("day") || unit === "hari"
            ? 86_400
            : 604_800;
    partialDraft.intervalSeconds = count * unitSeconds;
  }

  const maxRuns = firstCapture(prompt, [
    /(?:maximum|maximal|maksimal|max)\s+(\d+)\s+(?:runs?|times?|kali)\b/i,
    /(?:for|selama)\s+(\d+)\s+(?:runs?|times?|kali)\b/i,
  ]);
  if (maxRuns) partialDraft.maxRuns = Number(maxRuns);

  const startAt = prompt.match(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})\b/,
  )?.[0];
  if (startAt) {
    partialDraft.startAt = normalizeIsoTime(startAt);
    partialDraft.timezone = startAt.endsWith("Z") ? "UTC" : "UTC offset";
  }

  const missingFields = AI_DRAFT_FIELDS.filter((field) => {
    if (field === "amount") return partialDraft.amountNear === undefined;
    if (field === "interval") return partialDraft.intervalSeconds === undefined;
    if (field === "minReserve") {
      return partialDraft.minReserveNear === undefined;
    }
    return partialDraft[field] === undefined;
  });
  const warnings = providerWarning ? [providerWarning] : [];

  if (missingFields.length) {
    return {
      status: "clarification",
      source: "deterministic",
      partialDraft,
      missingFields,
      questions: missingFields.map((field) => QUESTION_BY_FIELD[field]),
      warnings,
    };
  }

  return {
    status: "ready",
    source: "deterministic",
    draft: {
      recipient: partialDraft.recipient!,
      asset: "NEAR",
      amountNear: partialDraft.amountNear!,
      intervalSeconds: partialDraft.intervalSeconds!,
      startAt: partialDraft.startAt!,
      maxRuns: partialDraft.maxRuns!,
      minReserveNear: partialDraft.minReserveNear!,
      maxPerRunNear: partialDraft.maxPerRunNear!,
      timezone: partialDraft.timezone!,
      explanation:
        "The instruction was mapped to an editable native NEAR payment draft.",
      warnings,
    },
  };
}

function firstCapture(value: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = value.match(pattern)?.[1];
    if (match) return match;
  }
  return undefined;
}

function normalizeDecimal(value: string): string {
  return value.replace(",", ".");
}

function normalizeIsoTime(value: string): string {
  return value.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})$/,
    "$1:00$2",
  );
}
