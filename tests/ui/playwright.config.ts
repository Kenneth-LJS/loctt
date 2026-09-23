import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * UI acceptance specs, transcribed from tests/cases/ui-test-cases/.
 *
 * Each spec drives the real `loctt ui` server against a real seeded
 * `.loctt/` — no mocked API. The flow docs assert observable behaviour
 * that spans the browser, the HTTP layer, and the files on disk (P1: the
 * files are the truth), and a mocked backend cannot falsify those claims.
 *
 * The server is booted per worker by the fixture in `fixtures/tracker.ts`,
 * not by `webServer` here, because each spec needs its own isolated
 * tracker directory rather than one shared instance.
 */
export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.ts$/,
  // A UI spec that needs a retry to pass is flaky, and a flaky gate is
  // worse than no gate — it teaches the agent to re-run instead of fix.
  retries: 0,
  fullyParallel: true,
  // Pinned at 2 (build-loop.md "Playwright is only trustworthy at 2
  // workers"): each worker boots its own tracker server, and contention
  // above 2 produces failures that are not defects (measured: 56 at 5
  // workers, 23 then 5 at 3, 0 at 2). Override with LOCTT_E2E_WORKERS for
  // a machine where that measurement does not hold; an explicit
  // `--workers` on the CLI still wins over both (Playwright's own CLI
  // flag takes precedence over anything returned here).
  workers: process.env.LOCTT_E2E_WORKERS ? Number(process.env.LOCTT_E2E_WORKERS) : 2,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
