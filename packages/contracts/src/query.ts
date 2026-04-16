/** Sort direction for query results. */
export type SortDirection = "asc" | "desc";

/** A single sort specifier in a saved query. */
export interface QuerySort {
  readonly field: string;
  readonly direction: SortDirection;
}

/** A saved query definition from queries.yaml. */
export interface SavedQuery {
  readonly name: string;
  readonly query: string;
  readonly sort?: readonly QuerySort[];
}

/** The full queries.yaml shape. */
export interface QueriesConfig {
  readonly queries: readonly SavedQuery[];
}
