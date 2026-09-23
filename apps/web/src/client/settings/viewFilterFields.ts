import type { ComparisonOp, WorkflowConfig } from "@loctt/contracts";

import type { FacetOptions } from "../list/facetOptions.ts";
import type { FilterOption } from "../list/FilterFacet.tsx";

/**
 * The field catalog for the saved-view dialog's SIMPLE filter rows (K102).
 *
 * A simple filter is `{field, op, values}` and renders as three dropdowns.
 * This module answers the two questions a row needs: which fields may the
 * user pick, and for a chosen field, which operators and which VALUES.
 *
 * The value options come straight from `buildFacetOptions` — the same
 * definition the top filter bar uses — so a value the dialog offers is a
 * value the bar can show, by construction rather than by two lists
 * happening to agree. Custom enum fields are folded in from the workflow
 * config on the same footing, matching `buildFilterCatalog`'s rule (only
 * enum custom fields with values are faceted).
 *
 * Nothing here parses a query string. The dialog renders a stored filter
 * by its stored `kind`; this catalog only decorates a `simple` one with
 * human labels and pickers.
 */

/** One choosable field in a simple-filter row. */
export interface ViewFilterField {
  /** The DSL field token stored in the filter, e.g. `status`, `fields.sev`. */
  readonly field: string;
  /** Human label for the field picker. */
  readonly label: string;
  /**
   * The closed value set, when the field has one. Absent means the value
   * is free text (`title`, `text`) — the row renders a text input instead
   * of a dropdown.
   */
  readonly options?: readonly FilterOption[];
}

/**
 * Operators offered for a field with a closed value set.
 *
 * Membership first: every picker here is MULTI-select, so `in` is the
 * shape the user is actually building (Ken, K102 — a one-value membership
 * filter stays a membership filter, it does not collapse to `=`).
 */
const ENUM_OPS: readonly ComparisonOp[] = ["in", "not in", "is empty", "is not empty"];

/** Operators offered for a free-text field. */
const TEXT_OPS: readonly ComparisonOp[] = ["~", "=", "!=", "is empty", "is not empty"];

/** Operators that take no right-hand value at all. */
export const VALUELESS_OPS: ReadonlySet<ComparisonOp> = new Set<ComparisonOp>([
  "is empty",
  "is not empty",
]);

/** The operators a given field may use. */
export function opsForField(field: ViewFilterField | undefined): readonly ComparisonOp[] {
  return field?.options === undefined ? TEXT_OPS : ENUM_OPS;
}

/** How each operator reads in the operator dropdown. */
export const OP_LABEL: Readonly<Record<string, string>> = {
  "in": "is any of",
  "not in": "is none of",
  "=": "is",
  "!=": "is not",
  "~": "contains",
  "is empty": "is empty",
  "is not empty": "is not empty",
};

/** The built-in fields, in the order the filter bar reads them. */
const BUILTIN: readonly { field: string; label: string; facet?: keyof FacetOptions }[] = [
  { field: "project", label: "Project", facet: "project" },
  { field: "status", label: "Status", facet: "status" },
  { field: "priority", label: "Priority", facet: "priority" },
  { field: "task_type", label: "Type", facet: "type" },
  { field: "assignee", label: "Assignee", facet: "assignee" },
  { field: "reporter", label: "Reporter", facet: "reporter" },
  { field: "labels", label: "Label", facet: "labels" },
  { field: "milestone", label: "Milestone", facet: "milestone" },
  { field: "sprint", label: "Sprint", facet: "sprint" },
  { field: "title", label: "Title" },
  { field: "text", label: "Any text" },
];

/**
 * Build the catalog from the loaded facet options + workflow config.
 *
 * Built-ins always appear even when their option source is still loading
 * or failed — an empty dropdown is a visible "no options" state, while
 * dropping the field entirely would make a STORED filter on it
 * unrenderable, which is exactly the swap-things-around behaviour K102
 * forbids.
 */
export function buildViewFilterFields(
  options: FacetOptions,
  workflow: WorkflowConfig | undefined,
): readonly ViewFilterField[] {
  const builtins: ViewFilterField[] = BUILTIN.map(b =>
    b.facet === undefined
      ? { field: b.field, label: b.label }
      : { field: b.field, label: b.label, options: options[b.facet] },
  );
  const customs: ViewFilterField[] = (workflow?.custom_fields ?? [])
    .filter(cf => cf.type === "enum" && cf.values && cf.values.length > 0)
    .map(cf => ({
      field: `fields.${cf.key}`,
      label: cf.label,
      options: (cf.values ?? []).map(v => ({ value: v.key, label: v.label })),
    }));
  return [...builtins, ...customs];
}

/**
 * Find a field in the catalog, or `undefined` when a STORED filter names
 * a field the catalog does not have (a since-removed custom field, or a
 * field only the DSL knows). The row still renders — with a free-text
 * value input and the raw field token — rather than vanishing.
 */
export function findField(
  catalog: readonly ViewFilterField[],
  field: string,
): ViewFilterField | undefined {
  return catalog.find(f => f.field === field);
}
