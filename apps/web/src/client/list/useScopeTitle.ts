import { useProjects, useViews } from "../api/hooks/sidebarData.ts";

/**
 * The title a task-view screen (List / Board / Timeline) shows at the top,
 * above its toolbar (K-title rule). The title reflects the current SCOPE,
 * not just the screen:
 *
 *   1. A saved **view** is active (`search.view` set) → the view's name.
 *   2. Else a single **project** is scoped (`search.project` has exactly
 *      one id) → that project's name. Adding other filters (status,
 *      priority, …) does not touch `project`, so the project title
 *      persists as the user narrows — matching "entered via a project,
 *      title stays as filters are added".
 *   3. Else → the plain screen name (the `fallback`).
 *
 * URL-derived and deterministic: no hidden entry-tracking state. While the
 * views/projects lists are still loading, a set scope falls back to the
 * screen name rather than flashing an id.
 */
export function useScopeTitle(
  search: {
    readonly view?: string | undefined;
    readonly project?: readonly string[] | undefined;
  },
  fallback: string,
): string {
  const views = useViews();
  const projects = useProjects();

  const viewId = search.view;
  if (viewId !== undefined) {
    const name = (views.data?.queries ?? []).find(v => v.id === viewId)?.name;
    if (name !== undefined && name.length > 0) return name;
    // A set-but-unresolved view id (still loading, or deleted): don't
    // flash the raw id — use the screen name until it resolves.
    return fallback;
  }

  const projectIds = search.project ?? [];
  if (projectIds.length === 1) {
    const only = projectIds[0];
    const name = (projects.data?.items ?? []).find(p => p.id === only)?.name;
    if (name !== undefined && name.length > 0) return name;
    return fallback;
  }

  return fallback;
}
