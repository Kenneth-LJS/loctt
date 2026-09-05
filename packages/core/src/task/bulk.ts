import { rm } from "node:fs/promises";

import type { Task, WorkflowConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import type { ArchivedGuardConfigs } from "../config/archived-guard.js";
import { getTaskDir, getTaskFilePath } from "../paths/index.js";
import { withStateLock } from "../state/lock.js";
import { stagedSwap } from "../state/staged-swap.js";
import { assembleTaskFile } from "./frontmatter.js";
import { appendHistory } from "./history.js";
import { assertWriteSafe, readTask } from "./io.js";
import { applyArchiveState } from "./lifecycle.js";
import { lookupTask, TaskNotFoundError } from "./lookup.js";
import { clearLookupCaches } from "./lookup-cache.js";
import { linkTask } from "./relationships.js";
import {
  assertChangesWritable,
  type DeferredFieldWrite,
  type SetFieldsEntry,
  setFieldsLocked,
  // Shared rather than re-declared: bulk.ts carried a byte-identical
  // private copy, and two implementations of "what is today, in the
  // workspace's timezone" is exactly the pair that drifts silently —
  // one honouring a calendar config change and the other not.
  todayDateString,
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
  /**
   * Tasks already in the target state, on the routes where that is
   * possible. A no-op is a success — refusing it would make archiving a
   * mixed selection impossible — but reporting it as a fresh change
   * overstates what happened (BLK-27).
   */
  readonly unchanged?: string[];
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

  // Phase 1: compute every task's result without writing any of them.
  //
  // A plain write-as-you-go loop killed at task nineteen of forty left
  // nineteen changed and twenty-one not — every file individually
  // valid, so nothing to detect and nothing reported. Computing first
  // means a per-task failure (a missing task, a validation error) is
  // still reported per task, exactly as before, while the *writes*
  // become all-or-nothing (V6).
  const pending: { id: string; write: DeferredFieldWrite }[] = [];
  for (const ref of taskRefs) {
    try {
      const task = await lookupTask(locttDir, ref);
      const id = task.frontmatter.id;
      // The same locked primitive the single-task path uses. The lock
      // is already held by bulkSetFields, and withStateLock is not
      // re-entrant, so this deliberately calls the *Locked form rather
      // than setFields.
      const write = await setFieldsLocked({
        locttDir,
        taskId: id,
        changes,
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        ...(archivedGuard !== undefined ? { archivedGuard } : {}),
        now,
        today,
        bulkOpId,
        defer: true,
      });
      pending.push({ id, write });
    } catch (err) {
      if (err instanceof TaskNotFoundError) {
        failed.push({ taskId: ref, error: "task not found" });
      } else {
        failed.push({ taskId: ref, error: (err as Error).message });
      }
    }
  }

  // Phase 2: stage, back up, journal, swap. Either every task.md in
  // the batch lands or none does.
  if (pending.length > 0) {
    // Same guard `writeTask` performs, run before anything is staged so
    // a write that would introduce or drop corruption cannot reach the
    // swap. `touched` is the change set — a preserved corrupt value on
    // any *other* field must survive the bulk write (§ 13.1 B1).
    const touched = new Set(changes.map(c => c.field));
    for (const p of pending) await assertWriteSafe(locttDir, p.id, p.write.task, touched);
    await stagedSwap(
      locttDir,
      pending.map(p => ({
        path: getTaskFilePath(locttDir, p.id),
        content: assembleTaskFile(p.write.task),
      })),
    );
    // History follows the swap. It is append-only and best-effort by
    // design — `appendHistory` already refuses to fail the operation
    // that triggered it — so it must not run before the writes it
    // describes have actually landed.
    // The swap wrote task.md behind writeTask's back, so the lookup
    // caches it maintains must be dropped by hand.
    clearLookupCaches(locttDir);
    for (const p of pending) {
      if (p.write.history.length > 0) {
        await appendHistory(locttDir, p.id, [...p.write.history]);
      }
      succeeded.push(p.id);
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
    const unchanged: string[] = [];
    const failed: { taskId: string; error: string }[] = [];
    // Two-phase for the same reason as bulkSetFields (V6): compute
    // every task, then swap the whole set in. A crash partway through
    // the old loop left the batch half-archived with nothing to detect
    // it.
    const pending: { id: string; task: Task }[] = [];
    for (const ref of opts.taskRefs) {
      try {
        const looked = await lookupTask(opts.locttDir, ref);
        const id = looked.frontmatter.id;
        const task = await readTask(opts.locttDir, id);
        const currentlyArchived = task.frontmatter.archived === true;
        // A corrupt `archived` reads as undefined; do NOT no-op over it —
        // the write must proceed to clear/repair the corrupt value (§ 13.3
        // S1, mirroring archiveTask/unarchiveTask).
        const archivedCorrupt = (task.health ?? []).some(h => h.field === "archived");
        if (currentlyArchived === opts.archive && !archivedCorrupt) {
          // Already in the target state: no write, no history entry.
          // Still a success — refusing would make archiving a mixed
          // selection impossible — but reported apart from the tasks
          // this call actually changed (BLK-27).
          succeeded.push(id);
          unchanged.push(id);
          continue;
        }
        const next: Task = {
          frontmatter: applyArchiveState(task.frontmatter, opts.archive, now),
          body: task.body,
          // Carry the source health so a preserved corrupt/unrecognised
          // field round-trips through the archive write (preserve-others).
          ...(task.health !== undefined ? { health: task.health } : {}),
        };
        await assertWriteSafe(
          opts.locttDir,
          id,
          next,
          new Set(["archived", "archived_at", "updated_at"]),
        );
        pending.push({ id, task: next });
      } catch (err) {
        if (err instanceof TaskNotFoundError) {
          failed.push({ taskId: ref, error: "task not found" });
        } else {
          failed.push({ taskId: ref, error: (err as Error).message });
        }
      }
    }

    if (pending.length > 0) {
      await stagedSwap(
        opts.locttDir,
        pending.map(p => ({
          path: getTaskFilePath(opts.locttDir, p.id),
          content: assembleTaskFile(p.task),
        })),
      );
      clearLookupCaches(opts.locttDir);
      for (const p of pending) {
        await appendHistory(opts.locttDir, p.id, [{
          timestamp: now,
          kind: opts.archive ? "archived" : "unarchived",
          bulk_op_id: bulkOpId,
        }]);
        succeeded.push(p.id);
      }
    }
    return { bulk_op_id: bulkOpId, succeeded, failed, unchanged };
  });
}


export interface BulkDeleteOptions {
  readonly locttDir: string;
  readonly taskRefs: readonly string[];
}

/**
 * Permanently removes many tasks under a single lock.
 *
 * The whole directory goes — `task.md`, `_history.yaml`, `_comments.yaml`,
 * attachments — so there is nothing to undo afterwards and no history
 * entry to write (the file it would live in is being deleted). That is
 * what distinguishes this from `bulkArchive`, which is reversible and
 * does record one.
 *
 * The removal is inlined rather than delegating to `deleteTask`:
 * `deleteTask` takes the state lock itself and `withStateLock` is not
 * re-entrant, the same constraint `bulkLink` documents below. Taking the
 * lock once for the batch also means a concurrent write cannot land
 * between two deletions.
 */
export async function bulkDelete(opts: BulkDeleteOptions): Promise<BulkResult> {
  const bulkOpId = ulid();
  return withStateLock(opts.locttDir, async () => {
    const succeeded: string[] = [];
    const failed: { taskId: string; error: string }[] = [];
    for (const ref of opts.taskRefs) {
      try {
        // Resolve before removing: a ref may be a key, and the key
        // index is what maps it to the id whose directory we delete.
        const looked = await lookupTask(opts.locttDir, ref);
        const id = looked.frontmatter.id;
        await rm(getTaskDir(opts.locttDir, id), { recursive: true, force: true });
        succeeded.push(id);
      } catch (err) {
        if (err instanceof TaskNotFoundError) {
          failed.push({ taskId: ref, error: "task not found" });
        } else {
          failed.push({ taskId: ref, error: (err as Error).message });
        }
      }
    }
    // Mirrors what `deleteTask` does after a single removal. The cache
    // is negative-only today, so a deletion cannot leave a stale *hit*
    // and no test can distinguish this line from its absence — it is
    // here so bulk and single delete stay the same shape if the cache
    // ever gains a positive side.
    if (succeeded.length > 0) clearLookupCaches(opts.locttDir);
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
