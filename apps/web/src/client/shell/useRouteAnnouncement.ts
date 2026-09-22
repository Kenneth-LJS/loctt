import type { ProjectDef } from "@loctt/contracts";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useProjects } from "../api/hooks/sidebarData.ts";
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
 * The project name the title should carry, or `null` when none
 * resolves.
 *
 * SHL-11 / SHL-31 ask that two `loctt ui` windows be tellable apart.
 * A tracker hosts one or more projects, so "the tracker's name" is not
 * a thing that exists — the rule is to name the project the user is
 * actually *scoped to*:
 *
 * 1. Exactly one `?project=` filter value → that project. It is the
 *    scope the user chose, and it is what the pane in front of them is
 *    showing.
 * 2. Otherwise the workspace's `effective_default` — the project a new
 *    task would land in, which is the one this window is "about" when
 *    nothing narrows it.
 * 3. Two or more filtered projects, or an id that resolves to no
 *    project, → `null`. Concatenating names would grow without bound
 *    and a stale id has no name to show; both fall back rather than
 *    invent one.
 *
 * Deliberately NOT the sole-project shortcut when `effective_default`
 * is null: the server already folds "sole project" into
 * `effective_default`, so re-deriving it here would be a second rule
 * that can disagree with the sidebar's active marker.
 */
export function titleProjectName(
  projects: readonly ProjectDef[] | undefined,
  effectiveDefault: string | null | undefined,
  filtered: readonly string[],
): string | null {
  if (projects === undefined) return null;
  const byId = (id: string): ProjectDef | undefined => projects.find(p => p.id === id);
  const sole = filtered.length === 1 ? filtered[0] : undefined;
  if (sole !== undefined) return byId(sole)?.name ?? null;
  if (filtered.length > 1) return null;
  if (effectiveDefault === null || effectiveDefault === undefined) return null;
  return byId(effectiveDefault)?.name ?? null;
}

/**
 * Builds the document title.
 *
 * `LocTT — <project> — <view>` when both resolve. With no project the
 * shape falls back to the pre-existing `<view> · LocTT` rather than
 * emitting an empty segment or a placeholder, and with no view (an
 * unmatched route) it is the bare app name.
 */
export function documentTitleFor(view: string | null, project: string | null): string {
  if (view === null) return project === null ? "LocTT" : `LocTT — ${project}`;
  if (project === null) return `${view} · LocTT`;
  return `LocTT — ${project} — ${view}`;
}

/**
 * Announces route changes and keeps `document.title` current.
 *
 * A11Y-45's third bullet — "the document title reflects the current
 * view, so a user with many tabs can tell them apart" — is the half
 * that also serves sighted users, and it is why the title is set here
 * rather than only announced. SHL-11 / SHL-31 extend the same title to
 * telling two *trackers* apart, by naming the project in it.
 *
 * The project read is the sidebar's own `["projects"]` query, so this
 * adds no request: the shell has already fetched it, and a route
 * change re-reads the cache rather than the network.
 *
 * The first render is deliberately **not** announced. Arriving on a
 * page is not a route *change*, and a reader already announces a
 * freshly loaded document; adding to it would talk over the page
 * heading. The title is still set on that first pass. The live-region
 * announcement stays the bare view name — the project has not changed
 * when the route does, and repeating it every navigation is noise a
 * screen-reader user cannot skip.
 */
export function useRouteAnnouncement(): void {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const filtered = useRouterState({
    select: s => (s.location.search as { project?: string[] }).project ?? [],
  });
  const { data: projects } = useProjects();
  const { announce } = useAnnouncer();
  const previous = useRef<string | null>(null);

  const projectName = titleProjectName(
    projects?.items,
    projects?.effective_default,
    filtered,
  );

  useEffect(() => {
    const name = viewNameFor(pathname);
    document.title = documentTitleFor(name, projectName);
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
    // `projectName` is a dependency so the title picks the name up when
    // the projects query resolves after the first paint. It cannot
    // re-fire the announce/focus branch: `changed` compares `pathname`
    // against the ref, and a projects-only re-run leaves them equal.
  }, [pathname, projectName, announce]);
}
