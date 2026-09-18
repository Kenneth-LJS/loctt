import { useCallback, useEffect, useState } from "react";

import { readLocal, writeLocal } from "./storage.ts";

/**
 * Broadcast a request to dismiss the sidebar (R2).
 *
 * The hook lives above the router in `AppShell`, but the two dismiss
 * triggers — a route change and a tap on the overlay backdrop — are
 * observed inside the router, in `Sidebar`. Rather than thread a
 * collapse callback back up through `AppShell` (a file this lane does
 * not own), `Sidebar` calls this and the single hook instance listens.
 * A window event is the app's existing cross-tree signal (see the
 * theme repaint and the shortcut registry); no new prop, no new
 * context.
 *
 * It is a no-op on a wide viewport — there is no overlay to dismiss —
 * so a route change on desktop never touches the persisted preference.
 */
const COLLAPSE_EVENT = "loctt:sidebar-collapse";

export function requestSidebarCollapse(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COLLAPSE_EVENT));
}

/**
 * Collapsed/expanded state for the app sidebar, persisted to
 * localStorage under `tt-sidebar-collapsed` ("1" / "0") to match the
 * mockup's key so the preference carries over from the static mockups.
 *
 * The `[` keyboard shortcut toggles it (also per the mockup). The
 * listener is installed once and ignores keystrokes while a text input
 * or textarea is focused, so typing `[` in the search box or a future
 * editor doesn't fold the sidebar.
 *
 * **Below `NARROW_PX` the sidebar defaults to collapsed but can be
 * opened as an overlay (R2).** At 532px the expanded sidebar took 240px
 * and left the table 165px of a 760px layout — the content the user
 * came for was the smallest thing on screen, so mobile starts collapsed
 * to a rail. But the rail used to be *permanent*: `canToggle` was
 * `false` below the breakpoint, so a 380px phone showed unlabelled
 * icons with no way to read them or reclaim the space. R2 re-enables the
 * toggle on mobile; the expanded state at a narrow width is a temporary
 * overlay `Sidebar` dismisses on a tap-away or a navigation
 * (`requestSidebarCollapse`), rather than a persisted preference. The
 * wide-viewport preference is kept untouched, so returning to a wide
 * window restores whatever the user last chose there.
 *
 * No acceptance case specifies a breakpoint. 900px is chosen as the
 * width below which a 240px sidebar costs more than it gives, and is
 * recorded as a proposed case rather than treated as settled.
 */

/** Below this viewport width the sidebar is always collapsed. */
const NARROW_PX = 900;

const STORAGE_KEY = "tt-sidebar-collapsed";

function readStored(): boolean {
  // Any value that is not exactly "1" — corrupt, absent, or an
  // unreadable store — means expanded (SHL-17, SHL-18).
  return readLocal(STORAGE_KEY) === "1";
}

function isNarrow(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < NARROW_PX;
}

export function useSidebarCollapse(): {
  collapsed: boolean;
  toggle: () => void;
  /**
   * Whether the sidebar can be toggled. Now always `true`: R2 re-enables
   * the toggle on mobile so the rail can be opened (into an overlay) and
   * dismissed, rather than being a permanent unlabelled icon strip. Kept
   * in the return so the Header's toggle keeps its existing prop shape.
   */
  canToggle: boolean;
  /**
   * True below the breakpoint. `Sidebar` renders the expanded state as a
   * dismissible overlay here (backdrop + tap-away + navigate-to-close),
   * instead of the in-grid column it is on a wide viewport.
   */
  narrow: boolean;
} {
  // The wide-viewport preference, persisted (SHL-12).
  const [stored, setStored] = useState<boolean>(readStored);
  // The mobile overlay's open state — session-only, never persisted, so
  // opening the rail on a phone does not overwrite the desktop choice.
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [narrow, setNarrow] = useState<boolean>(isNarrow);
  // On a narrow viewport the sidebar is collapsed unless the user opened
  // the overlay; on a wide one the persisted preference governs.
  const collapsed = narrow ? !mobileOpen : stored;

  const toggle = useCallback(() => {
    if (isNarrow()) {
      // Mobile: flip the transient overlay, leave the stored preference
      // alone so a later wide window restores the user's real choice.
      setMobileOpen(prev => !prev);
      return;
    }
    setStored(prev => {
      const next = !prev;
      writeLocal(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    const onResize = (): void => {
      const nowNarrow = isNarrow();
      setNarrow(nowNarrow);
      // Growing back to a wide window closes the transient overlay so it
      // cannot linger as a floating panel over a desktop layout.
      if (!nowNarrow) setMobileOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // R2 dismiss: a tap-away on the overlay backdrop or a navigation (both
  // observed in `Sidebar`, below the router) closes the mobile overlay.
  // Only the transient state is touched — never the persisted preference.
  useEffect(() => {
    const onCollapse = (): void => { setMobileOpen(false); };
    window.addEventListener(COLLAPSE_EVENT, onCollapse);
    return () => window.removeEventListener(COLLAPSE_EVENT, onCollapse);
  }, []);

  // `[` is bound by the global shortcut registry (`shortcuts.ts`),
  // not here. It used to be a local listener with only the typing
  // guard, which meant `[` collapsed the sidebar underneath an open
  // create modal — A11Y-8 requires a modal to own the keyboard. The
  // registry applies the typing guard, the dialog guard and the
  // modifier guard uniformly, and is the same table the `?` reference
  // renders from (A11Y-4).
  return { collapsed, toggle, canToggle: true, narrow };
}
