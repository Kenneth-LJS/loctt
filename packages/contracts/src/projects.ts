/**
 * A single project definition. A LocTT tracker can host multiple
 * projects, each with its own key prefix and counter. Tasks belong
 * to exactly one project (via `TaskFrontmatter.project`).
 *
 *  - `key` is the immutable internal identifier (slug).
 *  - `label` is the human display name; editable.
 *  - `prefix` is the task-key prefix (e.g. `BACKEND-`, `WEB-`);
 *    immutable after creation because changing it would require
 *    renaming every task in the project.
 */
export interface ProjectDef {
  readonly key: string;
  readonly label: string;
  readonly prefix: string;
  /**
   * Soft-delete flag. Archived projects are hidden from default
   * lists and pickers but remain valid references on existing
   * tasks. Hard-delete (with explicit remap) moves the counter to
   * `LocttState.retired_keys` and removes the entry.
   */
  readonly archived?: boolean;
}

/** The full projects.yaml shape. */
export interface ProjectsConfig {
  readonly projects: readonly ProjectDef[];
  /**
   * Optional workspace-level default project key. Used by
   * `loctt create` and the UI to pre-select a project when none
   * is specified.
   */
  readonly default?: string;
}
