import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useAnnouncer } from "../ui/Announcer.tsx";
import { MAIN_CONTENT_ID } from "./SkipLink.tsx";

/**
 * Names the current view for the document title and the live region
 * (A11Y-45).
 *
 * Kept as a table rather than derived from the path segment: the case
 * requires the announcement to name *the view*, and "tasks/$key" is
 * not a name a user recognises. Unmatched paths fall back to the app
 * name rather than announcing a raw path.
 */
function viewNameFor(pathname: string): string | null {
  if (pathname === "/list") return "List";
  if (pathname === "/board") return "Board";
  if (pathname === "/timeline") return "Timeline";
  if (pathname === "/sprints") return "Sprints";
  if (pathname.startsWith("/sprints/")) return "Sprint detail";
  if (pathname.startsWith("/tasks/")) return "Task detail";
  if (pathname.startsWith("/settings/")) return "Settings";
  return null;
}

/**
 * Announces route changes and keeps `document.title` current.
 *
 * A11Y-45's third bullet — "the document title reflects the current
 * view, so a user with many tabs can tell them apart" — is the half
 * that also serves sighted users, and it is why the title is set here
 * rather than only announced.
 *
 * The first render is deliberately **not** announced. Arriving on a
 * page is not a route *change*, and a reader already announces a
 * freshly loaded document; adding to it would talk over the page
 * heading. The title is still set on that first pass.
 */
export function useRouteAnnouncement(): void {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const { announce } = useAnnouncer();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const name = viewNameFor(pathname);
    document.title = name === null ? "LocTT" : `${name} · LocTT`;
    const isFirst = previous.current === null;
    const changed = previous.current !== pathname;
    previous.current = pathname;
    if (isFirst || !changed || name === null) return;
    announce(name);
    // A11Y-45 bullet 2: "Focus moves to the start of the new main
    // content … not left on the sidebar link, and not dropped to
    // `document.body`." Nothing did this. `AppShell.tsx` made the pane
    // `tabIndex={-1}` and its comment said the route announcement
    // lands focus here — but the only caller was the skip link, and
    // this hook had zero focus calls. Measured: after List → Board,
    // focus was still on the sidebar's Board link.
    //
    // Not on the first render: focus belongs wherever the page put it
    // on load, and stealing it there would fight the skip link.
    document.getElementById(MAIN_CONTENT_ID)?.focus();
  }, [pathname, announce]);
}
