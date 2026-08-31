import { useCallback, useEffect, useState } from "react";

import { readLocal, writeLocal } from "./storage.ts";
import { isTypingTarget } from "./typingTarget.ts";

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
 * **Below `NARROW_PX` the sidebar collapses regardless of the stored
 * preference.** At 532px the expanded sidebar took 240px and left the
 * table 165px of a 760px layout — the content the user came for was
 * the smallest thing on screen. The preference is not overwritten: it
 * is what the sidebar returns to when there is room again, so a
 * rotation or a window resize does not silently discard a choice.
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
   * False below the breakpoint, where the sidebar cannot expand. The
   * toggle stays mounted so the layout does not shift, but a control
   * that silently does nothing is worse than a disabled one — and the
   * click was previously stored and surfaced later at a wide width,
   * which reads as the app changing state on its own.
   */
  canToggle: boolean;
} {
  const [stored, setCollapsed] = useState<boolean>(readStored);
  const [narrow, setNarrow] = useState<boolean>(isNarrow);
  const collapsed = stored || narrow;

  const toggle = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev;
      writeLocal(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  useEffect(() => {
    const onResize = (): void => { setNarrow(isNarrow()); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return { collapsed, toggle, canToggle: !narrow };
}
