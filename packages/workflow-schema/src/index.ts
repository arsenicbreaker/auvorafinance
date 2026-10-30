import { z } from "zod";

export const MIN_INTERVAL_MS = 60_000;
export const MAX_INTERVAL_MS = 31_536_000_000;
export const MAX_RUNS = 1_000;

export const EXECUTION_REASON_CODES = [
  "NOT_DUE",
  "PAUSED",
  "INACTIVE",
  "RECIPIENT_NOT_ALLOWED",
  "RESERVE_GUARD",
  "ALREADY_DISPATCHED",
  "TRANSFER_FAILED",
  "CALLBACK_ALREADY_RESOLVED",
] as const;

export const EXECUTION_STATUSES = [
  "Dispatched",
  "Skipped",
  "Succeeded",
  "Failed",
  "Ignored",
] as const;

export const EXECUTION_EVENT_NAMES = [
  "execution_dispatched",
  "execution_skipped",
  "execution_succeeded",
  "execution_failed",
] as const;

export type ExecutionReasonCode = (typeof EXECUTION_REASON_CODES)[number];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export type ExecutionEventName = (typeof EXECUTION_EVENT_NAMES)[number];

export const executionEventSchema = z.object({
  standard: z.literal("auvora"),
  version: z.literal("1.0.0"),
  event: z.enum(EXECUTION_EVENT_NAMES),
  data: z
    .array(
      z.object({
        workflow_id: z.number().int().nonnegative(),
        run_index: z.number().int().nonnegative(),
        scheduled_for_ms: z.number().int().nonnegative(),
        amount: z.string().regex(/^\d+$/),
        reason_code: z.enum(EXECUTION_REASON_CODES).optional(),
      }),
    )
    .min(1),
});

export type ExecutionEvent = z.infer<typeof executionEventSchema>;

const accountIdSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const positiveYoctoSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .refine((value) => BigInt(value) <= (1n << 128n) - 1n, "U128_OVERFLOW");
const nonNegativeYoctoSchema = z
  .string()
  .regex(/^\d+$/)
  .refine((value) => BigInt(value) <= (1n << 128n) - 1n, "U128_OVERFLOW");

export const createWorkflowSchema = z
  .object({
    recipientId: accountIdSchema,
    amountYocto: positiveYoctoSchema,
    maxPerRunYocto: positiveYoctoSchema,
    minReserveYocto: nonNegativeYoctoSchema,
    intervalMs: z.number().int().min(MIN_INTERVAL_MS).max(MAX_INTERVAL_MS),
    startAtMs: z.number().int().positive(),
    maxRuns: z.number().int().min(1).max(MAX_RUNS),
    configHash: z.string().trim().min(1).max(128),
  })
  .superRefine((workflow, context) => {
    if (BigInt(workflow.amountYocto) > BigInt(workflow.maxPerRunYocto)) {
      context.addIssue({
        code: "custom",
        message: "MAX_PER_RUN_EXCEEDED",
        path: ["amountYocto"],
      });
    }
  });

export type CreateWorkflow = z.infer<typeof createWorkflowSchema>;

export const AI_DRAFT_FIELDS = [
  "recipient",
  "amount",
  "interval",
  "startAt",
  "maxRuns",
  "minReserve",
] as const;

const nearDecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d{1,24})?$/);

const positiveNearDecimalSchema = nearDecimalSchema.refine(
  (value) => /[1-9]/.test(value),
  "AMOUNT_MUST_BE_POSITIVE",
);

const aiWorkflowDraftObjectSchema = z.object({
  recipient: accountIdSchema,
  asset: z.literal("NEAR"),
  amountNear: positiveNearDecimalSchema,
  intervalSeconds: z
    .number()
    .int()
    .refine(
      (value) => [60, 3_600, 86_400, 604_800].includes(value),
      "UNSUPPORTED_INTERVAL",
    ),
  startAt: z.string().datetime({ offset: true }),
  maxRuns: z.number().int().min(1).max(12),
  minReserveNear: nearDecimalSchema,
  maxPerRunNear: positiveNearDecimalSchema,
  timezone: z.string().trim().min(1).max(64),
  explanation: z.string().trim().min(1).max(400),
  warnings: z.array(z.string().trim().min(1).max(240)).max(6),
});

export const aiWorkflowDraftSchema = aiWorkflowDraftObjectSchema.superRefine(
  (draft, context) => {
    if (
      !positiveNearDecimalSchema.safeParse(draft.amountNear).success ||
      !positiveNearDecimalSchema.safeParse(draft.maxPerRunNear).success
    )
      return;
    if (
      nearDecimalToAtomic(draft.amountNear) >
      nearDecimalToAtomic(draft.maxPerRunNear)
    ) {
      context.addIssue({
        code: "custom",
        message: "MAX_PER_RUN_EXCEEDED",
        path: ["amountNear"],
      });
    }
  },
);

export const aiWorkflowPartialDraftSchema = aiWorkflowDraftObjectSchema
  .omit({ explanation: true, warnings: true })
  .partial();

const aiDraftSourceSchema = z.enum(["provider", "deterministic"]);

export const aiWorkflowParserResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    source: aiDraftSourceSchema,
    draft: aiWorkflowDraftSchema,
  }),
  z.object({
    status: z.literal("clarification"),
    source: aiDraftSourceSchema,
    partialDraft: aiWorkflowPartialDraftSchema,
    missingFields: z.array(z.enum(AI_DRAFT_FIELDS)).min(1),
    questions: z.array(z.string().trim().min(1).max(240)).min(1).max(6),
    warnings: z.array(z.string().trim().min(1).max(240)).max(6),
  }),
  z.object({
    status: z.literal("rejected"),
    source: aiDraftSourceSchema,
    code: z.enum(["UNSUPPORTED_ASSET", "UNSAFE_PROMPT"]),
    message: z.string().trim().min(1).max(300),
  }),
]);

export const aiWorkflowParserRequestSchema = z.object({
  prompt: z.string().trim().min(8).max(1_000),
  ownerAccountId: accountIdSchema.optional(),
});

export type AiWorkflowDraft = z.infer<typeof aiWorkflowDraftSchema>;
export type AiWorkflowPartialDraft = z.infer<
  typeof aiWorkflowPartialDraftSchema
>;
export type AiWorkflowParserResult = z.infer<
  typeof aiWorkflowParserResultSchema
>;

function nearDecimalToAtomic(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(24, "0")}`);
}

export interface ContractCreateWorkflowArgs {
  recipient_id: string;
  amount: string;
  max_per_run: string;
  min_reserve: string;
  interval_ms: number;
  start_at_ms: number;
  max_runs: number;
  config_hash: string;
}

export function toContractArgs(
  input: CreateWorkflow,
): ContractCreateWorkflowArgs {
  const workflow = createWorkflowSchema.parse(input);
  return {
    recipient_id: workflow.recipientId,
    amount: workflow.amountYocto,
    max_per_run: workflow.maxPerRunYocto,
    min_reserve: workflow.minReserveYocto,
    interval_ms: workflow.intervalMs,
    start_at_ms: workflow.startAtMs,
    max_runs: workflow.maxRuns,
    config_hash: workflow.configHash,
  };
}
