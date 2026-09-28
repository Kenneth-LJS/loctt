/**
 * Regenerates tests/cases/case-index.json from the flow docs, and (K155,
 * B50) tests/ui/smoke.list, the Playwright blocker-case selection that
 * `npm run test:smoke` runs instead of the full UI suite.
 *
 * `--check` verifies both committed files match what the docs/specs
 * currently produce, without writing, so CI (and the per-ticket gate)
 * fails when a case is added or retagged, or a blocker test moves,
 * without regenerating. Every other consumer — the coverage report, the
 * smoke runner, the agent's plan step — reads the committed files, so
 * either going stale would quietly narrow what anything believes it must
 * satisfy or run.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex } from "./parse.ts";
import { formatSmokeList, resolveSmokeTests, SMOKE_LIST_PATH } from "./smoke.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(REPO_ROOT, "tests/cases/case-index.json");

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const index = await buildIndex(REPO_ROOT);
  const serializedIndex = `${JSON.stringify(index, null, 2)}\n`;

  const smoke = await resolveSmokeTests(index);
  if (smoke.unresolved.length > 0) {
    console.error(
      `case-index: ${String(smoke.unresolved.length)} blocker-case @verifies tag(s) ` +
        `could not be pinned to a test:`,
    );
    for (const u of smoke.unresolved) {
      console.error(`    ${u.file}:${String(u.line)} → ${u.caseId}`);
    }
    process.exit(1);
    return;
  }
  const serializedSmoke = formatSmokeList(smoke);

  if (check) {
    let committedIndex: string;
    let committedSmoke: string;
    try {
      committedIndex = await readFile(INDEX_PATH, "utf8");
    } catch {
      console.error(
        `case-index: ${path.relative(REPO_ROOT, INDEX_PATH)} does not exist.\n` +
          `Run: npm run cases:index`,
      );
      process.exit(1);
      return;
    }
    try {
      committedSmoke = await readFile(SMOKE_LIST_PATH, "utf8");
    } catch {
      console.error(
        `case-index: ${path.relative(REPO_ROOT, SMOKE_LIST_PATH)} does not exist.\n` +
          `Run: npm run cases:index`,
      );
      process.exit(1);
      return;
    }
    if (committedIndex !== serializedIndex) {
      console.error(
        `case-index: the committed index is stale — the flow docs have changed.\n` +
          `Run: npm run cases:index`,
      );
      process.exit(1);
      return;
    }
    if (committedSmoke !== serializedSmoke) {
      console.error(
        `case-index: ${path.relative(REPO_ROOT, SMOKE_LIST_PATH)} is stale — a blocker ` +
          `case's @verifies tag or test moved.\nRun: npm run cases:index`,
      );
      process.exit(1);
      return;
    }
    console.log(`case-index: up to date (${index.counts.total} cases, ${smoke.tests.length} smoke tests).`);
    return;
  }

  await writeFile(INDEX_PATH, serializedIndex, "utf8");
  await writeFile(SMOKE_LIST_PATH, serializedSmoke, "utf8");
  console.log(
    `case-index: wrote ${index.counts.total} cases ` +
      `(${index.counts.ui} UI, ${index.counts.surface} surface) ` +
      `to ${path.relative(REPO_ROOT, INDEX_PATH)}`,
  );
  console.log(
    `case-index: wrote ${smoke.tests.length} smoke test(s) ` +
      `to ${path.relative(REPO_ROOT, SMOKE_LIST_PATH)}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
