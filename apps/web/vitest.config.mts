import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "@auvora/db/history": fileURLToPath(
        new URL("../../packages/db/src/history.ts", import.meta.url),
      ),
      "@auvora/near-client/evidence": fileURLToPath(
        new URL("../../packages/near-client/src/evidence.ts", import.meta.url),
      ),
    },
  },
});
