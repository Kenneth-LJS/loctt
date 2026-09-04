import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  AutoMergedField,
  ConflictOption,
  ConflictValue,
  CustomFieldDef,
  ReconcilePlan,
  StatusDef,
  Task,
  TaskConflictField,
  WorkflowConfig,
} from "@loctt/contracts";

import { parseFrontmatter, splitTaskFile } from "../task/frontmatter.js";
import { loadAllTasks } from "../task/load-all.js";
import type { PathPlan } from "./three-way.js";
import { readTreeFile } from "./three-way.js";

/**
 * The REPORTING variant of the merge (GIT-6, GIT-11, GIT-13, GIT-14,
 * GIT-17).
 *
 * `merge.ts` `mergeTask` RESOLVES: it silently picks a winner per field
 * and hands back the merged task. The conflict cases need the opposite —
 * the per-field split, so the panel can ask the user. This module
 * classifies the same three cases `mergeTask` handles, but emits them
 * instead of settling them:
 *
 * - **different keys** in `relationships` / `fields` → union, auto-merged,
 *   no row (GIT-5). Reported so the merge is visible.
 * - **same scalar field, different values** → a conflict row (GIT-6,
 *   GIT-11). The `parent` edge is a conflict too, shown as tasks (GIT-13).
 * - **same field, identical value on both sides** → converged, auto-wins,
 *   no row, but named in the result (GIT-17).
 *
 * The classification (same-key-diff-value vs diff-key vs identical) is the
 * same rule `resolveFieldsFromHistory` walks; this does not re-resolve
 * from history, because a conflict is precisely the state history could
 * not settle — both sides deliberately hold a value and the user must
 * choose.
 *
 * Pure: it takes two parsed tasks and the workflow config and returns the
 * report. Reading tasks off disk and writing resolutions belong to the
 * caller.
 */

/** Scalar frontmatter fields a conflict can arise on, with their labels. */
const SCALAR_FIELDS: ReadonlyArray<{ field: string; label: string }> = [
  { field: "title", label: "Title" },
  { field: "status", label: "Status" },
  { field: "priority", label: "Priority" },
  { field: "task_type", label: "Type" },
  { field: "assignee", label: "Assignee" },
  { field: "due_date", label: "Due date" },
  { field: "start_date", label: "Start date" },
  { field: "estimate", label: "Estimate" },
  { field: "milestone", label: "Milestone" },
  { field: "sprint", label: "Sprint" },
];

/** Built-in enum fields whose values are workflow config keys. */
const ENUM_FIELDS: ReadonlySet<string> = new Set([
  "status", "priority", "task_type",
]);

/**
 * Compares two frontmatter values for equality of display identity. A
 * scalar compares by its string form; anything structural (an array,
 * object) compares by its JSON form, so `[object Object]` never stands in
 * for a real value.
 */
function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Options + label lookup for a built-in enum field. */
function builtinEnumDefs(
  field: string,
  config: WorkflowConfig | undefined,
): { key: string; label: string }[] {
  if (config === undefined) return [];
  if (field === "status") return config.statuses.map(s => ({ key: s.key, label: s.label }));
  if (field === "priority") return config.priorities.map(p => ({ key: p.key, label: p.label }));
  if (field === "task_type") return config.task_types.map(t => ({ key: t.key, label: t.label }));
  return [];
}

/** Resolves an enum key to its configured label, or reports drift (GIT-14). */
function resolveEnum(
  raw: unknown,
  defs: { key: string; label: string }[],
): ConflictValue {
  if (raw === undefined || raw === null) return { raw: null, display: "(none)" };
  const key = str(raw);
  const match = defs.find(d => d.key === key);
  if (match !== undefined) return { raw: key, display: match.label };
  // Not in local config — GIT-14. Render the raw key with a drift marker
  // rather than blank, and keep it out of the pick-value options.
  return {
    raw: key,
    display: key,
    drift: { reason: `'${key}' is not in the local workflow.yaml` },
  };
}

/** A plain scalar value, stringified for display. `null`/absent → unset. */
function scalarValue(raw: unknown): ConflictValue {
  if (raw === undefined || raw === null) return { raw: null, display: "(none)" };
  if (typeof raw === "string") return { raw, display: raw };
  return { raw, display: JSON.stringify(raw) };
}

/** A `parent` ULID resolved to `key · title` (GIT-13). */
function relationshipValue(
  targetId: string | undefined,
  taskById: ReadonlyMap<string, { key: string; title: string }>,
): ConflictValue {
  if (targetId === undefined) return { raw: null, display: "(none)" };
  const t = taskById.get(targetId);
  if (t === undefined) {
    // The referenced task is not present locally — drift, shown with the
    // ULID rather than a broken row.
    return {
      raw: targetId,
      display: targetId,
      drift: { reason: `task ${targetId} is not present locally` },
    };
  }
  return { raw: targetId, display: `${t.key} · ${t.title}` };
}

/** The single directional `parent` edge on a task, or undefined. */
function parentTarget(task: Task): string | undefined {
  return task.frontmatter.relationships?.find(r => r.type === "parent")?.target;
}

/** Custom field definition lookup by key. */
function customFieldDef(
  key: string,
  config: WorkflowConfig | undefined,
): CustomFieldDef | undefined {
  return config?.custom_fields.find(f => f.key === key);
}

export interface ConflictComputation {
  readonly conflicts: TaskConflictField[];
  readonly autoMerged: AutoMergedField[];
}

/**
 * Classifies one task-vs-task divergence into conflicts + auto-merges.
 *
 * `taskById` maps every local task's ULID to its key/title, so `parent`
 * targets render as tasks (GIT-13). `config` supplies enum labels and
 * pick-value options (GIT-11) and detects drift (GIT-14).
 */
export function computeTaskConflicts(
  local: Task,
  remote: Task,
  config: WorkflowConfig | undefined,
  taskById: ReadonlyMap<string, { key: string; title: string }>,
  /**
   * The task at the last-synced base, when available. A field is a TRUE
   * conflict only when BOTH sides moved it away from the base; if only one
   * side changed it, that side wins and it is not a conflict — the same
   * three-way rule `planSync`/`mergeTask` use. Without a base (first sync,
   * history rewritten) every divergence is treated as a conflict, because
   * nothing can prove it was one-sided.
   */
  base?: Task,
): ConflictComputation {
  const lf = local.frontmatter as unknown as Record<string, unknown>;
  const rf = remote.frontmatter as unknown as Record<string, unknown>;
  const bf = (base?.frontmatter ?? undefined) as unknown as Record<string, unknown> | undefined;
  /**
   * True when this field genuinely conflicts: both sides differ from each
   * other AND, if a base is known, both moved from it. A one-sided change
   * (local === base, or remote === base) is not a conflict.
   */
  const bothMoved = (field: string, l: unknown, r: unknown): boolean => {
    if (str(l) === str(r)) return false;
    if (bf === undefined) return true;
    const b = bf[field];
    const localMoved = str(l) !== str(b);
    const remoteMoved = str(r) !== str(b);
    return localMoved && remoteMoved;
  };
  const taskKey = local.frontmatter.key;
  const taskTitle = local.frontmatter.title;
  const taskId = local.frontmatter.id;

  const conflicts: TaskConflictField[] = [];
  const converged: string[] = [];
  const unioned: string[] = [];

  // --- Scalar + built-in enum fields ---
  for (const { field, label } of SCALAR_FIELDS) {
    const l = lf[field];
    const r = rf[field];
    const lHas = l !== undefined && l !== null;
    const rHas = r !== undefined && r !== null;
    if (!lHas && !rHas) continue;
    // Identical on both sides — converged (GIT-17), not a conflict.
    if (str(l) === str(r)) {
      // Only interesting to name if it was actually a two-sided value.
      if (lHas) converged.push(label);
      continue;
    }
    // Different values, but only ONE side moved from the base — a
    // one-sided edit that history/three-way resolves silently, not a
    // conflict (the branch renamed, local left it; or vice versa).
    if (!bothMoved(field, l, r)) continue;
    // Genuinely different values on the same field — a conflict row.
    if (ENUM_FIELDS.has(field)) {
      const defs = builtinEnumDefs(field, config);
      conflicts.push({
        taskId, taskKey, taskTitle,
        field, fieldLabel: label,
        kind: "enum",
        local: resolveEnum(l, defs),
        remote: resolveEnum(r, defs),
        options: defs.map(d => ({ key: d.key, label: d.label } satisfies ConflictOption)),
      });
    } else {
      conflicts.push({
        taskId, taskKey, taskTitle,
        field, fieldLabel: label,
        kind: "scalar",
        local: scalarValue(l),
        remote: scalarValue(r),
      });
    }
  }

  // --- Custom fields (GIT-5 union vs GIT-11 conflict) ---
  const localFields = (lf.fields ?? {}) as Record<string, unknown>;
  const remoteFields = (rf.fields ?? {}) as Record<string, unknown>;
  for (const key of new Set([...Object.keys(localFields), ...Object.keys(remoteFields)])) {
    const inLocal = key in localFields;
    const inRemote = key in remoteFields;
    const def = customFieldDef(key, config);
    const fieldLabel = def?.label ?? key;
    // Different keys on each side → union, no conflict (GIT-5).
    if (inLocal !== inRemote) {
      unioned.push(fieldLabel);
      continue;
    }
    const l = localFields[key];
    const r = remoteFields[key];
    if (JSON.stringify(l) === JSON.stringify(r)) {
      converged.push(fieldLabel);
      continue;
    }
    // Only one side moved this key from the base → one-sided edit, merges
    // silently, not a conflict.
    const baseFields = (bf?.fields ?? undefined) as Record<string, unknown> | undefined;
    if (baseFields !== undefined) {
      const b = baseFields[key];
      const localMoved = JSON.stringify(l) !== JSON.stringify(b);
      const remoteMoved = JSON.stringify(r) !== JSON.stringify(b);
      if (!(localMoved && remoteMoved)) continue;
    }
    // Same key, different values, both moved → conflict (GIT-11).
    if (def?.type === "enum" && def.values !== undefined) {
      const defs = def.values.map(v => ({ key: v.key, label: v.label }));
      conflicts.push({
        taskId, taskKey, taskTitle,
        field: `fields.${key}`, fieldLabel,
        kind: "enum",
        local: resolveEnum(l, defs),
        remote: resolveEnum(r, defs),
        options: defs.map(d => ({ key: d.key, label: d.label } satisfies ConflictOption)),
      });
    } else {
      conflicts.push({
        taskId, taskKey, taskTitle,
        field: `fields.${key}`, fieldLabel,
        kind: "scalar",
        local: scalarValue(l),
        remote: scalarValue(r),
      });
    }
  }

  // --- parent relationship (GIT-13) ---
  const lParent = parentTarget(local);
  const rParent = parentTarget(remote);
  const bParent = base !== undefined ? parentTarget(base) : undefined;
  const parentBothMoved = lParent !== rParent
    && (base === undefined || (lParent !== bParent && rParent !== bParent));
  if (parentBothMoved) {
    // A `parent` picker offers every local task as key · title.
    const options: ConflictOption[] = [...taskById.entries()]
      // Never offer the task itself as its own parent.
      .filter(([id]) => id !== taskId)
      .map(([id, t]) => ({ key: id, label: `${t.key} · ${t.title}` }));
    conflicts.push({
      taskId, taskKey, taskTitle,
      field: "parent", fieldLabel: "Parent",
      kind: "relationship_parent",
      local: relationshipValue(lParent, taskById),
      remote: relationshipValue(rParent, taskById),
      options,
    });
  }
  if (!parentBothMoved) {
    // Non-conflicting relationship edges union by (type,target) — GIT-5.
    // (When parent both-moved it is a conflict row above; the union line
    // would double-count it.)
    const lRels = local.frontmatter.relationships ?? [];
    const rRels = remote.frontmatter.relationships ?? [];
    const lKeys = new Set(lRels.map(r => `${r.type}:${r.target}`));
    const rKeys = new Set(rRels.map(r => `${r.type}:${r.target}`));
    const differ = [...lKeys].some(k => !rKeys.has(k)) || [...rKeys].some(k => !lKeys.has(k));
    if (differ) unioned.push("Relationships");
  }

  const autoMerged: AutoMergedField[] = [];
  if (unioned.length > 0) {
    autoMerged.push({ taskKey, fields: unioned, kind: "union" });
  }
  if (converged.length > 0) {
    autoMerged.push({ taskKey, fields: converged, kind: "converged" });
  }

  return { conflicts, autoMerged };
}

/**
 * Whether a status key exists in the local workflow — the GIT-14 drift
 * test, exported so the write-back can warn when keep-remote lands a
 * drift value.
 */
export function statusExistsLocally(
  key: string,
  statuses: readonly StatusDef[],
): boolean {
  return statuses.some(s => s.key === key);
}

/** Recognises `tasks/<id>/task.md`. */
function isTaskFile(path: string): boolean {
  return /^tasks\/[^/]+\/task\.md$/.test(path);
}

async function readTaskFileAt(dir: string, path: string): Promise<Task | undefined> {
  try {
    const raw = await readFile(join(dir, path), "utf-8");
    const { rawYaml, body } = splitTaskFile(raw);
    return { frontmatter: parseFrontmatter(rawYaml), body };
  } catch {
    return undefined;
  }
}

/**
 * The whole reconciliation report for a sync/publish (GIT-6, GIT-11,
 * GIT-13, GIT-14, GIT-17).
 *
 * Reads both sides of every conflicting task file — the local workspace
 * and the checked-out branch (`incomingDir`) — and classifies each into
 * conflicts (needs a decision) and auto-merges (reported, not asked).
 * The local task set supplies key/title for `parent` rendering (GIT-13)
 * and the pick-value picker options.
 *
 * A conflicting path that is not a task file (config, history) is not a
 * per-field reconciliation concern — those merge by their own union
 * rules in `resolve-conflicts.ts`. This reports only the task-field
 * conflicts the panel resolves.
 */
export async function computeReconcilePlan(input: {
  readonly localDir: string;
  readonly incomingDir: string;
  readonly conflicts: readonly PathPlan[];
  readonly config: WorkflowConfig | undefined;
  readonly mode: "publish" | "sync";
  readonly baseCommit: string;
  readonly remoteCommit: string;
  /**
   * The repo root and branch path prefix, so the base version of each
   * conflicting task can be read from `baseCommit` — a field is a true
   * conflict only when both sides moved from that base. Omit `root` to
   * treat every divergence as a conflict (first sync: no base).
   */
  readonly root?: string;
  readonly basePrefix?: string;
}): Promise<ReconcilePlan> {
  const { localDir, incomingDir, conflicts, config, mode, baseCommit, remoteCommit, root, basePrefix = "" } = input;

  const readBase = (path: string): Task | undefined => {
    if (root === undefined) return undefined;
    const raw = readTreeFile(root, baseCommit, basePrefix ? `${basePrefix}${path}` : path);
    if (raw === undefined) return undefined;
    try {
      const { rawYaml, body } = splitTaskFile(raw);
      return { frontmatter: parseFrontmatter(rawYaml), body };
    } catch {
      return undefined;
    }
  };

  // key/title for every local task, so `parent` targets render as tasks
  // and the picker can list them (GIT-13).
  const taskById = new Map<string, { key: string; title: string }>();
  for (const t of await loadAllTasks(localDir)) {
    taskById.set(t.frontmatter.id, {
      key: t.frontmatter.key,
      title: t.frontmatter.title,
    });
  }

  const allConflicts: TaskConflictField[] = [];
  const allAuto: AutoMergedField[] = [];

  for (const c of conflicts) {
    if (!isTaskFile(c.path)) continue;
    // `basename` guards against a `task.md` nested oddly; the id is the
    // parent directory name.
    if (basename(c.path) !== "task.md") continue;
    const [local, remote] = await Promise.all([
      readTaskFileAt(localDir, c.path),
      readTaskFileAt(incomingDir, c.path),
    ]);
    if (local === undefined || remote === undefined) continue;
    const base = readBase(c.path);
    const { conflicts: fieldConflicts, autoMerged } = computeTaskConflicts(
      local, remote, config, taskById, base,
    );
    allConflicts.push(...fieldConflicts);
    allAuto.push(...autoMerged);
  }

  return {
    mode,
    base_commit: baseCommit,
    remote_commit: remoteCommit,
    conflicts: allConflicts,
    autoMerged: allAuto,
  };
}
