import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "integration",
    include: ["tests/integration/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    globalSetup: ["tests/integration/fixtures/global-sweep.ts"],
  },
});
