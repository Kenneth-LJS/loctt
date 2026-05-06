import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
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
 * If a legacy `history.yaml` exists, it is removed after the new file
 * is successfully written so we eventually consolidate without leaving
 * both files behind.
 */
export async function appendHistory(
  locttDir: string,
  taskId: string,
  entries: HistoryEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const existing = await readHistory(locttDir, taskId);
  const merged = [...existing, ...entries];
  const filePath = getHistoryFilePath(locttDir, taskId);
  await mkdir(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tmpPath, stringifyYaml(merged), "utf-8");
  await rename(tmpPath, filePath);

  // After a successful write, drop the legacy file if it's still around
  // so callers don't see two history files side-by-side.
  const legacyPath = getLegacyHistoryFilePath(locttDir, taskId);
  try {
    await unlink(legacyPath);
  } catch {
    // ENOENT is the normal case; ignore other errors so we don't fail
    // the append over leftover-file cleanup.
  }
}
