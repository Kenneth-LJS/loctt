import type { Task } from "@loctt/contracts";

import { isKeyIndexFresh, loadKeyIndex, lookupKeyInIndex, rebuildKeyIndex } from "../state/key-index.js";
import { readTask } from "./io.js";
import { hasNegativeLookup, rememberNegativeLookup } from "./lookup-cache.js";

export class TaskNotFoundError extends Error {
  constructor(ref: string) {
    super(`task not found: "${ref}"`);
    this.name = "TaskNotFoundError";
  }
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
 *
 * Negative-cache + watermark optimisations:
 * - On a hit, returns immediately.
 * - On a miss with a fresh index (task count matches the watermark
 *   recorded at the last rebuild), trusts the index and throws
 *   without scanning. Records the key in the in-process negative
 *   cache so subsequent identical lookups in the same process
 *   short-circuit.
 * - On a miss with a stale (or watermark-less) index, rebuilds the
 *   index and retries. Still records a final miss in the negative
 *   cache to defend against keyspace probes within the same task
 *   population.
 */
export async function lookupByKey(locttDir: string, key: string): Promise<Task> {
  if (hasNegativeLookup(locttDir, key)) {
    throw new TaskNotFoundError(key);
  }

  // Try key index first (single file read)
  let index = await loadKeyIndex(locttDir);
  if (index) {
    const id = lookupKeyInIndex(index, key);
    if (id) {
      try {
        return await readTask(locttDir, id);
      } catch {
        // Index stale at the entry level — fall through to rebuild
      }
    } else if (await isKeyIndexFresh(locttDir, index)) {
      // Index reflects the current task population AND doesn't
      // contain the key. Skip the rebuild scan; cache the miss.
      rememberNegativeLookup(locttDir, key);
      throw new TaskNotFoundError(key);
    }
  }

  // Rebuild index and retry
  index = await rebuildKeyIndex(locttDir);
  const id = lookupKeyInIndex(index, key);
  if (id) {
    return await readTask(locttDir, id);
  }

  rememberNegativeLookup(locttDir, key);
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
