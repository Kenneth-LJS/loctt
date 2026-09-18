import { focusManager, QueryClient } from "@tanstack/react-query";

import { ApiError } from "./client.ts";

/**
 * Whether asking again could plausibly give a different answer.
 *
 * The distinction is the server's *code*, not its status class. A
 * first cut tested `status >= 400 && status < 500` and got two things
 * wrong: `conflict` is a 409 that BLK-42 says to wait out ("retrying
 * after the lock clears succeeds"), and 408/429 are retryable by
 * definition. Meanwhile a `config_invalid` will say the same thing
 * every time until the user edits the file.
 *
 * Unknown codes and envelope-less failures count as retryable: a
 * failure we cannot classify is one we have no grounds to give up on,
 * and an unreachable server has no envelope at all.
 */
function isSettledAnswer(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  const code = error.envelope?.code;
  if (code === undefined) return false;
  // The server considered the request and refused it. Asking again
  // changes nothing until something on disk changes.
  return (
    code === "validation_failed"
    || code === "not_found"
    || code === "config_invalid"
    || code === "schema_mismatch"
    || code === "archived_reference"
  );
}

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
 * - retry — one quick retry for failures a retry could fix; never
 *   for a 4xx, which is the server's considered answer.
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
        // One quick retry hides a transient blip — but only for
        // failures a retry could plausibly fix. A 4xx is the server's
        // considered answer: it will say the same thing next time.
        //
        // This is not only waste. The M1 gate found a schema-mismatched
        // tracker (every route 409s, permanently) hung on a spinner
        // forever, because the retries kept the query re-entering
        // `fetching` and `isLoading` is `isPending && isFetching`.
        // Retrying a permanent answer manufactured a perpetual
        // in-flight state out of a settled one.
        retry: (failureCount, error) => {
          if (isSettledAnswer(error)) return false;
          return failureCount < 1;
        },
        // A settled error is an answer, and mounting a component is not
        // a reason to un-answer it.
        //
        // This is the whole of the M1 gate's F3 hang, and it is
        // structural rather than a policy tweak. `AppBootstrap` gates
        // the shell on `["info"]`; the shell contains `ListView`, which
        // calls `useInfo()` too. So the gate depends on a query that
        // opening the gate mutates:
        //
        //   1. `["info"]` 409s          → status "error"
        //   2. `AppBootstrap` sees the error, renders `AppShell`
        //   3. `ListView` mounts a *second* observer on `["info"]`
        //   4. `shouldLoadOnMount` is true — no data, and by default a
        //      new observer retries an errored query — so query-core
        //      dispatches `fetch`, whose reducer resets `status` to
        //      "pending" and `fetchFailureCount` to 0
        //   5. the gate closes again, `AppShell` unmounts, goto 1
        //
        // Measured on a schema-mismatched tracker: ~70 cycles a second,
        // `errorUpdateCount` past 4,900 while `fetchFailureCount` stayed
        // 0 (reset every cycle by that `fetch`) and `status` never left
        // "pending". The shell mounted and unmounted so fast it never
        // reached a commit, so the schema banner it exists to show was
        // unreachable — the page read "Loading…" forever.
        //
        // `retryOnMount` has exactly one use site in query-core, and it
        // only suppresses the mount fetch for a query that is *already*
        // in `error` with no data. A successful or pending query is
        // unaffected, so this costs nothing on the healthy path.
        //
        // Nor does it strand a recoverable failure: recovery here is the
        // `refetchInterval` poll below, not a remount, so a transient
        // error still re-attempts within 5 seconds whether or not
        // anything mounted.
        retryOnMount: false,
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
        refetchInterval: query => {
          // A settled answer will say the same thing next time, so
          // polling it is not recovery — it is waste. Recovery polling
          // exists for a server that might come back, or a lock that
          // might clear.
          //
          // This is *not* what caused the M1 gate's F3 hang — that was
          // the mount-refetch loop `retryOnMount` above describes, and
          // this returning `false` did not stop it. Kept on its own
          // merits: without it, a permanently-4xx route is re-asked
          // every 5 seconds forever.
          if (isSettledAnswer(query.state.error)) return false;
          return query.state.status === "error"
            // Errored: poll fast, because this is the recovery path.
            ? 5_000
            // Healthy: the bounded staleness window XS-2 requires. A
            // `false` here makes the maximum time a value can be wrong
            // the lifetime of the tab.
            : STALENESS_WINDOW_MS;
        },
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
