import type { TrackerInfoResponse } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * Reads tracker info: exists flag, task count, key prefix, next key,
 * and the schema status. Used by:
 *  - the schema-mismatch banner (T0.5) to know whether to show
 *  - the init wizard (T6) to know whether to redirect to /init
 *  - the sidebar footer (T1.1) to show prefix + next key
 *
 * The query key is intentionally short — there's only one info per
 * tracker.
 */
export function useInfo() {
  return useQuery({
    queryKey: ["info"],
    queryFn: ({ signal }) => apiClient.get<TrackerInfoResponse>("/api/info", { signal }),
  });
}

/**
 * Same info, but always refetched on mount (K16).
 *
 * `AppBootstrap` calls `useInfo()` while the shell mounts, and the
 * default `staleTime` is 30s — so a panel mounting inside that window
 * reads the bootstrap's cached response. That is fine for the prefix
 * and task count, which do not change under the user.
 *
 * It is not fine for `completedPrefixRename`. The server recovers an
 * interrupted rename on whichever request arrives first, which is
 * usually *not* the bootstrap's `/api/info` — so the cached response
 * predates the recovery and the notice never appears. Measured: the
 * server returned the notice to `curl` while the UI showed nothing.
 *
 * The Projects panel is the only place the notice renders, so it asks
 * for a fresh read rather than every consumer paying for one.
 */
export function useInfoFresh() {
  return useQuery({
    queryKey: ["info"],
    queryFn: ({ signal }) => apiClient.get<TrackerInfoResponse>("/api/info", { signal }),
    refetchOnMount: "always",
    staleTime: 0,
  });
}
