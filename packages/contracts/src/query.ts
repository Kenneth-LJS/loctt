/** Sort direction for query results. */
export type SortDirection = "asc" | "desc";

/** A single sort specifier in a saved query. */
export interface QuerySort {
  readonly field: string;
  readonly direction: SortDirection;
}

/** A saved query definition from queries.yaml. */
export interface SavedQuery {
  /**
   * Stable unique identifier (ulid). User-pinned filters and other
   * surfaces reference views by this — `name` is just a display
   * label and can be renamed without breaking references.
   */
  readonly id: string;
  readonly name: string;
  readonly query: string;
  readonly sort?: readonly QuerySort[];
}

/** The full queries.yaml shape. */
export interface QueriesConfig {
  readonly queries: readonly SavedQuery[];
}
