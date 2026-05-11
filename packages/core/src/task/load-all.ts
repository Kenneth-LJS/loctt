import type { Task } from "@loctt/contracts";

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
  const ids = await listTaskIds(locttDir);
  return mapWithLimit(ids, READ_CONCURRENCY, id => readTask(locttDir, id));
}
