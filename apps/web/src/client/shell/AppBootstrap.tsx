import { Outlet } from "@tanstack/react-router";

import { useCurrentUser } from "../api/hooks/useCurrentUser.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { AppShell } from "./AppShell.tsx";

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

  if (info.isError) {
    return (
      <FatalError
        message={info.error?.message ?? "Failed to load tracker info."}
        onRetry={() => void info.refetch()}
      />
    );
  }

  // currentUser maps "no users yet" to data === null (not an error);
  // any *error* here is a real failure worth surfacing.
  if (currentUser.isError) {
    return (
      <FatalError
        message={currentUser.error?.message ?? "Failed to load the current user."}
        onRetry={() => void currentUser.refetch()}
      />
    );
  }

  const trackerInfo = info.data;
  const user = currentUser.data;
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
