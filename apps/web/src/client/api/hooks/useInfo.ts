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
