import type { ArchivedScope } from "@loctt/contracts";
import { DEFAULT_ARCHIVED_SCOPE } from "@loctt/contracts";

/**
 * The one place the archived scope is applied to a list of archivable
 * config entities — saved views, milestones, sprints, labels, projects,
 * users (K107). Before this, every surface (CLI, web server, sidebar,
 * settings panels) re-implemented `.filter(x => x.archived !== true)`
 * with its own default, so "hide archived" was re-derived 3-4× per entity
 * and drifted. Now core owns the rule and every surface calls this.
 *
 * `active` (the default) hides archived; `archived` keeps ONLY archived;
 * `all` keeps everything. An item is "archived" when `archived === true`.
 *
 * Tasks are NOT filtered here — they go through the query DSL in
 * `query/list.ts`, which owns the same tri-state via `archivedScope`.
 */
// The constraint carries `| undefined` deliberately. The repo compiles
// with `exactOptionalPropertyTypes`, under which a config entity typed
// `archived?: boolean | undefined` is NOT assignable to a constraint of
// `archived?: boolean` — so the plain-`boolean` form made this function
// uncallable from every real surface (CLI/MCP/web all store the field as
// `boolean | undefined`). Widening the constraint keeps the generic `T`
// concrete (callers get their own element type back) and changes no
// runtime behaviour.
export function applyArchivedScope<T extends { readonly archived?: boolean | undefined }>(
  items: readonly T[],
  scope: ArchivedScope = DEFAULT_ARCHIVED_SCOPE,
): T[] {
  switch (scope) {
    case "all":
      return [...items];
    case "archived":
      return items.filter(item => item.archived === true);
    case "active":
      return items.filter(item => item.archived !== true);
  }
}
