import { useEffect, useState } from "react";

/**
 * True when the viewport is narrower than `breakpoint` (default 640px, the
 * Tailwind `sm` breakpoint). For components that must render a DIFFERENT
 * DOM below a breakpoint rather than just restyle — e.g. the task list
 * swapping its table for a stacked-card layout on phones (UX eval #3).
 *
 * Prefer plain Tailwind responsive classes for restyling; reach for this
 * only when the two layouts are structurally different and rendering both
 * would duplicate content in the DOM (a second copy every screen reader
 * and every `getByText` would find).
 *
 * SSR / jsdom safe: `window` is read lazily and defaults to "not narrow"
 * (wide) when unavailable, so server render and unit tests get the table
 * layout unless a test drives the resize. Uses matchMedia when present and
 * falls back to `innerWidth` + a resize listener.
 */
export function useIsNarrow(breakpoint = 640): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;

  const read = (): boolean => {
    if (typeof window === "undefined") return false;
    if (typeof window.matchMedia === "function") return window.matchMedia(query).matches;
    return window.innerWidth < breakpoint;
  };

  const [narrow, setNarrow] = useState<boolean>(read);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = (): void => { setNarrow(read()); };
    update();
    if (typeof window.matchMedia === "function") {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", update);
      return () => { mql.removeEventListener("change", update); };
    }
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("resize", update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [breakpoint]);

  return narrow;
}
