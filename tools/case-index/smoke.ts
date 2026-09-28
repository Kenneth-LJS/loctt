/**
 * Resolves `@verifies` tags on blocker-severity cases to the exact
 * Playwright test each one annotates, and writes `tests/ui/smoke.list`
 * (one `file:line` per line, relative to `tests/ui/`, in the form
 * Playwright's own CLI accepts as a positional test filter).
 *
 * This is the list `npm run test:smoke` (K155) runs instead of the full
 * UI suite — ~7.6 min instead of ~25, per K155's measurement — without
 * scanning a fixed line window (fragile: it silently drops tests once a
 * file grows past the window) or hand-maintaining a list (drifts the
 * moment a blocker case's test moves).
 *
 * ## Resolving a tag to a test
 *
 * `tools/coverage/scan.ts`'s `collectTags` finds every `@verifies` tag
 * for coverage purposes, but only needs the tag's own file:line — it
 * never has to say *which test* a tag belongs to, because coverage is a
 * set membership question ("does this case have a tag anywhere"). A
 * smoke *runner* needs an actual test to hand to Playwright, so this
 * module adds that resolution step on top of the same tag collection.
 *
 * The repo's `@verifies` comments appear in two shapes, both observed in
 * `tests/ui/**\/*.spec.ts`:
 *
 *   1. Immediately before the `test(...)` call it covers
 *      (`// @verifies GIT-8` then `test("GIT-8: ...", ...)`).
 *   2. As the first statement INSIDE the test body
 *      (`test("GIT-19 ...", async () => { // @verifies GIT-19 ...`),
 *      which also covers the common `test.describe(...)` docblock +
 *      nested `test(...)` shape, since the tag sits inside the nested
 *      test either way.
 *
 * So a tag resolves to: the nearest `test(`/`test.only(`/`test.skip(`
 * line within a few lines BEHIND it (shape 1), else the nearest one
 * AHEAD of it (shape 2). A small backward window (8 lines) is enough for
 * shape 1's short comment blocks and deliberately short enough that it
 * cannot cross into a *different* test's trailing lines; the forward
 * window (60 lines) matches file bodies observed in this repo (longest
 * gap between a docblock's `@verifies` and its `test(` was under 20).
 *
 * A tag that resolves neither way is a file-level docblock claiming
 * every case in a comma/space-separated list for the whole file (one
 * observed instance: `flow-relationships-children-reorder.spec.ts`'s
 * header lists five case IDs with no single test to bind to). Such a
 * tag expands to EVERY `test(...)` in that file — the tag's own claim,
 * taken at face value, is "this file's tests cover these cases".
 *
 * An unresolvable tag is not silently dropped: `--check` (wired into
 * `cases:check`, per K155/B50) fails if any blocker case's tag cannot be
 * pinned to at least one concrete test, since a case that quietly falls
 * out of smoke defeats the point of the gate.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CaseIndex } from "./parse.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const UI_TEST_DIR = path.join(REPO_ROOT, "tests/ui");
export const SMOKE_LIST_PATH = path.join(UI_TEST_DIR, "smoke.list");

const VERIFIES_LINE = /^\s*(?:\/\/|\*)\s*@verifies\s+([A-Z][A-Z0-9]*-C?\d+(?:[\s,]+[A-Z][A-Z0-9]*-C?\d+)*)/;
const TEST_CALL = /^\s*test(?:\.only|\.skip)?\(/;
const SPEC_FILE = /\.spec\.ts$/;

const BACKWARD_WINDOW = 8;
const FORWARD_WINDOW = 60;

export interface ResolvedTest {
  /** Path relative to `tests/ui/`, POSIX separators, matching Playwright's own reporting. */
  readonly file: string;
  readonly line: number;
}

export interface SmokeResolution {
  readonly tests: readonly ResolvedTest[];
  /** Blocker case IDs with an `@verifies` tag whose test could not be pinned down. */
  readonly unresolved: readonly { readonly caseId: string; readonly file: string; readonly line: number }[];
}

async function specFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name === "fixtures") continue;
      files.push(...(await specFiles(path.join(dir, entry.name))));
      continue;
    }
    if (SPEC_FILE.test(entry.name)) files.push(path.join(dir, entry.name));
  }
  return files;
}

function findTestLines(lines: readonly string[]): number[] {
  const out: number[] = [];
  lines.forEach((line, idx) => {
    if (TEST_CALL.test(line)) out.push(idx);
  });
  return out;
}

/** Nearest `test(` line behind `tagIdx` within `BACKWARD_WINDOW`, else nearest ahead within `FORWARD_WINDOW`. */
function resolveOne(lines: readonly string[], tagIdx: number): number | undefined {
  for (let k = tagIdx; k >= Math.max(0, tagIdx - BACKWARD_WINDOW); k -= 1) {
    if (TEST_CALL.test(lines[k] ?? "")) return k;
  }
  for (let k = tagIdx + 1; k < Math.min(lines.length, tagIdx + FORWARD_WINDOW); k += 1) {
    if (TEST_CALL.test(lines[k] ?? "")) return k;
  }
  return undefined;
}

/**
 * Resolves every `@verifies` tag in `<uiTestDir>/**\/*.spec.ts` that
 * names a blocker case to the line(s) of the test(s) it covers.
 * `uiTestDir` defaults to the real `tests/ui/` and is parameterized only
 * so unit tests can point it at a fixture directory.
 */
export async function resolveSmokeTests(index: CaseIndex, uiTestDir: string = UI_TEST_DIR): Promise<SmokeResolution> {
  const blockers = new Set(index.cases.filter((c) => c.severity === "blocker").map((c) => c.id));

  const files = (await specFiles(uiTestDir)).sort();
  const tests = new Map<string, Set<number>>(); // file (relative) -> line set (0-indexed)
  const unresolved: { caseId: string; file: string; line: number }[] = [];

  for (const abs of files) {
    const rel = path.relative(uiTestDir, abs).split(path.sep).join("/");
    const lines = (await readFile(abs, "utf8")).split("\n");
    const allTestLines = findTestLines(lines);

    lines.forEach((line, idx) => {
      const match = VERIFIES_LINE.exec(line);
      const ids = match?.[1];
      if (ids === undefined) return;

      const caseIds = ids.split(/[\s,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
      const relevant = caseIds.filter((id) => blockers.has(id));
      if (relevant.length === 0) return;

      const resolved = resolveOne(lines, idx);
      if (resolved !== undefined) {
        const set = tests.get(rel) ?? new Set<number>();
        set.add(resolved);
        tests.set(rel, set);
        return;
      }

      // File-level claim (no single test): every test in the file counts.
      if (allTestLines.length > 0) {
        const set = tests.get(rel) ?? new Set<number>();
        for (const t of allTestLines) set.add(t);
        tests.set(rel, set);
        return;
      }

      for (const caseId of relevant) {
        unresolved.push({ caseId, file: rel, line: idx + 1 });
      }
    });
  }

  const resolvedTests: ResolvedTest[] = [];
  for (const [file, lineSet] of [...tests.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const line of [...lineSet].sort((a, b) => a - b)) {
      resolvedTests.push({ file, line: line + 1 });
    }
  }

  return { tests: resolvedTests, unresolved };
}

export function formatSmokeList(resolution: SmokeResolution): string {
  const entries = resolution.tests.map((t) => `${t.file}:${String(t.line)}`);
  return entries.length > 0 ? `${entries.join("\n")}\n` : "";
}

export async function writeSmokeList(index: CaseIndex): Promise<SmokeResolution> {
  const resolution = await resolveSmokeTests(index);
  await writeFile(SMOKE_LIST_PATH, formatSmokeList(resolution), "utf8");
  return resolution;
}

export async function readCommittedSmokeList(): Promise<string | undefined> {
  try {
    return await readFile(SMOKE_LIST_PATH, "utf8");
  } catch {
    return undefined;
  }
}
