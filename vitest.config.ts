import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest for the simulation migration's S2/S3 gates (protocol §4.1):
 *  - pure request-assembly logic (features/simulation/lib/scenario-curves.test.ts)
 *  - port <-> /api/simulate contract vs MSW (features/simulation/api/*.contract.test.ts)
 * Node environment: these exercise pure functions + fetch (MSW node interception),
 * no DOM needed. Heavier Playwright visual-regression (§4.2) is deferred to S5.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
