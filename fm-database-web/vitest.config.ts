import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest ran with zero config until the dish→recipe matcher needed covering.
 * `client-app.ts` imports the `server-only` marker, whose default export throws
 * on import outside a React Server Component — so its logic (the matcher that
 * decides which recipe a client's meal opens) was untestable. Aliasing the
 * marker to the package's own no-op build makes it importable in node.
 * Aliases only; no other defaults are changed.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});
