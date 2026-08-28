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
 * Returns a map keyed by built-in id → `{ count, isLoading,
 * unavailable }`.
 */
export interface BuiltinCount {
  readonly count: number | undefined;
  readonly isLoading: boolean;
  /**
   * The count could not be obtained: the request failed, or it ran
   * past `COUNT_TIMEOUT_MS` without answering.
   *
   * SHL-23 forbids a badge spinning forever — a pending affordance
   * that never resolves is indistinguishable from a hang, and the
   * user has no way to tell the count is simply not coming.
   */
  readonly unavailable: boolean;
}

/**
 * How long a count may take before the badge gives up on it.
 *
 * Deliberately generous: the count is decoration, and a slow tracker
 * answering at eight seconds should still get its number. Overridable
 * from the page so a spec can exercise the deadline without waiting.
 */
export const COUNT_TIMEOUT_MS = Number(
  (globalThis as { __LOCTT_COUNT_TIMEOUT_MS__?: unknown }).__LOCTT_COUNT_TIMEOUT_MS__ ?? 15_000,
);

export function useBuiltinCounts(
  builtins: readonly BuiltinFilter[],
  ctx: BuiltinContext,
  /**
   * Overrides the deadline. A parameter rather than only the global,
   * because the global is read at module-evaluation time and a test
   * importing this module cannot set it early enough — which made the
   * deadline, the part SHL-23 actually turns on, untestable.
   */
  timeoutMs: number = COUNT_TIMEOUT_MS,
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
            { signal, timeoutMs },
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
    // refetch) would render a stale number with no signal.
    const enabled = search?.q !== undefined;
    out[id] = {
      count: enabled && r?.isSuccess === true ? r.data?.total : undefined,
      isLoading: enabled && r?.isLoading === true,
      // A failed count — including one the deadline aborted — is
      // reported as unavailable rather than left pending (SHL-23).
      unavailable: enabled && r?.isError === true,
    };
  });
  return out;
}
