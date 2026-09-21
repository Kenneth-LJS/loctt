// Imported by subpath, NOT the barrel: the barrel drags node:path/sharp
// into the browser bundle (see buildDsl.ts / dslToSearch.ts, A37).
import type { BuilderTree } from "@loctt/core/query/builderTree.js";

import type { ListSearch } from "../router/listSearch.ts";

/**
 * Builds the STRUCTURED conditions tree ({@link BuilderTree}) from the
 * active list filters — the source of truth for "Save as view" (M1.3).
 *
 * This replaces the old string-first path. The tree is authored here with
 * FIXED per-facet operators; the derived DSL `query` is then produced from
 * it by core's spacing-only serializer (see {@link buildDslFromSearch} in
 * ./buildDsl.ts), so the stored structure and string can never disagree.
 *
 * ## Operator choice is by FACET, never by value count (Ken's ruling)
 *
 * Every facet in the filter bar is a MULTI-SELECT: the chip row lets the
 * user pick any number of values. A membership question with one value
 * selected is still a membership question — so it serializes as
 * `status in (A)`, NOT `status = A`. The old `clause()` switched operator
 * on `v.length` (`= x` for one, `in (...)` for many), which is a
 * form-rewrite: saving a one-value filter and re-opening it would show a
 * different query shape than the user built. Membership stays membership.
 *
 * (If a genuinely single-valued scalar facet is ever added — one the UI
 * models as exactly one value, not a set — it would author a `=` leaf.
 * None exists today; all nine facets below are sets.)
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
 * A membership leaf (`field in (a, b, …)`) for a multi-select facet, or
 * `null` when the facet has no usable values. Value ORDER is preserved
 * (only trimming and dropping blanks), so the round-trip is form-faithful.
 */
function membershipLeaf(field: string, values: readonly string[]): BuilderTree | null {
  const v = values.map(s => s.trim()).filter(Boolean);
  if (v.length === 0) return null;
  return {
    kind: "leaf",
    field,
    op: "in",
    value: { type: "list", values: v.map(value => ({ type: "string" as const, value })) },
  };
}

/**
 * The `archived != true` leaf that a saved view carries so re-running it
 * does not surface archived tasks — the structured form of the default
 * "open" semantics the string builder appended.
 */
function archivedLeaf(): BuilderTree {
  return { kind: "leaf", field: "archived", op: "!=", value: { type: "boolean", value: true } };
}

/** The `archived = true` leaf, for a view saved under the `archived` scope. */
function archivedOnlyLeaf(): BuilderTree {
  return { kind: "leaf", field: "archived", op: "=", value: { type: "boolean", value: true } };
}

/**
 * Build the structured conditions tree from the active list filters.
 *
 * The children are AND-ed (the same intersection semantics the filter bar
 * has), in this order: the free-text `q` (parsed to its own subtree),
 * then each active facet in {@link FACET_TO_FIELD} order, then each custom
 * `field.<key>` filter, then the default `archived != true` guard. An
 * empty result (no active filters) is just the `archived != true` guard.
 *
 * The free-text `q` is itself DSL, so it is parsed with core's total
 * parser and spliced in as a subtree; an unparseable `q` is dropped (the
 * filter bar only ever puts a valid `text ~ …` there, and a bad hand-typed
 * one should not sink the whole save — it simply is not carried, matching
 * how the old string builder would have produced an unparseable string).
 */
export function buildConditionsFromSearch(
  search: Partial<ListSearch>,
  // Injected so this module does not import the core barrel; the caller
  // (buildDsl.ts) passes core's `queryToConditions`.
  parseQ: (q: string) => { ok: true; tree: BuilderTree } | { ok: false; reason: string },
): BuilderTree {
  const children: BuilderTree[] = [];

  if (typeof search.q === "string" && search.q.trim().length > 0) {
    const parsed = parseQ(search.q.trim());
    if (parsed.ok) children.push(parsed.tree);
  }

  const bag = search as Record<string, unknown>;
  for (const [facet, field] of Object.entries(FACET_TO_FIELD)) {
    const raw = bag[facet];
    if (Array.isArray(raw)) {
      const leaf = membershipLeaf(field, raw.filter((x): x is string => typeof x === "string"));
      if (leaf) children.push(leaf);
    }
  }

  for (const [k, v] of Object.entries(search)) {
    if (k.startsWith("field.") && k.length > "field.".length) {
      const list = Array.isArray(v)
        ? (v as string[])
        : typeof v === "string"
          ? v.split(",")
          : [];
      const leaf = membershipLeaf(`fields.${k.slice("field.".length)}`, list);
      if (leaf) children.push(leaf);
    }
  }

  // K107: the archived dimension is now the tri-state scope, not a boolean
  // toggle. Until K102 lets a view carry the scope as its own flag, the
  // scope is still encoded into the view's structured query so re-running
  // it reproduces what the user saw: `active` (or absent) → `archived !=
  // true`; `archived` → `archived = true`; `all` → no archived leaf.
  if (search.archived === "archived") {
    children.push(archivedOnlyLeaf());
  } else if (search.archived !== "all") {
    children.push(archivedLeaf());
  }

  // A view with no conditions at all is meaningless (and the serializer
  // refuses an empty group), so a filter set that produced nothing —
  // scope `all` with no other facet — falls back to the `archived != true`
  // guard, exactly as the old string builder did.
  if (children.length === 0) {
    children.push(archivedLeaf());
  }

  // A single condition serializes without a wrapping group (a one-child
  // group is just its child), so an all-defaults save yields exactly
  // `archived != true`. The root is always a group so the structure is
  // uniform and editable.
  return { kind: "group", op: "and", children };
}
