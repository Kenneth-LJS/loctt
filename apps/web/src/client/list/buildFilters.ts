import type { ArchivedScope, Filter } from "@loctt/contracts";

import type { ListSearch } from "../router/listSearch.ts";

/**
 * Builds a view's ORDERED FILTER LIST from the active list filters —
 * the source of truth for "Save as view" (K102).
 *
 * Replaces `buildConditionsFromSearch`, which authored a single
 * `BuilderTree` and derived a DSL string from it. Under K102 a view
 * stores neither: it stores the filters as authored, each keeping its own
 * kind, so a reopened view renders every facet back as the dropdown row
 * it came from rather than as query text.
 *
 * ## Operator choice is by FACET, never by value count (Ken's ruling)
 *
 * Every facet in the filter bar is a MULTI-SELECT: the chip row lets the
 * user pick any number of values. A membership question with one value
 * selected is still a membership question — so it authors `op: "in"` with
 * one value, NOT `op: "="`. Switching operator on value count is a
 * form-rewrite: saving a one-value filter and reopening it would show a
 * different shape than the user built. Membership stays membership.
 *
 * ## The free-text `q` is the ONE advanced filter
 *
 * `q` holds DSL the user typed, so it is carried verbatim as a single
 * `{kind:"advanced"}` filter — the only place this builder produces one.
 * Everything else is simple, which is what keeps a saved view editable in
 * the picker (K102: the DSL is advanced shit; average people never see
 * it).
 *
 * ## Archived is a SCOPE, not a filter
 *
 * The old builder appended an `archived != true` leaf to the conditions.
 * K107 + K102 make it a field on the view instead, so it never appears as
 * a filter row the user has to look at and cannot safely delete. See
 * {@link archivedScopeFromSearch}.
 */

/** The multi-select facets and the queryable field each maps to. */
const FACET_TO_FIELD: Readonly<Record<string, string>> = {
  project: "project",
  status: "status",
  priority: "priority",
  type: "task_type",
  assignee: "assignee",
  reporter: "reporter",
  labels: "labels",
  milestone: "milestone",
  sprint: "sprint",
};

/**
 * A membership filter for a multi-select facet, or `null` when the facet
 * has no usable values. Value ORDER is preserved (only trimming and
 * dropping blanks), so the round-trip is form-faithful.
 */
function membershipFilter(field: string, values: readonly string[]): Filter | null {
  const v = values.map(s => s.trim()).filter(Boolean);
  if (v.length === 0) return null;
  return { kind: "simple", field, op: "in", values: v };
}

/**
 * The archived SCOPE a view should carry for the current filter state.
 *
 * Returns `undefined` for the default (`active`) so the stored view omits
 * the field entirely rather than writing the default out — "absent" and
 * "explicitly active" mean the same thing, and omitting keeps the file
 * minimal.
 */
export function archivedScopeFromSearch(
  search: Partial<ListSearch>,
): ArchivedScope | undefined {
  if (search.archived === "archived") return "archived";
  if (search.archived === "all") return "all";
  return undefined;
}

/**
 * Build the ordered filter list from the active list filters.
 *
 * Order: the free-text `q` (as one advanced filter) first, then each
 * active facet in {@link FACET_TO_FIELD} order, then each custom
 * `field.<key>` filter. That is the order the user reads them in the
 * filter bar, and it is the order they will be stored and redisplayed in.
 *
 * An empty result is legitimate: a view with no filters matches
 * everything within its archived scope. The old builder had to fall back
 * to an `archived != true` leaf because its serializer refused an empty
 * group; a filter LIST has no such problem.
 */
export function buildFiltersFromSearch(search: Partial<ListSearch>): Filter[] {
  const filters: Filter[] = [];

  // The user's own DSL, carried verbatim as the one advanced filter.
  // Unlike the old builder this does NOT parse it here — core validates
  // it on write and normalizes only its spacing, so an unparseable `q` is
  // rejected with a message instead of being silently dropped.
  if (typeof search.q === "string" && search.q.trim().length > 0) {
    filters.push({ kind: "advanced", query: search.q.trim() });
  }

  const bag = search as Record<string, unknown>;
  for (const [facet, field] of Object.entries(FACET_TO_FIELD)) {
    const raw = bag[facet];
    if (Array.isArray(raw)) {
      const f = membershipFilter(field, raw.filter((x): x is string => typeof x === "string"));
      if (f) filters.push(f);
    }
  }

  for (const [k, v] of Object.entries(search)) {
    if (k.startsWith("field.") && k.length > "field.".length) {
      const list = Array.isArray(v)
        ? (v as string[])
        : typeof v === "string"
          ? v.split(",")
          : [];
      const f = membershipFilter(`fields.${k.slice("field.".length)}`, list);
      if (f) filters.push(f);
    }
  }

  return filters;
}
