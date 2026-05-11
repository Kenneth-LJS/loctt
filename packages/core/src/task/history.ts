import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
import * as lockfile from "proper-lockfile";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getHistoryFilePath } from "../paths/index.js";

/**
 * Reads all history entries for a task. Returns `[]` if the file does
 * not exist.
 */
export async function readHistory(
  locttDir: string,
  taskId: string,
): Promise<HistoryEntry[]> {
  const filePath = getHistoryFilePath(locttDir, taskId);

  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    return [];
  }
  const parsed: unknown = parseYaml(content);
  if (!Array.isArray(parsed)) return [];
  return parsed as HistoryEntry[];
}

/**
 * Appends history entries to a task's `_history.yaml`. Creates the file
 * (and directory) if needed.
 *
 * Concurrent writers are serialized with a per-task advisory lock
 * (proper-lockfile, scoped to the task's directory).
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
    const merged = [...existing, ...entries];
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
