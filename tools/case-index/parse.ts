/**
 * Parses the prose acceptance-criteria docs into a machine-readable index.
 *
 * The flow docs under docs/dev/{ui,surface}-test-cases/ are the specification
 * an agent builds against. Prose is right for humans reasoning about
 * behaviour, but an agent re-reading 878 cases each iteration will
 * paraphrase them differently every time. The index gives every case a
 * stable, addressable identity so "which cases does this ticket cover" and
 * "which cases are unverified" become lookups rather than re-readings.
 *
 * The parser is deliberately strict: a heading that does not match the
 * documented shape is an error, not a skipped line. A silently dropped case
 * is a case nothing will ever test.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type Severity = "blocker" | "major" | "minor";
export type Milestone = "M1" | "M2" | "M3" | "M4";
export type Surface = "CLI" | "MCP" | "UI";
export type Tree = "ui" | "surface";

export interface TestCase {
  /** Stable case ID, e.g. "LST-3" or "CMT-C4". Never renumbered. */
  readonly id: string;
  /** Which doc tree the case came from. */
  readonly tree: Tree;
  /** Repo-relative path of the flow doc declaring it. */
  readonly file: string;
  /** 1-indexed line of the `###` heading. */
  readonly line: number;
  /** The bolded one-sentence claim following the heading. */
  readonly title: string;
  /** UI cases only — the milestone the case becomes verifiable in. */
  readonly milestone?: Milestone;
  readonly severity: Severity;
  /** Principles the case defends, e.g. ["P2", "P8"]. */
  readonly principles: readonly string[];
  /** Surfaces the case applies to. UI cases are implicitly ["UI"]. */
  readonly surfaces: readonly Surface[];
  /**
   * True when the heading carries the `— **resolved**` suffix: the gap the
   * case describes has since been closed. The case stays indexed and
   * addressable — it is still a requirement, and a regression must still
   * fail — but it is not outstanding work.
   */
  readonly resolved: boolean;
}

export interface CaseIndex {
  readonly generated_from: string;
  readonly counts: {
    readonly total: number;
    readonly ui: number;
    readonly surface: number;
    readonly resolved: number;
  };
  readonly cases: readonly TestCase[];
}

const SEVERITIES = new Set<string>(["blocker", "major", "minor"]);
const MILESTONES = new Set<string>(["M1", "M2", "M3", "M4"]);
const SURFACES = new Set<string>(["CLI", "MCP", "UI"]);

/** Case headings are `### <ID> · …`; section headings like `### A.1 Foo` are not. */
const CASE_HEADING = /^###\s+([A-Z][A-Z0-9]*-C?\d+)\s+·\s+(.+?)\s*$/;
const PRINCIPLE = /^P([1-9]|1[01])$/;
/** A closed gap keeps its case; the suffix records that it is no longer outstanding. */
const RESOLVED_SUFFIX = /\s+—\s+\*\*resolved\*\*$/;

export class CaseParseError extends Error {
  constructor(file: string, line: number, detail: string) {
    super(`${file}:${line} — ${detail}`);
    this.name = "CaseParseError";
  }
}

/**
 * Pulls the case title from the bolded claim on the line after the heading.
 * A claim may wrap across lines, so we read to the closing `**` rather than
 * to the end of the first line.
 */
function extractTitle(lines: readonly string[], headingIdx: number): string | undefined {
  const first = lines[headingIdx + 1];
  if (first === undefined || !first.startsWith("**")) return undefined;

  const collected: string[] = [];
  for (let i = headingIdx + 1; i < lines.length && i <= headingIdx + 6; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    collected.push(line);
    // The claim closes on the first `**` that is not the opening one.
    if (collected.join(" ").slice(2).includes("**")) break;
  }

  const joined = collected.join(" ");
  const end = joined.indexOf("**", 2);
  if (end === -1) return undefined;
  return joined.slice(2, end).replace(/\s+/g, " ").trim();
}

/**
 * Splits a heading's `·`-separated tags into the typed fields. UI headings
 * carry a milestone and no surface list; surface headings carry a surface
 * list and no milestone. Anything else is a malformed heading.
 */
function parseTags(
  tree: Tree,
  rawTags: string,
  file: string,
  line: number,
): Pick<TestCase, "milestone" | "severity" | "principles" | "surfaces" | "resolved"> {
  const resolved = RESOLVED_SUFFIX.test(rawTags);
  const tags = rawTags
    .replace(RESOLVED_SUFFIX, "")
    .split("·")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  let milestone: Milestone | undefined;
  let severity: Severity | undefined;
  const principles: string[] = [];
  const surfaces: Surface[] = [];

  for (const tag of tags) {
    if (MILESTONES.has(tag)) {
      if (milestone !== undefined) {
        throw new CaseParseError(file, line, `two milestone tags (${milestone}, ${tag})`);
      }
      milestone = tag as Milestone;
      continue;
    }
    if (SEVERITIES.has(tag)) {
      if (severity !== undefined) {
        throw new CaseParseError(file, line, `two severity tags (${severity}, ${tag})`);
      }
      severity = tag as Severity;
      continue;
    }
    // Principles and surfaces both arrive space-separated within one tag.
    const parts = tag.split(/\s+/);
    if (parts.every((p) => PRINCIPLE.test(p))) {
      principles.push(...parts);
      continue;
    }
    if (parts.every((p) => SURFACES.has(p))) {
      surfaces.push(...(parts as Surface[]));
      continue;
    }
    throw new CaseParseError(file, line, `unrecognized tag "${tag}"`);
  }

  if (severity === undefined) {
    throw new CaseParseError(file, line, "no severity tag (blocker/major/minor)");
  }
  if (principles.length === 0) {
    throw new CaseParseError(file, line, "no principle tags (P1–P11)");
  }

  if (tree === "ui") {
    if (milestone === undefined) {
      throw new CaseParseError(file, line, "UI case has no milestone tag (M1–M4)");
    }
    if (surfaces.length > 0) {
      throw new CaseParseError(file, line, "UI case carries a surface tag");
    }
    return { milestone, severity, principles, surfaces: ["UI"], resolved };
  }

  if (milestone !== undefined) {
    throw new CaseParseError(
      file,
      line,
      "surface case carries a milestone tag (M1–M4 schedule the web UI build only)",
    );
  }
  if (surfaces.length === 0) {
    throw new CaseParseError(file, line, "surface case has no surface tag (CLI/MCP)");
  }
  return { severity, principles, surfaces, resolved };
}

async function parseFile(absPath: string, repoRoot: string, tree: Tree): Promise<TestCase[]> {
  const rel = path.relative(repoRoot, absPath);
  const lines = (await readFile(absPath, "utf8")).split("\n");
  const cases: TestCase[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const match = CASE_HEADING.exec(raw);
    if (match === null) continue;

    const [, id, rawTags] = match;
    if (id === undefined || rawTags === undefined) continue;
    const line = i + 1;

    const title = extractTitle(lines, i);
    if (title === undefined) {
      throw new CaseParseError(rel, line, `${id} has no bolded claim on the following line`);
    }

    cases.push({
      id,
      tree,
      file: rel,
      line,
      title,
      ...parseTags(tree, rawTags, rel, line),
    });
  }

  return cases;
}

async function flowDocs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.startsWith("flow-") && e.name.endsWith(".md"))
    .map((e) => path.join(dir, e.name))
    .sort();
}

export async function buildIndex(repoRoot: string): Promise<CaseIndex> {
  const trees: readonly { tree: Tree; dir: string }[] = [
    { tree: "ui", dir: path.join(repoRoot, "tests/cases/ui-test-cases") },
    { tree: "surface", dir: path.join(repoRoot, "tests/cases/surface-test-cases") },
  ];

  const cases: TestCase[] = [];
  for (const { tree, dir } of trees) {
    for (const doc of await flowDocs(dir)) {
      cases.push(...(await parseFile(doc, repoRoot, tree)));
    }
  }

  // IDs address cases across docs and commits; a duplicate means two
  // different requirements answer to one name and coverage silently
  // conflates them.
  const seen = new Map<string, TestCase>();
  const duplicates: string[] = [];
  for (const c of cases) {
    const prior = seen.get(c.id);
    if (prior !== undefined) {
      duplicates.push(`${c.id}: ${prior.file}:${prior.line} and ${c.file}:${c.line}`);
      continue;
    }
    seen.set(c.id, c);
  }
  if (duplicates.length > 0) {
    throw new Error(`Duplicate case IDs:\n  ${duplicates.join("\n  ")}`);
  }

  cases.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

  return {
    generated_from: "tests/cases/ui-test-cases/, tests/cases/surface-test-cases/",
    counts: {
      total: cases.length,
      ui: cases.filter((c) => c.tree === "ui").length,
      surface: cases.filter((c) => c.tree === "surface").length,
      resolved: cases.filter((c) => c.resolved).length,
    },
    cases,
  };
}
