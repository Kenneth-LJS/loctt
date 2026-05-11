import { readdir } from "node:fs/promises";

import type { Task } from "@loctt/contracts";

import { getTasksDir } from "../paths/index.js";
import { loadKeyIndex, lookupKeyInIndex, rebuildKeyIndex } from "../state/key-index.js";
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
 * Maximum number of concurrent task reads when scanning the whole
 * tracker. Without a cap, `Promise.all(ids.map(readTask))` opens one
 * file descriptor per task; macOS's default ulimit (256) trips at
 * ~250 tasks. Picked low enough to stay well below that, high enough
 * that throughput doesn't suffer on a thousand-task tracker.
 */
const READ_CONCURRENCY = 32;

/**
 * Promise.all with a concurrency cap. Preserves input order in the
 * result. Used by `loadAllTasks` to avoid exhausting file descriptors
 * on large trackers.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      const item = items[idx];
      // Defensive: a sparse input would otherwise leave `results`
      // with a hole. `continue`, not `return`, so this worker keeps
      // pulling the next slot.
      if (item === undefined) continue;
      results[idx] = await fn(item, idx);
    }
  }
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Loads all tasks from the .loctt directory.
 *
 * Reads are bounded by {@link READ_CONCURRENCY} to keep file-descriptor
 * usage in check on large trackers — see the constant's docstring.
 */
export async function loadAllTasks(locttDir: string): Promise<Task[]> {
  const ids = await listTaskIds(locttDir);
  return mapWithLimit(ids, READ_CONCURRENCY, id => readTask(locttDir, id));
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
 * Looks up a task by key (e.g. "T-123").
 * Uses the key index if available, falling back to a full scan.
 * Also checks key_history for previously rekeyed tasks.
 */
export async function lookupByKey(locttDir: string, key: string): Promise<Task> {
  // Try key index first (single file read)
  let index = await loadKeyIndex(locttDir);
  if (index) {
    const id = lookupKeyInIndex(index, key);
    if (id) {
      try {
        return await readTask(locttDir, id);
      } catch {
        // Index stale — fall through to rebuild
      }
    }
  }

  // Rebuild index and retry
  index = await rebuildKeyIndex(locttDir);
  const id = lookupKeyInIndex(index, key);
  if (id) {
    return await readTask(locttDir, id);
  }

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
