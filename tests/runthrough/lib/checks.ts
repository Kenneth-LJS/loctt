/**
 * The runthrough checks. Each reads the tracker files directly (K144)
 * and returns `null` on success or a message naming what was expected
 * and what was found.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { Check } from "./schema.ts";
import { diffSnapshots, type Snapshot,snapshot } from "./snapshot.ts";
import { asStringArray, parseTaskFile, type TaskRecord, type TrackerView } from "./tracker.ts";

export interface CheckContext {
  readonly tracker: TrackerView;
  /** The tracker as it was before the step's action ran. */
  readonly before: Snapshot;
  /** The action's combined output (undefined for pre-checks). */
  readonly output: string | undefined;
  /** The surface that produced `output`. */
  readonly surface?: "cli" | "mcp";
}

const show = (v: unknown): string => (v === undefined ? "(absent)" : JSON.stringify(v));

function fieldValue(task: TaskRecord, field: string): unknown {
  if (field === "body") return task.body;
  if (field.startsWith("fields.")) {
    const fields = task.frontmatter["fields"];
    if (fields === null || typeof fields !== "object") return undefined;
    return (fields as Record<string, unknown>)[field.slice("fields.".length)];
  }
  return task.frontmatter[field];
}

function compare(
  actual: unknown,
  c: { equals?: unknown; contains?: unknown; absent?: true | undefined; matches?: string | undefined },
): string | null {
  if (c.absent) return actual === undefined ? null : `expected absent, found ${show(actual)}`;
  if (c.matches !== undefined) {
    const text = typeof actual === "string" ? actual : JSON.stringify(actual);
    return actual !== undefined && new RegExp(c.matches).test(text)
      ? null
      : `expected to match /${c.matches}/, found ${show(actual)}`;
  }
  if (c.contains !== undefined) {
    if (Array.isArray(actual)) {
      return actual.some(v => isDeepStrictEqual(v, c.contains)) ? null : `expected ${show(actual)} to contain ${show(c.contains)}`;
    }
    if (typeof actual === "string" && typeof c.contains === "string") {
      return actual.includes(c.contains) ? null : `expected ${show(actual)} to contain ${show(c.contains)}`;
    }
    return `expected a list or string containing ${show(c.contains)}, found ${show(actual)}`;
  }
  return isDeepStrictEqual(actual, c.equals) ? null : `expected ${show(c.equals)}, found ${show(actual)}`;
}

function keyOf(tracker: TrackerView, id: string): string {
  return tracker.tasks().find(t => t.id === id)?.key ?? id;
}

/**
 * Edges of `type` in their display order: by `rank` when any edge
 * carries one (unranked edges after the ranked ones, as the schema
 * reference documents), otherwise in stored order.
 */
export function orderedTargets(tracker: TrackerView, task: TaskRecord, type: string): string[] {
  const edges = tracker.relationships(task).filter(r => r.type === type);
  const indexed = edges.map((e, i) => ({ e, i }));
  indexed.sort((a, b) => {
    const ra = a.e.rank;
    const rb = b.e.rank;
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra < rb ? -1 : 1;
    if (ra !== undefined && rb === undefined) return -1;
    if (ra === undefined && rb !== undefined) return 1;
    return a.i - b.i;
  });
  return indexed.map(x => x.e.target);
}

/**
 * Every edge on `task` has its mirror on the target, and every edge
 * pointing at `task` has its mirror on `task`. Returns the violations.
 */
export function bilateralViolations(tracker: TrackerView, task: TaskRecord): string[] {
  const out: string[] = [];
  const all = tracker.tasks();
  const byId = new Map(all.map(t => [t.id, t]));
  for (const edge of tracker.relationships(task)) {
    const inverse = tracker.inverseOf(edge.type);
    if (inverse === undefined) continue;
    const target = byId.get(edge.target);
    if (!target) {
      out.push(`${task.key} --${edge.type}--> ${edge.target}: target is not a task id on disk`);
      continue;
    }
    if (!tracker.relationships(target).some(r => r.type === inverse && r.target === task.id)) {
      out.push(`${task.key} --${edge.type}--> ${target.key}, but ${target.key} has no ${inverse} → ${task.key}`);
    }
  }
  for (const other of all) {
    if (other.id === task.id) continue;
    for (const edge of tracker.relationships(other)) {
      if (edge.target !== task.id) continue;
      const inverse = tracker.inverseOf(edge.type);
      if (inverse === undefined) continue;
      if (!tracker.relationships(task).some(r => r.type === inverse && r.target === other.id)) {
        out.push(`${other.key} --${edge.type}--> ${task.key}, but ${task.key} has no ${inverse} → ${other.key}`);
      }
    }
  }
  return out;
}

/**
 * Ids of tasks whose stored relationships differ from `before` — the
 * "touched links" the automatic bilateral check covers. A deleted task
 * is covered through its former link partners, which changed too.
 */
export function touchedLinkTaskIds(before: Snapshot, tracker: TrackerView): string[] {
  const ids: string[] = [];
  for (const t of tracker.tasks()) {
    const posix = t.file.split("\\").join("/");
    const prev = before.get(posix);
    const now = tracker.relationships(t).map(r => [r.type, r.target]);
    if (prev === undefined) {
      if (now.length > 0) ids.push(t.id);
      continue;
    }
    let prevRels: unknown[] = [];
    try {
      const fm = parseTaskFile(prev, posix).frontmatter["relationships"];
      prevRels = Array.isArray(fm)
        ? fm.map((r: unknown) => {
          const rec = (r ?? {}) as Record<string, unknown>;
          return [String(rec["type"]), String(rec["target"])];
        })
        : [];
    } catch {
      // the old file did not parse; treat every current edge as touched
    }
    if (!isDeepStrictEqual(prevRels, now)) ids.push(t.id);
  }
  return ids;
}

/** Task keys a list/search result names, by surface-neutral parsing. */
export function resultKeys(output: string): string[] {
  // MCP results are JSON, possibly after other calls' output: parse the
  // last document that starts at column 0 (a list call is the last call).
  const lines = output.split("\n");
  for (let start = lines.length - 1; start >= 0; start--) {
    const first = lines[start] ?? "";
    if (!first.startsWith("[") && !first.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines.slice(start).join("\n"));
    } catch {
      continue;
    }
    const rows = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { tasks?: unknown }).tasks) ? (parsed as { tasks: unknown[] }).tasks : undefined;
    if (rows) return rows.flatMap(r => (r && typeof r === "object" && "key" in r ? [String((r as { key: unknown }).key)] : []));
    break;
  }
  const keys: string[] = [];
  for (const line of output.split("\n")) {
    const m = /^\s*(?:⚠\s*)?([A-Z][A-Z0-9]*-\d+)\s/.exec(line);
    if (m) keys.push(m[1] as string);
  }
  return keys;
}

type YamlPathToken = { key: string } | { select: [string, string] } | { index: number };

function yamlPath(root: unknown, path: string): unknown {
  const tokens: YamlPathToken[] = [];
  const re = /([^.[\]]+)|\[([^=\]]+)=([^\]]*)\]|\[(\d+)\]/g;
  for (const m of path.matchAll(re)) {
    if (m[1] !== undefined) tokens.push({ key: m[1] });
    else if (m[2] !== undefined) tokens.push({ select: [m[2], m[3] ?? ""] });
    else tokens.push({ index: Number(m[4]) });
  }
  let cur: unknown = root;
  for (const tok of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if ("key" in tok) cur = (cur as Record<string, unknown>)[tok.key];
    else if ("index" in tok) cur = Array.isArray(cur) ? cur[tok.index] : undefined;
    else {
      const [k, v] = tok.select;
      cur = Array.isArray(cur)
        ? cur.find(el => el && typeof el === "object" && String((el as Record<string, unknown>)[k]) === v)
        : undefined;
    }
  }
  return cur;
}

const ENTITY_FILES = {
  project: ["config/projects.yaml", "projects"],
  label: ["config/labels.yaml", "labels"],
  milestone: ["config/milestones.yaml", "milestones"],
  sprint: ["config/sprints.yaml", "sprints"],
  view: ["config/queries.yaml", "queries"],
} as const;

function whereMatches(actual: unknown, want: unknown): boolean {
  const isEmpty = actual === undefined || actual === null || (Array.isArray(actual) && actual.length === 0);
  if (want !== null && typeof want === "object" && !Array.isArray(want)) {
    const w = want as Record<string, unknown>;
    if (w["absent"] === true) return isEmpty;
    if (w["present"] === true) return !isEmpty;
    if (Array.isArray(w["in"])) {
      const list = w["in"] as unknown[];
      return Array.isArray(actual)
        ? actual.some(a => list.some(l => isDeepStrictEqual(a, l)))
        : list.some(l => isDeepStrictEqual(actual, l));
    }
  }
  if (Array.isArray(actual) && !Array.isArray(want)) return actual.some(a => isDeepStrictEqual(a, want));
  return isDeepStrictEqual(actual, want);
}

export function runCheck(check: Check, ctx: CheckContext): string | null {
  const { tracker } = ctx;

  if ("task_exists" in check) {
    return tracker.findTask(check.task_exists) ? null : `expected a task matching "${check.task_exists}", found none`;
  }
  if ("task_absent" in check) {
    const t = tracker.findTask(check.task_absent);
    return t ? `expected no task matching "${check.task_absent}", found ${t.key} (${t.file})` : null;
  }
  if ("field" in check) {
    const c = check.field;
    const task = tracker.task(c.task);
    const failure = compare(fieldValue(task, c.field), c);
    return failure === null ? null : `${task.key}.${c.field}: ${failure}`;
  }
  if ("relationship" in check) {
    const c = check.relationship;
    const task = tracker.task(c.task);
    const edges = tracker.relationships(task).filter(r => r.type === c.type);
    const target = tracker.findTask(c.target);
    if (c.present) {
      if (!target) return `${task.key}: relationship target "${c.target}" is not a task on disk`;
      if (edges.some(e => e.target === target.id)) return null;
      const asKey = edges.find(e => e.target === target.key || asStringArray(target.frontmatter["key_history"]).includes(e.target));
      if (asKey) return `${task.key} --${c.type}--> ${target.key} is stored by key ("${asKey.target}"), expected the id ${target.id}`;
      return `expected ${task.key} --${c.type}--> ${target.key} (${target.id}); ${c.type} edges are ${show(edges.map(e => keyOf(tracker, e.target)))}`;
    }
    const hit = edges.find(e => e.target === c.target || (target !== undefined && e.target === target.id));
    return hit ? `expected no ${task.key} --${c.type}--> ${c.target}, but it is stored` : null;
  }
  if ("relationship_order" in check) {
    const c = check.relationship_order;
    const task = tracker.task(c.task);
    const want = c.targets.map(r => tracker.task(r).id);
    const got = orderedTargets(tracker, task, c.type);
    return isDeepStrictEqual(got, want)
      ? null
      : `${task.key} ${c.type} order: expected ${show(want.map(id => keyOf(tracker, id)))}, found ${show(got.map(id => keyOf(tracker, id)))}`;
  }
  if ("bilateral" in check) {
    const violations = bilateralViolations(tracker, tracker.task(check.bilateral));
    return violations.length === 0 ? null : `one-sided links:\n  ${violations.join("\n  ")}`;
  }
  if ("count" in check) {
    const c = check.count;
    const matched = tracker.tasks().filter(t => {
      const archived = t.frontmatter["archived"] === true;
      if (c.archived === "exclude" && archived) return false;
      if (c.archived === "only" && !archived) return false;
      return Object.entries(c.where).every(([field, want]) => whereMatches(fieldValue(t, field), want));
    });
    return matched.length === c.equals
      ? null
      : `count where ${show(c.where)} (archived: ${c.archived}): expected ${c.equals}, found ${matched.length} ${show(matched.map(t => t.key))}`;
  }
  if ("comment" in check) {
    const c = check.comment;
    const task = tracker.task(c.task);
    const comments = tracker.comments(task);
    const hits = comments.filter(cm =>
      (c.id === undefined || cm["id"] === c.id)
      && (c.contains === undefined || (typeof cm["body"] === "string" && cm["body"].includes(c.contains)))
      && (c.author === undefined || cm["author"] === c.author)
      && (c.mentions === undefined || c.mentions.every(m => asStringArray(cm["mentions"]).includes(m)))
      && (c.edited === undefined || (cm["edited"] === true) === c.edited));
    if (c.present && hits.length === 0) {
      return `${task.key}: no comment matches ${show({ id: c.id, contains: c.contains, author: c.author, mentions: c.mentions, edited: c.edited })}; comments are ${show(comments)}`;
    }
    if (!c.present && hits.length > 0) return `${task.key}: expected no comment matching, found ${show(hits)}`;
    return null;
  }
  if ("comment_count" in check) {
    const task = tracker.task(check.comment_count.task);
    const n = tracker.comments(task).length;
    return n === check.comment_count.equals ? null : `${task.key}: expected ${check.comment_count.equals} comment(s), found ${n}`;
  }
  if ("attachment" in check) {
    const c = check.attachment;
    const task = tracker.task(c.task);
    const file = tracker.abs(`${tracker.attachmentsDir(task)}/${c.name}`);
    const present = existsSync(file);
    if (present !== c.present) return `${task.key}: attachment ${c.name} expected ${c.present ? "present" : "absent"}, is ${present ? "present" : "absent"}`;
    if (present && c.content !== undefined) {
      const actual = readFileSync(file, "utf-8");
      if (actual !== c.content) return `${task.key}: attachment ${c.name} content: expected ${show(c.content)}, found ${show(actual)}`;
    }
    return null;
  }
  if ("entity" in check) {
    const c = check.entity;
    let list: unknown[];
    if (c.kind === "user") list = tracker.users();
    else {
      const [file, key] = ENTITY_FILES[c.kind];
      const doc = tracker.readYaml(file) as Record<string, unknown> | undefined;
      list = Array.isArray(doc?.[key]) ? doc[key] as unknown[] : [];
    }
    const found = list.filter(e => e && typeof e === "object" && (e as Record<string, unknown>)["name"] === c.name) as Array<Record<string, unknown>>;
    if (!c.present) return found.length === 0 ? null : `expected no ${c.kind} named "${c.name}", found ${found.length}`;
    if (found.length !== 1) return `expected one ${c.kind} named "${c.name}", found ${found.length}`;
    const entity = found[0] as Record<string, unknown>;
    for (const [k, want] of Object.entries(c.fields ?? {})) {
      const actual = entity[k];
      const ok = want === null ? actual === undefined || actual === null : isDeepStrictEqual(actual, want);
      if (!ok) return `${c.kind} "${c.name}".${k}: expected ${want === null ? "(absent)" : show(want)}, found ${show(actual)}`;
    }
    return null;
  }
  if ("yaml" in check) {
    const c = check.yaml;
    if (!tracker.exists(c.file)) {
      return c.absent ? null : `${c.file}: file does not exist`;
    }
    const failure = compare(yamlPath(tracker.readYaml(c.file), c.path), c);
    return failure === null ? null : `${c.file} ${c.path || "(root)"}: ${failure}`;
  }
  if ("file_unchanged" in check) {
    const diff = diffSnapshots(ctx.before, snapshot(tracker.locttDir), check.file_unchanged);
    return diff === "" ? null : `expected ${check.file_unchanged} unchanged:\n${diff}`;
  }
  if ("changed_only" in check) {
    const dirs: string[] = [];
    for (const ref of check.changed_only.tasks) {
      const t = tracker.findTask(ref);
      if (!t) return `changed_only: no task on disk matches "${ref}"`;
      dirs.push(`tasks/${t.id}/`);
    }
    const files = new Set(check.changed_only.files ?? []);
    const after = snapshot(tracker.locttDir);
    const outside = [...new Set([...ctx.before.keys(), ...after.keys()])]
      .filter(name => ctx.before.get(name) !== after.get(name))
      .filter(name => !files.has(name) && !dirs.some(d => name.startsWith(d)))
      .sort();
    if (outside.length === 0) return null;
    return `expected changes only to ${show(check.changed_only)}; also changed:\n`
      + outside.map(name => diffSnapshots(ctx.before, after, name)).join("\n");
  }
  if ("tracker_unchanged" in check) {
    const diff = diffSnapshots(ctx.before, snapshot(tracker.locttDir));
    return diff === "" ? null : `expected the tracker unchanged:\n${diff}`;
  }
  if ("path" in check) {
    const there = existsSync(path.join(tracker.root, check.path.path));
    return there === check.path.exists ? null : `expected ${check.path.path} to ${check.path.exists ? "exist" : "be absent"}`;
  }
  if ("git" in check) {
    const g = check.git;
    const repo = g.repo === "remote" ? remoteOf(tracker.root) : tracker.root;
    const sha = gitRevOrNull(repo, g.ref, g.repo === "remote");
    if (!g.exists) return sha === null ? null : `expected ${g.repo} ref ${g.ref} to be absent, it is ${sha}`;
    if (sha === null) return `expected ${g.repo} ref ${g.ref} to exist`;
    if (g.not_equals !== undefined && sha === g.not_equals) return `expected ${g.ref} to have moved from ${g.not_equals}`;
    return null;
  }
  if ("git_show" in check) {
    const res = spawnSync("git", ["show", check.git_show.spec], { cwd: tracker.root, encoding: "utf-8" });
    if (res.status !== 0) return `git show ${check.git_show.spec} failed: ${res.stderr}`;
    return res.stdout.includes(check.git_show.contains)
      ? null
      : `expected git show ${check.git_show.spec} to contain ${show(check.git_show.contains)}; got:\n${res.stdout}`;
  }
  // "output" in check
  const c = check.output;
  if (ctx.output === undefined) return "output: there is no action output to check here (a pre-check?)";
  if (c.surface !== undefined && ctx.surface !== undefined && c.surface !== ctx.surface) return null;
  const out = ctx.output;
  for (const s of c.contains ?? []) if (!out.includes(s)) return `output: expected to contain ${show(s)}; output was:\n${out}`;
  for (const s of c.not_contains ?? []) if (out.includes(s)) return `output: expected not to contain ${show(s)}; output was:\n${out}`;
  if (c.in_order) {
    let at = -1;
    for (const s of c.in_order) {
      const next = out.indexOf(s, at + 1);
      if (next < 0) return `output: expected ${show(c.in_order)} in that order; ${show(s)} not found after position ${at}; output was:\n${out}`;
      at = next;
    }
  }
  if (c.line_count) {
    const re = new RegExp(c.line_count.matches);
    const n = out.split("\n").filter(l => re.test(l)).length;
    if (n !== c.line_count.equals) return `output: expected ${String(c.line_count.equals)} line(s) matching /${c.line_count.matches}/, found ${String(n)}; output was:\n${out}`;
  }
  if (c.keys) {
    const got = [...new Set(resultKeys(out))].sort();
    const want = [...new Set(c.keys)].sort();
    if (!isDeepStrictEqual(got, want)) return `output: expected keys ${show(want)}, found ${show(got)}; output was:\n${out}`;
  }
  return null;
}

/** A one-line label for a check, for failure messages. */
export function describeCheck(check: Check): string {
  const [kind] = Object.keys(check);
  return `${kind ?? "?"} ${JSON.stringify((check as Record<string, unknown>)[kind ?? ""])}`;
}

/** The bare remote `blankTracker` made for `git: remote`. */
function remoteOf(root: string): string {
  return path.join(root, ".remote.git");
}

function gitRevOrNull(repo: string, ref: string, bare: boolean): string | null {
  const args = bare ? ["--git-dir", repo, "rev-parse", "--verify", "-q", ref] : ["rev-parse", "--verify", "-q", ref];
  const res = spawnSync("git", args, { cwd: bare ? path.dirname(repo) : repo, encoding: "utf-8" });
  return res.status === 0 ? res.stdout.trim() : null;
}

/** The commit `ref` points at in the tracker's repository; throws if none. */
export function gitRev(root: string, ref: string): string {
  const sha = gitRevOrNull(root, ref, false);
  if (sha === null) throw new Error(`git ref ${ref} does not exist`);
  return sha;
}

