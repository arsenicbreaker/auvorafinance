import { z } from "zod";

export const MIN_INTERVAL_MS = 60_000;
export const MAX_INTERVAL_MS = 31_536_000_000;
export const MAX_RUNS = 1_000;

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
