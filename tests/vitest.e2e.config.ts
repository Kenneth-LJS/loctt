import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    include: ["tests/e2e/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Same orphan-dir sweep the integration suite runs, so a
    // SIGKILL'd previous run can't leave loctt-* dirs piling up
    // under tests/workspace/. Belt-and-braces over per-test
    // teardown.
    globalSetup: ["tests/integration/fixtures/global-sweep.ts"],
  },
});
