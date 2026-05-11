import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";

import { getKeyIndexPath } from "../paths/index.js";
import { listTaskIds } from "../task/list-ids.js";
import { loadAllTasks } from "../task/load-all.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";

/**
 * Mapping of key (current or historical) → task ID, plus a
 * watermark recording the task count at the time of the last
 * full rebuild. Lookup paths use the watermark to detect when
 * the on-disk task population has changed (created/deleted out
 * of band, e.g. via `git pull`) and a rebuild is needed.
 *
 * Why count rather than mtime: filesystem mtime granularity is
 * 1 second on some filesystems, so a write+lookup within the
 * same second could miss a real change. Integer task count is
 * always precise; misses on hand-edited rekeys (same count, new
 * key) are tolerated by the existing fallback rebuild on miss.
 */
export interface KeyIndex {
  readonly entries: Readonly<Record<string, string>>;
  /** Task count recorded at the last rebuild. */
  readonly task_count: number;
}

/** Loads the key index from disk. Returns undefined if not found or malformed. */
export async function loadKeyIndex(locttDir: string): Promise<KeyIndex | undefined> {
  const path = getKeyIndexPath(locttDir);
  try {
    const content = await readFile(path, "utf-8");
    const raw: unknown = parseYaml(content);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const obj = raw as Record<string, unknown>;
    const entries = obj["entries"];
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) return undefined;
    const taskCount = obj["task_count"];
    if (typeof taskCount !== "number") return undefined;
    return {
      entries: entries as Record<string, string>,
      task_count: taskCount,
    };
  } catch {
    return undefined;
  }
}

/** Saves the key index to disk. */
export async function saveKeyIndex(locttDir: string, index: KeyIndex): Promise<void> {
  await writeYamlAtomically(getKeyIndexPath(locttDir), {
    entries: index.entries,
    task_count: index.task_count,
  });
}

/**
 * Rebuilds the key index by scanning all tasks. Records the task
 * count as the watermark so subsequent lookups can detect when
 * the population has changed and skip rebuild on stable misses.
 */
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

  const index: KeyIndex = { entries, task_count: tasks.length };
  await saveKeyIndex(locttDir, index);
  return index;
}

/**
 * Returns true when the on-disk task count matches the index's
 * watermark — i.e. the index can be trusted as authoritative for
 * "this key isn't here." Returns false when the count drifted
 * (creation, deletion, or a partial rebuild), forcing a rebuild
 * on the next miss.
 */
export async function isKeyIndexFresh(
  locttDir: string,
  index: KeyIndex,
): Promise<boolean> {
  const ids = await listTaskIds(locttDir);
  return ids.length === index.task_count;
}

/** Looks up a task ID by key using the index. Returns undefined if not found. */
export function lookupKeyInIndex(index: KeyIndex, key: string): string | undefined {
  return index.entries[key];
}

/**
 * Adds a key→id mapping to the index. Returns a new immutable
 * KeyIndex with the addition. Bumps the watermark by 1 so the
 * caller's freshness check still matches the on-disk count after
 * a write that they themselves created.
 */
export function addToKeyIndex(index: KeyIndex, key: string, id: string): KeyIndex {
  return {
    entries: { ...index.entries, [key]: id },
    task_count: index.task_count + 1,
  };
}
