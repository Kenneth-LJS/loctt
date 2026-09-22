import { useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";

/**
 * Scrolls the element named by the URL hash into view and briefly
 * highlights it — the shared mechanism behind every deep link to a
 * location within a page (K76): a settings field (`#field-timezone`), a
 * task's comments (`#comments`), one comment (`#comment-<id>`).
 *
 * ## Why it retries rather than firing once
 *
 * The target often mounts *after* the hash is known: a comment or a
 * settings field appears only once its async data has loaded. Reading the
 * hash once in an effect would miss it. So this polls for the element on
 * a bounded set of animation frames after the hash changes, and stops the
 * moment it finds it — the same "content arrives after the route change"
 * shape `useMainScrollRestoration` handles, and the A11Y-17 focus-restore
 * pattern in `ListView`. The bound (rather than an unbounded observer)
 * keeps a hash naming a target that never appears (a deleted comment)
 * from watching forever.
 *
 * ## Highlight
 *
 * The found element gets `data-hash-target` for one highlight cycle, then
 * it is removed so a later navigation can re-trigger it. The highlight
 * itself is CSS keyed on that attribute and is dropped under
 * `prefers-reduced-motion` (SHL-28) — the scroll still happens, only the
 * flash is suppressed.
 *
 * Reads the hash from the router so it re-runs on in-app navigation
 * (clicking a deep link while already on the page), not only on a cold
 * load.
 */
// A wall-clock deadline, not a frame count. A frame budget (~0.5s at 60fps)
// is fragile: a deep-link target can mount only AFTER an async config fetch
// resolves and, for an archived row, after a "Show archived" state flip
// re-renders it (K100 deep links) — a chain that can exceed 30 frames on a
// slow load, and rAF is throttled in a background tab. Poll each frame until
// the element appears or the deadline passes.
const SCROLL_DEADLINE_MS = 3000;
// A hard frame cap as a backstop so the poll always terminates even where the
// clock does not advance between frames (e.g. fake timers in tests). ~3s at
// 60fps, matching the wall-clock deadline; whichever fires first wins.
const MAX_FRAMES = 180;
const HIGHLIGHT_MS = 1600;

export function useScrollToHash(): void {
  const hash = useRouterState({ select: s => s.location.hash });

  useEffect(() => {
    if (hash === undefined || hash === "") return undefined;
    // `location.hash` from the router carries no leading `#`; `getElementById`
    // wants the bare id. Guard against a malformed hash.
    const id = hash.replace(/^#/, "");
    if (id === "") return undefined;

    const deadline = performance.now() + SCROLL_DEADLINE_MS;
    let frame = 0;
    let rafId = 0;
    let highlightTimer: ReturnType<typeof setTimeout> | undefined;
    let highlighted: HTMLElement | undefined;

    const tryScroll = (): void => {
      const el = document.getElementById(id);
      if (el !== null) {
        el.scrollIntoView({ block: "start", behavior: "auto" });
        el.setAttribute("data-hash-target", "true");
        highlighted = el;
        highlightTimer = setTimeout(() => {
          el.removeAttribute("data-hash-target");
        }, HIGHLIGHT_MS);
        return;
      }
      frame += 1;
      if (frame < MAX_FRAMES && performance.now() < deadline) {
        rafId = requestAnimationFrame(tryScroll);
      }
    };
    rafId = requestAnimationFrame(tryScroll);

    return () => {
      cancelAnimationFrame(rafId);
      if (highlightTimer !== undefined) clearTimeout(highlightTimer);
      // Clean the attribute if we unmount mid-highlight, so a remount
      // does not find a stale marker.
      highlighted?.removeAttribute("data-hash-target");
    };
  }, [hash]);
}
