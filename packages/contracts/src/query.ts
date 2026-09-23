import { z } from "zod";

import { EntityColorSchema } from "./color.js";
import { IconStringSchema, TimelineGroupingSchema, TimelineZoomSchema } from "./workflow.js";

/** Sort direction for query results. */
export const SortDirectionSchema = z.enum(["asc", "desc"]);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

/**
 * The archived-scope for any list of an archivable entity (K107) — tasks,
 * saved views, milestones, sprints, labels, projects, users. A first-class
 * scope, not a magic filter term:
 * - `active`   — hide archived (the DEFAULT everywhere, every call).
 * - `archived` — only archived.
 * - `all`      — both.
 *
 * String literals (not `boolean | "all"`) so the value is unambiguous
 * across JSON bodies, URL params, CLI flags, and stored view fields.
 */
export const ArchivedScopeSchema = z.enum(["active", "archived", "all"]);
export type ArchivedScope = z.infer<typeof ArchivedScopeSchema>;

/** The default scope — hide archived — applied when a caller passes none. */
export const DEFAULT_ARCHIVED_SCOPE: ArchivedScope = "active";

/** A single sort specifier in a saved query. */
export const QuerySortSchema = z.object({
  field: z.string().min(1),
  direction: SortDirectionSchema,
}).strict();
export type QuerySort = z.infer<typeof QuerySortSchema>;

/**
 * Query value/operator mirrors.
 *
 * These schemas MIRROR core's `QueryValue` / `ComparisonOp` types
 * (packages/core/src/query/parser.ts) exactly — core OWNS the TypeScript
 * types; contracts owns the runtime (zod) shape, the same split as
 * `SavedQuerySchema`/`SavedQuery`. If a core type gains a value kind,
 * these must gain the matching case.
 *
 * K102 removed the `BuilderTree` AST mirror that used to live here: a
 * saved view no longer stores a condition tree or a derived DSL string,
 * only its ordered `filters[]` (see `FilterSchema`). `ComparisonOp` and
 * `QueryValue` remain because a simple filter names an operator and the
 * evaluator still speaks these values.
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

/**
 * A single filter on a saved view (K102).
 *
 * A View is an ORDERED LIST of these, and every filter ANDs together. The
 * union is DISCRIMINATED — a "dumb" filter authored through the dropdown
 * picker and a query filter the human typed are genuinely different
 * stored shapes, not one shape with a flag:
 *
 *  - `simple`   — field + operator + value(s). Carries NO query string at
 *                 all, so it cannot degrade into one. A reopened view
 *                 renders it as the dropdown row because that is the only
 *                 thing it can render as.
 *  - `advanced` — the DSL string the human typed. Carries no field/op/
 *                 values.
 *
 * The kind is RECORDED, never inferred: there is no parse-and-guess step
 * on read, which is what makes "filters swap position / come back as DSL
 * text" structurally impossible rather than merely avoided. Array order is
 * the authored order, preserved on read and write.
 *
 * There is deliberately NO derived canonical `query` field on the view —
 * merging the list into one DSL is precisely what K102 removes. Execution
 * composes an AST in memory at call time and discards it.
 */
export const SimpleFilterSchema = z.object({
  kind: z.literal("simple"),
  field: z.string().min(1),
  op: ComparisonOpSchema,
  /**
   * The selected value(s). A multi-select picker yields several; a
   * single-value operator yields one. `is empty` / `is not empty` take
   * none, so the array may be empty for those.
   */
  values: z.array(z.string()),
}).strict();
export type SimpleFilter = z.infer<typeof SimpleFilterSchema>;

export const AdvancedFilterSchema = z.object({
  kind: z.literal("advanced"),
  /**
   * The DSL as authored, save for FORMATTING: on write it is parsed and
   * re-emitted, which normalises whitespace. Nothing semantic is touched —
   * no operator rewriting, no negation flipping, no value or term
   * reordering. Ken, K102: *"you may normalise spacing, dont edit anything
   * else."*
   *
   * Parentheses are KEPT as authored and ADDED where precedence needs
   * them: `(a or b)` at top level stays parenthesised, `((x))` keeps both
   * pairs, `a and (b or c)` is re-emitted intact, and an unwritten pair
   * appears only where the text would otherwise reparse to a different
   * tree. Ken, K102: *"i think we should store parens as needed to prevent
   * ambiguity or whatever, but if the user adds more parens for clarity,
   * we should keep."* The result is idempotent — re-saving a view does not
   * drift its text.
   */
  query: z.string().min(1),
}).strict();
export type AdvancedFilter = z.infer<typeof AdvancedFilterSchema>;

export const FilterSchema = z.discriminatedUnion("kind", [
  SimpleFilterSchema,
  AdvancedFilterSchema,
]);
export type Filter = z.infer<typeof FilterSchema>;

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
   * The view's filters, in authored order — the SOLE source of truth for
   * what it matches (K102). All filters AND together. Replaces the former
   * `query` + `conditions` pair: there is no derived canonical DSL, and
   * nothing reconstructs one. May be empty (a view that matches
   * everything within its archived scope).
   */
  filters: z.array(FilterSchema),
  sort: z.array(QuerySortSchema).optional(),
  display: SavedViewDisplaySchema.optional(),
  /**
   * The view's archived SCOPE (K107) — a property of the view, never a
   * filter term. Absent means the default (`active`).
   */
  archivedScope: ArchivedScopeSchema.optional(),
  /**
   * Optional icon (K104 supplies the picker; the field lands here).
   *
   * `IconStringSchema`, not a bare string: that is where the one-grapheme
   * rule lives (Ken, 2026-09-23 — an icon may not be two emoji or an
   * emoji glued to a letter), and a saved view's icon is authored through
   * the same picker and the same free-typed escape hatch as a status's.
   * Two schemas for one field is how the two drift apart.
   */
  icon: IconStringSchema.optional(),
  /**
   * Optional colour (K103's three shapes: bare hex, `{light,dark}`, or
   * `{palette: id}`).
   *
   * Ken, 2026-09-23: *"if icon and color, then yea. if only colour, then
   * only have the color picker"* — colour follows icon wherever both
   * exist. A saved view has an icon, so it gets a colour, and the web
   * dialog pairs them through `IconColorFields`, which carries the UI-14
   * rule: the colour applies ONLY to a Lucide glyph, because an emoji
   * carries its own colour and cannot be tinted.
   *
   * Field-local on corruption (the corruption guide's default): a colour
   * that does not match any of the three shapes is DROPPED on load so the
   * view still loads, runs and renders — exactly the MSL-22 precedent for
   * a label's colour. The view keeps its id, name and filters, which is
   * everything a reference needs; losing the whole view over a decorative
   * field would be destruction by another route. `doctor` reports the
   * dropped value so it is never silently lived with.
   */
  color: EntityColorSchema.optional(),
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
 * This is only for per-ENTRY filter failures. A whole-file YAML failure, a
 * missing `queries` array, a missing `id`/`name`, or a duplicate
 * id is object-fatal and still throws `QueriesConfigError`.
 */
export const BrokenSavedQuerySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /**
   * A human-readable rendering of whatever the entry held, so a surface
   * can still show what the view was trying to be. Best-effort and
   * display-only — a broken entry's filters did not validate, so this is
   * never parsed back. The authoritative bytes are in `rawText`.
   */
  summary: z.string(),
  error: z.string().min(1),
  position: z.number().int().nonnegative().optional(),
  index: z.number().int().nonnegative(),
  rawText: z.string().min(1),
}).strict();
export type BrokenSavedQuery = z.infer<typeof BrokenSavedQuerySchema>;

export const QueriesConfigSchema = z.object({
  queries: z.array(SavedQuerySchema),
  /**
   * Per-entry filter failures, if any. Omitted (not `[]`) when every entry
   * parsed, so existing consumers that read only `queries` are
   * unaffected and "no broken views" stays distinguishable from "did not
   * look". Never written back to disk — it is a load-time diagnostic.
   */
  broken: z.array(BrokenSavedQuerySchema).optional(),
}).strict();
export type QueriesConfig = z.infer<typeof QueriesConfigSchema>;
