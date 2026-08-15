// Standalone assertion helpers for llm:verify scripts. No vitest, no
// node:assert — every failure throws AssertionError with a structured
// message that names the scenario expectation that broke.
//
// Each helper reads `.loctt/` under `process.cwd()` so a human can `cd`
// into the workspace under verification and run `npm run llm:verify`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { Task, WorkflowConfig } from "@loctt/contracts";
import {
  loadWorkflowConfig,
  parseFrontmatter,
  resolveLocttDir,
  splitTaskFile,
} from "@loctt/core";
import { parse as parseYaml } from "yaml";

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

function fail(message: string): never {
  throw new AssertionError(message);
}

interface LoadedTask {
  readonly id: string;
  readonly frontmatter: Task["frontmatter"];
  readonly body: string;
}

function root(): string {
  return process.cwd();
}

function locttDir(): string {
  return resolveLocttDir(root());
}

function tasksDir(): string {
  return path.join(locttDir(), "tasks");
}

function listTaskIds(): string[] {
  let entries: string[];
  try {
    entries = readdirSync(tasksDir());
  } catch {
    return [];
  }
  return entries.filter(name => {
    try {
      return statSync(path.join(tasksDir(), name)).isDirectory();
    } catch {
      return false;
    }
  });
}

function loadAll(): LoadedTask[] {
  const out: LoadedTask[] = [];
  for (const id of listTaskIds()) {
    const taskPath = path.join(tasksDir(), id, "task.md");
    let raw: string;
    try {
      raw = readFileSync(taskPath, "utf-8");
    } catch {
      continue;
    }
    const { rawYaml, body } = splitTaskFile(raw);
    const fm = parseFrontmatter(rawYaml);
    out.push({ id, frontmatter: fm, body });
  }
  return out;
}

function findByRef(refOrKey: string): LoadedTask | undefined {
  const all = loadAll();
  // Try id (ULID 26-char) match first, then key.
  return all.find(t => t.id === refOrKey || t.frontmatter.key === refOrKey);
}

function matches(value: string | undefined, matcher: string | RegExp): boolean {
  if (value === undefined) return false;
  if (matcher instanceof RegExp) return matcher.test(value);
  return value === matcher;
}

function describe(matcher: string | RegExp): string {
  return matcher instanceof RegExp ? matcher.toString() : JSON.stringify(matcher);
}

let workflowCache: WorkflowConfig | undefined;
async function getWorkflow(): Promise<WorkflowConfig> {
  if (!workflowCache) {
    workflowCache = await loadWorkflowConfig(locttDir());
  }
  return workflowCache;
}

function inverseOf(workflow: WorkflowConfig, type: string): string {
  // The workflow stores each bilateral edge as a single record keyed by
  // one direction with an `inverse` pointing at the other. So `type` may
  // appear as either `key` or `inverse`.
  const direct = workflow.relationships.find(r => r.key === type);
  // A symmetric relationship declares no `inverse` — it folds onto
  // itself, so the inverse edge carries the same key.
  if (direct) return direct.inverse ?? direct.key;
  const reverse = workflow.relationships.find(r => r.inverse === type);
  if (reverse) return reverse.key;
  fail(`relationship type "${type}" is not defined in workflow.yaml`);
}

function readHistorySync(taskId: string): unknown[] {
  const filePath = path.join(tasksDir(), taskId, "_history.yaml");
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const parsed: unknown = parseYaml(content);
  return Array.isArray(parsed) ? parsed : [];
}

function listAttachments(taskId: string): string[] {
  const dir = path.join(tasksDir(), taskId, "attachments");
  try {
    return readdirSync(dir).filter(n => !n.startsWith("."));
  } catch {
    return [];
  }
}

export interface TaskAssertion {
  toExist(): TaskAssertion;
  notToExist(): TaskAssertion;
  toHaveTitle(matcher: string | RegExp): TaskAssertion;
  toHaveStatus(value: string | string[]): TaskAssertion;
  toHavePriority(value: string): TaskAssertion;
  toHaveField(field: string, value: unknown): TaskAssertion;
  toHaveBody(matcher: string | RegExp): TaskAssertion;
  notToHaveBody(matcher: string | RegExp): TaskAssertion;
  toBeArchived(): TaskAssertion;
  notToBeArchived(): TaskAssertion;
  toBeBlockedBy(refOrKey: string): Promise<TaskAssertion>;
  toBlock(refOrKey: string): Promise<TaskAssertion>;
  toHaveParent(refOrKey: string): Promise<TaskAssertion>;
  toHaveChild(refOrKey: string): Promise<TaskAssertion>;
  toHaveAttachment(name: string | RegExp): TaskAssertion;
  toHaveHistoryEntry(kind: string): TaskAssertion;
}

export function expectTask(refOrKey: string): TaskAssertion {
  // Resolve the task lazily so notToExist() can be called against a
  // ref that is supposed to be missing.
  const get = (): LoadedTask => {
    const t = findByRef(refOrKey);
    if (!t) fail(`expected task ${refOrKey} to exist, but no task with that id or key was found`);
    return t;
  };

  const resolveTarget = (target: string): LoadedTask => {
    const t = findByRef(target);
    if (!t) fail(`expected task ${target} (relationship target) to exist, but no task with that id or key was found`);
    return t;
  };

  const a: TaskAssertion = {
    toExist() {
      get();
      return a;
    },
    notToExist() {
      const t = findByRef(refOrKey);
      if (t) fail(`expected task ${refOrKey} not to exist, but it does (id=${t.id}, key=${t.frontmatter.key})`);
      return a;
    },
    toHaveTitle(matcher) {
      const t = get();
      if (!matches(t.frontmatter.title, matcher)) {
        fail(`expected task ${refOrKey} title to match ${describe(matcher)}, got ${JSON.stringify(t.frontmatter.title)}`);
      }
      return a;
    },
    toHaveStatus(value) {
      const t = get();
      const accepted = Array.isArray(value) ? value : [value];
      const actual = t.frontmatter.status;
      if (actual === undefined || !accepted.includes(actual)) {
        fail(`expected task ${refOrKey} to have status ${JSON.stringify(accepted)}, got ${JSON.stringify(actual)}`);
      }
      return a;
    },
    toHavePriority(value) {
      const t = get();
      if (t.frontmatter.priority !== value) {
        fail(`expected task ${refOrKey} to have priority ${JSON.stringify(value)}, got ${JSON.stringify(t.frontmatter.priority)}`);
      }
      return a;
    },
    toHaveField(field, value) {
      const t = get();
      const fm = t.frontmatter as unknown as Record<string, unknown>;
      const actual = fm[field] ?? (fm["fields"] as Record<string, unknown> | undefined)?.[field];
      if (actual !== value) {
        fail(`expected task ${refOrKey}.${field} to equal ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`);
      }
      return a;
    },
    toHaveBody(matcher) {
      const t = get();
      if (!matches(t.body, matcher)) {
        fail(`expected task ${refOrKey} body to match ${describe(matcher)}, got ${JSON.stringify(t.body.slice(0, 200))}`);
      }
      return a;
    },
    notToHaveBody(matcher) {
      const t = get();
      if (matches(t.body, matcher)) {
        fail(`expected task ${refOrKey} body NOT to match ${describe(matcher)}, but it did`);
      }
      return a;
    },
    toBeArchived() {
      const t = get();
      if (t.frontmatter.archived !== true) {
        fail(`expected task ${refOrKey} to be archived, but archived=${JSON.stringify(t.frontmatter.archived)}`);
      }
      return a;
    },
    notToBeArchived() {
      const t = get();
      if (t.frontmatter.archived === true) {
        fail(`expected task ${refOrKey} not to be archived, but it is`);
      }
      return a;
    },
    async toBeBlockedBy(target) {
      // The relationship "is_blocked_by" should appear on `refOrKey` pointing at `target`.
      // The inverse "blocks" should appear on `target` pointing at `refOrKey`.
      await assertBilateral(refOrKey, target, "is_blocked_by");
      return a;
    },
    async toBlock(target) {
      await assertBilateral(refOrKey, target, "blocks");
      return a;
    },
    async toHaveParent(target) {
      await assertBilateral(refOrKey, target, "parent");
      return a;
    },
    async toHaveChild(target) {
      await assertBilateral(refOrKey, target, "child");
      return a;
    },
    toHaveAttachment(name) {
      const t = get();
      const files = listAttachments(t.id);
      const found = files.some(f => matches(f, name));
      if (!found) {
        fail(`expected task ${refOrKey} to have attachment matching ${describe(name)}, got [${files.join(", ")}]`);
      }
      return a;
    },
    toHaveHistoryEntry(kind) {
      const t = get();
      const entries = readHistorySync(t.id);
      const found = entries.some(e => {
        if (e === null || typeof e !== "object") return false;
        const rec = e as Record<string, unknown>;
        return rec["kind"] === kind || rec["type"] === kind;
      });
      if (!found) {
        fail(`expected task ${refOrKey} history to contain an entry of kind ${JSON.stringify(kind)}, but none was found (${entries.length} entries total)`);
      }
      return a;
    },
  };

  // assertBilateral is hoisted into closure; defined below.
  async function assertBilateral(sourceRef: string, targetRef: string, type: string): Promise<void> {
    const source = get();
    const target = resolveTarget(targetRef);
    const workflow = await getWorkflow();
    const inverse = inverseOf(workflow, type);

    const sourceRels = source.frontmatter.relationships ?? [];
    const targetRels = target.frontmatter.relationships ?? [];

    const forward = sourceRels.some(r => r.type === type && r.target === target.id);
    const back = targetRels.some(r => r.type === inverse && r.target === source.id);

    if (!forward) {
      fail(`expected task ${sourceRef} to have relationship "${type}" → ${targetRef}, but found ${JSON.stringify(sourceRels)}`);
    }
    if (!back) {
      fail(`expected task ${targetRef} to have inverse relationship "${inverse}" → ${sourceRef}, but found ${JSON.stringify(targetRels)}`);
    }
  }

  return a;
}

export function expectTaskCount(n: number): void {
  const all = loadAll();
  if (all.length !== n) {
    const summary = all.map(t => `${t.frontmatter.key}=${JSON.stringify(t.frontmatter.title)}`).join(", ");
    fail(`expected ${n} task(s), got ${all.length} [${summary}]`);
  }
}

export function expectActiveTaskCount(n: number): void {
  // Counts non-archived tasks. Useful when archive state matters.
  const active = loadAll().filter(t => t.frontmatter.archived !== true);
  if (active.length !== n) {
    fail(`expected ${n} non-archived task(s), got ${active.length}`);
  }
}

interface TaskFilter {
  title?: string | RegExp;
  status?: string;
  archived?: boolean;
}

function taskMatches(t: LoadedTask, filter: TaskFilter): boolean {
  if (filter.title !== undefined && !matches(t.frontmatter.title, filter.title)) return false;
  if (filter.status !== undefined && t.frontmatter.status !== filter.status) return false;
  if (filter.archived !== undefined && (t.frontmatter.archived ?? false) !== filter.archived) return false;
  return true;
}

export function expectAnyTaskWith(filter: TaskFilter): void {
  const all = loadAll();
  if (!all.some(t => taskMatches(t, filter))) {
    fail(`expected at least one task matching ${JSON.stringify(filter, replacer)}, but none of the ${all.length} tasks did`);
  }
}

export function expectNoTaskWith(filter: TaskFilter): void {
  const all = loadAll();
  const matched = all.filter(t => taskMatches(t, filter));
  if (matched.length > 0) {
    const summary = matched.map(t => `${t.frontmatter.key}=${JSON.stringify(t.frontmatter.title)}`).join(", ");
    fail(`expected NO task matching ${JSON.stringify(filter, replacer)}, but found ${matched.length} [${summary}]`);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value instanceof RegExp) return value.toString();
  return value;
}

/** For verify scripts that want to introspect the workspace directly. */
export async function workflow(): Promise<WorkflowConfig> {
  return getWorkflow();
}

/** Returns ids/keys of all tasks. Useful for read-only scenarios. */
export function allTasks(): ReadonlyArray<{ id: string; key: string; title: string; status?: string; archived?: boolean; priority?: string }> {
  return loadAll().map(t => ({
    id: t.id,
    key: t.frontmatter.key,
    title: t.frontmatter.title,
    ...(t.frontmatter.status !== undefined ? { status: t.frontmatter.status } : {}),
    ...(t.frontmatter.archived !== undefined ? { archived: t.frontmatter.archived } : {}),
    ...(t.frontmatter.priority !== undefined ? { priority: t.frontmatter.priority } : {}),
  }));
}
