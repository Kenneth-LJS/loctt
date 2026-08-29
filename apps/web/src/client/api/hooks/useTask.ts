import type { TaskResponse } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

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
 * A 404 is a real answer, not a transient failure: the key was never
 * allocated. It is thrown like any other error so the route can
 * distinguish it (ERR-8, SHL-44 both turn on that distinction), and
 * the shared retry predicate already declines to retry `not_found`.
 */
export function useTask(ref: string) {
  return useQuery<TaskResponse, ApiError>({
    queryKey: ["task", ref],
    queryFn: ({ signal }) => apiClient.get<TaskResponse>(
      `/api/tasks/${encodeURIComponent(ref)}`,
      { signal },
    ),
  });
}
