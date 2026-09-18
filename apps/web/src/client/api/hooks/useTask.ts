import type { TaskResponse } from "@loctt/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { apiClient, ApiError } from "../client.ts";

/**
 * Reads one task by its user-facing ref — a current key, a retired
 * key, or a ULID.
 *
 * **The server resolves retired keys** (TSK-2). Measured against a
 * real tracker: move `T-1` into another project so it becomes `WEB1`,
 * then `GET /api/tasks/T-1` still answers 200 and returns
 * `key: "WEB1"` with `key_history: ["T-1"]`. So the caller always has
 * both the live key and the one the user navigated by, and does not
 * need to ask twice to tell them apart.
 *
 * **Fetching also records the view.** `GET /api/tasks/:ref` calls
 * `pushRecent` server-side, which is what fills the sidebar's
 * "Recently viewed" group (TSK-3). Nothing on the client pushes, so
 * "once per mount" is a question of not refetching rather than of not
 * calling — `staleTime` on the shared client governs it.
 *
 * But the server pushing is not the same as the sidebar *showing* it.
 * `/api/recents` is its own query with the shared 30-second
 * `staleTime`, so opening a task changed the file and left the
 * sidebar rendering "No recent tasks" until the window happened to
 * refetch. TSK-3 requires the group to gain the task **without a page
 * reload**, so the fetch that caused the push invalidates the query
 * that reads it.
 *
 * On success only, and keyed on the *response*: invalidating in the
 * query function would fire on the 404 path too, where nothing was
 * pushed, and re-reading recents on every failed deep link is work
 * for an answer that cannot have changed.
 *
 * A 404 is a real answer, not a transient failure: the key was never
 * allocated. It is thrown like any other error so the route can
 * distinguish it (ERR-8, SHL-44 both turn on that distinction), and
 * the shared retry predicate already declines to retry `not_found`.
 *
 * **`refetchOnMount: "always"` — this query opts out of the shared
 * 30-second `staleTime`, deliberately.**
 *
 * The shared default is right for the sidebar's config lists, which
 * are cheap to be slightly stale about. It is wrong for this one. A
 * task detail is a whole page rendered from a single file, and if that
 * file is gone the page is not slightly stale — it is a screen of
 * fields for a task that does not exist, with a header, a meta panel
 * and a More menu that all look live. XS-58 names exactly that:
 * "not a page of stale fields with live-looking edit controls".
 *
 * Measured, not assumed: with the shared default, deleting a task in
 * the CLI and navigating back to it in-app rendered the full detail
 * page from cache — title, breadcrumb, meta panel — for a task with no
 * directory on disk. Mounting the route is the moment the user asserts
 * they are looking at this task, so it is the moment to check.
 *
 * The cost is one request per mount of a route the user navigated to
 * on purpose, against a local server reading one file. P-1 puts the
 * files first and the cache second, and this is where that costs
 * least.
 *
 * To revert: drop the option and this query inherits the 30s window
 * again — at the price of XS-58 and ERR-7's first bullet.
 */
export function useTask(ref: string) {
  const qc = useQueryClient();
  const query = useQuery<TaskResponse, ApiError>({
    queryKey: ["task", ref],
    queryFn: ({ signal }) => apiClient.get<TaskResponse>(
      `/api/tasks/${encodeURIComponent(ref)}`,
      { signal },
    ),
    refetchOnMount: "always",
  });

  // `dataUpdatedAt` changes once per *successful* fetch and is stable
  // across re-renders, so this fires when a fetch lands and not on
  // every render — which an effect keyed on `data` would, since a
  // fresh object identity arrives each time.
  const { isSuccess, dataUpdatedAt } = query;
  useEffect(() => {
    if (!isSuccess) return;
    void qc.invalidateQueries({ queryKey: ["recents"] });
  }, [isSuccess, dataUpdatedAt, qc]);

  return query;
}
