import type { ProjectDef } from "@loctt/contracts";

/**
 * Name search for the config lists (labels, milestones, sprints, users,
 * projects) — K90.
 *
 * The pickers used to fetch the whole list and filter it in the browser,
 * which silently truncated past 1000 entries and (because names are
 * non-unique and `createLabel` has no name guard) let the create modal
 * offer to write a duplicate of a label that fell outside the window.
 * K90 makes name search a **core** capability so the web pickers, the
 * CLI, and MCP all match the same way — this module is that one place.
 *
 * Semantics (K90): case-insensitive substring on the display name. An
 * empty or whitespace-only query is "no filter" — the caller gets its
 * list unchanged, so an initial picker render (and a bare `list`) still
 * shows everything. This deliberately differs from `/api/search`, whose
 * empty query returns nothing because scanning the whole tracker is
 * expensive; a config list is already small enough to page.
 */

/** True when `q` is absent/blank — callers treat that as "no filter". */
export function isBlankQuery(q: string | undefined): boolean {
  return q === undefined || q.trim() === "";
}

/**
 * Filters a list of `{ name }` items by a case-insensitive substring of
 * their name. A blank query returns the input array unchanged (same
 * reference), so callers can pass the raw config through unconditionally.
 */
export function filterByName<T extends { readonly name?: string | undefined }>(
  items: readonly T[],
  q: string | undefined,
): readonly T[] {
  const needle = (q ?? "").trim().toLowerCase();
  if (needle === "") return items;
  return items.filter(i => i.name !== undefined && i.name.toLowerCase().includes(needle));
}

/**
 * Projects match on name **and** slug **and** prefix (K90): slug and
 * prefix are the stable handles a user would type (e.g. `WEB` for a
 * project keyed `WEB-`, or its `web` slug), so matching only the display
 * name would surprise. Case-insensitive substring, match if any field
 * hits. A blank query returns the input unchanged.
 */
export function filterProjects(
  projects: readonly ProjectDef[],
  q: string | undefined,
): readonly ProjectDef[] {
  const needle = (q ?? "").trim().toLowerCase();
  if (needle === "") return projects;
  return projects.filter(p =>
    p.name.toLowerCase().includes(needle)
    || (p.slug !== undefined && p.slug.toLowerCase().includes(needle))
    || p.prefix.toLowerCase().includes(needle),
  );
}
