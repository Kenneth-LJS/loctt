import type { IntegritySummaryResponse } from "@loctt/contracts";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client.ts";

/**
 * DEG-31: the global data-integrity summary that feeds the header badge.
 *
 * `GET /api/integrity` returns a tiny fixed-size count (`{ ok, counts,
 * total }`), computed cheaply server-side — never a full doctor run per
 * page load. The badge renders only when `ok === false`, so most reads
 * cost nothing to display.
 *
 * The key is `["integrity"]`, invalidated by the same mutations that
 * invalidate `["tasks"]` and the config lists (see the mutation hooks) —
 * so a write that repairs (or introduces) corruption refreshes the badge
 * without polling. `staleTime` of 30s matches the app's `/api/info` window:
 * a badge that lags a repair by up to half a minute is fine when every
 * relevant write already invalidates it.
 */
const INTEGRITY_STALE_MS = 30_000;

export function useIntegrity() {
  return useQuery({
    queryKey: ["integrity"],
    queryFn: ({ signal }) =>
      apiClient.get<IntegritySummaryResponse>("/api/integrity", { signal }),
    staleTime: INTEGRITY_STALE_MS,
  });
}
