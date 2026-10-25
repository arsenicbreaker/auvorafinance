import { z } from "zod";

const networkSchema = z.literal("testnet");

const publicConfigSchema = z.object({
  AUVORA_CONTRACT_ID: z.string().min(2),
  NEAR_NETWORK_ID: networkSchema,
  NEAR_RPC_URL: z.url().refine((value) => value.startsWith("https://"), {
    message: "NEAR_RPC_URL must use HTTPS",
  }),
});

const serviceConfigSchema = publicConfigSchema.extend({
  DATABASE_URL: z.string().min(1),
});

const keeperConfigSchema = serviceConfigSchema.extend({
  KEEPER_ACCOUNT_ID: z.string().min(2),
  KEEPER_FINALITY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(5_000)
    .max(300_000)
    .default(60_000),
  KEEPER_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3_001),
  KEEPER_INSTANCE_ID: z.string().min(1).max(128).default("keeper-1"),
  KEEPER_LEASE_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(600_000)
    .default(60_000),
  KEEPER_PAGE_SIZE: z.coerce.number().int().min(1).max(50).default(20),
  KEEPER_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(15_000),
  KEEPER_PRIVATE_KEY: z.string().min(1),
});

const relayerConfigSchema = serviceConfigSchema.extend({
  RELAYER_ACCOUNT_ID: z.string().min(2),
  RELAYER_DAILY_BUDGET: z.coerce.bigint().positive(),
  RELAYER_MAX_GAS_PER_REQUEST: z.coerce.bigint().positive(),
  RELAYER_PRIVATE_KEY: z.string().min(1),
});

export type PublicConfig = z.infer<typeof publicConfigSchema>;
export type KeeperConfig = z.infer<typeof keeperConfigSchema>;
export type RelayerConfig = z.infer<typeof relayerConfigSchema>;

export function readPublicConfig(environment: NodeJS.ProcessEnv): PublicConfig {
  return publicConfigSchema.parse(environment);
}

export function readKeeperConfig(environment: NodeJS.ProcessEnv): KeeperConfig {
  return keeperConfigSchema.parse(environment);
}

export function readRelayerConfig(
  environment: NodeJS.ProcessEnv,
): RelayerConfig {
  return relayerConfigSchema.parse(environment);
}
