import type { SchemaStatusResponse, TrackerInfoResponse } from "@loctt/contracts";
import { Outlet } from "@tanstack/react-router";

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

  if (info.isLoading || currentUser.isLoading) {
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
  const schemaMismatch = schemaStatusFromError(info.error);

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

  if (schemaMismatch !== null) {
    return (
      <AppShell
        info={PLACEHOLDER_INFO(schemaMismatch)}
        currentUser={null}
        identityUnknown
      >
        <Outlet />
      </AppShell>
    );
  }

  if (info.isError) {
    return (
      <FatalError
        message={info.error?.message ?? "Failed to load tracker info."}
        onRetry={() => void info.refetch()}
      />
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

  if (trackerInfo?.exists === true && identityUnknown) {
    return (
      <AppShell info={trackerInfo} currentUser={null} identityUnknown>
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

function FatalError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <CenteredMessage>
      <div className="max-w-md text-center">
        <h1 className="mb-2 text-lg font-semibold text-danger-fg">Something went wrong</h1>
        <p className="mb-4 text-[13px] text-text-secondary">{message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-contrast hover:bg-accent-hover"
        >
          Retry
        </button>
      </div>
    </CenteredMessage>
  );
}
