import { executionEventSchema } from "@auvora/workflow-schema";

import type { ParsedExecutionEvent } from "./types.js";

const EVENT_PREFIX = "EVENT_JSON:";

export function parseExecutionEvents(
  logs: readonly string[],
): ParsedExecutionEvent[] {
  const parsed: ParsedExecutionEvent[] = [];
  for (const log of logs) {
    if (!log.startsWith(EVENT_PREFIX)) continue;
    try {
      const event = executionEventSchema.safeParse(
        JSON.parse(log.slice(EVENT_PREFIX.length)),
      );
      if (!event.success) continue;
      for (const data of event.data.data) {
        parsed.push({
          event: event.data.event,
          workflowId: data.workflow_id,
          runIndex: data.run_index,
          scheduledForMs: data.scheduled_for_ms,
          amountYocto: data.amount,
          reasonCode: data.reason_code ?? null,
        });
      }
    } catch {
      continue;
    }
  }
  return parsed;
}

export function collectOutcomeLogs(outcome: unknown): string[] {
  if (!outcome || typeof outcome !== "object") return [];
  const candidate = outcome as {
    transaction_outcome?: { outcome?: { logs?: unknown } };
    receipts_outcome?: Array<{ outcome?: { logs?: unknown } }>;
  };
  const logs: string[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) {
      logs.push(
        ...value.filter((item): item is string => typeof item === "string"),
      );
    }
  };
  append(candidate.transaction_outcome?.outcome?.logs);
  for (const receipt of candidate.receipts_outcome ?? []) {
    append(receipt.outcome?.logs);
  }
  return logs;
}
