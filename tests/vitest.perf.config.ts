import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "perf",
    include: ["tests/perf/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
