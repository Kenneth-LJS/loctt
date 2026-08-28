import type { SchemaStatusResponse, TrackerInfoResponse } from "@loctt/contracts";
import { Outlet } from "@tanstack/react-router";
import { useMemo } from "react";

import { ApiError } from "../api/client.ts";
import { useCurrentUser } from "../api/hooks/useCurrentUser.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
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
 *  - uninitialized / no user → a placeholder pointing at the CLI. The
 *    in-app init wizard lands in M4; until then `loctt init` is the
 *    path, and this state is informational rather than a dead end.
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
  const stillWaiting = (q: { isPending: boolean; isError: boolean }): boolean =>
    q.isPending && !q.isError;

  // `||`, unchanged: either read still genuinely pending means the
  // shell has nothing to render from. Only the *definition* of
  // "still pending" changed.
  if (stillWaiting(info) || stillWaiting(currentUser)) {
    return <CenteredMessage>Loading…</CenteredMessage>;
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

  const trackerInfo = info.data;
  const user = currentUser.data;

  // currentUser maps "no users yet" to data === null (not an error);
  // any *error* here is a real failure — but not a fatal one.
  //
  // SHL-40: this used to blank the app. Not knowing *who* you are does
  // not stop you reading tasks or reaching Settings, which is where the
  // user list is fixed; it stops attributed writes, and those are
  // blocked individually with the reason named. A full-page error here
  // both overstated the failure and removed the route to its own fix.
  const identityUnknown = currentUser.isError;

  // **The rule, stated once.** A boot read that fails degrades
  // *inside* the shell — it never replaces it.
  //
  // This file has been fixed three times for the same mistake, in
  // three different branches, because each decided independently
  // whether its failure was fatal and the fatal answer was the
  // default. SHL-40 fixed the current-user branch; the schema branch
  // was fixed separately; and the M1 gate then found that a plain
  // failed `/api/info` still destroyed the entire app — shell,
  // sidebar and nav gone, with no `[role=alert]` anywhere — reached
  // by nothing more exotic than killing the server and clicking a nav
  // link (SHL-41, ERR-1).
  //
  // So the fatal branch is gone rather than patched. What is left:
  // if the tracker exists, render the shell.
  // `ServerUnreachableBanner` inside it states an unreachable server,
  // each view states its own failure, and neither can be reached from
  // a page that replaced them both.
  if (trackerInfo?.exists === true && identityUnknown) {
    return (
      <AppShell info={trackerInfo} currentUser={null} identityUnknown>
        <Outlet />
      </AppShell>
    );
  }

  // Info failed. The one thing that costs is `info.data`, so the
  // shell renders from a placeholder that reports nothing it does not
  // know — rather than from a page that reports nothing at all.
  if (info.isError) {
    return (
      <AppShell
        info={trackerInfo ?? unknownInfo}
        currentUser={user ?? null}
        identityUnknown={user === null || user === undefined}
      >
        <Outlet />
      </AppShell>
    );
  }

  if (!trackerInfo || !trackerInfo.exists || !user) {
    return (
      <CenteredMessage>
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-lg font-semibold text-text-primary">
            No tracker here yet
          </h1>
          <p className="text-[13px] text-text-secondary">
            Run <code className="rounded bg-bg-muted px-1 py-0.5 font-mono">loctt init</code> in
            this directory to create one. The in-app setup wizard arrives in a later
            release.
          </p>
        </div>
      </CenteredMessage>
    );
  }

  return (
    <AppShell info={trackerInfo} currentUser={user}>
      <Outlet />
    </AppShell>
  );
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
    taskCount: 0,
    keyPrefix: null,
    nextKey: null,
    schemaStatus: { kind: "current", version: 0 },
    cwd: "",
    today: new Date().toISOString().slice(0, 10),
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
    taskCount: 0,
    keyPrefix: null,
    nextKey: null,
    schemaStatus,
    cwd: "",
    today: new Date().toISOString().slice(0, 10),
  };
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-screen place-items-center bg-bg-canvas text-[13px] text-text-secondary">
      {children}
    </div>
  );
}
