import type { HistoryEntry } from "@loctt/contracts";
import { useInfiniteQuery } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * The task's activity feed, paginated (M2.4b — CMT-17, CMT-25,
 * CMT-38).
 *
 * ## Why `useInfiniteQuery` and not a page counter in state
 *
 * CMT-38's third bullet: a failed "Load more" must resume **from the
 * same offset**, not restart from zero and duplicate entries. A
 * `useState` offset advanced optimistically gets that wrong in the
 * obvious way, and advanced on success loses the retry target on
 * unmount. React Query keeps the loaded pages and the next cursor as
 * one value, so a failed `fetchNextPage` leaves both exactly where
 * they were — the already-loaded pages stay in `data` (the first
 * bullet) and retrying re-requests the same offset.
 *
 * ## The unit is entries, not rows
 *
 * CMT-25's first bullet — "'Load more' pages by underlying *entries*,
 * and the count text is honest about which unit it's counting". The
 * server slices the reversed entry list, so `offset` counts entries;
 * the bulk collapse happens after, in the client, over everything
 * loaded. Expanding a group therefore cannot consume pagination budget
 * (third bullet): expansion is local component state and never touches
 * this query.
 */

/** Entries per "Load more". */
export const ACTIVITY_PAGE_SIZE = 50;

export interface ActivityPage {
  readonly entries: readonly HistoryEntry[];
  /** Readable entries the server holds for this task, at read time. */
  readonly total: number;
  /**
   * Rows in `_history.yaml` the server could not interpret and left
   * out of `total`.
   *
   * CMT-37's second bullet needs this: without it a file with one
   * hand-broken entry reads back as a complete, shorter history, and
   * the feed presents a partial log as the whole one. Optional
   * because an older server does not send it — and `> 0` is the only
   * test, so an absent field is correctly "nothing was dropped"
   * rather than a false alarm.
   */
  readonly unreadable?: number;
}

export function activityQueryKey(ref: string): readonly unknown[] {
  return ["activity", ref];
}

export function useActivity(ref: string, pageSize = ACTIVITY_PAGE_SIZE) {
  return useInfiniteQuery<
    ActivityPage,
    Error,
    { pages: ActivityPage[]; pageParams: number[] },
    readonly unknown[],
    number
  >({
    queryKey: activityQueryKey(ref),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      apiClient.get<ActivityPage>(
        `/api/tasks/${encodeURIComponent(ref)}/activity`
        + `?limit=${String(pageSize)}&offset=${String(pageParam)}`,
        { signal },
      ),
    /**
     * The next offset is the count of what is already loaded, not
     * `pages.length * pageSize` — a short page (the server holding
     * fewer entries than asked for, or a malformed row dropped by
     * `readHistory`) would otherwise leave a hole. Returning
     * `undefined` is what makes "Load more" disappear once everything
     * is present (CMT-17's fourth bullet).
     */
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.entries.length, 0);
      return loaded >= last.total ? undefined : loaded;
    },
  });
}
