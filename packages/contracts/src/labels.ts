/**
 * A single label definition. Labels live in `.loctt/config/labels.yaml`
 * and are referenced by their `key` from a task's `labels` array.
 *
 *  - `key` is immutable.
 *  - `label` is the human display name; editable.
 *  - `color` is an optional hex string (e.g. "#1e6fcb").
 */
export interface LabelDef {
  readonly key: string;
  readonly label: string;
  readonly color?: string;
}

/** The full labels.yaml shape. */
export interface LabelsConfig {
  readonly labels: readonly LabelDef[];
}
