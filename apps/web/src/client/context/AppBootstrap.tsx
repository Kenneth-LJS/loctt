import type { SchemaStatusResponse, UserProfile } from "@loctt/contracts";
import { createContext, type ReactNode, useContext } from "react";

import { ApiError } from "../api/client.ts";
import { useCurrentUser } from "../api/hooks/useCurrentUser.ts";
import { useInfo } from "../api/hooks/useInfo.ts";

/**
 * App-level context exposing bootstrap data that's needed everywhere:
 * the current user (may be null on a brand-new tracker), the tracker's
 * schema status (drives the read-only mode flag below), and a
 * derived `readOnly` boolean. Components that need to disable write
 * actions during a stale-schema state subscribe to `readOnly` rather
 * than re-checking the status shape.
 */
export interface AppContextValue {
  readonly currentUser: UserProfile | null;
  readonly schemaStatus: SchemaStatusResponse;
  readonly readOnly: boolean;
}

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Reads the AppContext. Throws if used outside the provider — that
 * would only happen during an accidental misuse, not a runtime
 * condition users hit.
 */
export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext used outside <AppBootstrap>");
  return ctx;
}

interface AppBootstrapProps {
  children: ReactNode;
}

/**
 * Bootstrap gate that loads schema status + current user before
 * children render. Three terminal states:
 *
 *   1. Loading — full-screen spinner.
 *   2. Hard error — both queries failed and not in the "no users"
 *      404 case. Renders an error page with a retry hint.
 *   3. Ready — provides AppContextValue to children.
 *
 * The current user being null (404 from the API) is *not* an error
 * here — that's the init-wizard state and should pass through to the
 * router, which will redirect to /init.
 */
export function AppBootstrap({ children }: AppBootstrapProps) {
  const info = useInfo();
  const user = useCurrentUser();

  // Treat a 404 on /user/current as "no users yet" — not an error.
  const userIs404 = user.error instanceof ApiError && user.error.status === 404;
  const userReady = user.isSuccess || userIs404;
  const fatalUserError = user.error && !userIs404;

  if (info.isLoading || (user.isLoading && !user.error)) {
    return <BootstrapLoading />;
  }
  if (info.error || fatalUserError) {
    const err = info.error ?? user.error;
    return <BootstrapError message={err?.message ?? "Bootstrap failed."} />;
  }
  // After the gates above, both queries have terminated: info has
  // data (no info.error path is left) and user is either success or
  // a 404. value is therefore always built.
  if (!info.data || !userReady) return <BootstrapLoading />;
  const value: AppContextValue = {
    currentUser: user.data ?? null,
    schemaStatus: info.data.schemaStatus,
    readOnly: info.data.schemaStatus.kind === "outdated"
      || info.data.schemaStatus.kind === "future"
      || info.data.schemaStatus.kind === "unknown",
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function BootstrapLoading() {
  return (
    <main className="min-h-screen bg-bg-canvas text-text-primary flex items-center justify-center">
      <div className="flex items-center gap-3 text-text-tertiary">
        <span className="inline-block w-4 h-4 rounded-full border-2 border-border-default border-t-accent animate-spin" />
        <span className="text-sm">Loading LocTT…</span>
      </div>
    </main>
  );
}

function BootstrapError({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-bg-canvas text-text-primary flex items-center justify-center p-8">
      <div className="rounded-md border border-border-subtle bg-bg-surface shadow-raised p-8 max-w-md flex flex-col gap-3">
        <h1 className="text-xl font-semibold text-danger-fg">Couldn't reach the LocTT API</h1>
        <p className="text-text-secondary text-sm">{message}</p>
        <p className="text-text-tertiary text-xs">
          Confirm the LocTT API is running (default port 7700) and reload.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="self-start mt-2 px-3 py-1.5 text-sm font-medium rounded-md bg-accent text-accent-contrast hover:bg-accent-hover"
        >
          Reload
        </button>
      </div>
    </main>
  );
}
