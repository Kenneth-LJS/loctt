import type { TrackerInfoResponse, UserProfile } from "@loctt/contracts";
import { Outlet } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Header } from "./Header.tsx";
import { SchemaBanner } from "./SchemaBanner.tsx";
import { Sidebar } from "./Sidebar.tsx";
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
  children,
}: {
  readonly info: TrackerInfoResponse;
  readonly currentUser: UserProfile;
  readonly children?: ReactNode;
}) {
  const { collapsed, toggle, canToggle } = useSidebarCollapse();
  const today = info.today;

  return (
    <div className="flex h-screen flex-col">
      <SchemaBanner status={info.schemaStatus} />
      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[48px_1fr]">
        <Header currentUser={currentUser} onToggleSidebar={toggle} canToggleSidebar={canToggle} />
        <Sidebar
          collapsed={collapsed}
          info={info}
          currentUserId={currentUser.id}
          today={today}
        />
        <main className="row-start-2 overflow-auto bg-bg-canvas">
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
  );
}
