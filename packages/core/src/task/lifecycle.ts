import { rm } from "node:fs/promises";

import type { Task, TaskFrontmatter } from "@loctt/contracts";

import { getTaskDir } from "../paths/index.js";
import { withStateLock } from "../state/lock.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { clearLookupCaches } from "./lookup-cache.js";

export class TaskLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskLifecycleError";
  }
}

/**
 * Archives a task. Wrapped in withStateLock so a concurrent setField
 * + archive can't clobber each other on the frontmatter, and the
 * history append lands while the lock is still held (a crash after
 * the write but before the history append leaves an audit gap; the
 * lock keeps the pair coherent against other writers).
 */
/**
 * The frontmatter half of archiving, shared with `bulkArchive`.
 *
 * Both paths now agree on the idempotency policy too (K25 / TSK-57):
 * archiving an already-archived task — or unarchiving one that is not
 * archived — is a **no-op success**, not an error. It leaves the task
 * in the state the caller asked for, writes nothing, and appends no
 * history entry. `bulkArchive` always worked this way (an already-archived
 * task counts as a success, reported apart under `unchanged`, BLK-27);
 * the single-task path used to *throw* `TaskLifecycleError`, which
 * escaped the web layer as a generic 500 (it is a plain Error, not a
 * LocttError). Two paths gave two answers for the same situation. They
 * now match. Sharing only the *fields* here (not the policy) is still
 * how "archived_at" avoids being written by one path and not the other.
 */
export function applyArchiveState(
  frontmatter: TaskFrontmatter,
  archive: boolean,
  now: string,
): TaskFrontmatter {
  const next = { ...frontmatter } as Record<string, unknown>;
  if (archive) {
    next["archived"] = true;
    next["archived_at"] = now;
  } else {
    delete next["archived"];
    delete next["archived_at"];
  }
  next["updated_at"] = now;
  return next as unknown as TaskFrontmatter;
}

/** True when `archived` is field-locally corrupt (its value is in health). */
function archivedIsCorrupt(task: Task): boolean {
  return (task.health ?? []).some(h => h.field === "archived");
}

/** Health to carry across an archive write (everything but `archived`). */
function carryArchiveHealth(task: Task): Task["health"] {
  const carried = (task.health ?? []).filter(h => h.field !== "archived");
  return carried.length > 0 ? carried : undefined;
}

const ARCHIVE_TOUCHED: ReadonlySet<string> = new Set(["archived", "archived_at", "updated_at"]);

export async function archiveTask(locttDir: string, taskId: string): Promise<Task> {
  return withStateLock(locttDir, async () => {
    const task = await readTask(locttDir, taskId);
    // K25 / TSK-57: already archived is a no-op success, matching
    // bulkArchive. Return the task untouched — no write, no history.
    // BUT: a *corrupt* `archived` reads as undefined (not archived), so
    // the write must proceed to repair it rather than no-op over garbage
    // (§ 13.3 S1: an idempotency read never silently persists a corrupt
    // value). `archived` here is the write's own target, so setting it is
    // the repair.
    if (task.frontmatter.archived && !archivedIsCorrupt(task)) {
      return task;
    }

    const now = new Date().toISOString();
    const carried = carryArchiveHealth(task);
    const result: Task = {
      frontmatter: applyArchiveState(task.frontmatter, true, now),
      body: task.body,
      ...(carried ? { health: carried } : {}),
    };
    await writeTask(locttDir, taskId, result, ARCHIVE_TOUCHED);
    await appendHistory(locttDir, taskId, [{ timestamp: now, kind: "archived" }]);
    return result;
  });
}

/**
 * Unarchives a task. Wrapped in withStateLock for the same reason as
 * `archiveTask` — concurrent writers must not interleave with the
 * read-modify-write or its paired history append.
 */
export async function unarchiveTask(locttDir: string, taskId: string): Promise<Task> {
  return withStateLock(locttDir, async () => {
    const task = await readTask(locttDir, taskId);
    // K25 / TSK-57 (mirror): not archived is a no-op success for
    // unarchive — the task is already in the requested state.
    // BUT: a *corrupt* `archived` reads as undefined; a no-op would leave
    // the corrupt flag on disk (the audit defect this fix closes, § 13.3
    // S1). So when `archived` is corrupt, proceed and clear it — the
    // write's own target field, so writing it is the repair.
    if (!task.frontmatter.archived && !archivedIsCorrupt(task)) {
      return task;
    }

    const now = new Date().toISOString();
    const carried = carryArchiveHealth(task);
    const result: Task = {
      frontmatter: applyArchiveState(task.frontmatter, false, now),
      body: task.body,
      ...(carried ? { health: carried } : {}),
    };
    await writeTask(locttDir, taskId, result, ARCHIVE_TOUCHED);
    await appendHistory(locttDir, taskId, [{ timestamp: now, kind: "unarchived" }]);
    return result;
  });
}

/**
 * Hard-deletes a task by removing its entire directory. Requires
 * force=true as a safety check. Wrapped in withStateLock so a
 * concurrent setField that's mid-write doesn't see the directory
 * disappear from under it (its writeTask would then create an
 * orphan dir; the lock serializes the two).
 */
export async function deleteTask(
  locttDir: string,
  taskId: string,
  options: { force: boolean },
): Promise<void> {
  if (!options.force) {
    throw new TaskLifecycleError("hard delete requires --force");
  }

  await withStateLock(locttDir, async () => {
    // Verify task exists first.
    await readTask(locttDir, taskId);

    const taskDir = getTaskDir(locttDir, taskId);
    await rm(taskDir, { recursive: true, force: true });
    // Drop any cached "key not found" verdicts — the just-deleted
    // task's keys still resolved a moment ago and any rebuild after
    // this point should reflect the new (smaller) population.
    clearLookupCaches(locttDir);
  });
}
