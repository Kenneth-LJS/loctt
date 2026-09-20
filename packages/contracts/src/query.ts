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

/**
 * Structured query conditions for a saved view (Stage 1 of "saved views
 * store structured conditions").
 *
 * These schemas MIRROR core's `BuilderTree` / `QueryValue` / `ComparisonOp`
 * types (packages/core/src/query/builderTree.ts + parser.ts) exactly —
 * core OWNS the TypeScript types; contracts owns the runtime (zod) shape,
 * the same split as `SavedQuerySchema`/`SavedQuery`. If the core type
 * gains a node kind or value kind, these must gain the matching case.
 *
 * The tree is TOTAL over the query grammar: it can hold every construct
 * the parser accepts (`not`, `has_link`, `link_count`, date functions),
 * so a view's stored `conditions` losslessly captures its DSL and the
 * `query` string is derived from it.
 */

/** Mirrors core's `ComparisonOp`. */
export const ComparisonOpSchema = z.enum([
  "=", "!=", "<", "<=", ">", ">=", "~", "in", "not in",
  "is empty", "is not empty",
]);
export type ComparisonOp = z.infer<typeof ComparisonOpSchema>;

/** A signed offset for a date function — mirrors core's `DateOffset`. */
const DateOffsetSchema = z.object({
  sign: z.union([z.literal(1), z.literal(-1)]),
  n: z.number(),
  unit: z.enum(["d", "w", "m"]),
}).strict();

/**
 * A signed date-function offset — mirrors core's `DateOffset`.
 * Optionals carry `| undefined` to line up with `exactOptionalPropertyTypes`.
 */
export interface DateOffset {
  readonly sign: 1 | -1;
  readonly n: number;
  readonly unit: "d" | "w" | "m";
}

/**
 * Mirrors core's `QueryValue` discriminated union. Recursive (a `list`
 * holds `QueryValue`s), so the schema carries an explicit type annotation
 * and the type is declared by hand — core owns the canonical type; this is
 * its runtime mirror.
 */
export type QueryValue =
  | { type: "string"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string }
  | { type: "today" }
  | { type: "current_user" }
  | { type: "date_fn"; fn: DateFn; offset?: DateOffset | undefined }
  | { type: "list"; values: readonly QueryValue[] }
  | { type: "empty" };

/** The seven date functions — mirrors core's `DateFn`. */
export type DateFn =
  | "now" | "startOfDay" | "startOfWeek" | "startOfMonth"
  | "endOfDay" | "endOfWeek" | "endOfMonth";

export const QueryValueSchema: z.ZodType<QueryValue> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.object({ type: z.literal("string"), value: z.string() }).strict(),
    z.object({ type: z.literal("number"), value: z.number() }).strict(),
    z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
    z.object({ type: z.literal("date"), value: z.string() }).strict(),
    z.object({ type: z.literal("today") }).strict(),
    z.object({ type: z.literal("current_user") }).strict(),
    z.object({
      type: z.literal("date_fn"),
      fn: z.enum([
        "now", "startOfDay", "startOfWeek", "startOfMonth",
        "endOfDay", "endOfWeek", "endOfMonth",
      ]),
      offset: DateOffsetSchema.optional(),
    }).strict(),
    z.object({
      type: z.literal("list"),
      // A list holds scalars; nested lists never occur (the parser rejects
      // them), but the schema mirrors the recursive core type verbatim.
      values: z.array(QueryValueSchema),
    }).strict(),
    z.object({ type: z.literal("empty") }).strict(),
  ]),
);

/** Mirrors core's `LinkCountCall`. */
export const LinkCountCallSchema = z.object({
  name: z.literal("link_count"),
  kind: z.string().optional(),
}).strict();
export interface LinkCountCall {
  readonly name: "link_count";
  readonly kind?: string | undefined;
}

/**
 * Mirrors core's `BuilderTree`. Recursive via `z.lazy` on the `group`
 * children and the `not` child. The `has_link` relationship kind is
 * `linkKind` (not `kind`) because `kind` is the union discriminant — the
 * exact same field name as the core type.
 */
export type BuilderTree =
  | { kind: "group"; op: "and" | "or"; children: BuilderTree[] }
  | { kind: "not"; child: BuilderTree }
  | { kind: "has_link"; linkKind?: string | undefined; target?: string | undefined }
  | { kind: "leaf"; field: string; op: ComparisonOp; value: QueryValue; call?: LinkCountCall | undefined };

export const BuilderTreeSchema: z.ZodType<BuilderTree> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("group"),
      op: z.enum(["and", "or"]),
      children: z.array(BuilderTreeSchema),
    }).strict(),
    z.object({
      kind: z.literal("not"),
      child: BuilderTreeSchema,
    }).strict(),
    z.object({
      kind: z.literal("has_link"),
      linkKind: z.string().optional(),
      target: z.string().optional(),
    }).strict(),
    z.object({
      kind: z.literal("leaf"),
      field: z.string(),
      op: ComparisonOpSchema,
      value: QueryValueSchema,
      call: LinkCountCallSchema.optional(),
    }).strict(),
  ]),
);

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
  /**
   * The DSL string is a DERIVED field: it is regenerated from
   * `conditions` on every write by a spacing-only serializer and is never
   * independently trusted. It stays in the stored shape (and required) so
   * hand-reading `queries.yaml` and existing readers still work.
   */
  query: z.string().min(1),
  /**
   * The structured conditions the view filters by — the source of truth
   * the `query` string is derived from. Required (greenfield; no stored
   * data to migrate).
   */
  conditions: BuilderTreeSchema,
  sort: z.array(QuerySortSchema).optional(),
  display: SavedViewDisplaySchema.optional(),
  archived: z.boolean().optional(),
}).strict();
export type SavedQuery = z.infer<typeof SavedQuerySchema>;

/**
 * A saved view whose stored shape is valid (id/name/query all present)
 * but whose `query` string no longer parses — typically the result of a
 * hand edit to `queries.yaml`. Per north-star principle 5 (per-element
 * degradation), one such entry must not blank the whole catalog: the
 * loader keeps every good entry as a `SavedQuery` and records each bad
 * one here instead of throwing.
 *
 * `id`, `name` and `query` are the raw values from the file (they passed
 * schema validation; only the DSL failed). `error` is the parser's own
 * message and `position` the offending character offset when the parser
 * reported one — enough for a surface to mark the fault in place. `index`
 * is the entry's original position in the `queries:` array, so a message
 * can name `queries[N]` the way the fatal errors already do.
 *
 * `rawText` is the entry's full YAML (`renderRawText` = `stringifyYaml(raw)`),
 * carried so a write re-emits ALL of the entry's fields — `sort`, `display`,
 * `archived` and any field added later — not just `{id,name,query}`. This is
 * the same preservation mechanism the six object-shaped configs use via
 * `BrokenEntry.rawText` + `brokenEntriesToPlain`; without it an unrelated
 * `queries.yaml` write silently strips a broken sibling's optional fields
 * (Phase Z finding C2, the residual loss inside K28).
 *
 * This is only for per-ENTRY DSL failures. A whole-file YAML failure, a
 * missing `queries` array, a missing `id`/`name`/`query`, or a duplicate
 * id is object-fatal and still throws `QueriesConfigError`.
 */
export const BrokenSavedQuerySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  query: z.string().min(1),
  error: z.string().min(1),
  position: z.number().int().nonnegative().optional(),
  index: z.number().int().nonnegative(),
  rawText: z.string().min(1),
}).strict();
export type BrokenSavedQuery = z.infer<typeof BrokenSavedQuerySchema>;

/**
 * A saved view whose stored `conditions` block was ABSENT or malformed
 * but whose `query` still parses, so the loader DERIVED a fresh
 * `conditions` tree from the query on load rather than failing the entry.
 * The entry is otherwise a fully valid `SavedQuery` — it lives in
 * `QueriesConfig.queries` like any other; this record is only a load-time
 * diagnostic so a surface (and `loctt doctor`) can tell the user the view
 * was migrated and will self-heal on the next write.
 *
 * Predates the greenfield decision that `conditions` is required (A217–
 * A219): a `queries.yaml` written before that ruling has `query` but no
 * `conditions`. Deriving on load (rather than throwing) is the migration
 * path — the derived conditions persist the next time the file is written
 * (the serializer already emits `conditions`), so the file self-heals.
 *
 * `reason` says WHY it was migrated ("conditions missing" vs the zod
 * message when a `conditions` block was present but did not validate), and
 * `index` is the entry's original position in the `queries:` array, so a
 * message can name `queries[N]` the way the other diagnostics do.
 */
export const MigratedSavedQuerySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  reason: z.string().min(1),
  index: z.number().int().nonnegative(),
}).strict();
export type MigratedSavedQuery = z.infer<typeof MigratedSavedQuerySchema>;

export const QueriesConfigSchema = z.object({
  queries: z.array(SavedQuerySchema),
  /**
   * Per-entry DSL failures, if any. Omitted (not `[]`) when every entry
   * parsed, so existing consumers that read only `queries` are
   * unaffected and "no broken views" stays distinguishable from "did not
   * look". Never written back to disk — it is a load-time diagnostic.
   */
  broken: z.array(BrokenSavedQuerySchema).optional(),
  /**
   * Per-entry `conditions` migrations, if any — views whose `conditions`
   * were derived from their `query` on load because the stored block was
   * absent or malformed. These entries ARE in `queries` (valid, runnable);
   * this list is purely so `doctor`/a surface can report "migrated, will
   * persist on next write". Omitted (not `[]`) when nothing migrated, and
   * never written back to disk — the derived conditions are written as an
   * ordinary `conditions` block, so a re-load finds nothing to migrate.
   */
  migrated: z.array(MigratedSavedQuerySchema).optional(),
}).strict();
export type QueriesConfig = z.infer<typeof QueriesConfigSchema>;
