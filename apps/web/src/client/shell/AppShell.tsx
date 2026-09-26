import type { TrackerInfoResponse, UserProfile } from "@loctt/contracts";
import { Outlet } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

import { useUserSettings } from "../api/hooks/useWorkflow.ts";
import { CreateTaskProvider } from "../create/CreateTaskProvider.tsx";
import { useScrollToHash } from "../router/useScrollToHash.ts";
import { adoptStoredTheme } from "../theme/useTheme.ts";
import { AnnouncerProvider } from "../ui/Announcer.tsx";
import { CHROME_ATTR } from "../ui/Modal.tsx";
import { ToastProvider } from "../ui/Toast.tsx";
import { AdvisoryFsBanner } from "./AdvisoryFsBanner.tsx";
import { Header } from "./Header.tsx";
import { SchemaBanner } from "./SchemaBanner.tsx";
import { ServerUnreachableBanner } from "./ServerUnreachableBanner.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { MAIN_CONTENT_ID,SkipLink } from "./SkipLink.tsx";
import { useGlobalShortcuts } from "./useGlobalShortcuts.tsx";
import { useMainScrollRestoration } from "./useMainScrollRestoration.ts";
import { useRouteAnnouncement } from "./useRouteAnnouncement.ts";
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

  // K76: honour a deep-link hash (`#comment-<id>`, `#field-<key>`, …) by
  // scrolling its target into view and highlighting it. Once, at the
  // shell, so every routed page inherits it through the Outlet.
  useScrollToHash();

  return (
    // The create modal, the toast region and the announcer are
    // app-level, not per-view: `n` opens the modal from any route
    // (NEW-4), the success toast has to outlive the modal that raised
    // it and the navigation its "Open" link performs (NEW-12), and the
    // live regions must survive the route change they announce
    // (A11Y-45). Mounted inside the router so `useNavigate` resolves,
    // and inside the query provider so the form's config reads share
    // the app's cache.
    <AnnouncerProvider>
    <ToastProvider>
    <CreateTaskProvider>
      <ShellChrome
        info={info}
        currentUser={currentUser}
        identityUnknown={identityUnknown}
        collapsed={collapsed}
        toggle={toggle}
        canToggle={canToggle}
      >
        {children}
      </ShellChrome>
    </CreateTaskProvider>
    </ToastProvider>
    </AnnouncerProvider>
  );
}

/**
 * The chrome itself, mounted inside the providers.
 *
 * Split out because the global shortcuts need `useCreateTask` (for
 * `n`) and `useAnnouncer` (for `t`), and a hook cannot read a context
 * its own component provides. The alternative — threading an imperative
 * handle out of the providers — buys nothing and hides the dependency.
 */
function ShellChrome({
  info,
  currentUser,
  identityUnknown,
  collapsed,
  toggle,
  canToggle,
  children,
}: {
  readonly info: TrackerInfoResponse;
  readonly currentUser: UserProfile | null;
  readonly identityUnknown: boolean;
  readonly collapsed: boolean;
  readonly toggle: () => void;
  readonly canToggle: boolean;
  readonly children?: ReactNode;
}) {
  const mainRef = useMainScrollRestoration();
  const today = info.today;
  useRouteAnnouncement();

  const { helpDialog, openHelp } = useGlobalShortcuts({
    // A11Y-2: `/` focuses the search box and scrolls it into view. The
    // box lives in the header, so the shell finds it by its accessible
    // name rather than threading a ref through Header's props — the
    // same name the case's screen-reader user would hear.
    onFocusSearch: () => {
      const box = document.querySelector<HTMLInputElement>('input[type="search"]');
      if (box === null) return;
      box.focus();
      box.scrollIntoView({ block: "nearest" });
    },
    onToggleSidebar: toggle,
  });

  return (
    <>
    {/* First in the DOM so it is the first tab stop (A11Y-44). Outside
        the chrome element so a modal marking the chrome inert does not
        also swallow it. */}
    <SkipLink />
    <div className="flex h-screen flex-col" {...{ [CHROME_ATTR]: "" }}>
      {/* SHL-41: an unreachable server is app-level, not per-view. A
          user watching a cached board while the server dies sees
          nothing from a view-scoped error. */}
      <ServerUnreachableBanner />
      <SchemaBanner status={info.schemaStatus} />
      {/* XS-50: a boot-time advisory when the tracker sits on a filesystem
          where advisory locks are unsafe. App-level and independent of git
          sync, because the hazard is the filesystem's, not git's. */}
      {info.fstypeAdvisory !== undefined && (
        <AdvisoryFsBanner advisory={info.fstypeAdvisory} cwd={info.cwd} />
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr] grid-rows-[48px_1fr]">
        <Header
          currentUser={currentUser}
          identityUnknown={identityUnknown}
          onToggleSidebar={toggle}
          canToggleSidebar={canToggle}
          sidebarCollapsed={collapsed}
          onOpenShortcutHelp={openHelp}
          {...(info.schemaStatus.kind !== "current"
            ? {
                createBlocked:
                  "This tracker's schema does not match this LocTT. "
                  + "Creating a task would be refused. See the banner above.",
              }
            : {})}
        />
        <Sidebar
          collapsed={collapsed}
          currentUserId={currentUser?.id ?? null}
          today={today}
        />
        {/* The scrolling element is this pane, not the window — the
            shell is a fixed grid. The router restores the offset of
            elements carrying this attribute (SHL-25, SHL-26). */}
        {/* `tabIndex={-1}` makes the pane programmatically focusable
            without adding a tab stop, which is what lets the skip link
            (A11Y-44) and the route announcement (A11Y-45) land focus
            here. `<main>` is also the landmark a screen reader jumps
            to directly. */}
        <main
          ref={mainRef}
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          data-scroll-restoration-id="main"
          // UI-18: `Sidebar` renders `null` on a narrow viewport (R2,
          // < 900px — no in-grid rail, the drawer is an overlay outside
          // this grid). With no sidebar element to auto-place into
          // column 1 first, an implicit `<main>` (grid-column: auto)
          // fell into that now-empty `auto` track itself instead of the
          // `1fr` content column — sized to its own content rather than
          // the remaining width, leaving a bare `1fr` gap on the right.
          // Reproduced at a settled 800x900 load: `<main>` measured
          // 494.89px of 800px, gridTemplateColumns resolving to
          // "494.891px 305.109px". `col-start-2` makes the placement
          // explicit (matching `Header`'s explicit `col-span-2`, rather
          // than relying on auto-placement order), so `<main>` always
          // gets the `1fr` content column whether or not the sidebar
          // is in the DOM. Verified: 1440px unaffected (main still
          // 1200px, sidebar still 240px); 800px now fills to 800px with
          // no gap.
          className="col-start-2 row-start-2 overflow-auto bg-bg-canvas outline-none"
        >
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
    {helpDialog}
    </>
  );
}
