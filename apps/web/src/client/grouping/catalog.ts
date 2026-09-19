import type { TimelineGrouping, WorkflowConfig } from "@loctt/contracts";

/**
 * The surface-neutral group-by catalog (Ken: full group-by set, via a
 * searchable picker).
 *
 * ## Why this is not under `timeline/`
 *
 * A group-by is not a timeline concept. The board already groups by
 * status, and the list will. What each surface *supports* differs, but
 * "which fields is a task groupable by, and what do they read as" is one
 * question with one answer per workspace — so it lives here, above any
 * single surface, and the timeline is merely its first caller. Putting
 * it under `timeline/` would be the drift CLAUDE.md names: a capability
 * shaped for one surface that the next surface then re-derives
 * differently. (When the board adopts it, `BoardGroupingSchema` should
 * be unified with `TimelineGroupingSchema` — recorded for a decisions.md
 * entry.)
 *
 * ## What is groupable (and what is not)
 *
 * Eight builtins, then every **single-value enum** custom field. Labels
 * and multi-value enum fields are excluded on purpose: a task carries
 * many of them at once, so grouping on one would place the task in N
 * bands and break TML-7's invariant that the total row count is
 * identical across every grouping. Non-enum custom fields (string /
 * number / date / boolean) are excluded because they have no closed set
 * of config-declared values to order bands by.
 */

/** A single groupable dimension, ready for the picker. */
export interface GroupEntry {
  /** The stored grouping value: a builtin key or `field.<key>`. */
  readonly id: TimelineGrouping;
  /** Human label for the trigger and the option row. */
  readonly label: string;
  /** Builtins read as one group; custom fields as another. */
  readonly group: "builtin" | "custom";
}

/**
 * The eight builtins, in fixed order with fixed labels. `none` leads —
 * it is the "flat" option, rendered by the picker as the clear row.
 */
export const BUILTIN_TIMELINE_GROUPINGS: readonly GroupEntry[] = [
  { id: "none", label: "None (flat)", group: "builtin" },
  { id: "project", label: "Project", group: "builtin" },
  { id: "milestone", label: "Milestone", group: "builtin" },
  { id: "sprint", label: "Sprint", group: "builtin" },
  { id: "assignee", label: "Assignee", group: "builtin" },
  { id: "status", label: "Status", group: "builtin" },
  { id: "priority", label: "Priority", group: "builtin" },
  { id: "task_type", label: "Type", group: "builtin" },
];

/**
 * Builds the full catalog for a workspace: the eight builtins, then the
 * eligible custom fields in `custom_fields` declaration order.
 *
 * A custom field is eligible when it is a **single-value enum with at
 * least one value** — `type === "enum" && multi === false && values`
 * non-empty. Everything else (labels are not a custom field at all;
 * multi enums; string/number/date/boolean fields) is dropped.
 *
 * Pure: no I/O, no memoisation. Callers memoise on `workflow`.
 */
export function buildGroupingCatalog(
  workflow: WorkflowConfig | undefined,
): readonly GroupEntry[] {
  const custom: GroupEntry[] = [];
  for (const def of workflow?.custom_fields ?? []) {
    if (def.type !== "enum") continue;
    if (def.multi !== false) continue;
    if ((def.values?.length ?? 0) === 0) continue;
    custom.push({ id: `field.${def.key}`, label: def.label, group: "custom" });
  }
  return [...BUILTIN_TIMELINE_GROUPINGS, ...custom];
}

/** Whether `id` is a grouping the given catalog offers. */
export function isValidGrouping(
  id: string,
  catalog: readonly GroupEntry[],
): id is TimelineGrouping {
  return catalog.some(e => e.id === id);
}

/**
 * The label for a grouping id, or the id itself when the catalog does
 * not offer it (a dangling `field.<key>` the caller still wants to name
 * in a notice).
 */
export function groupingLabel(
  id: string,
  catalog: readonly GroupEntry[],
): string {
  return catalog.find(e => e.id === id)?.label ?? id;
}
