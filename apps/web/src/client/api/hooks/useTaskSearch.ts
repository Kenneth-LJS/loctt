import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/** `/api/search`'s envelope — the same `paginated()` shape `/api/tasks` uses. */
interface SearchPage {
  readonly items: readonly TaskFrontmatterPublic[];
  readonly total: number;
}

/**
 * The link picker's target search (REL-8).
 *
 * `GET /api/search?q=…` runs core's `text ~ "…"`, which matches
 * `title`, `key` and `id` — so REL-8's first two bullets (exact key,
 * a word from the title) are one request.
 *
 * **`key_history` is not in core's `text` alias.** `TEXT_SEARCH_FIELDS`
 * in `query/evaluator.ts` is `["title", "key", "id"]`, so typing a
 * retired key finds nothing there. REL-8's third bullet requires it to
 * resolve, so a second request goes to `GET /api/tasks/:ref` — which
 * *does* resolve retired keys via the key index (that is TSK-2's whole
 * mechanism) — and its answer is merged in when the search missed it.
 *
 * Two requests rather than widening `text ~` server-side, because
 * `text` is the shared query language: adding `key_history` to it
 * changes what `loctt list "text ~ x"` matches on every surface, which
 * is a P10 decision this ticket has no mandate to make. The fallback
 * is the narrower change and is confined to this picker.
 *
 * **Archived tasks are excluded** (REL-30's first bullet): `/api/search`
 * omits them unless `archived=true`, which is not sent. The direct
 * lookup can still surface one — it resolves by ref regardless — and
 * that is deliberate: REL-30's second bullet wants a pasted archived
 * key to be *refused by name*, which needs it to be reachable at all.
 * The row is marked so the picker can say so before the request.
 */
export interface TaskSearchHit {
  readonly id: string;
  readonly key: string;
  /**
   * May be `undefined` when the task's `title` frontmatter is corrupt or
   * absent (K26 — title is field-local, so the task still loads). The
   * picker pairs it with {@link key}, so consumers fall back to a
   * placeholder rather than the key (which is already shown beside it).
   */
  readonly title: string | undefined;
  readonly status: string | undefined;
  readonly archived: boolean;
  /**
   * True when this hit came from the retired-key fallback rather than
   * the search index — the picker labels it, so following a former key
   * is visibly different from a title match.
   */
  readonly viaRetiredKey: boolean;
}

async function lookupExact(
  ref: string,
  signal: AbortSignal | undefined,
): Promise<TaskFrontmatterPublic | undefined> {
  try {
    const res = await apiClient.get<{ frontmatter: TaskFrontmatterPublic }>(
      `/api/tasks/${encodeURIComponent(ref)}`,
      signal === undefined ? {} : { signal },
    );
    return res.frontmatter;
  } catch {
    // A miss is the ordinary case — most keystrokes are not a key.
    // REL-43's "no task matches it" is decided by the *empty result
    // set*, not by this failure, so it is swallowed rather than
    // surfaced as a search error.
    return undefined;
  }
}

/**
 * Searches for link targets, excluding `selfId` (REL-8's last bullet
 * and REL-29's first: the current task never appears in its own
 * results).
 */
export function useTaskSearch(query: string, selfId: string) {
  const trimmed = query.trim();
  return useQuery<readonly TaskSearchHit[]>({
    queryKey: ["task-search", trimmed, selfId],
    enabled: trimmed.length > 0,
    queryFn: async ({ signal }) => {
      const page = await apiClient.get<SearchPage>(
        `/api/search?q=${encodeURIComponent(trimmed)}&limit=20`,
        { signal },
      );
      const hits: TaskSearchHit[] = page.items
        .filter(fm => fm.id !== selfId)
        .map(fm => ({
          id: fm.id,
          key: fm.key,
          title: fm.title,
          status: fm.status,
          archived: fm.archived === true,
          viaRetiredKey: false,
        }));

      // The retired-key fallback. Only when the search did not already
      // find the task, so a live key does not produce two rows.
      const found = new Set(hits.map(h => h.id));
      const exact = await lookupExact(trimmed, signal);
      if (
        exact !== undefined
        && exact.id !== selfId
        && !found.has(exact.id)
      ) {
        hits.unshift({
          id: exact.id,
          key: exact.key,
          title: exact.title,
          status: exact.status,
          archived: exact.archived === true,
          // Only a *retired* key gets here: a live key would have
          // matched `text ~` above and been filtered out by `found`.
          viaRetiredKey: exact.key.toLowerCase() !== trimmed.toLowerCase(),
        });
      }
      return hits;
    },
  });
}
