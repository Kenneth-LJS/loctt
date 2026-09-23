import type { SchemaStatusResponse, TrackerInfoResponse } from "@loctt/contracts";
import { Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";

import { ApiError } from "../api/client.ts";
import { useCurrentUser } from "../api/hooks/useCurrentUser.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { InitWizard } from "../init/InitWizard.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { AppShell } from "./AppShell.tsx";
import { InterruptedMigration } from "./InterruptedMigration.tsx";

/**
 * Gates the whole app on the two reads every screen needs: tracker
 * info (`/api/info`) and the current user (`/api/user/current`).
 *
 * Branches:
 *  - loading      → a centered spinner
 *  - fatal error  → a reload-able error page (info failed, or current
 *    user failed for a reason other than "no users yet")
 *  - uninitialized → the init wizard, replacing the shell. It is
 *    decided here rather than by the `/init` route because ONB-29
 *    requires *every* path to route here rather than render its own
 *    empty state.
 *  - ready        → the app shell with the routed page inside it
 */
export function AppBootstrap() {
  const info = useInfo();
  const currentUser = useCurrentUser();

  // Every hook stays above every branch, per the rules of hooks — and
  // every value that becomes `AppShell`'s `info` is memoised, so the
  // shell's subtree is not re-mounted by a fresh object each render.
  //
  // Worth stating plainly, because this file spent four attempts being
  // blamed for it: memoising these did **not** fix the M1 gate's F3
  // hang, and the hang was never about identity here. This component
  // gates the shell on `["info"]`, and `ListView` — which renders
  // inside that shell — reads `["info"]` too. A second observer
  // mounting on an errored, data-less query refetches it by default,
  // which resets its status to "pending" and closes the gate again.
  // The cure is `retryOnMount: false` in `queryClient.ts`, where that
  // cycle is written out in full. These `useMemo`s are kept because
  // stable props are right anyway, not because they stop a loop.
  const schemaMismatch = useMemo(
    () => schemaStatusFromError(info.error),
    [info.error],
  );
  const placeholderInfo = useMemo(
    () => (schemaMismatch === null ? null : PLACEHOLDER_INFO(schemaMismatch)),
    [schemaMismatch],
  );
  const unknownInfo = useMemo(() => UNKNOWN_INFO(), []);
  // The last `info` actually read. `info.data` is undefined during any
  // attempt on a data-less query, so branching on it makes the answer
  // flicker; this does not.
  const everKnownInfo = useRef<TrackerInfoResponse | undefined>(undefined);

  // `isLoading` is `isPending && isFetching`, which is true again on
  // every refetch of a query that has never succeeded. A boot read
  // that keeps failing therefore oscillates back into "loading"
  // forever — the M1 gate measured this as a spinner still spinning
  // at 142 seconds against a schema-mismatched tracker, with the
  // banner it was meant to show unreachable behind it.
  //
  // What the spinner is actually for is the *first* attempt, before
  // anything is known. Once a read has failed, the answer is known:
  // it failed. `isPending && !isError` says that and does not
  // un-say it on the next tick.
  // Neither `isLoading` nor `isPending` can express this. query-core's
  // `fetchState` resets a data-less query to `status: "pending",
  // error: null` on **every** fetch, not just a mount fetch — so each
  // recovery attempt against a still-dead server walks the query back
  // through "pending", and a gate reading live status collapses the
  // shell for the duration of the attempt.
  //
  // Measured: pressing "Try now" on the unreachable banner destroyed
  // the shell holding the banner.
  //
  // `errorUpdatedAt` / `dataUpdatedAt` survive that reset. They record
  // whether this query has *ever* settled, which is the question the
  // spinner is actually asking.
  const stillWaiting = (q: { errorUpdatedAt: number; dataUpdatedAt: number }): boolean =>
    q.errorUpdatedAt === 0 && q.dataUpdatedAt === 0;

  // `||`, unchanged: either read still genuinely pending means the
  // shell has nothing to render from. Only the *definition* of
  // "still pending" changed.
  if (stillWaiting(info) || stillWaiting(currentUser)) {
    return (
      <LoadingState
        // Full-viewport bootstrap gate, not a settings panel — same
        // component (role=status/aria-busy contract), a bigger spinner
        // and a screen-filling wrapper instead of the panel padding.
        className="grid h-screen place-items-center bg-bg-canvas"
        size={48}
      >
        Loading…
      </LoadingState>
    );
  }

  // A schema mismatch is not a fatal error — it is the state the
  // banner exists for. Every `/api/` route 409s while it stands,
  // `/api/info` included, so this used to render a full-page error and
  // the banner was unreachable in exactly the situation it describes.
  //
  // SHL-13, XS-34 and XS-35 all require the shell and navigation to
  // stay up with the banner visible: the user can move around and read
  // the explanation, they just cannot see or change tasks.
  // XS-37: a crashed migration is not a banner state. It gets its own
  // blocking screen, because the tracker may be half-rewritten and
  // there is nothing safe to browse or click.
  if (schemaMismatch?.kind === "interrupted") {
    return (
      <InterruptedMigration
        from={schemaMismatch.from}
        to={schemaMismatch.to}
        backup={schemaMismatch.backup}
        sentinelPath={schemaMismatch.sentinel_path}
      />
    );
  }

  if (schemaMismatch !== null && placeholderInfo !== null) {
    return (
      <AppShell
        info={placeholderInfo}
        currentUser={null}
        identityUnknown
      >
        <Outlet />
      </AppShell>
    );
  }

  // **One decision, made once.**
  //
  // This file was fixed four times for four flavours of the same
  // mistake, because each branch decided independently what a failure
  // meant, and they disagreed. The fourth: pressing "Try now" on the
  // unreachable banner told a user with a perfectly good tracker that
  // they had none — `info.data` is undefined during any attempt on a
  // data-less query, and a branch reading it took that for absence.
  //
  // The rule underneath all four: **a boot read that fails degrades
  // inside the shell — it never replaces it.** The only state that may
  // replace the shell is the one where there is no shell to draw: a
  // directory with no tracker in it. (A crashed migration is handled
  // above, for the same reason — nothing there is safe to browse.)
  //
  // `everKnownInfo` is what makes this hold under a refetch: the last
  // value we actually read, rather than the one currently in flight.
  if (info.data !== undefined) everKnownInfo.current = info.data;
  const known = info.data ?? everKnownInfo.current;

  // "No tracker here" is a claim about the directory, and may only be
  // made when the server told us so. A read that failed is the shell's
  // job to explain — saying this instead tells a user their data is
  // gone when it is on disk a metre away.
  // The *only* condition that earns this screen: the server answered,
  // and said there is nothing here.
  //
  // A second guard for "no data and no error" was tried and removed —
  // that is precisely the state a refetch passes through, so it put
  // "No tracker here yet" in front of a user whose tracker was fine.
  // If we have never read anything and nothing errored, we are still
  // waiting, and the gate above owns that.
  // ONB-1, ONB-15, ONB-29: an uninitialized directory lands on
  // `/init`, *whatever path was requested* — `/`, `/list`, `/board`,
  // `/tasks/T-1`, `/settings/general`. Deciding it here rather than
  // per-route is what makes that true for every path at once; leaving
  // each route to notice would have them rendering their own empty
  // states, which is the "reads as data loss" blocker itself.
  //
  // A real redirect rather than rendering the wizard in place: ONB-1
  // asks for the address bar to say `/init`, and ONB-27 asks what
  // happens when `/init` is "re-entered by URL", which presumes it is
  // somewhere the user can actually be.
  //
  // `initState`, not `exists`: an empty `.loctt/` is present on disk
  // but is not a tracker, and ONB-16 requires it get this screen with
  // copy that accounts for the folder already being there.
  const uninitialized =
    known !== undefined && (known.initState === "absent" || known.initState === "empty");
  if (uninitialized) {
    // The wizard replaces the shell: there is no sidebar to populate,
    // and a sidebar with zero counts is exactly the reading ONB-1 and
    // ONB-29 forbid.
    return <InitRedirect info={known} />;
  }

  // Everything else renders the shell. Only the props differ.
  const user = currentUser.data ?? null;
  return (
    <>
      {/*
        ONB-27 / ONB-35: `/init` on a working tracker is not a place to
        stay. Reaching it by Back or by typing the URL sends the user
        to the list rather than offering to initialize a second tracker
        over the first — and because this sits in the ready branch, no
        code path can render the wizard here at all.
      */}
      <RedirectFromInit />
      <AppShell
        info={known ?? unknownInfo}
        currentUser={user}
        identityUnknown={user === null}
      >
        <Outlet />
      </AppShell>
    </>
  );
}

/**
 * Sends `/init` to `/list` on a tracker that is already initialized.
 *
 * A component rather than a bare effect in the parent, so it can sit
 * inside the ready branch's JSX without adding a hook that the
 * earlier `return`s would skip — the rules of hooks are why every
 * other conditional in this file is a branch on already-computed
 * state.
 */
function RedirectFromInit() {
  const navigate = useNavigate();
  const pathname = typeof window === "undefined" ? "" : window.location.pathname;
  useEffect(() => {
    if (pathname === "/init") void navigate({ to: "/list", replace: true });
  }, [pathname, navigate]);
  return null;
}

/**
 * Puts the address bar on `/init` and renders the wizard there.
 *
 * The navigation is a side effect rather than a `throw redirect` in a
 * route loader, because this decision is made above the router's
 * outlet — the shell gate runs for every path, and the whole point is
 * that no individual route has to know. Rendering the wizard while the
 * navigation settles avoids a frame of blank page on the way.
 */
function InitRedirect({ info }: { info: TrackerInfoResponse }) {
  const navigate = useNavigate();
  const pathname = typeof window === "undefined" ? "/init" : window.location.pathname;
  useEffect(() => {
    // `replace`, so Back does not walk the user through every route
    // they were bounced off.
    if (pathname !== "/init") void navigate({ to: "/init", replace: true });
  }, [pathname, navigate]);
  return <InitWizard info={info} />;
}

/**
 * Reads a schema mismatch out of a failed `/api/info`.
 *
 * The guard's 409 carries the tracker's schema status directly, so the
 * kind is read rather than inferred. An earlier cut recovered it by
 * matching the error's prose, which makes a copy edit a behaviour
 * change and quietly collapses the four states P4 requires be kept
 * apart.
 */
function schemaStatusFromError(err: unknown): SchemaStatusResponse | null {
  if (!(err instanceof ApiError)) return null;
  if (err.envelope?.code !== "schema_mismatch") return null;
  // A guard that refused without saying which state it is in leaves
  // the surface genuinely unable to say — which is `unknown`, and the
  // one kind whose copy admits that (SHL-38).
  return err.envelope.schema_status ?? { kind: "unknown", message: err.message };
}

/**
 * `TrackerInfoResponse` for a tracker we could not read.
 *
 * Everything is zero or empty because nothing is known — the footer
 * shows no count rather than a wrong one. `schemaStatus` claims
 * `current` because a schema we could not read is not a schema
 * *mismatch*, and saying otherwise would raise the wrong banner;
 * `ServerUnreachableBanner` is what speaks in this state.
 */
function UNKNOWN_INFO(): TrackerInfoResponse {
  return {
    exists: true,
    // "ready", for the same reason `schemaStatus` claims `current`: a
    // tracker we could not read is not a tracker we know to be
    // missing, and offering to initialize one that may well exist is
    // the mistake ONB-32 rules out.
    initState: "ready",
    defaultUserName: "you",
    taskCount: 0,
    keyPrefix: null,
    nextKey: null,
    schemaStatus: { kind: "current", version: 0 },
    cwd: "",
    today: new Date().toISOString().slice(0, 10),
    // Nothing is known here, so the zone matches the server's own
    // fallback rather than the viewer's browser zone.
    timezone: "UTC",
  };
}

/**
 * Enough `TrackerInfoResponse` for the shell to render while the real
 * one is unavailable.
 *
 * Deliberately not invented data: the counts are zero and the labels
 * empty, because nothing is known. What matters is that the schema
 * status is real, since that is the whole reason this shell renders.
 */
function PLACEHOLDER_INFO(schemaStatus: SchemaStatusResponse): TrackerInfoResponse {
  return {
    exists: true,
    // "ready", for the same reason `schemaStatus` claims `current`: a
    // tracker we could not read is not a tracker we know to be
    // missing, and offering to initialize one that may well exist is
    // the mistake ONB-32 rules out.
    initState: "ready",
    defaultUserName: "you",
    taskCount: 0,
    keyPrefix: null,
    nextKey: null,
    schemaStatus,
    cwd: "",
    today: new Date().toISOString().slice(0, 10),
    // Nothing is known here, so the zone matches the server's own
    // fallback rather than the viewer's browser zone.
    timezone: "UTC",
  };
}
