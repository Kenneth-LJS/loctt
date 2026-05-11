import { rm } from "node:fs/promises";

import type { Task, TaskFrontmatter } from "@loctt/contracts";

import { getTaskDir } from "../paths/index.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { clearLookupCaches } from "./lookup-cache.js";

export class TaskLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskLifecycleError";
  }
}

/** Archives a task by setting archived=true and archived_at. */
export async function archiveTask(locttDir: string, taskId: string): Promise<Task> {
  const task = await readTask(locttDir, taskId);
  if (task.frontmatter.archived) {
    throw new TaskLifecycleError("task is already archived");
  }

  const now = new Date().toISOString();
  const updated: TaskFrontmatter = {
    ...task.frontmatter,
    archived: true,
    archived_at: now,
    updated_at: now,
  };

  const result: Task = { frontmatter: updated, body: task.body };
  await writeTask(locttDir, taskId, result);
  await appendHistory(locttDir, taskId, [{ timestamp: now, kind: "archived" }]);
  return result;
}

/** Unarchives a task by removing archived and archived_at. */
export async function unarchiveTask(locttDir: string, taskId: string): Promise<Task> {
  const task = await readTask(locttDir, taskId);
  if (!task.frontmatter.archived) {
    throw new TaskLifecycleError("task is not archived");
  }

  const now = new Date().toISOString();
  const copy = { ...task.frontmatter } as Record<string, unknown>;
  delete copy["archived"];
  delete copy["archived_at"];
  copy["updated_at"] = now;
  const updated = copy as unknown as TaskFrontmatter;

  const result: Task = { frontmatter: updated, body: task.body };
  await writeTask(locttDir, taskId, result);
  await appendHistory(locttDir, taskId, [{ timestamp: now, kind: "unarchived" }]);
  return result;
}

/**
 * Hard-deletes a task by removing its entire directory.
 * Requires force=true as a safety check.
 */
export async function deleteTask(
  locttDir: string,
  taskId: string,
  options: { force: boolean },
): Promise<void> {
  if (!options.force) {
    throw new TaskLifecycleError("hard delete requires --force");
  }

  // Verify task exists first
  await readTask(locttDir, taskId);

  const taskDir = getTaskDir(locttDir, taskId);
  await rm(taskDir, { recursive: true, force: true });
  // Drop any cached "key not found" verdicts — the just-deleted
  // task's keys still resolved a moment ago and any rebuild after
  // this point should reflect the new (smaller) population.
  clearLookupCaches(locttDir);
}
