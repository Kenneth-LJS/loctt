import type { Task, WorkflowConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import type { ArchivedGuardConfigs } from "../config/archived-guard.js";
import { loadCalendarConfig } from "../config/calendar.js";
import { withStateLock } from "../state/lock.js";
import { todayInZone } from "../utils/today.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { lookupTask, TaskNotFoundError } from "./lookup.js";
import { linkTask } from "./relationships.js";
import {
  assertChangesWritable,
  type SetFieldsEntry,
  setFieldsLocked,
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

/**
 * Today's date (`YYYY-MM-DD`) in the workspace timezone, for
 * `completed_date`. See the same helper in update.ts — resolving in
 * UTC stamps yesterday's date on anything completed before local
 * morning in an ahead-of-UTC workspace.
 */
async function todayDateString(locttDir: string): Promise<string> {
  try {
    return todayInZone((await loadCalendarConfig(locttDir)).timezone);
  } catch {
    return todayInZone();
  }
}

export async function bulkSetFields(opts: BulkSetFieldsOptions): Promise<BulkResult> {
  assertChangesWritable(opts.changes, "bulkSetFields");
  const bulkOpId = ulid();
  return withStateLock(opts.locttDir, () => runBulk(opts, bulkOpId));
}

async function runBulk(
  opts: BulkSetFieldsOptions,
  bulkOpId: string,
): Promise<BulkResult> {
  const { locttDir, taskRefs, changes, workflowConfig, archivedGuard } = opts;
  const now = new Date().toISOString();
  // Resolved once for the whole batch, like `now` — a bulk run that
  // straddles midnight must stamp one date across every task, not
  // split the batch across two days.
  const today = await todayDateString(locttDir);
  const succeeded: string[] = [];
  const failed: { taskId: string; error: string }[] = [];

  for (const ref of taskRefs) {
    try {
      const task = await lookupTask(locttDir, ref);
      const id = task.frontmatter.id;
      // The same locked primitive the single-task path uses. The lock
      // is already held by bulkSetFields, and withStateLock is not
      // re-entrant, so this deliberately calls the *Locked form rather
      // than setFields.
      await setFieldsLocked({
        locttDir,
        taskId: id,
        changes,
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        ...(archivedGuard !== undefined ? { archivedGuard } : {}),
        now,
        today,
        bulkOpId,
      });
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


export interface BulkLinkOptions {
  readonly locttDir: string;
  /** Source tasks; each gets an edge to `target`. */
  readonly taskRefs: readonly string[];
  readonly type: string;
  readonly target: string;
  readonly workflowConfig?: WorkflowConfig;
}

/**
 * Links many source tasks to one target under a shared `bulk_op_id`.
 *
 * **Not atomic, unlike the other bulk operations.** `linkTask` takes
 * the tracker state lock itself and `withStateLock` is not re-entrant,
 * so a batch-level lock would throw rather than nest. Each link is
 * therefore committed independently: a failure part-way leaves earlier
 * links in place, and `failed` reports which did not land.
 *
 * That is the right trade here — each edge is independently valid, and
 * the alternative (reimplementing linkTask's cycle check and inverse
 * write inside one lock) would duplicate the logic most likely to
 * drift.
 */
export async function bulkLink(opts: BulkLinkOptions): Promise<BulkResult> {
  const bulkOpId = ulid();
  const succeeded: string[] = [];
  const failed: { taskId: string; error: string }[] = [];

  // `linkTask` stores edges by id, so the target ref must be resolved
  // once up front. Passing a key straight through fails per-source with
  // an ENOENT naming the key as though it were an id — an error that
  // reads like a missing file rather than an unresolved reference.
  let targetId: string;
  try {
    targetId = (await lookupTask(opts.locttDir, opts.target)).frontmatter.id;
  } catch {
    // One unresolvable target fails the whole batch, since every edge
    // would fail identically. Reported per source so the shape stays
    // consistent with the other bulk results.
    return {
      bulk_op_id: bulkOpId,
      succeeded: [],
      failed: opts.taskRefs.map(r => ({
        taskId: r,
        error: `link target "${opts.target}" not found`,
      })),
    };
  }

  for (const ref of opts.taskRefs) {
    try {
      const task = await lookupTask(opts.locttDir, ref);
      await linkTask({
        locttDir: opts.locttDir,
        taskId: task.frontmatter.id,
        type: opts.type,
        target: targetId,
        ...(opts.workflowConfig ? { workflowConfig: opts.workflowConfig } : {}),
      });
      succeeded.push(task.frontmatter.id);
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
