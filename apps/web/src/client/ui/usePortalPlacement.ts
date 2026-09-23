import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * The measured, viewport-clamped placement shared by every floating panel
 * in the app (`ui/Menu` and `ui/Dropdown`).
 *
 * ## Why the panel is portalled and measured (MENU-PORTAL)
 *
 * A panel positioned with CSS anchor classes on an inline `absolute`
 * child had two defects:
 *   1. It was clipped by any ancestor with `overflow` — the sidebar's
 *      scroll container (`overflow-y-auto`) sliced the saved-filter row
 *      kebab menu, so "Edit", "Pin to top", "Delete" were unreadable.
 *   2. A CSS-only anchor cannot flip or clamp to the viewport, so an
 *      `align="end"` panel next to a kebab near the sidebar's right edge
 *      ran off the *left* of the viewport.
 *
 * The fix is `createPortal` into `document.body` (no ancestor can clip
 * what is not a descendant) plus `position: fixed` coordinates measured
 * after first paint, which is the only way to know the real panel size
 * and clamp it inside the viewport. Callers render the panel off-screen
 * for one frame (`hiddenStyle` below) so it can be measured without
 * flashing in the wrong place.
 *
 * K106 stage 2 lifted this out of `Menu` so the whole dropdown family
 * sits on the same substrate: the inline `absolute` panel `Combobox` used
 * had defect (1) latent in exactly the same way.
 */

/** Gutter kept between the panel and the viewport edge, in px. */
export const VIEWPORT_MARGIN = 8;
/** Gap between the trigger and the panel, in px. */
export const TRIGGER_GAP = 4;

export interface PanelPosition {
  readonly left: number;
  readonly top: number;
}

/**
 * The inline style a portalled panel applies. Before the first
 * measurement the panel is parked at the origin and hidden, so it can be
 * measured at its natural size without flashing in the wrong place.
 */
export function panelStyle(pos: PanelPosition | null): React.CSSProperties {
  return pos === null
    ? { left: 0, top: 0, visibility: "hidden" }
    : { left: pos.left, top: pos.top };
}

/**
 * Compute the panel's viewport coordinates from the two measured rects.
 * Anchors below the trigger, flips above when there is no room below,
 * honors `align` (start → panel left to trigger left, end → panel right
 * to trigger right), then clamps horizontally so the panel never crosses
 * a viewport edge.
 *
 * Exported so the math is testable without a DOM: the clamp is the part
 * that fixed the sidebar kebab and it must not silently regress.
 */
export function placePanel(
  wrap: { left: number; right: number; top: number; bottom: number },
  panel: { width: number; height: number },
  align: "start" | "end",
  viewport: { width: number; height: number },
): PanelPosition {
  let left = align === "end" ? wrap.right - panel.width : wrap.left;
  const maxLeft = viewport.width - VIEWPORT_MARGIN - panel.width;
  // Clamp within [margin, maxLeft]. `Math.min` first, then a `Math.max`
  // floor, so a panel wider than the viewport still starts at the left
  // gutter rather than off-screen.
  left = Math.max(VIEWPORT_MARGIN, Math.min(left, maxLeft));

  let top = wrap.bottom + TRIGGER_GAP;
  if (top + panel.height > viewport.height - VIEWPORT_MARGIN) {
    const above = wrap.top - TRIGGER_GAP - panel.height;
    top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, top);
  }
  return { left, top };
}

/**
 * Measures and keeps a portalled panel placed while `open`.
 *
 * Returns the coordinates, or `null` until the first measurement has run
 * (feed that straight to `panelStyle`).
 */
export function usePortalPlacement(
  open: boolean,
  wrapRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  align: "start" | "end",
): PanelPosition | null {
  const [pos, setPos] = useState<PanelPosition | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return undefined;
    }
    const place = (): void => {
      const wrap = wrapRef.current?.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      if (wrap === undefined || panel === undefined) return;
      setPos(placePanel(wrap, panel, align, {
        width: window.innerWidth,
        height: window.innerHeight,
      }));
    };
    place();
    // Keep the panel anchored as ancestors scroll or the window resizes.
    // `capture: true` on scroll so a scrolling *ancestor* (which does not
    // bubble its scroll event) is still heard — the sidebar's own scroll
    // container is exactly this case.
    const onReflow = (): void => { place(); };
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("resize", onReflow);
    return () => {
      window.removeEventListener("scroll", onReflow, true);
      window.removeEventListener("resize", onReflow);
    };
    // The refs are stable; `open` and `align` are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, align]);

  return pos;
}
