/**
 * A single sprint definition. Watered-down per the design doc:
 * tasks belong to zero or one sprint via `TaskFrontmatter.sprint`,
 * `state` is just a field the user edits (no start/complete
 * lifecycle ceremony), and there's no carryover.
 *
 *  - `key` is immutable.
 *  - `label` is the human display name.
 *  - `start_date` / `end_date` define the sprint window
 *    (YYYY-MM-DD).
 *  - `state` is one of `active` / `completed` / `future`.
 *  - `goal` is an optional free-text note.
 */
export type SprintState = "active" | "completed" | "future";

export interface SprintDef {
  readonly key: string;
  readonly label: string;
  readonly start_date: string;
  readonly end_date: string;
  readonly state: SprintState;
  readonly goal?: string;
  /**
   * Soft-delete flag. Archived sprints are hidden from default
   * lists and pickers but remain valid references on existing
   * tasks. Hard-delete (with explicit remap) removes the entry.
   */
  readonly archived?: boolean;
}

/** The full sprints.yaml shape. */
export interface SprintsConfig {
  readonly sprints: readonly SprintDef[];
}
