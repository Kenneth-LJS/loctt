import { mkdir,readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getKeyIndexPath } from "../paths/index.js";
import { loadAllTasks } from "../task/lookup.js";

/** Mapping of key (current or historical) → task ID. */
export interface KeyIndex {
  readonly entries: Readonly<Record<string, string>>;
}

/** Loads the key index from disk. Returns undefined if not found. */
export async function loadKeyIndex(locttDir: string): Promise<KeyIndex | undefined> {
  const path = getKeyIndexPath(locttDir);
  try {
    const content = await readFile(path, "utf-8");
    const raw: unknown = parseYaml(content);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const entries = (raw as Record<string, unknown>)["entries"];
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) return undefined;
    return { entries: entries as Record<string, string> };
  } catch {
    return undefined;
  }
}

/** Saves the key index to disk. */
export async function saveKeyIndex(locttDir: string, index: KeyIndex): Promise<void> {
  const path = getKeyIndexPath(locttDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml({ entries: index.entries }), "utf-8");
}

/** Rebuilds the key index by scanning all tasks. */
export async function rebuildKeyIndex(locttDir: string): Promise<KeyIndex> {
  const tasks = await loadAllTasks(locttDir);
  const entries: Record<string, string> = {};

  for (const task of tasks) {
    entries[task.frontmatter.key] = task.frontmatter.id;
    if (task.frontmatter.key_history) {
      for (const oldKey of task.frontmatter.key_history) {
        entries[oldKey] = task.frontmatter.id;
      }
    }
  }

  const index: KeyIndex = { entries };
  await saveKeyIndex(locttDir, index);
  return index;
}

/** Looks up a task ID by key using the index. Returns undefined if not found. */
export function lookupKeyInIndex(index: KeyIndex, key: string): string | undefined {
  return index.entries[key];
}

/** Adds a key→id mapping to the index (mutates and returns new index). */
export function addToKeyIndex(index: KeyIndex, key: string, id: string): KeyIndex {
  return { entries: { ...index.entries, [key]: id } };
}
