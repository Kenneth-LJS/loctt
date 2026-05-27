import { QueryClient } from "@tanstack/react-query";

/**
 * Shared TanStack Query client. Defaults are conservative — most
 * LocTT views are local-first (one user, one filesystem), so we don't
 * need aggressive cache invalidation, but we also don't want stale
 * data sticking around forever when configs change.
 *
 * - staleTime 30s: same query within the window won't refetch on
 *   re-mount. Good for navigating across views that re-read the same
 *   list of projects / users / labels.
 * - refetchOnWindowFocus false: the app is local; nothing changes
 *   when you tab away. Re-enable later if/when collaboration lands.
 * - retry: 1 — one quick retry hides transient network blips during
 *   `npm run dev` reloads but doesn't mask real failures.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
