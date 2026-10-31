import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "./generated/prisma/client.js";

export function createPrismaClient(
  databaseUrl: string,
  options?: {
    connectionTimeoutMillis?: number;
    query_timeout?: number;
    max?: number;
  },
): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl, ...options });
  return new PrismaClient({ adapter });
}

export type AuvoraPrismaClient = ReturnType<typeof createPrismaClient>;
