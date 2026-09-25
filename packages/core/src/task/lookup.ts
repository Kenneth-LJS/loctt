import type { Task } from "@loctt/contracts";

import { LocttError } from "../errors.js";
import { getTaskFilePath } from "../paths/index.js";
import {
  addToKeyIndex,
  type KeyIndex,
  loadKeyIndex,
  lookupKeyInIndex,
  rebuildKeyIndex,
  removeFromKeyIndex,
  saveKeyIndex,
} from "../state/key-index.js";
import { TaskParseError } from "./frontmatter.js";
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
    super("not_found", `Task not found: "${ref}"`);
    this.name = "TaskNotFoundError";
    this.ref = ref;
  }
}

/**
 * The task's file is on disk and cannot be read or parsed.
 *
 * ERR-1's prohibition, applied to a single task: a failure and an
 * absence must not look alike. Before this, both halves of the corrupt
 * case were wrong — a key present in the index surfaced the raw parse
 * error as an unattributed server fault, and a key *absent* from the
 * index (because `foldUnknownTasks` skips a directory whose task.md
 * will not parse) surfaced `task not found`, telling the user their
 * task did not exist while the file sat on disk.
 *
 * `io_failed` is the existing `ErrorCode` for "the server could not
 * read the user's data" — no new code is introduced. The path is in
 * the headline deliberately: ERR-16 bars stack traces and errnos from
 * a headline but carves out paths inside `.loctt/`, because that is
 * the file the user has to go and fix (P-4's "next action"). The
 * parse error — which names the line and column — is the reason, and
 * it is what makes the message actionable rather than a bare "could
 * not read".
 *
 * XS-51 settles the wording: LocTT writes task.md atomically (temp
 * file + rename), so a reader never sees a torn write. A malformed
 * file is therefore a hand edit or another tool, and the message says
 * so rather than hedging.
 */
export class UnreadableTaskError extends LocttError {
  /** The ref as the user typed it. */
  readonly ref: string;
  /**
   * Full paths to the files that would not parse.
   *
   * Usually one. It is a list only on the indeterminate path below,
   * where the ref could not be matched to a directory *because* the
   * frontmatter holding the key is the unparseable part — so every
   * unreadable candidate has to be named.
   */
  readonly paths: readonly string[];
  /** The parse error verbatim — it names the YAML line and column. */
  readonly reason: string;
  /**
   * True when the ref did not resolve *and* some task file would not
   * parse, so whether the ref exists is genuinely unknown.
   *
   * A key lives inside its own task.md. When that file will not
   * parse, its key cannot be harvested into the index, so a lookup
   * for that key misses — but a lookup for a key that simply does
   * not exist misses identically. Asserting either would be a guess:
   * "not found" repeats the original bug (claiming absence over a
   * file that is on disk), and "T-99 could not be read" blames a file
   * that may have nothing to do with T-99.
   *
   * P-4's rare exception is the shape that fits: an undetermined
   * cause is permitted only when it genuinely cannot be determined,
   * and must still name what was attempted and what to do next. Both
   * are in the message — the lookup, and the files to repair.
   */
  readonly indeterminate: boolean;

  constructor(
    ref: string,
    paths: readonly string[],
    cause: unknown,
    opts: { readonly indeterminate?: boolean } = {},
  ) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    const indeterminate = opts.indeterminate ?? false;
    const list = paths.join(", ");
    // No `data_state`: this is a read, so nothing was at stake
    // (ERR-18 scopes that requirement to write paths).
    //
    // `recovery: none`, not `retry`: re-reading the same bytes fails
    // the same way every time, and ERR-15 wants a control the user
    // can actually press. The only fix is to edit the file, which the
    // message names.
    super("io_failed", indeterminate
      ? `No task matched "${ref}", but not every task file could be read, `
        + `so whether the task exists is unknown. `
        + `Repair ${paths.length === 1 ? "this file" : "these files"} `
        + `and try again: ${list}. ${reason}`
      : `${ref} could not be read because `
        + `${paths.length === 1
            ? `${list} could not be parsed`
            : `none of these could be parsed: ${list}`}. `
        + `The file appears to have been edited by hand or by another `
        + `tool, not a half-written write. ${reason}`,
      { detail: reason, recovery: { kind: "none" }, cause });
    this.name = "UnreadableTaskError";
    this.ref = ref;
    this.paths = paths;
    this.reason = reason;
    this.indeterminate = indeterminate;
  }

  /** See {@link UnreadableTaskError.indeterminate}. */
  static indeterminateRef(
    ref: string,
    paths: readonly string[],
    cause: unknown,
  ): UnreadableTaskError {
    return new UnreadableTaskError(ref, paths, cause, { indeterminate: true });
  }

  /** The single offending path, when there is exactly one. */
  get path(): string | undefined {
    return this.paths.length === 1 ? this.paths[0] : undefined;
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
    if (isParseFailure(err)) {
      throw new UnreadableTaskError(id, [getTaskFilePath(locttDir, id)], err);
    }
    throw err;
  }
}

/**
 * True when the file was found but its content could not be turned
 * into a task — as opposed to an I/O failure (permissions, a full
 * disk), which has a different cause and a different remedy and so
 * keeps propagating as itself.
 *
 * A typed test, not an errno-shaped one. `YAMLParseError` carries
 * `code: "MISSING_CHAR"` for the unclosed quote TSK-54 describes, so
 * "has no errno" would have classified the headline case as a disk
 * error; `parseFrontmatter` now normalises both parse failures to
 * `TaskParseError`, which is the one thing to branch on.
 */
function isParseFailure(err: unknown): boolean {
  return err instanceof TaskParseError;
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
): Promise<
  | { kind: "ok"; key: string; keyHistory: readonly string[] }
  | { kind: "unreadable"; id: string; cause: unknown }
  | undefined
> {
  try {
    const task = await readTask(locttDir, id);
    return {
      kind: "ok",
      key: task.frontmatter.key,
      keyHistory: task.frontmatter.key_history ?? [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return undefined;
    // A malformed task.md still must not poison the fold for
    // unrelated tasks — the other directories keep folding. But it is
    // no longer *forgotten*: the id comes back so `lookupByKey` can
    // tell "no task has this key" from "the task that might have this
    // key would not parse". Silently dropping it here is what made a
    // corrupt file report as `task not found`.
    return { kind: "unreadable", id, cause: err };
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
): Promise<{ index: KeyIndex; unreadable: UnreadableFold[] }> {
  const knownIds = new Set(Object.values(index.entries));
  const allIds = await listTaskIds(locttDir);
  const unknowns = allIds.filter(id => !knownIds.has(id));
  if (unknowns.length === 0) return { index, unreadable: [] };

  let next = index;
  const unreadable: UnreadableFold[] = [];
  for (const id of unknowns) {
    const header = await readKeyHeader(locttDir, id);
    if (!header) continue;
    if (header.kind === "unreadable") {
      unreadable.push({ id: header.id, cause: header.cause });
      continue;
    }
    next = addToKeyIndex(next, header.key, id);
    for (const oldKey of header.keyHistory) {
      next = addToKeyIndex(next, oldKey, id);
    }
  }

  if (next !== index) await saveKeyIndex(locttDir, next);
  return { index: next, unreadable };
}

/** A task directory the fold could not read. */
interface UnreadableFold {
  readonly id: string;
  readonly cause: unknown;
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
      if (isParseFailure(err)) {
        // The file is there and will not parse. Attributed rather
        // than rethrown raw: unattributed, the web turned it into
        // "The server failed while handling GET /api/tasks/T-1" with
        // the only useful sentence buried in `detail` (TSK-54, P-4).
        throw new UnreadableTaskError(
          key,
          [getTaskFilePath(locttDir, indexedId)],
          err,
        );
      }
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

  const fold = await foldUnknownTasks(locttDir, index);
  index = fold.index;
  const folded = lookupKeyInIndex(index, key);
  if (folded) {
    try {
      return await readTask(locttDir, folded);
    } catch (err) {
      if (isParseFailure(err)) {
        throw new UnreadableTaskError(
          key,
          [getTaskFilePath(locttDir, folded)],
          err,
        );
      }
      throw err;
    }
  }

  // A task file that would not parse may be *why* the key is missing
  // from the index: `readKeyHeader` could not harvest its key, so
  // nothing was ever folded for it. Reporting `task not found` here is
  // the worse of the two original failures — it asserts the task does
  // not exist while the file is on disk, exactly the confusion ERR-1
  // forbids.
  //
  // But the opposite claim would be just as wrong: the key may not
  // exist at all, and the corrupt file may be an unrelated neighbour.
  // We cannot tell, because the key we would compare against is the
  // part that would not parse. So say that, and name every candidate.
  if (fold.unreadable.length > 0) {
    const first = fold.unreadable[0] as UnreadableFold;
    throw UnreadableTaskError.indeterminateRef(
      key,
      fold.unreadable.map(u => getTaskFilePath(locttDir, u.id)),
      first.cause,
    );
  }

  // Nothing unreadable, so the miss is a real absence and may be
  // cached. Caching above would pin an answer derived from a file the
  // user is about to fix.
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
