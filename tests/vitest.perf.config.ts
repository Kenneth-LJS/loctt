import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "perf",
    include: ["tests/perf/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Same orphan-dir sweep the integration suite runs. Especially
    // relevant for the perf suite — long-running tests are more
    // likely to be SIGKILL'd or aborted, leaving loctt-* dirs.
    globalSetup: ["tests/integration/fixtures/global-sweep.ts"],
  },
});
