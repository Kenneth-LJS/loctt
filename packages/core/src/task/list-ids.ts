import { readdir } from "node:fs/promises";

import { getTasksDir } from "../paths/index.js";

/**
 * Lists all task IDs by reading the tasks directory. Returns an
 * empty array if the tasks directory doesn't exist.
 *
 * Lives in its own leaf module so callers that only need IDs (e.g.
 * `state/key-index.ts` for the freshness watermark) don't transitively
 * import the heavier `task/lookup.ts` — that import path used to
 * close a cycle (lookup → key-index → lookup).
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
