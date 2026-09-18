import { readFile } from "node:fs/promises";

import { parse as parseYaml } from "yaml";

import { getKeyIndexPath } from "../paths/index.js";
import { loadAllTasks } from "../task/load-all.js";
import { clearLookupCaches } from "../task/lookup-cache.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";

/**
 * Mapping of key (current or historical) → task ID.
 *
 * The index is a cache that LocTT itself maintains. The only place
 * a task's `key` is rewritten inside LocTT is `git/reconcile.ts`
 * during sync (collision resolution); MCP, CLI, and the web API
 * all reject `key` and `key_history` as immutable. Out-of-band
 * edits to those fields (manual frontmatter edits, third-party
 * scripts) fall under LocTT's general trust-the-filesystem model
 * and are repaired via `loctt doctor --rebuild-index`.
 *
 * Lookup keeps the index current with two cheap moves on miss:
 *   1. Fold-in unknown task directories (creation race / `git pull`
 *      that added tasks). Cost is proportional to the number of
 *      new task directories, not the total population.
 *   2. Drop dangling entries when the target task.md is gone
 *      (concurrent delete by another process).
 *
 * Both happen in `lookupByKey`. See `task/lookup.ts`.
 */
export interface KeyIndex {
  readonly entries: Readonly<Record<string, string>>;
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
    // Validate every entry is string→string. A malformed entry
    // signals an old or corrupt index; fall back to rebuild.
    for (const [k, v] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof k !== "string" || typeof v !== "string") return undefined;
    }
    return { entries: entries as Record<string, string> };
  } catch {
    return undefined;
  }
}

/** Saves the key index to disk. */
export async function saveKeyIndex(locttDir: string, index: KeyIndex): Promise<void> {
  await writeYamlAtomically(getKeyIndexPath(locttDir), {
    entries: index.entries,
  });
}

/**
 * Full rebuild of the key index from a scan of all tasks. Used by
 * `loctt doctor --rebuild-index` and as the fallback when no index
 * file exists. Lookups never call this on the hot path; they use
 * the cheaper fold-in approach in `lookupByKey`.
 */
export async function rebuildKeyIndex(locttDir: string): Promise<KeyIndex> {
  const tasks = await loadAllTasks(locttDir);
  const entries: Record<string, string> = {};

  // Historical keys first, live keys second, so a live key always wins.
  // After a two-tracker merge one task can hold `T-1` while another
  // carries `T-1` in its history — writing them in one pass lets the
  // historical entry shadow the live one, and `loctt show T-1` then
  // resolves to the wrong task.
  for (const task of tasks) {
    for (const oldKey of task.frontmatter.key_history ?? []) {
      entries[oldKey] = task.frontmatter.id;
    }
  }
  for (const task of tasks) {
    entries[task.frontmatter.key] = task.frontmatter.id;
  }

  const index: KeyIndex = { entries };
  await saveKeyIndex(locttDir, index);
  // Repair-style rebuild (doctor, or cold-start bootstrap): drop the
  // in-process negative cache so any prior misses recomputed against
  // the stale index are not held over after the repair.
  clearLookupCaches(locttDir);
  return index;
}

/** Looks up a task ID by key using the index. Returns undefined if not found. */
export function lookupKeyInIndex(index: KeyIndex, key: string): string | undefined {
  return index.entries[key];
}

/**
 * Adds a key→id mapping to the index. Used by `lookupByKey` during
 * the fold-in step (one entry per newly-discovered task) and by
 * write paths that want to keep the index hot. Pure: returns a new
 * KeyIndex; the caller is responsible for persisting via
 * `saveKeyIndex` if appropriate.
 */
export function addToKeyIndex(index: KeyIndex, key: string, id: string): KeyIndex {
  return {
    entries: { ...index.entries, [key]: id },
  };
}

/**
 * Removes a key entry from the index. Used when a lookup discovers
 * the target task.md is gone (concurrent delete by another process).
 * Pure: returns a new KeyIndex.
 */
export function removeFromKeyIndex(index: KeyIndex, key: string): KeyIndex {
  if (!(key in index.entries)) return index;
  const next: Record<string, string> = { ...index.entries };
  delete next[key];
  return { entries: next };
}
