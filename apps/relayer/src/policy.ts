import { z } from "zod";

const gasSchema = z.coerce.bigint().positive();
const depositSchema = z.coerce.bigint().nonnegative();

const delegatedCallSchema = z.object({
  attachedDeposit: depositSchema,
  gas: gasSchema,
  maxBlockHeight: z.coerce.bigint().positive(),
  methodName: z.string().min(1),
  receiverId: z.string().min(2),
});

export type DelegatedCall = z.infer<typeof delegatedCallSchema>;

export type SponsorshipPolicy = Readonly<{
  allowedMethods: ReadonlySet<string>;
  contractId: string;
  currentBlockHeight: bigint;
  maxGasPerRequest: bigint;
  networkId: "testnet";
}>;

export type PolicyDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{
      allowed: false;
      code:
        | "ATTACHED_DEPOSIT_FORBIDDEN"
        | "DELEGATE_EXPIRED"
        | "GAS_LIMIT_EXCEEDED"
        | "INVALID_SIGNATURE"
        | "INVALID_REQUEST"
        | "METHOD_NOT_ALLOWED"
        | "RECEIVER_NOT_ALLOWED";
    }>;

export function evaluateSponsorship(
  input: unknown,
  policy: SponsorshipPolicy,
): PolicyDecision {
  const parsed = delegatedCallSchema.safeParse(input);
  if (!parsed.success) {
    return { allowed: false, code: "INVALID_REQUEST" };
  }

  if (parsed.data.receiverId !== policy.contractId) {
    return { allowed: false, code: "RECEIVER_NOT_ALLOWED" };
  }
  if (!policy.allowedMethods.has(parsed.data.methodName)) {
    return { allowed: false, code: "METHOD_NOT_ALLOWED" };
  }
  if (parsed.data.attachedDeposit !== 0n) {
    return { allowed: false, code: "ATTACHED_DEPOSIT_FORBIDDEN" };
  }
  if (parsed.data.gas > policy.maxGasPerRequest) {
    return { allowed: false, code: "GAS_LIMIT_EXCEEDED" };
  }
  if (parsed.data.maxBlockHeight <= policy.currentBlockHeight) {
    return { allowed: false, code: "DELEGATE_EXPIRED" };
  }

  return { allowed: true };
}
