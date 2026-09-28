import { defineConfig } from "vitest/config";

/**
 * Runthrough tests (K144, B42): one YAML case per test, run on the CLI
 * and on scripted MCP against a fresh copy of the seed tracker.
 *
 * One test file generates every case, so parallelism comes from
 * `describe.concurrent` inside it, capped by `maxConcurrency`. Each case
 * spawns the CLI (and an MCP server) several times, so the cap is the
 * same "processes fanning out processes" budget the integration config
 * explains.
 */
export default defineConfig({
  test: {
    name: "runthrough",
    include: ["tests/runthrough/runthrough.test.ts"],
    globalSetup: ["tests/runthrough/global-setup.ts"],
    maxConcurrency: 4,
    testTimeout: 90_000,
    hookTimeout: 60_000,
  },
});
