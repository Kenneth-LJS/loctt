import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getHistoryFilePath } from "../paths/index.js";

/**
 * Reads all history entries for a task.
 * Returns `[]` if the history file doesn't exist.
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
 * Appends history entries to a task's history.yaml.
 * Creates the file (and directory) if needed.
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
}
