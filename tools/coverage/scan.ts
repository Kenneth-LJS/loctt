/**
 * Cross-references `@verifies` tags in test files against the case index.
 *
 * This is the gate that makes "done" computable. An agent implementing a
 * ticket claims a set of case IDs; the tests it writes tag the cases they
 * verify; this tool checks the claim against the tags and the tags against
 * the index. The agent never declares a ticket complete — this does.
 *
 * Two failure modes it exists to catch:
 *
 *  - **Fabricated IDs.** A tag naming a case that does not exist means the
 *    agent invented a requirement. Hard error, never a warning.
 *  - **Silent under-coverage.** A ticket's cases that no test tags are
 *    reported as uncovered, so "the suite is green" cannot be mistaken for
 *    "the cases are satisfied".
 *
 * A tag asserts only that a test *targets* a case. It cannot prove the
 * assertion is faithful to the prose — that is what the review step reads.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { CaseIndex, TestCase } from "../case-index/parse.ts";

/**
 * `// @verifies LST-3, LST-4` — one or more comma-separated IDs.
 *
 * Anchored to the START of the comment on the line: the tag must be the
 * first thing after the comment marker (`//`, `*`, `/*`, `/**`) and
 * optional whitespace. This is deliberate — a case ID that merely appears
 * in prose ("this differs from LST-3", "unlike @verifies elsewhere") must
 * NOT be counted as coverage, or the gate reports a case as verified by a
 * test that only mentions it. A real tag is a line whose comment body
 * begins with `@verifies`; anything else is prose.
 */
const VERIFIES = /^\s*(?:\/\/|\/\*\*?|\*)?\s*@verifies\s+([A-Z][A-Z0-9]*-C?\d+(?:\s*,\s*[A-Z][A-Z0-9]*-C?\d+)*)/;

const TEST_FILE = /\.(test|spec)\.tsx?$/;
// `.claude` holds agent worktrees — full copies of the repo. Without
// it the scanner walks every one and counts every tag twice: 451 tags
// became 902 the moment a build agent's worktree existed. Coverage
// itself survived (it is a set of IDs), but the tag count became
// meaningless, and a worktree at a *different* commit would report
// coverage the main tree does not have. Same shape as the six sweep
// worktrees that made `npm run lint` exhaust the V8 heap.
const SKIP_DIRS = new Set([
  "node_modules", "dist", ".git", "workspace", ".claude",
]);

export interface Tag {
  readonly caseId: string;
  readonly file: string;
  readonly line: number;
}

export interface CoverageReport {
  /** Tags naming a case ID absent from the index. Always fatal. */
  readonly unknown: readonly Tag[];
  /** Case IDs with at least one tag, mapped to the tags claiming them. */
  readonly covered: ReadonlyMap<string, readonly Tag[]>;
  /** Indexed cases no test tags. */
  readonly uncovered: readonly TestCase[];
}

async function walk(dir: string, out: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(path.join(dir, entry.name), out);
      continue;
    }
    if (TEST_FILE.test(entry.name)) out.push(path.join(dir, entry.name));
  }
}

export async function collectTags(repoRoot: string): Promise<Tag[]> {
  const files: string[] = [];
  await walk(repoRoot, files);
  files.sort();

  const tags: Tag[] = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, idx) => {
      // One tag per line: it must lead the comment (see VERIFIES), so a
      // line carries at most one `@verifies`. A single comma-separated
      // list after it still expands to multiple case ids.
      const match = VERIFIES.exec(line);
      const ids = match?.[1];
      if (ids === undefined) return;
      for (const caseId of ids.split(",").map((s) => s.trim())) {
        tags.push({ caseId, file: rel, line: idx + 1 });
      }
    });
  }
  return tags;
}

export function report(index: CaseIndex, tags: readonly Tag[]): CoverageReport {
  const byId = new Map(index.cases.map((c) => [c.id, c]));

  const unknown: Tag[] = [];
  const covered = new Map<string, Tag[]>();

  for (const tag of tags) {
    if (!byId.has(tag.caseId)) {
      unknown.push(tag);
      continue;
    }
    const existing = covered.get(tag.caseId);
    if (existing === undefined) covered.set(tag.caseId, [tag]);
    else existing.push(tag);
  }

  const uncovered = index.cases.filter((c) => !covered.has(c.id));

  return { unknown, covered, uncovered };
}

/** Filters a report's uncovered set to one milestone, for per-ticket gating. */
export function uncoveredFor(
  uncovered: readonly TestCase[],
  filter: { milestone?: string; tree?: string; severity?: string },
): readonly TestCase[] {
  return uncovered.filter((c) => {
    if (filter.milestone !== undefined && c.milestone !== filter.milestone) return false;
    if (filter.tree !== undefined && c.tree !== filter.tree) return false;
    if (filter.severity !== undefined && c.severity !== filter.severity) return false;
    return true;
  });
}
