import type { HistoryEntry, Task, WorkflowConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import type { ArchivedGuardConfigs } from "../config/archived-guard.js";
import { assertNotArchivedReferences } from "../config/archived-guard.js";
import { validateTaskAgainstWorkflow } from "../config/validation.js";
import { withStateLock } from "../state/lock.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { lookupTask, TaskNotFoundError } from "./lookup.js";
import {
  AUTO_MANAGED_FIELDS,
  BUILTIN_OPTIONAL_FIELDS,
  type SetFieldsEntry,
  TaskUpdateError,
  USER_IMMUTABLE_FIELDS,
} from "./update.js";

/**
 * Result of a bulk operation. `succeeded` lists task ids that were
 * updated; `failed` records per-task errors so the caller can show a
 * partial-success UI rather than failing the whole batch.
 *
 * `bulk_op_id` is the shared id stamped on every history entry produced
 * by this operation. UIs use it to collapse the activity feed.
 */
export interface BulkResult {
  readonly bulk_op_id: string;
  readonly succeeded: string[];
  readonly failed: { taskId: string; error: string }[];
}

export interface BulkSetFieldsOptions {
  readonly locttDir: string;
  /** Task ids OR keys. Each ref is resolved at the time of the lock. */
  readonly taskRefs: readonly string[];
  readonly changes: readonly SetFieldsEntry[];
  readonly workflowConfig?: WorkflowConfig;
  readonly archivedGuard?: ArchivedGuardConfigs;
}

function isCompletedStatus(
  statusKey: unknown,
  wf: WorkflowConfig | undefined,
): boolean {
  if (typeof statusKey !== "string" || !wf) return false;
  return wf.statuses.find(s => s.key === statusKey)?.category === "completed";
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

function validateChanges(changes: readonly SetFieldsEntry[]): void {
  if (changes.length === 0) {
    throw new TaskUpdateError("bulkSetFields requires at least one change");
  }
  const seen = new Set<string>();
  for (const c of changes) {
    if (seen.has(c.field)) {
      throw new TaskUpdateError(`duplicate field in changes: "${c.field}"`);
    }
    seen.add(c.field);
    if (USER_IMMUTABLE_FIELDS.has(c.field)) {
      throw new TaskUpdateError(`cannot set immutable field "${c.field}"`);
    }
    if (AUTO_MANAGED_FIELDS.has(c.field)) {
      throw new TaskUpdateError(`cannot set auto-managed field "${c.field}"`);
    }
  }
}

/**
 * Apply a set of field changes to many tasks in one logical operation.
 *
 * One state lock spans the whole batch; per-task failures are recorded
 * in {@link BulkResult.failed} and don't abort the rest. Every history
 * entry from this call is stamped with the shared `bulk_op_id`, which
 * is also returned so UIs can group the entries.
 */
export async function bulkSetFields(opts: BulkSetFieldsOptions): Promise<BulkResult> {
  validateChanges(opts.changes);
  const bulkOpId = ulid();
  return withStateLock(opts.locttDir, () => runBulk(opts, bulkOpId));
}

async function runBulk(
  opts: BulkSetFieldsOptions,
  bulkOpId: string,
): Promise<BulkResult> {
  const { locttDir, taskRefs, changes, workflowConfig, archivedGuard } = opts;
  const now = new Date().toISOString();
  const succeeded: string[] = [];
  const failed: { taskId: string; error: string }[] = [];

  for (const ref of taskRefs) {
    try {
      const task = await lookupTask(locttDir, ref);
      const id = task.frontmatter.id;
      const updated = await applyOneTask({
        locttDir, taskId: id, changes, now, workflowConfig, archivedGuard, bulkOpId,
      });
      if (updated) succeeded.push(id);
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        failed.push({ taskId: ref, error: "task not found" });
      } else {
        failed.push({ taskId: ref, error: (err as Error).message });
      }
    }
  }
  return { bulk_op_id: bulkOpId, succeeded, failed };
}

async function applyOneTask(args: {
  locttDir: string;
  taskId: string;
  changes: readonly SetFieldsEntry[];
  now: string;
  workflowConfig: WorkflowConfig | undefined;
  archivedGuard: ArchivedGuardConfigs | undefined;
  bulkOpId: string;
}): Promise<boolean> {
  const { locttDir, taskId, changes, now, workflowConfig, archivedGuard, bulkOpId } = args;
  const task = await readTask(locttDir, taskId);
  const patch: Record<string, unknown> = { ...task.frontmatter };
  let statusChanged = false;
  let newStatus: unknown = task.frontmatter.status;
  const historyEntries: HistoryEntry[] = [];

  for (const { field, value } of changes) {
    const before = field.startsWith("fields.")
      ? task.frontmatter.fields?.[field.slice("fields.".length)]
      : (task.frontmatter as unknown as Record<string, unknown>)[field];

    if (field === "title") {
      if (typeof value !== "string" || value.length === 0) {
        throw new TaskUpdateError("title must be a non-empty string");
      }
      patch["title"] = value;
    } else if (BUILTIN_OPTIONAL_FIELDS.has(field)) {
      if (value === undefined) delete patch[field];
      else patch[field] = value;
      if (field === "status") {
        statusChanged = true;
        newStatus = value;
        patch["status_updated_at"] = now;
      }
    } else {
      const existing = (patch["fields"] as Record<string, unknown> | undefined) ?? {};
      if (value === undefined) {
        if (field in existing) {
          const next = { ...existing };
          delete next[field];
          if (Object.keys(next).length === 0) delete patch["fields"];
          else patch["fields"] = next;
        } else {
          continue;
        }
      } else {
        patch["fields"] = { ...existing, [field]: value };
      }
    }

    if (before !== value) {
      const isCustom = !BUILTIN_OPTIONAL_FIELDS.has(field) && field !== "title";
      if (field === "labels") {
        const oldL = new Set(task.frontmatter.labels ?? []);
        const newL = new Set((value as readonly string[]) ?? []);
        for (const l of newL) if (!oldL.has(l)) {
          historyEntries.push({ timestamp: now, kind: "label_added", after: l, bulk_op_id: bulkOpId });
        }
        for (const l of oldL) if (!newL.has(l)) {
          historyEntries.push({ timestamp: now, kind: "label_removed", before: l, bulk_op_id: bulkOpId });
        }
      } else if (isCustom) {
        historyEntries.push({
          timestamp: now, kind: "custom_field_change", field,
          before: before ?? null, after: value ?? null, bulk_op_id: bulkOpId,
        });
      } else {
        historyEntries.push({
          timestamp: now, kind: "field_change", field,
          before: before ?? null, after: value ?? null, bulk_op_id: bulkOpId,
        });
      }
    }
  }

  if (statusChanged) {
    const wasCompleted = isCompletedStatus(task.frontmatter.status, workflowConfig);
    const isNowCompleted = isCompletedStatus(newStatus, workflowConfig);
    if (isNowCompleted && !wasCompleted) patch["completed_date"] = todayDateString();
    else if (!isNowCompleted && wasCompleted) delete patch["completed_date"];
  }
  patch["updated_at"] = now;
  const updated = patch as unknown as Task["frontmatter"];

  if (workflowConfig) {
    const errors = validateTaskAgainstWorkflow(updated, workflowConfig);
    if (errors.length > 0) {
      throw new TaskUpdateError(
        `invalid value: ${errors.map(e => `${e.field}: ${e.message}`).join("; ")}`,
      );
    }
  }
  if (archivedGuard) {
    assertNotArchivedReferences(updated, task.frontmatter, archivedGuard);
  }

  await writeTask(locttDir, taskId, { frontmatter: updated, body: task.body });
  if (historyEntries.length > 0) {
    await appendHistory(locttDir, taskId, historyEntries);
  }
  return true;
}

export interface BulkArchiveOptions {
  readonly locttDir: string;
  readonly taskRefs: readonly string[];
  readonly archive: boolean;
}

/**
 * Archives or unarchives many tasks under a single bulk_op_id. Skips
 * tasks that are already in the target state (no history entry produced).
 */
export async function bulkArchive(opts: BulkArchiveOptions): Promise<BulkResult> {
  const bulkOpId = ulid();
  return withStateLock(opts.locttDir, async () => {
    const now = new Date().toISOString();
    const succeeded: string[] = [];
    const failed: { taskId: string; error: string }[] = [];
    for (const ref of opts.taskRefs) {
      try {
        const looked = await lookupTask(opts.locttDir, ref);
        const id = looked.frontmatter.id;
        const task = await readTask(opts.locttDir, id);
        const currentlyArchived = task.frontmatter.archived === true;
        if (currentlyArchived === opts.archive) {
          succeeded.push(id);
          continue;
        }
        const patch = { ...task.frontmatter } as Record<string, unknown>;
        if (opts.archive) {
          patch["archived"] = true;
          patch["archived_at"] = now;
        } else {
          delete patch["archived"];
          delete patch["archived_at"];
        }
        patch["updated_at"] = now;
        await writeTask(opts.locttDir, id, {
          frontmatter: patch as unknown as Task["frontmatter"],
          body: task.body,
        });
        await appendHistory(opts.locttDir, id, [{
          timestamp: now,
          kind: opts.archive ? "archived" : "unarchived",
          bulk_op_id: bulkOpId,
        }]);
        succeeded.push(id);
      } catch (err) {
        if (err instanceof TaskNotFoundError) {
          failed.push({ taskId: ref, error: "task not found" });
        } else {
          failed.push({ taskId: ref, error: (err as Error).message });
        }
      }
    }
    return { bulk_op_id: bulkOpId, succeeded, failed };
  });
}
