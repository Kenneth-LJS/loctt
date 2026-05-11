import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
import * as lockfile from "proper-lockfile";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getHistoryFilePath, getLegacyHistoryFilePath } from "../paths/index.js";

/**
 * Reads all history entries for a task.
 *
 * Dual-read strategy: prefers `_history.yaml`. If that doesn't exist,
 * falls back to the legacy `history.yaml` so old trackers keep working
 * until their next write consolidates them. Returns `[]` if neither
 * file exists.
 */
export async function readHistory(
  locttDir: string,
  taskId: string,
): Promise<HistoryEntry[]> {
  const newPath = getHistoryFilePath(locttDir, taskId);
  const legacyPath = getLegacyHistoryFilePath(locttDir, taskId);

  let content: string;
  try {
    content = await readFile(newPath, "utf-8");
  } catch {
    try {
      content = await readFile(legacyPath, "utf-8");
    } catch {
      return [];
    }
  }
  const parsed: unknown = parseYaml(content);
  if (!Array.isArray(parsed)) return [];
  return parsed as HistoryEntry[];
}

/**
 * Appends history entries to a task's `_history.yaml`.
 * Creates the file (and directory) if needed.
 *
 * Concurrent writers are serialized with a per-task advisory lock
 * (proper-lockfile, scoped to the task's directory). The
 * directory-as-target avoids a race where two callers on a
 * brand-new task would each touch an empty `_history.yaml` and
 * then race on a legacy→new consolidation outside the lock —
 * which could overwrite a just-merged file with stale legacy
 * content and lose entries. With the lock on the directory, the
 * dual-read consolidation runs inside the critical section and is
 * safe.
 *
 * If a legacy `history.yaml` exists, it is removed after the new
 * file is successfully written so we eventually consolidate
 * without leaving both files behind.
 */
export async function appendHistory(
  locttDir: string,
  taskId: string,
  entries: HistoryEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  const filePath = getHistoryFilePath(locttDir, taskId);
  const legacyPath = getLegacyHistoryFilePath(locttDir, taskId);
  const taskDir = dirname(filePath);
  await mkdir(taskDir, { recursive: true });

  // Lock the task directory rather than the history file. The
  // directory always exists by this point (we just mkdir'd it), so
  // we don't need an empty-touch dance on the file — and that
  // dance was racy: see the function's docstring.
  //
  // Higher retry count than withStateLock because history writes
  // are tight and many history entries can pile up on the same
  // task in a tight loop (e.g. a script that flips status and
  // labels in succession). Each acquire is fast.
  const release = await lockfile.lock(taskDir, {
    retries: { retries: 50, factor: 1.5, minTimeout: 20, maxTimeout: 500 },
    stale: 10_000,
    realpath: false,
  });
  try {
    // readHistory handles the dual-read fallback (new file → legacy
    // file → []) so the merge baseline already includes legacy
    // entries when a brand-new tracker first lands inside the lock.
    const existing = await readHistory(locttDir, taskId);
    const merged = [...existing, ...entries];
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, stringifyYaml(merged), "utf-8");
    await rename(tmpPath, filePath);

    // After a successful write, drop the legacy file if it's still
    // around so callers don't see two history files side-by-side.
    try {
      await unlink(legacyPath);
    } catch {
      // ENOENT is the normal case; ignore other errors so we don't
      // fail the append over leftover-file cleanup.
    }
  } finally {
    await release().catch(() => {
      // Releaser failed — usually because the lock file was already
      // removed or the lock expired. Swallow so it doesn't mask the
      // caller's outcome.
    });
  }
}
