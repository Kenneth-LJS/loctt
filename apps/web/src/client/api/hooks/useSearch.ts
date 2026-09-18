import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * A single search hit — the subset of task frontmatter the header
 * dropdown renders. `/api/search` returns the same projected
 * frontmatter shape as `/api/tasks`, so key + title are always present.
 */
export interface SearchHit {
  readonly key: string;
  readonly title: string;
}

interface SearchResponse {
  readonly items: readonly SearchHit[];
  readonly total: number;
  readonly unreadable?: readonly { readonly path: string; readonly error: string }[];
}

/**
 * The global header search (SHL-46).
 *
 * Fires `GET /api/search?q=<text>` — a real network request — whenever
 * `q` is non-empty, capped to a short result list for the dropdown. An
 * empty query issues no request and returns nothing (the endpoint
 * treats empty as "no results", not "everything", but skipping the
 * request entirely avoids a wasted round-trip on a cleared box).
 *
 * `enabled` is threaded so the caller can gate the request on the box
 * actually holding text; `keepPreviousData` stops the dropdown from
 * flickering to empty between keystrokes while the next request lands.
 */
export function useSearch(q: string, limit = 8) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: ["search", trimmed, limit],
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      apiClient.get<SearchResponse>(
        `/api/search?q=${encodeURIComponent(trimmed)}&limit=${String(limit)}`,
        { signal },
      ),
  });
}
