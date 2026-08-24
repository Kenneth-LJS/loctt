import type { Task } from "@loctt/contracts";

import { LocttError } from "../errors.js";
import {
  addToKeyIndex,
  type KeyIndex,
  loadKeyIndex,
  lookupKeyInIndex,
  rebuildKeyIndex,
  removeFromKeyIndex,
  saveKeyIndex,
} from "../state/key-index.js";
import { readTask } from "./io.js";
import { listTaskIds } from "./list-ids.js";
import { hasNegativeLookup, rememberNegativeLookup } from "./lookup-cache.js";

export class TaskNotFoundError extends LocttError {
  /** The ref as the user typed it — a key, never a ULID (ERR-16). */
  readonly ref: string;

  constructor(ref: string) {
    // No `data_state`: nothing was attempted, so there is no claim to
    // make about the user's data (ERR-18 scopes the requirement to
    // write paths).
    super("not_found", `task not found: "${ref}"`);
    this.name = "TaskNotFoundError";
    this.ref = ref;
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
 * Reads a known-unknown task directory just to harvest its key and
 * key_history into the index. Returns undefined if the directory
 * isn't a task (missing or unparseable task.md) so the caller can
 * skip it without failing the whole fold.
 */
async function readKeyHeader(
  locttDir: string,
  id: string,
): Promise<{ key: string; keyHistory: readonly string[] } | undefined> {
  try {
    const task = await readTask(locttDir, id);
    return {
      key: task.frontmatter.key,
      keyHistory: task.frontmatter.key_history ?? [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    // A malformed task.md shouldn't poison the fold for unrelated
    // tasks. Skip and let `doctor` surface the corruption.
    return undefined;
  }
}

/**
 * Folds task directories not yet represented in the index into it.
 * Persists the index when it changed. Returns the (possibly
 * updated) index.
 *
 * Cost is proportional to the number of *new* task directories
 * since the index was last rebuilt or folded — typically zero in a
 * stable workspace.
 */
async function foldUnknownTasks(
  locttDir: string,
  index: KeyIndex,
): Promise<KeyIndex> {
  const knownIds = new Set(Object.values(index.entries));
  const allIds = await listTaskIds(locttDir);
  const unknowns = allIds.filter(id => !knownIds.has(id));
  if (unknowns.length === 0) return index;

  let next = index;
  for (const id of unknowns) {
    const header = await readKeyHeader(locttDir, id);
    if (!header) continue;
    next = addToKeyIndex(next, header.key, id);
    for (const oldKey of header.keyHistory) {
      next = addToKeyIndex(next, oldKey, id);
    }
  }

  if (next !== index) await saveKeyIndex(locttDir, next);
  return next;
}

/**
 * Looks up a task by key (e.g. "T-123"). Uses the cached key index
 * with two lazy repair moves on miss:
 *
 *  1. **Fold unknowns:** if the key is missing from the index, list
 *     `tasks/`, find directories not yet indexed (creation by another
 *     process or a `git pull`), read their frontmatter, fold their
 *     `key` and `key_history` into the index, and retry the lookup.
 *
 *  2. **Drop dangling:** if the indexed entry's task.md is gone
 *     (concurrent delete), remove the entry and fall through to fold.
 *
 * Out-of-band rewrites of an *existing* task's `key` (manual
 * frontmatter edit on a task already in the index) are not detected
 * automatically — the indexed entry still points at the same task
 * id, just under the old key. Run `loctt doctor --rebuild-index`
 * after such edits.
 */
export async function lookupByKey(locttDir: string, key: string): Promise<Task> {
  if (hasNegativeLookup(locttDir, key)) {
    throw new TaskNotFoundError(key);
  }

  let index = await loadKeyIndex(locttDir);
  if (!index) {
    index = await rebuildKeyIndex(locttDir);
  }

  const indexedId = lookupKeyInIndex(index, key);
  if (indexedId) {
    try {
      return await readTask(locttDir, indexedId);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Real I/O failure (permissions, disk error). Don't paper
        // over it with a "not found" — surface the underlying error.
        throw err;
      }
      // Concurrent delete: drop the dangling entry, persist, and
      // fall through to the fold path in case the key was reassigned
      // (which shouldn't happen, but if it did, fold will catch it).
      index = removeFromKeyIndex(index, key);
      await saveKeyIndex(locttDir, index);
    }
  }

  index = await foldUnknownTasks(locttDir, index);
  const folded = lookupKeyInIndex(index, key);
  if (folded) {
    return await readTask(locttDir, folded);
  }

  rememberNegativeLookup(locttDir, key);
  throw new TaskNotFoundError(key);
}

/**
 * Looks up a task by either id or key. Tries id first (when the
 * ref looks like a ULID), then falls back to key lookup. The id
 * path's `TaskNotFoundError` is swallowed for fallback; any other
 * error (permissions, disk) propagates.
 */
export async function lookupTask(locttDir: string, ref: string): Promise<Task> {
  // ULIDs are 26 chars of Crockford base32.
  const looksLikeUlid = /^[0-9A-Z]{26}$/i.test(ref);

  if (looksLikeUlid) {
    try {
      return await lookupById(locttDir, ref);
    } catch (err) {
      if (!(err instanceof TaskNotFoundError)) throw err;
      // Fall through to key lookup only for genuine not-found.
    }
  }

  return await lookupByKey(locttDir, ref);
}
