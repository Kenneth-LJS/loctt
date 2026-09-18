import type { WorkflowConfig } from "@loctt/contracts";

/**
 * The shape of the Estimate control for the configured estimation mode
 * (SET-9, TSK-9), decided from `workflow.estimation` alone.
 *
 * SET-9 requires the field to look the same *everywhere it appears* —
 * task detail, the create modal, and (as a column) the list. Rather than
 * each surface re-reading `estimation.unit` and risking divergence, they
 * all call {@link estimationShape} and render from its answer:
 *
 *  - `null` — estimation is absent or disabled. No control, no column,
 *    no row (SET-9's first bullet: nothing appears anywhere).
 *  - `{ kind: "enum", options }` — a select constrained to the declared
 *    `preset_values`; a free-text box would let a value outside the scale
 *    reach the file, which defeats declaring a scale.
 *  - `{ kind: "numeric", suffix }` — a number input suffixed with the
 *    unit label. `unit_label` is required for `custom_numeric` and absent
 *    for the built-in units, whose own names read correctly as the suffix
 *    ("5 points").
 */
export type EstimationShape =
  | { readonly kind: "enum"; readonly options: readonly string[] }
  | { readonly kind: "numeric"; readonly suffix: string };

export function estimationShape(
  workflow: WorkflowConfig | undefined,
): EstimationShape | null {
  const est = workflow?.estimation;
  if (est === undefined || !est.enabled) return null;

  if (est.unit === "custom_enum") {
    return { kind: "enum", options: (est.preset_values ?? []).map(v => String(v)) };
  }
  return { kind: "numeric", suffix: est.unit_label ?? est.unit };
}
