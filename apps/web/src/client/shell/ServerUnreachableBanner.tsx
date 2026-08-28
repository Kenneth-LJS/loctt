import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { ApiError } from "../api/client.ts";

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
 * Recovery is automatic. The query defaults poll an errored query, so
 * when the server returns a query succeeds and this clears itself
 * without a manual reload — the case's last bullet.
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
        if (q.state.dataUpdatedAt > 0) {
          // This query has been answered at some point, so the server
          // exists as far as it is concerned.
          lastSuccess = Math.max(lastSuccess, q.state.dataUpdatedAt);
          continue;
        }
        if (q.state.status !== "error") continue;
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
      className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-danger-fg/20 bg-danger-bg px-4 py-2 text-[13px] text-danger-fg"
    >
      <span className="font-semibold">The LocTT server is not responding.</span>
      <span className="opacity-90">
        The terminal running <code className="font-mono">loctt ui</code> may have
        stopped — restart it and this will clear on its own.
      </span>
      <button
        type="button"
        onClick={() => { void queryClient.refetchQueries(); }}
        className="ml-auto rounded border border-danger-fg/40 px-2 py-0.5 hover:bg-danger-fg/10"
      >
        Try now
      </button>
    </div>
  );
}
