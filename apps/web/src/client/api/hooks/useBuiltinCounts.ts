import { useQueries } from "@tanstack/react-query";

import type { BuiltinContext, BuiltinFilter } from "../../sidebar/builtinFilters.ts";
import { apiClient } from "../client.ts";

interface TasksPage {
  readonly total: number;
}

/**
 * Live count badges for the sidebar's built-in saved filters.
 *
 * For each built-in that resolves to a search state with a `q` DSL
 * string, we issue the same request the list view would
 * (`/api/tasks?query=…&limit=0`) and read back `total`. `limit=0`
 * means the server still computes the full match count but ships no
 * task rows — exactly what a count badge needs.
 *
 * Built-ins that don't resolve (no current user yet, or "Mentions me"
 * which is deferred) get `count: undefined` and render without a
 * badge. The query key embeds the resolved `q` so a user switch (which
 * changes "Assigned to me") refetches automatically.
 *
 * Returns a map keyed by built-in id → `{ count, isLoading }`.
 */
export interface BuiltinCount {
  readonly count: number | undefined;
  readonly isLoading: boolean;
}

export function useBuiltinCounts(
  builtins: readonly BuiltinFilter[],
  ctx: BuiltinContext,
): Record<string, BuiltinCount> {
  const resolved = builtins.map(b => ({ id: b.id, search: b.resolve(ctx) }));

  const results = useQueries({
    queries: resolved.map(({ id, search }) => {
      const q = search?.q;
      return {
        queryKey: ["builtin-count", id, q ?? null],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          apiClient.get<TasksPage>(
            `/api/tasks?limit=0&query=${encodeURIComponent(q ?? "")}`,
            { signal },
          ),
        // Skip the fetch for built-ins with no resolvable query.
        enabled: q !== undefined,
      };
    }),
  });

  const out: Record<string, BuiltinCount> = {};
  resolved.forEach(({ id, search }, i) => {
    const r = results[i];
    // Only surface a count once the query has actually succeeded —
    // otherwise a failed or in-flight count (e.g. mid user-switch
    // refetch) would render a stale number with no signal. An errored
    // or pending count simply shows no badge.
    out[id] = {
      count: search?.q !== undefined && r?.isSuccess ? r.data?.total : undefined,
      isLoading: r?.isLoading ?? false,
    };
  });
  return out;
}
