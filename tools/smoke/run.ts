/**
 * `npm run test:smoke` (K155, B50): the tier that runs before every
 * commit, cheap enough to actually run every time — build, typecheck,
 * cached lint, all unit tests, the full runthrough, packaging, and only
 * the Playwright tests that `@verifies` a blocker case.
 *
 * Integration is deliberately NOT in smoke (K155): only 8 of 586
 * integration tests tie to a blocker case, and the runthrough already
 * covers CLI and MCP end to end. It still runs on touched files while
 * working, and in full before merge alongside the full Playwright suite
 * — see docs/dev/process/build-loop.md.
 *
 * Each step is a single command; the whole point (per build-loop.md) is
 * that "done" is a command exiting 0, not an agent's judgment call. This
 * script's only job is sequencing them, building once up front rather
 * than three times (build, runthrough and packaging each have their own
 * `pretest` build hook when run via `npm run test:x`; called here as
 * `vitest run` directly, skipping that hook, since the build already
 * ran), stopping at the first failure, and reporting how long each step
 * took — so a step that regresses in wall-clock time is visible without
 * re-deriving K155's baseline by hand.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex } from "../case-index/parse.ts";
import { resolveSmokeTests } from "../case-index/smoke.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

interface Step {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
}

function run(step: Step): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(step.command, step.args, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("close", (code) => { resolve(code ?? 1); });
    child.on("error", (err) => {
      console.error(`smoke: failed to start "${step.name}": ${err.message}`);
      resolve(1);
    });
  });
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  return s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s.toFixed(1)}s`;
}

async function main(): Promise<void> {
  // The smoke Playwright selection needs the freshly-generated
  // smoke.list, and a stale one is exactly what `cases:check` (run as
  // its own step below) is meant to catch — but generating it here too
  // means a plain `npm run test:smoke` doesn't fail on go-stale alone
  // when nothing else has changed since the last `cases:index`.
  const index = await buildIndex(REPO_ROOT);
  const smoke = await resolveSmokeTests(index);
  if (smoke.unresolved.length > 0) {
    console.error(
      `smoke: ${String(smoke.unresolved.length)} blocker-case @verifies tag(s) could not be ` +
        `pinned to a test. Run: npm run cases:index`,
    );
    process.exit(1);
  }
  if (smoke.tests.length === 0) {
    console.error("smoke: no Playwright tests resolved for any blocker case — refusing to run an empty gate.");
    process.exit(1);
  }
  const playwrightArgs = smoke.tests.map((t) => `${t.file}:${String(t.line)}`);

  const steps: Step[] = [
    { name: "build", command: "npm", args: ["run", "build"] },
    { name: "typecheck", command: "npm", args: ["run", "typecheck"] },
    { name: "lint", command: "npm", args: ["run", "lint"] },
    { name: "cases:check", command: "npx", args: ["tsx", "tools/case-index/main.ts", "--check"] },
    { name: "unit", command: "npm", args: ["run", "test"] },
    { name: "runthrough", command: "npx", args: ["vitest", "run", "--config", "tests/vitest.runthrough.config.ts"] },
    { name: "packaging", command: "npx", args: ["vitest", "run", "--config", "tests/vitest.packaging.config.ts"] },
    {
      name: "playwright (blocker cases)",
      command: "npx",
      args: ["playwright", "test", "--config", "tests/ui/playwright.config.ts", ...playwrightArgs],
    },
  ];

  console.log(`smoke: running ${String(steps.length)} step(s); ${String(playwrightArgs.length)} Playwright test(s) selected.\n`);

  const timings: { name: string; ms: number }[] = [];
  const overallStart = Date.now();

  for (const step of steps) {
    const start = Date.now();
    console.log(`\n▶ ${step.name}`);
    const code = await run(step);
    const ms = Date.now() - start;
    timings.push({ name: step.name, ms });

    if (code !== 0) {
      console.error(`\n✗ smoke failed at "${step.name}" (exit ${String(code)}) after ${formatDuration(ms)}.`);
      printTimings(timings, Date.now() - overallStart);
      process.exit(code);
    }
    console.log(`✓ ${step.name} (${formatDuration(ms)})`);
  }

  console.log(`\n✓ smoke passed.`);
  printTimings(timings, Date.now() - overallStart);
}

function printTimings(timings: readonly { name: string; ms: number }[], totalMs: number): void {
  console.log(`\nsmoke timings:`);
  for (const t of timings) {
    console.log(`  ${t.name.padEnd(28)} ${formatDuration(t.ms)}`);
  }
  console.log(`  ${"total".padEnd(28)} ${formatDuration(totalMs)}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
