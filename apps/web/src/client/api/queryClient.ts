import { focusManager, QueryClient } from "@tanstack/react-query";

/**
 * The longest a displayed value may be wrong, in milliseconds.
 *
 * Exported so the surface can *state* the number rather than describe
 * the behaviour as "eventually" (XS-2), and so a test asserts the same
 * constant the client is configured with.
 */
export const STALENESS_WINDOW_MS = 60_000;

/**
 * Shared TanStack Query client. Defaults are conservative — most
 * LocTT views are local-first (one user, one filesystem), so we don't
 * need aggressive cache invalidation, but we also don't want stale
 * data sticking around forever when configs change.
 *
 * - staleTime 30s: same query within the window won't refetch on
 *   re-mount. Good for navigating across views that re-read the same
 *   list of projects / users / labels.
 * - refetchOnWindowFocus true — see STALENESS below.
 * - refetchInterval 60s — likewise.
 * - retry: 1 — one quick retry hides transient network blips during
 *   `npm run dev` reloads but doesn't mask real failures.
 * - networkMode "always" — see below. Load-bearing, not a tweak.
 *
 * ## STALENESS (XS-2)
 *
 * **The maximum time a displayed value can be wrong is 60 seconds,
 * and less than that whenever the tab regains focus.**
 *
 * That number is this file's contract. It exists because the tracker
 * has three writers — the UI, the CLI, and the MCP server — all
 * against the same `.loctt/` directory. This previously ran with
 * `refetchOnWindowFocus: false` on the reasoning that "the app is
 * local; nothing changes when you tab away", which is precisely
 * backwards: tabbing away to a terminal and running `loctt set` is the
 * normal way this tracker is used. With no interval either, a value
 * could be wrong for the lifetime of the tab — the state XS-2 rules
 * out by name.
 */
/**
 * Stops TanStack pausing work while the tab is in the background.
 *
 * `networkMode: "always"` only clears one of the retryer's two
 * conjuncts. The other is `focusManager.isFocused()`, which is just
 * `document.visibilityState !== "hidden"` — so a failed request in a
 * background tab pauses **indefinitely**: `status` stays "pending", the
 * error is never recorded, `isError` is false forever, and every error
 * branch keyed on it is unreachable. Switching tabs is not an exotic
 * state; it is what a user does constantly.
 *
 * The fix is *not* "report focused forever", which is what this did
 * first. `refetchOnWindowFocus` fires on a focus **transition**, so a
 * manager pinned to `true` never transitions and the focus refetch
 * XS-2 requires can never happen — one case's fix silently disabling
 * another's.
 *
 * Instead the listener tracks visibility as the default does, but
 * reports focused whenever the document is hidden. Retries therefore
 * never stall (the retryer sees focused), while a real
 * hidden → visible transition still produces a `false → true` edge for
 * the refetch to hang off.
 */
focusManager.setEventListener(setFocused => {
  const update = (): void => {
    // Hidden reports as focused so the retryer never pauses; visible
    // reports as focused too. The transition that matters is produced
    // by the `false` pulse below.
    setFocused(true);
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") {
      // Pulse false → true so TanStack sees an edge and honours
      // `refetchOnWindowFocus`. Without the pulse the manager is
      // already `true` and the return-to-tab refetch never fires.
      setFocused(false);
      setFocused(true);
    } else {
      update();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility, false);
  }
  update();
  return () => {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
});

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Focus is a refetch trigger, not only time: a tab left open
        // overnight shows current data on the frame the user returns
        // to it, before they can act on a stale value (XS-2).
        refetchOnWindowFocus: true,
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
        refetchInterval: query =>
          query.state.status === "error"
            // Errored: poll fast, because this is the recovery path.
            ? 5_000
            // Healthy: the bounded staleness window XS-2 requires. A
            // `false` here makes the maximum time a value can be wrong
            // the lifetime of the tab.
            : STALENESS_WINDOW_MS,
        // `true`, per the docs' own recommendation for a
        // retry-until-it-recovers poll. With `false` the interval is
        // gated on `focusManager.isFocused()`, so recovery would only
        // run while the user is looking at the tab — and a user who
        // switches away during an outage would come back to the same
        // error screen. The poll only exists while a query is in error,
        // so a healthy tracker still does nothing in the background.
        refetchIntervalInBackground: true,
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
