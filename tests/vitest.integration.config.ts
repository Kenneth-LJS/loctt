import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "integration",
    include: ["tests/integration/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
    /**
     * Two workers, not one-per-core.
     *
     * These tests spawn the real `loctt` binary and a real MCP stdio
     * server per case, so a worker is not a thread doing arithmetic —
     * it is a process fanning out more processes. Vitest's default
     * (one worker per core) put ~10 of those in flight on a 10-core
     * box, and the 15 s timeout then fired on tests that were merely
     * starved.
     *
     * Measured 2026-09-02, the run this was diagnosed from:
     *
     *   default workers  ->  5, 8, 9 and 30 failures across four runs
     *   --maxWorkers=2   ->  462 passed, exit 0
     *
     * 27 of the 30 were `Test timed out in 15000ms`, and the summed
     * `import` time exceeded the wall clock — the tell that workers
     * were contending rather than tests being slow.
     *
     * The earlier recorded diagnosis blamed vitest's 5 s default. That
     * was wrong: this file has carried 15 s since it was written. The
     * timeout was never the cause, so raising it would have hidden the
     * contention instead of fixing it.
     */
    maxWorkers: 2,
    globalSetup: ["tests/integration/fixtures/global-sweep.ts"],
  },
});
