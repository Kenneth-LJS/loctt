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
 * - networkMode "always" — see below. Load-bearing, not a tweak.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
        // The server is on loopback, so `navigator.onLine` says nothing
        // about whether it is reachable.
        //
        // Under the default "online" mode the retryer checks
        // `onlineManager.isOnline()` *between* the first failure and the
        // retry and, if the browser reports offline, pauses the query
        // **indefinitely**: `status` stays "pending", `fetchStatus`
        // becomes "paused", and the error is never recorded — so
        // `isError` is false forever and every error branch keyed on it
        // is unreachable.
        //
        // For a localhost app that is simply wrong: a laptop with Wi-Fi
        // off reports offline while the server runs fine a loopback
        // away, and the list shows its empty state until the network
        // comes back. It also produced three separate wrong screens in
        // the M1 gate — stale rows under a new filter, "No tasks match
        // these filters" on a cold navigation, and a Load-more button
        // that failed silently — all one mechanism, none of them
        // reachable in a settled error state.
        networkMode: "always",
        // ERR-2: the UI recovers on its own when the server comes back,
        // without a manual reload. With `networkMode: "always"` the
        // browser's online event is not a reliable signal — the server
        // is on loopback and may restart while the network never
        // changed — so recovery is a poll rather than a reconnect hook.
        //
        // Only while the query is in an error state: returning false
        // for a healthy query means a working tracker polls nothing,
        // and a broken one re-checks every few seconds until it heals.
        refetchInterval: query => (query.state.status === "error" ? 5_000 : false),
        refetchIntervalInBackground: false,
      },
      mutations: {
        // Same reasoning, and worse if it bites: a paused *write* never
        // runs and never reports, so a bulk action would spin with the
        // server sitting there ready.
        networkMode: "always",
      },
    },
  });
}
