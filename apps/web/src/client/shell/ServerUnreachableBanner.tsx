import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";

/**
 * App-level notice that the LocTT server has stopped answering.
 *
 * SHL-41 asks for a *persistent, visible* state — not a per-view
 * error. The distinction matters: a user who is looking at a cached
 * board while the server dies sees nothing at all from a view-scoped
 * error, and "views do not render as empty in the meantime" cannot be
 * enforced one view at a time.
 *
 * Detection is by observing the query cache rather than
 * `navigator.onLine`: the server is on loopback and can stop while the
 * network never changes. A failure with no error envelope means the
 * request never reached the server at all, which is exactly the
 * "terminal was closed" case; a 500 with an envelope is the server
 * answering, and is not this.
 *
 * Recovery is automatic and measured: the banner clears itself within
 * a second of the server returning, with no reload and no click
 * (ERR-2's last bullet).
 *
 * The M1 gate (F2) claimed the errored-query poll never runs. It does,
 * and it is what recovers this: traced through query-core to the
 * `#updateRefetchInterval` timer, one frame under the `fetch` that
 * heals `["info"]`. Disable that poll and the banner is still up
 * twenty seconds after the server returns.
 *
 * The recovery is *only* the poll. Everything else that fires in the
 * same moment — the sidebar counts, the list — is downstream: those
 * are `onSubscribe` fetches from components that mount once
 * `AppBootstrap`'s gate reopens on the healed `["info"]`.
 */
export function ServerUnreachableBanner() {
  const queryClient = useQueryClient();
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const recompute = (): void => {
      const queries = cache.getAll();
      // "Not responding" is a claim about the *server*, so it needs
      // more than one failed request. A single aborted page load
      // inside a query that has already had a page answered is a
      // failed request, not a stopped process — and saying otherwise
      // tells the user to go restart a terminal that is fine.
      //
      // The rule: a query counts as evidence only when the server has
      // never answered it. The most recent evidence wins, so a
      // success clears the banner and a later failure brings it back.
      let lastFailure = 0;
      let lastSuccess = 0;
      for (const q of queries) {
        // A query that has been answered is evidence the server was
        // alive *at that moment* — recorded, then compared by time
        // below. It is emphatically not a reason to stop looking at
        // this query's later failures.
        //
        // It used to `continue` here, and that is the whole of the M1
        // round-6 F1 blocker: with the page open every query has
        // succeeded, so every query was skipped, so no failure could
        // ever be counted. Kill the server with the app open and
        // nothing said so — 50 stale rows under an authoritative
        // "Showing 1–50 of 63". Seven UI specs missed it because all
        // of them `page.reload()` first, and a reload throws away the
        // cache that creates the condition.
        if (q.state.dataUpdatedAt > 0) {
          lastSuccess = Math.max(lastSuccess, q.state.dataUpdatedAt);
        }

        // **Never ask what the status is right now.** `fetchState`
        // resets a data-less query to `status: "pending", error: null`
        // on every fetch, so a query that is failing and retrying
        // reads as "pending" for the whole attempt — measured here as
        // `status: "pending", fetchStatus: "fetching",
        // errorUpdatedAt > 0` while the server was definitively dead.
        //
        // A `status !== "error"` guard therefore drops exactly the
        // failures this banner exists to notice. `errorUpdatedAt`
        // survives the reset; it is the honest question, and it is the
        // same fix `AppBootstrap` carries for the same reason. This is
        // the fifth bug traced to that one trap — see known-gaps.md.
        if (q.state.errorUpdatedAt === 0) continue;
        const err = q.state.error;
        // An envelope means the server answered — a server error, not
        // an absent server, and it belongs to the view that asked.
        if (err instanceof ApiError && err.envelope !== undefined) continue;
        lastFailure = Math.max(lastFailure, q.state.errorUpdatedAt);
      }
      // `>=` rather than `>`: the timestamps have millisecond
      // resolution, so a failure and a success in the same tick are
      // indistinguishable by time. When they tie, the failure wins —
      // saying "not responding" for a moment while the server is fine
      // is a smaller error than staying silent while it is not.
      setUnreachable(lastFailure > 0 && lastFailure >= lastSuccess);
    };
    recompute();
    return cache.subscribe(recompute);
  }, [queryClient]);

  if (!unreachable) return null;

  return (
    <div
      // `status`, not `alert`. SHL-41 asks for "a persistent, visible
      // state (banner or blocking overlay)" and never for an alert
      // role — and `alert` is wrong for it twice over: this is
      // standing context rather than an interruption, and it fires
      // alongside whatever the failing view is already saying, so a
      // screen reader user would get two simultaneous assertive
      // announcements for one event.
      //
      // It also made every spec that kills the server ambiguous:
      // `getByRole("alert")` resolved to this banner *and* the view's
      // own error state, which broke twenty of them at once.
      role="status"
      data-server-unreachable="true"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-danger-fg/20 bg-danger-bg px-4 py-2 text-[0.9286rem] text-danger-fg"
    >
      <span className="font-semibold">The LocTT server is not responding.</span>
      <span className="opacity-90">
        The terminal running <code className="font-mono">loctt ui</code> may have
        stopped. Restart it to continue.
      </span>
      {/*
        A311: `variant="current"` inherits this banner's `text-danger-fg`
        via `currentColor` — same tinted-outline look as the old
        hand-rolled `border-danger-fg/40`, now the shared primitive.
      */}
      <Button
        variant="current"
        size="sm"
        className="ml-auto text-[0.9286rem]"
        onClick={() => { void queryClient.refetchQueries(); }}
      >
        Try now
      </Button>
    </div>
  );
}
