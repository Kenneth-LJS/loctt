import type { BuiltinContext } from "../sidebar/builtinFilters.ts";
import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";
import { buildDslFromSearch } from "./buildDsl.ts";

/**
 * The DSL behind a built-in filter, for VUE-12: choosing "edit" on a
 * built-in must open the advanced editor showing *the actual query*,
 * not an empty box.
 *
 * Built-ins already describe themselves as URL search state (`q` plus
 * facets), and `buildDslFromSearch` already turns that into DSL — so
 * this composes the two rather than transcribing each built-in's query
 * a second time. Transcribing would be the drift VUE-12's second
 * bullet catches: the pre-populated DSL is required to return the same
 * rows the built-in returned, which only holds if there is one
 * definition, not two.
 *
 * Returns `null` for a built-in that cannot resolve in this workspace
 * (`mentions-me`, or `high-priority` on a tracker with no high band) —
 * there is no query to pre-populate, and inventing one would show the
 * user a filter the sidebar never ran.
 */
export function builtinToDsl(id: string, ctx: BuiltinContext): string | null {
  const builtin = BUILTIN_FILTERS.find(b => b.id === id);
  if (builtin === undefined) return null;

  const search = builtin.resolve(ctx);
  if (search === null) return null;

  return buildDslFromSearch(search);
}
