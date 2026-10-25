import { z } from "zod";

const pendingExecutionSchema = z.object({
  run_index: z.number().int().nonnegative(),
  scheduled_for_ms: z.number().int().nonnegative(),
  amount: z.string().regex(/^\d+$/),
  dispatched_at_ms: z.number().int().nonnegative(),
});

export const workflowViewSchema = z.object({
  id: z.number().int().nonnegative(),
  owner_id: z.string().min(2),
  recipient_id: z.string().min(2),
  amount: z.string().regex(/^\d+$/),
  max_per_run: z.string().regex(/^\d+$/),
  min_reserve: z.string().regex(/^\d+$/),
  interval_ms: z.number().int().positive(),
  next_run_at_ms: z.number().int().nonnegative(),
  max_runs: z.number().int().positive(),
  runs_completed: z.number().int().nonnegative(),
  available_balance: z.string().regex(/^\d+$/),
  state: z.enum(["Active", "Paused", "Completed", "Cancelled"]),
  config_hash: z.string(),
  created_at_ms: z.number().int().nonnegative(),
  withdrawable: z.string().regex(/^\d+$/),
  pending_execution: pendingExecutionSchema.nullable(),
});
