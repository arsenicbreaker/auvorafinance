import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required in .env.keeper.local");
}

const separator = databaseUrl.includes("?") ? "&" : "?";
const migrationUrl = databaseUrl.includes("pgbouncer=true")
  ? databaseUrl
  : `${databaseUrl}${separator}pgbouncer=true`;
execSync(
  "corepack pnpm@12.14.0 exec prisma migrate deploy --config prisma7.config.ts",
  {
    cwd: fileURLToPath(new URL("../packages/db/", import.meta.url)),
    env: { ...process.env, DATABASE_URL: migrationUrl },
    stdio: "inherit",
    shell: true,
  },
);
