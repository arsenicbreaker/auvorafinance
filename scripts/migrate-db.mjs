import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required in .env.keeper.local");
}

execSync(
  "corepack pnpm@12.14.0 exec prisma migrate deploy --config prisma7.config.ts",
  {
    cwd: fileURLToPath(new URL("../packages/db/", import.meta.url)),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
    shell: true,
  },
);
