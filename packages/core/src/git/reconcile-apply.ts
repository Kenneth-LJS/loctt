import type {
  ReconcileDecision,
  TaskConflictField,
  WorkflowConfig,
} from "@loctt/contracts";

import { readTask, writeTask } from "../task/io.js";
import { linkTask, unlinkTask } from "../task/relationships.js";

/**
 * Write-back for a resolved reconciliation (GIT-7, GIT-12, GIT-13,
 * GIT-32, GIT-37).
 *
 * Takes the per-field decisions the user made and writes the chosen
 * values onto the tasks on disk. Three properties the cases pin:
 *
 * - **Inverse edges stay consistent (GIT-13, P-12).** A `parent`
 *   resolution is not a frontmatter poke: choosing keep-remote must
 *   remove the losing parent's `child` edge and add the winning one's,
 *   so it goes through `unlinkTask`/`linkTask` — the same bilateral path
 *   the rest of the app writes relationships through — never a
 *   hand-written edge.
 * - **Honest partial results (GIT-12, GIT-32, GIT-37).** A task whose
 *   write throws is reported as failed, by key and reason; the tasks
 *   that succeeded are reported as succeeded. Never "30 written" when 28
 *   landed.
 * - **Resumable (GIT-32).** The caller records which task ids landed and
 *   does NOT clear the sentinel on a partial failure, so a reopen offers
 *   only the unwritten rows and a retry re-applies only those (GIT-37).
 *
 * Grouped by task: all of one task's field decisions are applied
 * together, and a task is "applied" only if every one of its decisions
 * landed. A per-field failure fails that whole task's group rather than
 * leaving it half-resolved, which keeps the resumable unit (the task)
 * atomic from the panel's point of view.
 */

export interface TaskApplyResult {
  readonly taskId: string;
  readonly taskKey: string;
  readonly ok: boolean;
  /** Present when `ok` is false — the reason the task's write failed. */
  readonly error?: string;
  /** Fields resolved on this task, named for the result (GIT-7). */
  readonly resolved: readonly { field: string; value: string }[];
}

export interface ApplyReconcileResult {
  readonly results: readonly TaskApplyResult[];
  /** Task ids that were fully written — the caller journals these (GIT-32). */
  readonly appliedTaskIds: readonly string[];
  /** True when every task landed. The caller clears the sentinel only then. */
  readonly complete: boolean;
}

/** The value a decision resolves to, from the conflict's own sides. */
function resolvedRaw(
  decision: ReconcileDecision,
  conflict: TaskConflictField,
): unknown {
  if (decision.choice === "local") return conflict.local.raw;
  if (decision.choice === "remote") return conflict.remote.raw;
  return decision.value ?? null;
}

/** Human display of the winning value, for the result line (GIT-7). */
function resolvedDisplay(
  decision: ReconcileDecision,
  conflict: TaskConflictField,
): string {
  if (decision.choice === "local") return conflict.local.display;
  if (decision.choice === "remote") return conflict.remote.display;
  const raw = decision.value ?? null;
  if (raw === null) return "(none)";
  // Prefer an option label where the picked value matches one.
  const asKey = typeof raw === "string" ? raw : JSON.stringify(raw);
  const opt = conflict.options?.find(o => o.key === asKey);
  return opt?.label ?? asKey;
}

/**
 * Sets a scalar/enum frontmatter field. `fields.<key>` writes into the
 * custom-fields map; a bare field writes the top-level property. A
 * `null` value clears the field.
 */
function setField(
  frontmatter: Record<string, unknown>,
  field: string,
  raw: unknown,
): Record<string, unknown> {
  const next = { ...frontmatter };
  if (field.startsWith("fields.")) {
    const key = field.slice("fields.".length);
    const fields = { ...(next.fields as Record<string, unknown> | undefined ?? {}) };
    if (raw === null || raw === undefined) {
      delete fields[key];
    } else {
      fields[key] = raw;
    }
    if (Object.keys(fields).length > 0) next.fields = fields;
    else delete next.fields;
    return next;
  }
  if (raw === null || raw === undefined) {
    delete next[field];
  } else {
    next[field] = raw;
  }
  next.updated_at = new Date().toISOString();
  return next;
}

/**
 * Applies every decision for one task. Scalars are collected and written
 * in a single `writeTask`; a `parent` decision is applied through the
 * bilateral relationship path so its inverse `child` edge stays
 * consistent (GIT-13).
 *
 * Throws on the first failing write, so the caller marks the whole task
 * failed rather than partly applied.
 */
async function applyTask(
  locttDir: string,
  taskId: string,
  decisions: readonly { decision: ReconcileDecision; conflict: TaskConflictField }[],
  config: WorkflowConfig | undefined,
): Promise<{ field: string; value: string }[]> {
  const resolved: { field: string; value: string }[] = [];

  // Parent first: link/unlink read-modify-write the task under the state
  // lock, so doing scalar writes after avoids clobbering their edge changes.
  const parentDecisions = decisions.filter(d => d.conflict.field === "parent");
  for (const { decision, conflict } of parentDecisions) {
    const oldParent = conflict.local.raw;
    const newParent = resolvedRaw(decision, conflict);
    // Remove the losing edge (and its inverse child edge) if there was one.
    if (typeof oldParent === "string" && oldParent !== newParent) {
      await unlinkTask({
        locttDir, taskId, type: "parent", target: oldParent,
        ...(config !== undefined ? { workflowConfig: config } : {}),
      }).catch((err: unknown) => {
        // Tolerant of an already-absent edge (unlink throws only when
        // neither side has it); a missing edge is the state we want.
        if (!/does not have|no.*relationship/i.test((err as Error).message)) throw err;
      });
    }
    if (typeof newParent === "string" && newParent !== oldParent) {
      await linkTask({
        locttDir, taskId, type: "parent", target: newParent,
        ...(config !== undefined ? { workflowConfig: config } : {}),
        // Reconciliation replays a decision the user already made; do not
        // re-reject on an archived target mid-merge.
        blockArchivedTarget: false,
      });
    }
    resolved.push({ field: conflict.fieldLabel, value: resolvedDisplay(decision, conflict) });
  }

  const scalarDecisions = decisions.filter(d => d.conflict.field !== "parent");
  if (scalarDecisions.length > 0) {
    const task = await readTask(locttDir, taskId);
    let frontmatter = task.frontmatter as unknown as Record<string, unknown>;
    for (const { decision, conflict } of scalarDecisions) {
      frontmatter = setField(frontmatter, conflict.field, resolvedRaw(decision, conflict));
      resolved.push({ field: conflict.fieldLabel, value: resolvedDisplay(decision, conflict) });
    }
    await writeTask(locttDir, taskId, {
      frontmatter: frontmatter as unknown as typeof task.frontmatter,
      body: task.body,
    });
  }

  return resolved;
}

/**
 * Applies all decisions, grouped by task, reporting the true outcome.
 *
 * `alreadyApplied` names task ids a previous partial Apply already wrote
 * (GIT-32) — they are skipped, not re-written. `conflicts` is the full
 * plan so a decision can be matched to its field's sides and options.
 */
export async function applyReconcile(
  locttDir: string,
  conflicts: readonly TaskConflictField[],
  decisions: readonly ReconcileDecision[],
  config: WorkflowConfig | undefined,
  alreadyApplied: readonly string[] = [],
): Promise<ApplyReconcileResult> {
  const conflictByKey = new Map<string, TaskConflictField>();
  for (const c of conflicts) conflictByKey.set(`${c.taskId}\0${c.field}`, c);

  // Group decisions by task, resolving each to its conflict.
  const byTask = new Map<string, { decision: ReconcileDecision; conflict: TaskConflictField }[]>();
  const taskKeyOf = new Map<string, string>();
  for (const decision of decisions) {
    const conflict = conflictByKey.get(`${decision.taskId}\0${decision.field}`);
    if (conflict === undefined) continue; // a stale decision for a field no longer in conflict
    const group = byTask.get(decision.taskId) ?? [];
    group.push({ decision, conflict });
    byTask.set(decision.taskId, group);
    taskKeyOf.set(decision.taskId, conflict.taskKey);
  }

  const applied = new Set(alreadyApplied);
  const results: TaskApplyResult[] = [];
  const appliedTaskIds: string[] = [...alreadyApplied];

  for (const [taskId, group] of byTask) {
    if (applied.has(taskId)) continue; // GIT-32: already written, do not redo
    const taskKey = taskKeyOf.get(taskId) ?? taskId;
    try {
      const resolved = await applyTask(locttDir, taskId, group, config);
      results.push({ taskId, taskKey, ok: true, resolved });
      appliedTaskIds.push(taskId);
    } catch (err) {
      results.push({
        taskId, taskKey, ok: false,
        error: (err as Error).message,
        resolved: [],
      });
    }
  }

  const complete = results.every(r => r.ok);
  return { results, appliedTaskIds, complete };
}
