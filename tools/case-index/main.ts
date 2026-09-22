/**
 * Regenerates tests/cases/case-index.json from the flow docs.
 *
 * `--check` verifies the committed index matches the docs without writing,
 * so CI (and the per-ticket gate) fails when a case is added or retagged
 * without regenerating. Every other consumer — the coverage report, the
 * agent's plan step — reads the committed JSON, so a stale index would
 * quietly narrow what anything believes it must satisfy.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildIndex } from "./parse.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(REPO_ROOT, "tests/cases/case-index.json");

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const index = await buildIndex(REPO_ROOT);
  const serialized = `${JSON.stringify(index, null, 2)}\n`;

  if (check) {
    const { readFile } = await import("node:fs/promises");
    let committed: string;
    try {
      committed = await readFile(INDEX_PATH, "utf8");
    } catch {
      console.error(
        `case-index: ${path.relative(REPO_ROOT, INDEX_PATH)} does not exist.\n` +
          `Run: npm run cases:index`,
      );
      process.exit(1);
      return;
    }
    if (committed !== serialized) {
      console.error(
        `case-index: the committed index is stale — the flow docs have changed.\n` +
          `Run: npm run cases:index`,
      );
      process.exit(1);
      return;
    }
    console.log(`case-index: up to date (${index.counts.total} cases).`);
    return;
  }

  await writeFile(INDEX_PATH, serialized, "utf8");
  console.log(
    `case-index: wrote ${index.counts.total} cases ` +
      `(${index.counts.ui} UI, ${index.counts.surface} surface) ` +
      `to ${path.relative(REPO_ROOT, INDEX_PATH)}`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
