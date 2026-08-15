import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HistoryEntry, HistoryKind } from "@loctt/contracts";
import * as lockfile from "proper-lockfile";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getHistoryFilePath } from "../paths/index.js";

/**
 * Coalesce window for body_edited entries by the same actor. Auto-save
 * UIs spam history during a typing burst; collapsing them into a single
 * "edited body" event over the window keeps the activity feed readable.
 *
 * The window applies between the most recent existing entry and any new
 * entry being appended. When a coalesce occurs, the existing entry's
 * `timestamp` is rolled forward to the new entry's timestamp; no entry
 * is duplicated.
 */
export const BODY_EDITED_COALESCE_WINDOW_MS = 15 * 60 * 1000;

/** Kinds eligible for coalescing in appendHistory. */
const COALESCEABLE_KINDS: ReadonlySet<HistoryKind> = new Set(["body_edited"]);

/**
 * Pagination options for {@link readHistory}. When omitted, all entries are
 * returned in chronological order (oldest first).
 *
 * - `order: "desc"` flips to newest-first.
 * - `limit` caps the number of returned entries (after ordering).
 * - `offset` skips that many entries before counting toward the limit.
 * - `kinds` filters to a subset of HistoryKinds (applied before limit/offset).
 */
export interface ReadHistoryOptions {
  readonly order?: "asc" | "desc";
  readonly limit?: number;
  readonly offset?: number;
  readonly kinds?: readonly HistoryKind[];
}

export interface ReadHistoryPage {
  readonly entries: HistoryEntry[];
  readonly total: number;
}

/**
 * Reads all history entries for a task. Returns `[]` if the file does
 * not exist. With options, returns a {@link ReadHistoryPage} with the
 * post-filter total so callers can render "x of y" cursors.
 */
export async function readHistory(
  locttDir: string,
  taskId: string,
): Promise<HistoryEntry[]>;
export async function readHistory(
  locttDir: string,
  taskId: string,
  options: ReadHistoryOptions,
): Promise<ReadHistoryPage>;
export async function readHistory(
  locttDir: string,
  taskId: string,
  options?: ReadHistoryOptions,
): Promise<HistoryEntry[] | ReadHistoryPage> {
  const filePath = getHistoryFilePath(locttDir, taskId);

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    if (options === undefined) return [];
    return { entries: [], total: 0 };
  }
  const parsed: unknown = parseYaml(content);
  const all = Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  if (options === undefined) return all;

  const kindSet = options.kinds && options.kinds.length > 0
    ? new Set(options.kinds)
    : null;
  const filtered = kindSet ? all.filter(e => kindSet.has(e.kind)) : all;
  const ordered = options.order === "desc" ? [...filtered].reverse() : filtered;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit;
  const sliced = limit === undefined ? ordered.slice(offset) : ordered.slice(offset, offset + limit);
  return { entries: sliced, total: filtered.length };
}

/**
 * Appends history entries to a task's `_history.yaml`. Creates the file
 * (and directory) if needed.
 *
 * Concurrent writers are serialized with a per-task advisory lock
 * (proper-lockfile, scoped to the task's directory).
 *
 * Each entry is stamped with `actor` (the active user id) when one
 * exists and the entry doesn't already carry an explicit `actor`.
 * Headless / first-run paths leave `actor` absent. Resolving the
 * active user is best-effort: if it fails for any reason, the entry
 * is written without an actor rather than rejecting the history
 * append (history must not block the operation that triggered it).
 */
export async function appendHistory(
  locttDir: string,
  taskId: string,
  entries: HistoryEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  const filePath = getHistoryFilePath(locttDir, taskId);
  const taskDir = dirname(filePath);
  await mkdir(taskDir, { recursive: true });

  // Resolve the active user once per append (the same user is acting
  // on every entry in this batch). Dynamic import keeps the
  // task→users dependency one-way at module load: users/manage.ts
  // pulls a recovery handler through state/journal.ts, and a static
  // import here would close the loop. Lazy import sidesteps it.
  let actor: string | undefined;
  try {
    const { readCurrentUserId } = await import("../users/current.js");
    const id = await readCurrentUserId(locttDir);
    if (id) actor = id;
  } catch {
    // Best-effort. A missing .current-user file is normal on first
    // run; any other read failure shouldn't take history with it.
  }
  const stamped = actor === undefined
    ? entries
    : entries.map(e => (e.actor === undefined ? { ...e, actor } : e));

  // Higher retry count than withStateLock because history writes are
  // tight and many entries can pile up on the same task in a tight
  // loop (e.g. a script flipping status and labels in succession).
  // Each acquire is fast.
  const release = await lockfile.lock(taskDir, {
    retries: { retries: 50, factor: 1.5, minTimeout: 20, maxTimeout: 500 },
    stale: 10_000,
    realpath: false,
  });
  try {
    const existing = await readHistory(locttDir, taskId);
    const merged = coalesceHistory(existing, stamped);
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, stringifyYaml(merged), "utf-8");
    await rename(tmpPath, filePath);
  } finally {
    await release().catch(() => {
      // Releaser failed — usually because the lock file was already
      // removed or the lock expired. Swallow so it doesn't mask the
      // caller's outcome.
    });
  }
}

/**
 * Merge `incoming` entries into `existing`, coalescing consecutive
 * same-actor entries of a coalesceable kind that fall inside the
 * window. Coalescing rolls the timestamp forward (so the burst's
 * "edited" event appears as recently as possible) but does NOT add
 * a new row.
 *
 * Bulk-op entries (those carrying `bulk_op_id`) never coalesce — each
 * bulk op stays distinct so the UI can group it. Likewise, mismatched
 * actors never coalesce.
 *
 * Exported (named, but module-internal — re-exported from index) for
 * testability.
 */
export function coalesceHistory(
  existing: readonly HistoryEntry[],
  incoming: readonly HistoryEntry[],
): HistoryEntry[] {
  const result: HistoryEntry[] = [...existing];
  for (const next of incoming) {
    const last = result[result.length - 1];
    if (
      last !== undefined &&
      COALESCEABLE_KINDS.has(next.kind) &&
      last.kind === next.kind &&
      last.actor === next.actor &&
      last.bulk_op_id === undefined &&
      next.bulk_op_id === undefined &&
      withinCoalesceWindow(last.timestamp, next.timestamp)
    ) {
      // Roll the existing entry's timestamp forward and drop the new
      // row — but span the whole burst: `before` stays the state at the
      // start of the burst, `after` advances to the latest. Keeping
      // `last.after` would leave the entry describing only the first
      // keystroke of the burst, so replaying it would restore a body the
      // user never stopped at.
      result[result.length - 1] = {
        ...last,
        timestamp: next.timestamp,
        ...("after" in next ? { after: next.after } : {}),
      };
      continue;
    }
    result.push(next);
  }
  return result;
}

function withinCoalesceWindow(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
  return Math.abs(tb - ta) <= BODY_EDITED_COALESCE_WINDOW_MS;
}
