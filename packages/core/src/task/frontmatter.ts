import type { FieldHealth, FieldHealthKind, Task, TaskFrontmatter } from "@loctt/contracts";
import { TaskFrontmatterSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { formatZodIssues } from "../config/zod-error.js";
import { errnoReasonWithoutPath } from "../utils/fs-errors.js";
import { toMutable } from "./mutable.js";

/**
 * Frontmatter keys the schema knows about, derived from
 * `TaskFrontmatterSchema.shape` so this list can't drift if a new
 * field is added to the schema. Used by `serializeFrontmatter` to
 * detect unknown keys (kept around because the schema uses
 * `.passthrough()`) so they can be re-emitted verbatim.
 */
const KNOWN_FRONTMATTER_KEYS: ReadonlySet<string> = new Set(
  Object.keys(TaskFrontmatterSchema.shape),
);

export class TaskParseError extends Error {
  /** The task.md this came from, when the reader knew it. */
  readonly path: string | undefined;
  /**
   * The parse failure without the file name. An aggregator that
   * already prints `path: reason` uses this, so the path is not said
   * twice; `message` leads with the path for a direct throw (A348).
   */
  readonly reason: string;

  constructor(message: string, opts: { path?: string; cause?: unknown } = {}) {
    super(
      opts.path !== undefined ? `${opts.path} is not valid: ${message}` : message,
      opts.cause !== undefined ? { cause: opts.cause } : undefined,
    );
    this.name = "TaskParseError";
    this.path = opts.path;
    this.reason = message;
  }

  /**
   * The reason to print beside a path the caller already names: the
   * unwrapped parse failure for a `TaskParseError`, the message for
   * anything else.
   */
  static reasonOf(err: unknown): string {
    if (err instanceof TaskParseError) return err.reason;
    // A read failure (EACCES, EISDIR…) embeds the path in Node's own
    // message; drop it so `path: reason` names the file once (A350).
    const errno = errnoReasonWithoutPath(err);
    if (errno !== undefined) return errno;
    return err instanceof Error ? err.message : String(err);
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Splits a task.md file into raw frontmatter YAML and markdown body.
 * Throws if the file doesn't start with valid frontmatter delimiters.
 */
export function splitTaskFile(content: string): { rawYaml: string; body: string } {
  const match = FRONTMATTER_RE.exec(content);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new TaskParseError("task.md must start with YAML frontmatter delimited by ---");
  }
  return { rawYaml: match[1], body: match[2] };
}

/**
 * Required frontmatter fields. A `null` value for one of these is
 * a real error (use of YAML `~` to "clear" a required field), so
 * we keep the null and let zod surface "expected string" rather
 * than the misleading "title is required".
 *
 * `title`/`created_at`/`updated_at` are required-but-degradable (K26):
 * a null/absent/wrong-typed value is field-local (`missing_required` or
 * `wrong_type` in `health`), not object-fatal. Only `id`/`key` are
 * object-fatal — see {@link FATAL_IDENTITY_FIELDS}.
 */
const REQUIRED_FRONTMATTER_FIELDS = new Set([
  "id",
  "key",
  "title",
  "created_at",
  "updated_at",
]);

/**
 * The object-fatal identity set (K26). A wrong-typed / absent value in
 * one of these makes the whole task object-fatal — there is no coherent
 * object to degrade around because the task cannot be *addressed*.
 * Everything else (including `title`/`created_at`/`updated_at` and the
 * structural fields `relationships`/`fields`/`labels`/`key_history`,
 * A135) is field-local: the value is lifted into `health` and the rest
 * of the task loads.
 */
const FATAL_IDENTITY_FIELDS: ReadonlySet<string> = new Set(["id", "key"]);

/**
 * Required fields that degrade rather than fatalling (K26). A missing or
 * null value for one of these is a `missing_required` health finding;
 * a present-but-wrong-typed value is `wrong_type`.
 */
const DEGRADABLE_REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "created_at",
  "updated_at",
]);

/**
 * Coerces YAML's quirky parsing (Date instances, empty
 * frontmatter, etc.) into the shape that TaskFrontmatterSchema
 * expects. Specifically: Date → ISO string. We don't trim
 * `created_at`/`updated_at` to YYYY-MM-DD because they're
 * timestamps, not calendar dates.
 */
function coerceFrontmatter(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    // YAML's `~` / explicit `null` is treated as "field absent"
    // for optional fields — drop the key so zod's optional()
    // accepts it. For required fields we keep the null so zod
    // produces a "must be a string" error rather than the
    // misleading "field is required".
    if (v === null) {
      if (REQUIRED_FRONTMATTER_FIELDS.has(k)) {
        out[k] = null;
      }
      continue;
    }
    if (v instanceof Date) {
      // Date-only fields land as YYYY-MM-DD; full timestamps stay
      // as ISO. We can't tell which from yaml alone, so produce
      // ISO and let downstream code accept the slim form when
      // needed (the schema uses z.string()).
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * One-line YAML rendering of a raw stored value, computed in core so
 * every surface (`loctt show`, `get_task`, the web UI) prints the same
 * string for a corrupt field (proposal § 4.2, `FieldHealth.rawText`).
 */
export function renderRawText(raw: unknown): string {
  if (raw === undefined) return "";
  try {
    // `lineWidth: 0` disables wrapping; trim the trailing newline
    // stringifyYaml appends.
    return stringifyYaml(raw, { lineWidth: 0 }).replace(/\n$/, "");
  } catch {
    // Last resort for a value stringifyYaml cannot render — a JSON form
    // rather than `[object Object]`.
    try {
      return JSON.stringify(raw) ?? "";
    } catch {
      return "";
    }
  }
}

/**
 * Builds a `FieldHealth` entry from an intrinsic (schema) fault.
 *
 * Kind and repair follow proposal § 6/§ 7.3:
 *   - a degradable *required* field that is null/absent → `missing_required`
 *     (repair: `set` — there is nothing to remove);
 *   - any other schema-known field with a wrong-typed value → `wrong_type`
 *     (repair: `set_or_remove`).
 */
function intrinsicHealth(field: string, raw: unknown, error: string): FieldHealth {
  const missing =
    DEGRADABLE_REQUIRED_FIELDS.has(field) && (raw === null || raw === undefined);
  const kind: FieldHealthKind = missing ? "missing_required" : "wrong_type";
  const repair: FieldHealth["repair"] = missing ? "set" : "set_or_remove";
  return { field, kind, raw, rawText: renderRawText(raw), error, repair };
}

/**
 * Parses raw YAML frontmatter tolerantly (proposal § 4.3).
 *
 * `frontmatter` holds only the fields that passed the schema; `health`
 * names every field that did not, with its raw stored value and the
 * reason. A clean task takes the strict fast path and returns an empty
 * `health`, so the tolerant path costs the common case nothing.
 *
 * Object-fatal cases still throw `TaskParseError`, unchanged, so
 * `lookup.ts`'s attribution to `UnreadableTaskError` keeps working:
 *   - a YAML *syntax* error (unclosed quote, etc.) — wrapped here so
 *     `lookupByKey` has one class to branch on (TSK-54);
 *   - a bad `id` or `key` — the fields needed to *address* the task (K26);
 *   - a remainder that still fails after lifting the corrupt fields out
 *     (fail closed rather than half-degrade).
 *
 * The message is passed through verbatim: it names the YAML line and
 * column, which is what P-4 wants and what makes the surface actionable.
 */
export function parseFrontmatter(
  rawYaml: string,
): { frontmatter: TaskFrontmatter; health: FieldHealth[] } {
  let raw: unknown;
  try {
    raw = coerceFrontmatter(parseYaml(rawYaml));
  } catch (err) {
    throw new TaskParseError(err instanceof Error ? err.message : String(err));
  }

  // Strict fast path: a clean task pays nothing and carries no health.
  const strict = TaskFrontmatterSchema.safeParse(raw);
  const rawObj = (raw !== null && typeof raw === "object" && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : undefined;

  // Unrecognised top-level keys: the schema is `.passthrough()`, so they
  // are NOT Zod issues. Split them out by hand — they move into `health`
  // (kind `unrecognised`) rather than staying on `frontmatter` (§ 4.3
  // change 3), so a healthy object contains exactly the schema's keys.
  const unrecognised: FieldHealth[] = [];
  if (rawObj !== undefined) {
    for (const [k, v] of Object.entries(rawObj)) {
      if (!KNOWN_FRONTMATTER_KEYS.has(k)) {
        unrecognised.push({
          field: k,
          kind: "unrecognised",
          raw: v,
          rawText: renderRawText(v),
          error: "LocTT has no type for this key",
          repair: "remove",
        });
      }
    }
  }

  // A degradable-required field (title/created_at/updated_at, K26) that
  // is simply ABSENT produces no Zod issue now that the field is
  // optional, so detect it here and record `missing_required`. A `null`
  // value (YAML `~`) is a Zod issue instead and is handled below via
  // `intrinsicHealth` (which maps null-on-required to missing_required).
  const missingRequired: FieldHealth[] = [];
  for (const field of DEGRADABLE_REQUIRED_FIELDS) {
    if (rawObj === undefined || !(field in rawObj)) {
      missingRequired.push({
        field,
        kind: "missing_required",
        raw: undefined,
        rawText: "",
        error: `${field} is required but absent`,
        repair: "set",
      });
    }
  }

  if (strict.success) {
    // `.passthrough()` keeps unrecognised keys on `strict.data`; strip
    // them so `frontmatter` holds only schema keys (they travel in
    // `health`). The serializer re-emits them from `health`.
    const fm = stripUnrecognised(strict.data, unrecognised);
    return { frontmatter: fm, health: [...unrecognised, ...missingRequired] };
  }

  // Collect the set of top-level keys with schema issues.
  const issues = strict.error.issues;
  const faultKeys = new Set(
    issues
      .map(i => i.path[0])
      .filter((k): k is string => typeof k === "string"),
  );

  // Object-fatal: a fault on `id`/`key` means the task cannot be
  // addressed (K26). Fail exactly as the old strict parse did.
  for (const k of faultKeys) {
    if (FATAL_IDENTITY_FIELDS.has(k)) {
      throw new TaskParseError(formatZodIssues("frontmatter", strict.error));
    }
  }
  // A deep issue (path length > 1, e.g. inside `relationships`) whose
  // top-level key is identity is caught above; any other deep issue is
  // handled by lifting its top-level key.

  // Lift every faulting top-level key out, reparse the remainder. If the
  // remainder still fails, the object is fatal (fail closed).
  const source = rawObj ?? {};
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (!faultKeys.has(k) && KNOWN_FRONTMATTER_KEYS.has(k)) cleaned[k] = v;
    else if (!faultKeys.has(k) && !KNOWN_FRONTMATTER_KEYS.has(k)) {
      // Unrecognised key: already lifted into `health` above; drop here.
    }
  }
  const reparsed = TaskFrontmatterSchema.safeParse(cleaned);
  if (!reparsed.success) {
    throw new TaskParseError(formatZodIssues("frontmatter", reparsed.error));
  }

  // Build the health list for the faulting schema keys, plus any
  // absent-required fields (dedup by field: a null-valued required field
  // is a fault key, so it is not also in missingRequired).
  const health: FieldHealth[] = [...unrecognised];
  for (const field of faultKeys) {
    const raw_ = source[field];
    const issue = issues.find(i => i.path[0] === field);
    health.push(intrinsicHealth(field, raw_, issue?.message ?? "value has the wrong type"));
  }
  for (const m of missingRequired) {
    if (!faultKeys.has(m.field)) health.push(m);
  }

  return { frontmatter: reparsed.data, health };
}

/**
 * Returns a copy of a parsed frontmatter with the unrecognised keys
 * removed, so `frontmatter` holds only schema-declared keys. The
 * unrecognised values are preserved in the passed `health` list and
 * re-emitted by `serializeFrontmatter`.
 */
function stripUnrecognised(
  fm: TaskFrontmatter,
  unrecognised: readonly FieldHealth[],
): TaskFrontmatter {
  if (unrecognised.length === 0) return fm;
  const copy = toMutable(fm);
  for (const u of unrecognised) delete copy[u.field];
  return copy as unknown as TaskFrontmatter;
}

/**
 * Serializes a TaskFrontmatter to YAML string (without --- delimiters).
 *
 * Field ordering: required identity first, then state, then dates,
 * then arrays/maps. Unknown keys (kept around because the schema
 * uses `.passthrough()`) are emitted last in their original order.
 * This means `parse → serialize` is round-trip-stable even for
 * frontmatter with experimental or plugin-defined fields the
 * schema hasn't enumerated.
 *
 * `health` (proposal § 4.4): each health entry's raw stored value is
 * re-emitted under its `field` **unless `fm` now has that key** —
 * override-on-direct-write wins. A degraded field lives only in `health`
 * (it was lifted off `frontmatter` at parse time), so without this
 * argument the write would drop it. Known fields go at their canonical
 * slot; unrecognised ones last, exactly where the passthrough loop puts
 * them. This is what preserves the value of a corrupt or unrecognised
 * field across a write to another field (north-star P5/P7).
 */
export function serializeFrontmatter(
  fm: TaskFrontmatter,
  health?: readonly FieldHealth[],
): string {
  // Health entries whose field is NOT present on `fm`: their raw value
  // must be re-emitted. Only top-level (non-indexed) fields carry a raw
  // scalar/structure to re-emit; an indexed path like `labels[2]` or
  // `relationships[1].target` describes a sub-position of a field that
  // is itself present, so there is nothing separate to re-emit for it.
  const fmObj = toMutable(fm);
  const reEmit = new Map<string, unknown>();
  for (const h of health ?? []) {
    if (h.field.includes("[") || h.field.includes(".")) continue;
    if (Object.prototype.hasOwnProperty.call(fmObj, h.field) && fmObj[h.field] !== undefined) {
      continue; // override wins
    }
    if (h.raw === undefined) continue;
    reEmit.set(h.field, h.raw);
  }

  const obj: Record<string, unknown> = {};
  // Identity first (always present — object-fatal otherwise).
  obj["id"] = fm.id;
  obj["key"] = fm.key;
  // K26: title/timestamps are optional now. Emit the healthy value if
  // present; otherwise fall back to the re-emitted raw value from health.
  const emitKnown = (k: string, v: unknown): void => {
    if (v !== undefined) obj[k] = v;
    else if (reEmit.has(k)) { obj[k] = reEmit.get(k); reEmit.delete(k); }
  };
  emitKnown("title", fm.title);
  emitKnown("created_at", fm.created_at);
  emitKnown("updated_at", fm.updated_at);

  emitKnown("project", fm.project);
  emitKnown("status", fm.status);
  emitKnown("status_updated_at", fm.status_updated_at);
  emitKnown("task_type", fm.task_type);
  emitKnown("priority", fm.priority);
  if (fm.labels !== undefined) obj["labels"] = [...fm.labels];
  else emitKnown("labels", undefined);
  emitKnown("assignee", fm.assignee);
  emitKnown("reporter", fm.reporter);
  emitKnown("start_date", fm.start_date);
  emitKnown("due_date", fm.due_date);
  emitKnown("estimate", fm.estimate);
  emitKnown("completed_date", fm.completed_date);
  emitKnown("milestone", fm.milestone);
  emitKnown("sprint", fm.sprint);
  emitKnown("archived", fm.archived);
  emitKnown("archived_at", fm.archived_at);
  if (fm.relationships !== undefined && fm.relationships.length > 0) {
    obj["relationships"] = fm.relationships.map(r => ({
      type: r.type,
      target: r.target,
      ...(r.rank !== undefined ? { rank: r.rank } : {}),
    }));
  } else emitKnown("relationships", undefined);
  if (fm.key_history !== undefined) obj["key_history"] = [...fm.key_history];
  else emitKnown("key_history", undefined);
  if (fm.fields !== undefined) obj["fields"] = { ...fm.fields };
  else emitKnown("fields", undefined);
  emitKnown("board_rank", fm.board_rank);

  // Pass-through preservation: any extra key the schema didn't
  // enumerate but accepted via .passthrough() is emitted last,
  // preserving user-added or plugin-defined frontmatter across
  // edits. We skip `undefined` (the field isn't really there); a
  // `foo: null` source ends up filtered out earlier by
  // coerceFrontmatter so it doesn't reach this loop.
  for (const [k, v] of Object.entries(fmObj)) {
    if (KNOWN_FRONTMATTER_KEYS.has(k)) continue;
    if (v === undefined) continue;
    obj[k] = v;
  }
  // Unrecognised keys carried only in `health` (they were lifted off
  // frontmatter at parse time). Re-emit last, preserving them across a
  // write to any other field — the round-trip P6 depends on.
  for (const [k, v] of reEmit) {
    if (KNOWN_FRONTMATTER_KEYS.has(k)) continue; // already handled above
    obj[k] = v;
  }

  return stringifyYaml(obj, { lineWidth: 0 });
}

/**
 * Assembles a full task.md file from a `Task` (proposal § 13.2 B2).
 *
 * Takes a whole `Task` — not `(fm, body)` — so its `health` is threaded
 * to the serializer and the raw values of degraded/unrecognised fields
 * are re-emitted. Making it take a `Task` is deliberate: the compiler
 * then flags every one of the six writers that would otherwise assemble
 * `{frontmatter, body}` without `health` and silently drop passthrough
 * and degraded fields.
 */
export function assembleTaskFile(task: Task): string {
  const yamlStr = serializeFrontmatter(task.frontmatter, task.health);
  return `---\n${yamlStr}---\n${task.body}`;
}
