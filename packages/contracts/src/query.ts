import { z } from "zod";

/** Sort direction for query results. */
export const SortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

/** A single sort specifier in a saved query. */
export const QuerySortSchema = z.object({
  field: z.string().min(1),
  direction: SortDirectionSchema,
}).strict();
export type QuerySort = z.infer<typeof QuerySortSchema>;

/**
 * A saved query definition from queries.yaml.
 *
 * `id` is a stable unique identifier (ulid). User-pinned filters
 * and other surfaces reference views by this — `name` is just a
 * display label and can be renamed without breaking references.
 *
 * `archived` hides from default lists; the entry is still
 * runnable by id. Hard-delete removes it entirely.
 */
export const SavedQuerySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  query: z.string().min(1),
  sort: z.array(QuerySortSchema).optional(),
  archived: z.boolean().optional(),
}).strict();
export type SavedQuery = z.infer<typeof SavedQuerySchema>;

export const QueriesConfigSchema = z.object({
  queries: z.array(SavedQuerySchema),
}).strict();
export type QueriesConfig = z.infer<typeof QueriesConfigSchema>;
