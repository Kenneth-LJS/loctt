/**
 * A single milestone definition. Milestones are named checkpoints
 * with an optional target date — release markers, not time boxes.
 *
 *  - `key` is immutable.
 *  - `label` is the human display name; editable.
 *  - `target_date` is an optional ISO date (YYYY-MM-DD).
 *  - `archived` hides milestones from pickers without breaking
 *    historical task references.
 */
export interface MilestoneDef {
  readonly key: string;
  readonly label: string;
  readonly target_date?: string;
  readonly archived?: boolean;
}

/** The full milestones.yaml shape. */
export interface MilestonesConfig {
  readonly milestones: readonly MilestoneDef[];
}
