/**
 * Process-scoped negative cache for `lookupByKey`. Lives in its own
 * leaf module so writers (`io.ts`, `lifecycle.ts`, `create.ts`) can
 * invalidate it without importing the full `lookup.ts` (which would
 * create an import cycle: lookup → io → lookup).
 *
 * Within a single process, a "key not found" verdict is stable
 * until a writer (`writeTask`, `deleteTask`, etc.) calls
 * `clearLookupCaches`. The cache short-circuits repeated misses on
 * the same key so a keyspace-probe pattern doesn't repeatedly
 * fold-in the same set of unknown task directories.
 *
 * Defends against keyspace-probe patterns that hit many missing keys
 * in a single MCP tool call or web request (e.g. an LLM iterating
 * `T-99999`, `T-99998`, …); each miss would otherwise scan the full
 * tasks dir to rebuild the index.
 *
 * Cleared by {@link clearLookupCaches} when a writer would
 * invalidate it. Keyed by `${locttDir}\0${key}` so multiple trackers
 * in the same process don't share entries.
 */
const negativeKeyCache = new Set<string>();

function negKey(locttDir: string, key: string): string {
  return `${locttDir}\0${key}`;
}

/** Returns true if this (locttDir, key) was cached as a known miss. */
export function hasNegativeLookup(locttDir: string, key: string): boolean {
  return negativeKeyCache.has(negKey(locttDir, key));
}

/** Records a (locttDir, key) as a known miss. */
export function rememberNegativeLookup(locttDir: string, key: string): void {
  negativeKeyCache.add(negKey(locttDir, key));
}

/**
 * Invalidates the in-process negative cache for one tracker.
 * Called by writers that mutate the task population so a key that
 * was "not found" before may now exist (e.g. just-created task).
 */
export function clearLookupCaches(locttDir: string): void {
  // Linear scan over a small set; trackers don't accumulate
  // millions of negative entries in a single process lifetime.
  const prefix = `${locttDir}\0`;
  for (const k of negativeKeyCache) {
    if (k.startsWith(prefix)) negativeKeyCache.delete(k);
  }
}
