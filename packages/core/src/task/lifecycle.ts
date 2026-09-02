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
 * Only the mutation is shared, deliberately. The two paths differ on
 * purpose everywhere else: `archiveTask` throws on an already-archived
 * task, while `bulkArchive` counts it a success and reports it apart
 * (BLK-27) — refusing would make archiving a mixed selection
 * impossible. Sharing the *policy* would break one or the other; not
 * sharing the *fields* is how "archived_at" ends up written by one
 * path and not the other.
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

export async function archiveTask(locttDir: string, taskId: string): Promise<Task> {
  return withStateLock(locttDir, async () => {
    const task = await readTask(locttDir, taskId);
    if (task.frontmatter.archived) {
      throw new TaskLifecycleError("task is already archived");
    }

    const now = new Date().toISOString();
    const result: Task = {
      frontmatter: applyArchiveState(task.frontmatter, true, now),
      body: task.body,
    };
    await writeTask(locttDir, taskId, result);
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
    if (!task.frontmatter.archived) {
      throw new TaskLifecycleError("task is not archived");
    }

    const now = new Date().toISOString();
    const result: Task = {
      frontmatter: applyArchiveState(task.frontmatter, false, now),
      body: task.body,
    };
    await writeTask(locttDir, taskId, result);
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
