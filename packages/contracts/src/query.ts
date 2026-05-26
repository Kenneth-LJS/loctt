import { z } from "zod";

import { TimelineGroupingSchema, TimelineZoomSchema } from "./workflow.js";

/** Sort direction for query results. */
export const SortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

/** A single sort specifier in a saved query. */
export const QuerySortSchema = z.object({
  field: z.string().min(1),
  direction: SortDirectionSchema,
}).strict();
export type QuerySort = z.infer<typeof QuerySortSchema>;

/** Which top-level view a saved query is authored for. */
export const SavedViewModeSchema = z.enum(["list", "board", "timeline"]);
export type SavedViewMode = z.infer<typeof SavedViewModeSchema>;

/** Board grouping options for board-mode saved views. */
export const BoardGroupingSchema = z.enum(["none", "assignee", "priority", "task_type", "project", "milestone", "sprint", "label", "status_category"]);
export type BoardGrouping = z.infer<typeof BoardGroupingSchema>;

/**
 * Optional per-view display config. Each field overrides the
 * workspace-level default (`workflow.timeline.*` for timeline fields)
 * or the user's UI prefs (column visibility/order).
 *
 * Every field is optional; omit any to fall back to the next layer.
 * UI consumers resolve in order: view.display → workspace defaults
 * → built-in defaults.
 */
export const SavedViewDisplaySchema = z.object({
  mode: SavedViewModeSchema.optional(),
  // List-mode columns: ordered, visibility implied by presence.
  columns: z.array(z.string().min(1)).optional(),
  // Board-mode grouping.
  group_by: BoardGroupingSchema.optional(),
  // Timeline-mode fields (mirror workflow.timeline.*).
  zoom: TimelineZoomSchema.optional(),
  grouping: TimelineGroupingSchema.optional(),
  show_arrows: z.boolean().optional(),
}).strict();
export type SavedViewDisplay = z.infer<typeof SavedViewDisplaySchema>;

/**
 * A saved query definition from queries.yaml.
 *
 * `id` is a stable unique identifier (ulid). User-pinned filters
 * and other surfaces reference views by this — `name` is just a
 * display label and can be renamed without breaking references.
 *
 * `display` is optional UI configuration the view was authored for
 * (list columns / board grouping / timeline zoom). When absent, the
 * UI falls back to workspace defaults.
 *
 * `archived` hides from default lists; the entry is still
 * runnable by id. Hard-delete removes it entirely.
 */
export const SavedQuerySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  query: z.string().min(1),
  sort: z.array(QuerySortSchema).optional(),
  display: SavedViewDisplaySchema.optional(),
  archived: z.boolean().optional(),
}).strict();
export type SavedQuery = z.infer<typeof SavedQuerySchema>;

export const QueriesConfigSchema = z.object({
  queries: z.array(SavedQuerySchema),
}).strict();
export type QueriesConfig = z.infer<typeof QueriesConfigSchema>;
