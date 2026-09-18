import { z } from "zod";


/**
 * Date-or-timestamp string. Frontmatter date fields can be authored
 * either as `YYYY-MM-DD` (date only) or as a full ISO-8601 timestamp.
 * YAML's auto-Date coercion lands on the latter; this brand accepts
 * both forms and surfaces a clearer error than `string` would.
 */
const DateOrIsoString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    "must be YYYY-MM-DD or full ISO-8601 timestamp",
  );

/**
 * Full ISO-8601 timestamp. Used for `created_at` / `updated_at` /
 * `status_updated_at` / `archived_at` — fields the system writes,
 * never date-only.
 */
const IsoTimestamp = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
    "must be a full ISO-8601 timestamp",
  );

/** A single relationship edge stored in task frontmatter. */
export const TaskRelationshipSchema = z.object({
  type: z.string().min(1),
  target: z.string().min(1),
  /**
   * Lexorank string used to order the targets of a single
   * relationship type within one source task. Only set when the
   * relationship type is configured as `ranked: true` in the
   * workflow. Tasks without rank sort below ranked ones.
   */
  rank: z.string().min(1).optional(),
}).strict();
export type TaskRelationship = z.infer<typeof TaskRelationshipSchema>;

/**
 * Task frontmatter — the structured metadata stored in task.md
 * YAML. The schema is intentionally lenient on optional fields:
 * narrow types are enforced where possible, but `fields:` accepts
 * any object so custom-field shapes aren't rejected before
 * `validateTaskAgainstWorkflow` gets a chance to inspect them.
 */
export const TaskFrontmatterSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  project: z.string().min(1).optional(),
  // K26: the object-fatal fatal set is `{id, key}` only — the fields
  // needed to *address* a task. `title` and the two required timestamps
  // are field-LOCAL: a task with a broken title or timestamp loads in a
  // degraded state (the bad field set aside in `health`) rather than
  // becoming unreadable. They are therefore optional in the type; a
  // corrupt value is dropped to `undefined` here and carried in `health`.
  title: z.string().min(1).optional(),
  created_at: IsoTimestamp.optional(),
  updated_at: IsoTimestamp.optional(),
  status: z.string().optional(),
  status_updated_at: IsoTimestamp.optional(),
  task_type: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(z.string().min(1)).optional(),
  assignee: z.string().optional(),
  reporter: z.string().optional(),
  start_date: DateOrIsoString.optional(),
  due_date: DateOrIsoString.optional(),
  estimate: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  /**
   * Auto-managed: set when status moves into a `completed`-category
   * status; cleared when moved out. Not user-editable.
   */
  completed_date: DateOrIsoString.optional(),
  milestone: z.string().min(1).optional(),
  sprint: z.string().min(1).optional(),
  archived: z.boolean().optional(),
  archived_at: IsoTimestamp.optional(),
  relationships: z.array(TaskRelationshipSchema).optional(),
  // : an empty string in key_history becomes an empty entry in
  // the key index, which P-7 relies on to keep old keys resolving. A
  // lookup for "" is not a lookup anyone makes, but the entry shadows
  // nothing and the index silently grows a row that can never match.
  key_history: z.array(z.string().min(1)).optional(),
  // Custom field values are user-defined and shape-varying per workflow
  // config; semantic validation runs in core (validateTaskAgainstWorkflow)
  // against the field's `type`, not at the contract layer.
  fields: z.record(z.string(), z.unknown()).optional(),
  /**
   * Lexorank string for manual drag-reorder within a board column.
   * Independent from relationship rank. Cards without `board_rank`
   * sort below ranked ones, fallback to created.
   *
   * "Within a board column" became true with K8. It was aspirational
   * before: core scoped the rank per *status*, so on a board whose
   * `boards` block collapsed several statuses into one column, the
   * ordering the board drew was one the write path would not produce.
   * Each column is now its own sequence, and ranks are only ever
   * compared within one — which is why two columns' first cards
   * legitimately share the value `"u"`, and why comparing ranks
   * across columns means nothing.
   */
  board_rank: z.string().optional(),
  // .passthrough(): unknown frontmatter keys are preserved on
  // round-trip rather than dropped. Authors may attach experimental
  // or tool-specific metadata; semantic checks live in core, and
  // discarding here would silently destroy that data.
}).passthrough();
export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

/**
 * The kind of a field-level health problem. Named by *what a reader or
 * writer can do about it*, not by cause (proposal § 2). The first three
 * are **intrinsic** — decided by parsing the file against the schema,
 * with no config. The last two are **extrinsic** — decided against the
 * workflow/aux configs and the rest of the tracker (`classifyTaskHealth`).
 */
export type FieldHealthKind =
  | "wrong_type"        // a schema-known field whose value fails its type/format
  | "missing_required"  // a required field (title/created_at/updated_at) absent or null
  | "unrecognised"      // a top-level key the schema does not declare
  | "invalid_value"     // right type, but the value the workflow does not define
  | "dangling";         // a reference whose target does not exist

/**
 * One field-level health finding on a task (proposal § 4.2). Replaces the
 * Phase-7-spike `FieldCorruption`.
 *
 * Modelled on `BrokenSavedQuery` (VUE-22): a per-element degradation
 * marker, not a thrown error. The corrupt field is NOT in `frontmatter`
 * (a healthy object holds only healthy values); its raw stored value
 * lives here in `raw` so a tolerant write round-trips it (north-star
 * principle 5/7: one bad field must not blank or rewrite the whole
 * object), and the validator's message is carried so a surface can
 * explain the fault and offer repair.
 *
 * Object-fatal violations (a missing/blank `id`/`key`, a YAML syntax
 * error) are NOT field-health findings — they still throw, because the
 * object has no stable identity to degrade around (K26).
 */
export interface FieldHealth {
  /** Path as the validator reports it: "due_date", "labels[2]", "fields.points", "relationships[1].target". */
  readonly field: string;
  readonly kind: FieldHealthKind;
  /** The stored value, JSON-safe (YAML Dates are already ISO strings via coerceFrontmatter). */
  readonly raw: unknown;
  /** One-line YAML rendering of `raw`, computed in core so all three surfaces print the same string. */
  readonly rawText: string;
  /** The validator's message — what was expected. */
  readonly error: string;
  /** What the user may do: set a valid value, remove the field, or both. */
  readonly repair: "set" | "remove" | "set_or_remove";
}

/** A full task: frontmatter + markdown body. */
export interface Task {
  readonly frontmatter: TaskFrontmatter;   // HEALTHY fields only
  readonly body: string;
  /**
   * Field-level health findings gathered while loading (intrinsic) and,
   * where configs are available, against the workflow/tracker
   * (extrinsic). Omitted (not `[]`) when clean — same convention as
   * `QueriesConfig.broken`. The corrupt fields are NOT in `frontmatter`;
   * a surface renders them from `health`, using `rawText` for display.
   */
  readonly health?: readonly FieldHealth[];
}

/**
 * Public projection of `TaskFrontmatterSchema` for API responses.
 *
 * The disk-level schema is `.passthrough()` so authors can attach
 * experimental or tool-specific metadata to a task.md without it
 * being silently dropped on round-trip. Public HTTP responses use
 * this projection instead so the response shape stays a stable
 * contract — unknown top-level keys on disk are *kept on disk*
 * (passthrough at parse / serialize time) but *not echoed* to API
 * clients as if they were canonical fields.
 *
 * Custom-field values declared in workflow.yaml live under the
 * `fields` map; they are part of the contract because their shape
 * is governed by the workflow config, not by individual files.
 *
 * Use `projectTaskFrontmatter()` (below) to apply this schema —
 * .parse() drops anything not listed here.
 */
export const TaskFrontmatterPublicSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  project: z.string().min(1).optional(),
  // K26: field-local, so optional here too. When one of these is corrupt
  // it is absent from `frontmatter` (the value lives in `health`), so the
  // public projection must accept its absence rather than throwing.
  title: z.string().min(1).optional(),
  created_at: IsoTimestamp.optional(),
  updated_at: IsoTimestamp.optional(),
  status: z.string().optional(),
  status_updated_at: IsoTimestamp.optional(),
  task_type: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(z.string().min(1)).optional(),
  assignee: z.string().optional(),
  reporter: z.string().optional(),
  start_date: DateOrIsoString.optional(),
  due_date: DateOrIsoString.optional(),
  estimate: z.union([z.string(), z.number()]).transform(v => String(v)).optional(),
  completed_date: DateOrIsoString.optional(),
  milestone: z.string().min(1).optional(),
  sprint: z.string().min(1).optional(),
  archived: z.boolean().optional(),
  archived_at: IsoTimestamp.optional(),
  relationships: z.array(TaskRelationshipSchema).optional(),
  // : an empty string in key_history becomes an empty entry in
  // the key index, which P-7 relies on to keep old keys resolving. A
  // lookup for "" is not a lookup anyone makes, but the entry shadows
  // nothing and the index silently grows a row that can never match.
  key_history: z.array(z.string().min(1)).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  board_rank: z.string().optional(),
}).strict();
export type TaskFrontmatterPublic = z.infer<typeof TaskFrontmatterPublicSchema>;

/**
 * Projects a frontmatter object to the public API shape. Strips
 * any unknown top-level keys that may have come from passthrough
 * parsing of an on-disk task.md. Throws if a known field fails
 * validation — that's a sign of corruption, not user error.
 */
export function projectTaskFrontmatter(fm: TaskFrontmatter): TaskFrontmatterPublic {
  // Build a shallow object containing only the public keys, then
  // parse to apply the schema's transforms (e.g. `estimate` →
  // string). Using `.parse()` rather than `.strip()` so we get
  // the typed result.
  // Derived from the schema, not written out beside it. The list was
  // hand-maintained, so a field added to
  // `TaskFrontmatterPublicSchema` and forgotten here was silently
  // dropped from every public projection — the CLI's JSON, the MCP
  // tools' output and the web API all — with no error anywhere. The
  // schema is the single place a public field is declared.
  const out: Record<string, unknown> = {};
  const src = fm as unknown as Record<string, unknown>;
  for (const k of Object.keys(TaskFrontmatterPublicSchema.shape)) {
    if (src[k] !== undefined) out[k] = src[k];
  }
  return TaskFrontmatterPublicSchema.parse(out);
}

/**
 * Whether the list can sort by `field`.
 *
 * Shared by the server (which builds the comparator) and the client
 * (which decides whether a `?sort=` in the URL was honoured). Two
 * copies of this drifted once already: the client kept a hand-written
 * list of its nine visible columns, so a URL sorting by `created_at`,
 * `reporter` or a custom `fields.*` key — all of which the server
 * honours — was silently stripped from the address bar and the
 * ordering lost.
 *
 * The schema is the authority precisely because it cannot rot: a
 * field added to `TaskFrontmatterSchema` becomes sortable on both
 * sides at once.
 */
export function isSortableTaskField(field: string): boolean {
  // Custom fields are per-workspace, so they are carried by shape
  // rather than by name.
  if (field.startsWith("fields.")) return field.length > "fields.".length;
  return Object.prototype.hasOwnProperty.call(TaskFrontmatterSchema.shape, field);
}
