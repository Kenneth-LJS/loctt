import type { TrackerInfoResponse, UserProfile } from "@loctt/contracts";
import { Outlet } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import { useUserSettings } from "../api/hooks/useWorkflow.ts";
import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { adoptStoredTheme } from "../theme/useTheme.ts";
import { ToastProvider } from "../ui/Toast.tsx";
import { Header } from "./Header.tsx";
import { SchemaBanner } from "./SchemaBanner.tsx";
import { ServerUnreachableBanner } from "./ServerUnreachableBanner.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { useMainScrollRestoration } from "./useMainScrollRestoration.ts";
import { useSidebarCollapse } from "./useSidebarCollapse.ts";

/**
 * The two-column app chrome: a full-width header row over a
 * [sidebar | main] row. The schema banner, when shown, sits above the
 * grid so it spans the full width and pushes the chrome down rather
 * than overlapping it.
 *
 * Routed page content renders through `<Outlet />` in the main pane.
 * `today` comes from the server in the workspace timezone and is
 * threaded into the sidebar so the date-relative built-in filters
 * ("Due this week", "Overdue") and their counts share a single stable
 * value for the render. Deriving it from the browser clock instead
 * would answer in the viewer's local zone, so the same filter could
 * disagree with the CLI or with a colleague in another timezone.
 */
export function AppShell({
  info,
  currentUser,
  identityUnknown = false,
  children,
}: {
  readonly info: TrackerInfoResponse;
  /**
   * Null when the current-user read failed. Carried as null rather
   * than a stand-in profile so nothing downstream can render a name or
   * an id that implies a real identity (SHL-40).
   */
  readonly currentUser: UserProfile | null;
  /** True when the identity is unknown because the read failed. */
  readonly identityUnknown?: boolean;
  readonly children?: ReactNode;
}) {
  const { collapsed, toggle, canToggle } = useSidebarCollapse();
  // SET-11: the theme is per *user*, so the acting user's stored
  // choice wins over whatever this browser last cached. Seeded here
  // rather than in the picker — the repaint must happen on every load
  // and after a user switch, not only when settings is open.
  const settingsQuery = useUserSettings();
  // `?.` on `settings` too, not only on `data`. The response type says
  // `settings` is always present, but a server that answered without
  // it — or any stub that does — would throw *inside the shell's own
  // render*, taking the whole app down over a theme preference. The
  // shell must survive its own optional reads (SHL-13's family).
  const storedTheme = settingsQuery.data?.settings?.theme;
  useEffect(() => {
    if (storedTheme !== undefined) adoptStoredTheme(storedTheme);
  }, [storedTheme]);
  const mainRef = useMainScrollRestoration();
  const today = info.today;

  return (
    // The create modal and the toast region are app-level, not
    // per-view: `n` opens the modal from any route (NEW-4), and the
    // success toast has to outlive the modal that raised it and the
    // navigation its "Open" link performs (NEW-12). Mounted inside the
    // router so `useNavigate` resolves, and inside the query provider
    // so the form's config reads share the app's cache.
    <ToastProvider>
    <CreateTaskProvider>
    <div className="flex h-screen flex-col">
      {/* SHL-41: an unreachable server is app-level, not per-view. A
          user watching a cached board while the server dies sees
          nothing from a view-scoped error. */}
      <ServerUnreachableBanner />
      <SchemaBanner status={info.schemaStatus} />
      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[48px_1fr]">
        <Header
          currentUser={currentUser}
          identityUnknown={identityUnknown}
          onToggleSidebar={toggle}
          canToggleSidebar={canToggle}
          {...(info.schemaStatus.kind !== "current"
            ? {
                createBlocked:
                  "This tracker's schema does not match this LocTT — "
                  + "creating a task would be refused. See the banner above.",
              }
            : {})}
        />
        <Sidebar
          collapsed={collapsed}
          info={info}
          currentUserId={currentUser?.id ?? null}
          today={today}
        />
        {/* The scrolling element is this pane, not the window — the
            shell is a fixed grid. The router restores the offset of
            elements carrying this attribute (SHL-25, SHL-26). */}
        <main
          ref={mainRef}
          data-scroll-restoration-id="main"
          className="row-start-2 overflow-auto bg-bg-canvas"
        >
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
    </CreateTaskProvider>
    </ToastProvider>
  );
}
