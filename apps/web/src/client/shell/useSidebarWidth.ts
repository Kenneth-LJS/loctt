import { useCallback, useState } from "react";

import { readLocal, writeLocal } from "./storage.ts";

/**
 * The expanded, in-grid sidebar's width in pixels, persisted so a
 * resize survives a reload.
 *
 * The width is *only* meaningful for the expanded, non-overlay,
 * desktop column: the collapsed rail keeps its fixed `w-14`, and the
 * mobile overlay drawer keeps its own `w-60 max-w-[85vw]` (it floats
 * over the content, so making it resizable would let the user cover the
 * whole screen with no in-grid track to push against). `Sidebar` gates
 * the drag handle and the inline width on that state; this hook just
 * owns the number.
 *
 * Storage discipline mirrors `useSidebarCollapse` / `storage.ts`
 * (SHL-18): every `localStorage` access is wrapped, an unreadable or
 * unparseable value falls back to the default, and a write that throws
 * is dropped. An out-of-range persisted value — a window that shrank,
 * or garbage in the store — is clamped on read, never rendered as-is.
 */

/** localStorage key for the persisted expanded width. */
export const SIDEBAR_WIDTH_KEY = "loctt.sidebarWidth";

/**
 * Default width, in px. Matches today's `w-60` (15rem = 240px) so a
 * user who has never resized, or whose stored value is unusable, sees
 * exactly the current layout.
 */
export const DEFAULT_SIDEBAR_WIDTH = 240;

/**
 * Minimum width, in px. Below this the nav labels start to truncate to
 * nothing; the collapsed rail (`w-14`) is the way to go narrower, not a
 * squeezed expanded column.
 */
export const MIN_SIDEBAR_WIDTH = 180;

/**
 * Maximum width, in px. Keeps the sidebar from eating the main pane on
 * a normal laptop screen.
 */
export const MAX_SIDEBAR_WIDTH = 480;

/** Keyboard nudge step for the resize separator (Left/Right arrows). */
export const SIDEBAR_WIDTH_STEP = 16;

/** Clamp any candidate width into the allowed range. */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SIDEBAR_WIDTH;
  if (px < MIN_SIDEBAR_WIDTH) return MIN_SIDEBAR_WIDTH;
  if (px > MAX_SIDEBAR_WIDTH) return MAX_SIDEBAR_WIDTH;
  return Math.round(px);
}

/**
 * Read the persisted width, clamped. Any value that is absent, not a
 * number, or out of range yields the default — the store never dictates
 * an unusable layout.
 */
function readStoredWidth(): number {
  const raw = readLocal(SIDEBAR_WIDTH_KEY);
  if (raw === null) return DEFAULT_SIDEBAR_WIDTH;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_SIDEBAR_WIDTH;
  return clampSidebarWidth(parsed);
}

export function useSidebarWidth(): {
  /** Current width in px, always within [MIN, MAX]. */
  width: number;
  /**
   * Set the width (clamped) and persist it. Safe to call on every
   * pointer move during a drag — the write is guarded and cheap, and
   * persisting continuously means an interrupted drag (tab closed
   * mid-gesture) still keeps the last position.
   */
  setWidth: (px: number) => void;
} {
  const [width, setWidthState] = useState<number>(readStoredWidth);

  const setWidth = useCallback((px: number) => {
    const next = clampSidebarWidth(px);
    setWidthState(prev => (prev === next ? prev : next));
    writeLocal(SIDEBAR_WIDTH_KEY, String(next));
  }, []);

  return { width, setWidth };
}
