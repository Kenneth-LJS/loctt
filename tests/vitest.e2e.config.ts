import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "e2e",
    include: ["tests/e2e/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    /**
     * Two workers, for the reason the integration config gives at
     * length: these journeys drive the real `loctt` binary, so a
     * worker fans out processes rather than sharing a core.
     *
     * Measured 2026-09-02 on a 10-core box: at vitest's default this
     * suite failed 2 of 21 in isolation and 1 of 21 alongside the
     * integration run, always `Test timed out in 30000ms` — never an
     * assertion. At two workers it passes.
     */
    maxWorkers: 2,
    // Same orphan-dir sweep the integration suite runs, so a
    // SIGKILL'd previous run can't leave loctt-* dirs piling up
    // under tests/workspace/. Belt-and-braces over per-test
    // teardown.
    globalSetup: ["tests/integration/fixtures/global-sweep.ts"],
  },
});
