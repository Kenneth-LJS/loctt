import { readdir } from "node:fs/promises";
import type { Task } from "@loctt/contracts";
import { getTasksDir } from "../paths/index.js";
import { readTask } from "./io.js";

export class TaskNotFoundError extends Error {
  constructor(ref: string) {
    super(`task not found: "${ref}"`);
    this.name = "TaskNotFoundError";
  }
}

/**
 * Lists all task IDs by reading the tasks directory.
 * Returns an empty array if the tasks directory doesn't exist.
 */
export async function listTaskIds(locttDir: string): Promise<string[]> {
  const tasksDir = getTasksDir(locttDir);
  try {
    const entries = await readdir(tasksDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

/**
 * Loads all tasks from the .loctt directory.
 */
export async function loadAllTasks(locttDir: string): Promise<Task[]> {
  const ids = await listTaskIds(locttDir);
  return Promise.all(ids.map(id => readTask(locttDir, id)));
}

/**
 * Looks up a task by id (exact match on directory name).
 */
export async function lookupById(locttDir: string, id: string): Promise<Task> {
  try {
    return await readTask(locttDir, id);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TaskNotFoundError(id);
    }
    throw err;
  }
}

/**
 * Looks up a task by key (e.g. "T-123"). Scans all tasks.
 * Also checks key_history for previously rekeyed tasks.
 */
export async function lookupByKey(locttDir: string, key: string): Promise<Task> {
  const tasks = await loadAllTasks(locttDir);

  // First try current key
  const byCurrentKey = tasks.find(t => t.frontmatter.key === key);
  if (byCurrentKey) return byCurrentKey;

  // Then try key_history
  const byHistory = tasks.find(
    t => t.frontmatter.key_history?.includes(key)
  );
  if (byHistory) return byHistory;

  throw new TaskNotFoundError(key);
}

/**
 * Looks up a task by either id or key.
 * Tries id first (if the ref looks like a ULID), then falls back to key.
 */
export async function lookupTask(locttDir: string, ref: string): Promise<Task> {
  // ULIDs are 26 chars of Crockford base32
  const looksLikeUlid = /^[0-9A-Z]{26}$/i.test(ref);

  if (looksLikeUlid) {
    try {
      return await lookupById(locttDir, ref);
    } catch {
      // Fall through to key lookup
    }
  }

  return await lookupByKey(locttDir, ref);
}
