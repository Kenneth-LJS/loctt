import type { Task } from "@loctt/contracts";

import { getTaskFilePath } from "../paths/index.js";
import { readTask } from "./io.js";
import { listTaskIds } from "./list-ids.js";

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
 * Lives in its own leaf module so callers like `state/key-index.ts`
 * can use it without closing an import cycle through `lookup.ts`
 * (which itself depends on `state/key-index.ts` for the watermark
 * check).
 *
 * Reads are bounded by {@link READ_CONCURRENCY} to keep file-
 * descriptor usage in check on large trackers.
 */
export async function loadAllTasks(locttDir: string): Promise<Task[]> {
  return (await loadAllTasksDetailed(locttDir)).tasks;
}

/** A task file that exists and could not be read or parsed. */
export interface UnreadableTask {
  /** The id, which is the directory name — the only handle we have. */
  readonly id: string;
  /** Full path, so the user can go and fix the file. */
  readonly path: string;
  /** The parse error, verbatim. It names the YAML problem. */
  readonly reason: string;
}

/**
 * Loads every task, keeping the ones that parse and reporting the ones
 * that do not.
 *
 * One corrupt `task.md` used to take down every read that went through
 * here — `loctt list` printed a YAML error and nothing else, and the
 * web list showed its error state with the export button disabled at
 * `total === 0`. A single unreadable neighbour destroyed access to the
 * whole tracker, which is P-11's exact prohibition: leniency means
 * keeping, never destroying.
 *
 * The failures are returned rather than thrown so a surface can do
 * what ERR-9 asks — render the other 49 rows *and* name the file and
 * the parse error. `loadAllTasks` keeps the plain `Task[]` shape its
 * 48 callers expect; only the callers that want to report take this.
 */
export async function loadAllTasksDetailed(
  locttDir: string,
): Promise<{ tasks: Task[]; unreadable: UnreadableTask[] }> {
  const ids = await listTaskIds(locttDir);
  const unreadable: UnreadableTask[] = [];
  const loaded = await mapWithLimit(
    ids,
    READ_CONCURRENCY,
    async (id): Promise<Task | undefined> => {
      try {
        return await readTask(locttDir, id);
      } catch (err) {
        unreadable.push({
          id,
          path: getTaskFilePath(locttDir, id),
          reason: err instanceof Error ? err.message : String(err),
        });
        return undefined;
      }
    },
  );
  return { tasks: loaded.filter((t): t is Task => t !== undefined), unreadable };
}
