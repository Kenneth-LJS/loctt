/**
 * Reports case coverage, and gates on it.
 *
 *   npm run cases:coverage                    # full report, exits 0
 *   npm run cases:coverage -- --milestone M1  # scope the uncovered list
 *   npm run cases:coverage -- --require LST-3,LST-4
 *
 * `--require` is the per-ticket gate: every named case must be tagged by
 * some test, or the command exits non-zero. That is what stops an agent
 * closing a ticket on a green suite that never targeted the ticket's cases.
 *
 * An unknown `@verifies` ID always fails, with or without `--require` — a
 * fabricated case ID means the agent invented a requirement, and no report
 * built on top of it can be trusted.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CaseIndex } from "../case-index/parse.ts";
import { collectTags, report, uncoveredFor } from "./scan.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const INDEX_PATH = path.join(REPO_ROOT, "tests/cases/case-index.json");

function flag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function main(): Promise<void> {
  let index: CaseIndex;
  try {
    index = JSON.parse(await readFile(INDEX_PATH, "utf8")) as CaseIndex;
  } catch {
    console.error(`coverage: cannot read ${path.relative(REPO_ROOT, INDEX_PATH)}.\nRun: npm run cases:index`);
    process.exit(1);
    return;
  }

  const tags = await collectTags(REPO_ROOT);
  const result = report(index, tags);
  let failed = false;

  if (result.unknown.length > 0) {
    failed = true;
    console.error(`\n✗ ${result.unknown.length} @verifies tag(s) name a case that does not exist:`);
    for (const tag of result.unknown) {
      console.error(`    ${tag.file}:${tag.line} → ${tag.caseId}`);
    }
    console.error(`  Case IDs come from tests/cases/case-index.json. Do not invent them.`);
  }

  const required = flag("require");
  if (required !== undefined) {
    const ids = required.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
    const byId = new Map(index.cases.map((c) => [c.id, c]));

    const missingFromIndex = ids.filter((id) => !byId.has(id));
    if (missingFromIndex.length > 0) {
      failed = true;
      console.error(`\n✗ --require names ${missingFromIndex.length} case(s) not in the index:`);
      for (const id of missingFromIndex) console.error(`    ${id}`);
    }

    const untagged = ids.filter((id) => byId.has(id) && !result.covered.has(id));
    if (untagged.length > 0) {
      failed = true;
      console.error(`\n✗ ${untagged.length} required case(s) have no @verifies tag:`);
      for (const id of untagged) {
        console.error(`    ${id}  ${byId.get(id)?.title ?? ""}`);
      }
      console.error(`  Add "// @verifies ${untagged[0]}" to the test that covers it.`);
    }

    if (!failed) {
      console.log(`✓ all ${ids.length} required case(s) covered.`);
    }
  }

  const milestone = flag("milestone");
  const tree = flag("tree");
  const severity = flag("severity");
  const scoped = uncoveredFor(result.uncovered, {
    ...(milestone !== undefined ? { milestone } : {}),
    ...(tree !== undefined ? { tree } : {}),
    ...(severity !== undefined ? { severity } : {}),
  });

  const scopeLabel = [
    milestone !== undefined ? `milestone=${milestone}` : undefined,
    tree !== undefined ? `tree=${tree}` : undefined,
    severity !== undefined ? `severity=${severity}` : undefined,
  ]
    .filter((s) => s !== undefined)
    .join(" ");

  console.log(
    `\ncoverage: ${result.covered.size}/${index.counts.total} cases tagged ` +
      `by ${tags.length} @verifies tag(s).`,
  );
  console.log(
    `uncovered${scopeLabel.length > 0 ? ` (${scopeLabel})` : ""}: ${scoped.length}`,
  );

  if (scopeLabel.length > 0 && scoped.length > 0) {
    for (const c of scoped.slice(0, 40)) {
      console.log(`    ${c.id.padEnd(10)} ${c.severity.padEnd(8)} ${c.title.slice(0, 68)}`);
    }
    if (scoped.length > 40) console.log(`    … and ${scoped.length - 40} more`);
  }

  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
