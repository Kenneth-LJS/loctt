import { useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";

/**
 * Per-route scroll position for the main pane.
 *
 * SHL-25 wants Back to return to roughly where the user left a
 * scrolled list; SHL-26 wants a fresh navigation to start at the top.
 *
 * The router's own `scrollRestoration` option was tried first and does
 * not work here: it resolves the saved element by selector at restore
 * time, and the main pane's content mounts *after* the route change,
 * so the element it finds has no height yet and the assignment is
 * discarded. Nothing is wrong with the router — the shell simply
 * renders its rows asynchronously, which is exactly the case's own
 * "restoration happens after rows render, not before".
 *
 * So the offset is stored per URL and re-applied on the next animation
 * frame, once the returning route's rows are in the DOM.
 *
 * The frame is load-bearing and was measured, not assumed: applied
 * synchronously in the effect, the pane holds ~48px of scrollable
 * range and an 800px offset clamps to 48 — the user lands near the
 * top, which is the failure the case's "not before, so it doesn't
 * land on a position that then collapses" describes. One frame later
 * the rows are there. An earlier draft looped until the height was
 * sufficient; that loop never ran twice in any scenario reachable
 * here, so it was untested machinery and is gone.
 */

/** Remembered offsets, keyed by full URL (path + search). */
const offsets = new Map<string, number>();

export function useMainScrollRestoration(): (el: HTMLElement | null) => void {
  const href = useRouterState({ select: s => s.location.href });
  const elementRef = useRef<HTMLElement | null>(null);
  // The URL whose offset the element currently holds, so the save on
  // navigation records the position under the page it came from.
  const currentHref = useRef(href);

  const ref = useCallback((el: HTMLElement | null) => {
    elementRef.current = el;
  }, []);

  // Save continuously rather than only on navigation: the pane can be
  // unmounted by a route change before any cleanup we schedule runs.
  useEffect(() => {
    const el = elementRef.current;
    if (el === null) return undefined;
    const onScroll = (): void => {
      offsets.set(currentHref.current, el.scrollTop);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => { el.removeEventListener("scroll", onScroll); };
  }, [href]);

  useEffect(() => {
    currentHref.current = href;
    const el = elementRef.current;
    if (el === null) return undefined;

    const target = offsets.get(href);
    // A URL never scrolled starts at the top (SHL-26) with no help
    // from here: the pane is remounted by the route change, so the
    // browser has already reset it. An explicit  was
    // tried and survived its own mutation test — it was doing
    // nothing, so it is not here.
    if (target === undefined || target === 0) return undefined;

    // Rows arrive with the route change, so the pane is too short to
    // hold the offset during the effect itself. One frame later it is
    // not, and  clamps rather than throwing if a page did
    // legitimately get shorter.
    const frame = requestAnimationFrame(() => { el.scrollTop = target; });
    return () => { cancelAnimationFrame(frame); };
  }, [href]);

  return ref;
}
