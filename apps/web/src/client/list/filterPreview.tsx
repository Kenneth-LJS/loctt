import type { Filter, QuerySort, SimpleFilter } from "@loctt/contracts";

import { OP_LABEL, VALUELESS_OPS } from "../settings/viewFilterFields.ts";
import type { FacetOptions } from "./facetOptions.ts";

/**
 * "Save as view" filter preview (A337).
 *
 * Ken, on the dialog's old preview — a raw DSL-shaped text dump
 * (`project in "01M33FN47B9B55YP89X786V1VB"`) — verbatim: *"why is the
 * filter preview just text?! that's bad UX."* Its two faults: it read as
 * query text rather than as the filters the user built, and it printed
 * internal ULIDs (a P-4 violation — `tests/cases/ui-test-cases/README.md`
 * bans raw ids in UI content).
 *
 * This module is the pure resolver: `SimpleFilter` + the same
 * `FacetOptions` the filter bar and `ViewFormDialog` already use →
 * `ResolvedFilterRow[]`, one row per stored filter, each carrying
 * everything `SaveViewDialog` needs to render field label + resolved
 * value chips without touching a ULID. Resolution is display-only, same
 * footing as `filterToSummary`/`buildChips` — nothing here is persisted
 * or parsed back.
 *
 * Kept separate from `SaveViewDialog.tsx` so the resolution logic is
 * unit-testable without mounting the dialog (it needs no DOM, no
 * `useState`, no query client).
 */

/** One resolved value in a simple filter — a name, or a degraded chip. */
export interface ResolvedValue {
  readonly key: string;
  readonly label: string;
  /** LST-33-style degraded reference: the id names nothing live. */
  readonly dangling: boolean;
}

/** A `{kind:"simple"}` filter, resolved for display. */
export interface ResolvedSimpleRow {
  readonly kind: "simple";
  /** e.g. "Project", "Status", or the raw field token when unknown. */
  readonly fieldLabel: string;
  /** "is any of", "is not", "is empty", … */
  readonly opLabel: string;
  readonly valueless: boolean;
  readonly values: readonly ResolvedValue[];
}

/** A `{kind:"advanced"}` filter — shown as the user's own DSL text. */
export interface ResolvedAdvancedRow {
  readonly kind: "advanced";
  readonly query: string;
}

export type ResolvedFilterRow = ResolvedSimpleRow | ResolvedAdvancedRow;

/** The queryable field a facet maps to — mirrors `buildFilters.ts`. */
const FIELD_LABELS: Readonly<Record<string, string>> = {
  project: "Project",
  status: "Status",
  priority: "Priority",
  task_type: "Type",
  assignee: "Assignee",
  reporter: "Reporter",
  labels: "Label",
  milestone: "Milestone",
  sprint: "Sprint",
  title: "Title",
  text: "Any text",
};

/** The facet whose options resolve a field's values, when it has one. */
const FIELD_TO_FACET: Readonly<Record<string, keyof FacetOptions>> = {
  project: "project",
  status: "status",
  priority: "priority",
  task_type: "type",
  assignee: "assignee",
  reporter: "reporter",
  labels: "labels",
  milestone: "milestone",
  sprint: "sprint",
};

/** `fields.<key>` → the custom field's own label + values, from workflow. */
export interface CustomFieldLookup {
  readonly label: string;
  readonly values: readonly { readonly key: string; readonly label: string }[];
}

function fieldLabelFor(
  field: string,
  customFields: ReadonlyMap<string, CustomFieldLookup>,
): string {
  if (field in FIELD_LABELS) return FIELD_LABELS[field] ?? field;
  if (field.startsWith("fields.")) {
    const key = field.slice("fields.".length);
    return customFields.get(key)?.label ?? key;
  }
  // A field the current config no longer declares (removed custom field,
  // or a DSL-only token). The raw token is the only remaining handle on
  // it — shown as-is rather than invented text, same call as
  // `viewFilterFields.ts`'s `findField` miss.
  return field;
}

function resolveSimpleValues(
  filter: SimpleFilter,
  options: FacetOptions,
  customFields: ReadonlyMap<string, CustomFieldLookup>,
): readonly ResolvedValue[] {
  const facet = FIELD_TO_FACET[filter.field];
  if (facet !== undefined) {
    const opts = options[facet];
    return filter.values.map(v => {
      const hit = opts.find(o => o.value === v);
      return hit
        ? { key: v, label: hit.label, dangling: false }
        // No ULID surfaces even in the degraded case (P-4) — the chip's
        // own text says what is missing, not the id.
        : { key: v, label: `Deleted ${FIELD_LABELS[filter.field]?.toLowerCase() ?? "value"}`, dangling: true };
    });
  }
  if (filter.field.startsWith("fields.")) {
    const key = filter.field.slice("fields.".length);
    const cf = customFields.get(key);
    return filter.values.map(v => {
      const hit = cf?.values.find(o => o.key === v);
      return hit
        ? { key: v, label: hit.label, dangling: false }
        : { key: v, label: "Unknown value", dangling: true };
    });
  }
  // Free-text fields (title/text) or an unrecognised token: the value IS
  // the text the user is matching against, not a reference — show it
  // verbatim, never marked dangling (there is nothing to resolve).
  return filter.values.map(v => ({ key: v, label: v, dangling: false }));
}

/**
 * Resolve one stored filter into display-ready shape. `undefined`
 * facet/custom-field sources (still loading) are handled by the caller
 * passing whatever `FacetOptions`/`customFields` it currently has — a
 * value that has not loaded yet resolves the same as an unknown one
 * (shown degraded) until the source settles and the dialog re-renders;
 * "Save as view" is a short-lived dialog opened after the data the list
 * page already needed, so this window is not one that leaves a chip
 * stuck.
 */
export function resolveFilterRow(
  filter: Filter,
  options: FacetOptions,
  customFields: ReadonlyMap<string, CustomFieldLookup>,
): ResolvedFilterRow {
  if (filter.kind === "advanced") return { kind: "advanced", query: filter.query };
  const valueless = VALUELESS_OPS.has(filter.op);
  return {
    kind: "simple",
    fieldLabel: fieldLabelFor(filter.field, customFields),
    opLabel: OP_LABEL[filter.op] ?? filter.op,
    valueless,
    values: valueless ? [] : resolveSimpleValues(filter, options, customFields),
  };
}

export function resolveFilterRows(
  filters: readonly Filter[],
  options: FacetOptions,
  customFields: ReadonlyMap<string, CustomFieldLookup>,
): readonly ResolvedFilterRow[] {
  return filters.map(f => resolveFilterRow(f, options, customFields));
}

/** A sort spec's field, in the same vocabulary as the filter rows. */
export function sortFieldLabel(
  sort: QuerySort,
  customFields: ReadonlyMap<string, CustomFieldLookup>,
): string {
  return fieldLabelFor(sort.field, customFields);
}
