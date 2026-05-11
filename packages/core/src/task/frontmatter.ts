import type { TaskFrontmatter } from "@loctt/contracts";
import { TaskFrontmatterSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { formatZodIssues } from "../config/zod-error.js";
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
  constructor(message: string) {
    super(message);
    this.name = "TaskParseError";
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
 */
const REQUIRED_FRONTMATTER_FIELDS = new Set([
  "id",
  "key",
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

/** Parses raw YAML frontmatter into a TaskFrontmatter. */
export function parseFrontmatter(rawYaml: string): TaskFrontmatter {
  const raw = coerceFrontmatter(parseYaml(rawYaml));
  try {
    return TaskFrontmatterSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new TaskParseError(formatZodIssues("frontmatter", err));
    }
    throw err;
  }
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
 */
export function serializeFrontmatter(fm: TaskFrontmatter): string {
  const obj: Record<string, unknown> = {
    id: fm.id,
    key: fm.key,
    title: fm.title,
    created_at: fm.created_at,
    updated_at: fm.updated_at,
  };

  if (fm.project !== undefined) obj["project"] = fm.project;
  if (fm.status !== undefined) obj["status"] = fm.status;
  if (fm.status_updated_at !== undefined) obj["status_updated_at"] = fm.status_updated_at;
  if (fm.task_type !== undefined) obj["task_type"] = fm.task_type;
  if (fm.priority !== undefined) obj["priority"] = fm.priority;
  if (fm.labels !== undefined) obj["labels"] = [...fm.labels];
  if (fm.assignee !== undefined) obj["assignee"] = fm.assignee;
  if (fm.reporter !== undefined) obj["reporter"] = fm.reporter;
  if (fm.start_date !== undefined) obj["start_date"] = fm.start_date;
  if (fm.due_date !== undefined) obj["due_date"] = fm.due_date;
  if (fm.estimate !== undefined) obj["estimate"] = fm.estimate;
  if (fm.completed_date !== undefined) obj["completed_date"] = fm.completed_date;
  if (fm.milestone !== undefined) obj["milestone"] = fm.milestone;
  if (fm.sprint !== undefined) obj["sprint"] = fm.sprint;
  if (fm.archived !== undefined) obj["archived"] = fm.archived;
  if (fm.archived_at !== undefined) obj["archived_at"] = fm.archived_at;
  if (fm.relationships !== undefined && fm.relationships.length > 0) {
    obj["relationships"] = fm.relationships.map(r => ({
      type: r.type,
      target: r.target,
      ...(r.rank !== undefined ? { rank: r.rank } : {}),
    }));
  }
  if (fm.key_history !== undefined) obj["key_history"] = [...fm.key_history];
  if (fm.fields !== undefined) obj["fields"] = { ...fm.fields };
  if (fm.board_rank !== undefined) obj["board_rank"] = fm.board_rank;

  // Pass-through preservation: any extra key the schema didn't
  // enumerate but accepted via .passthrough() is emitted last,
  // preserving user-added or plugin-defined frontmatter across
  // edits. We skip `undefined` (the field isn't really there); a
  // `foo: null` source ends up filtered out earlier by
  // coerceFrontmatter so it doesn't reach this loop.
  for (const [k, v] of Object.entries(toMutable(fm))) {
    if (KNOWN_FRONTMATTER_KEYS.has(k)) continue;
    if (v === undefined) continue;
    obj[k] = v;
  }

  return stringifyYaml(obj, { lineWidth: 0 });
}

/** Assembles a full task.md file from frontmatter and body. */
export function assembleTaskFile(fm: TaskFrontmatter, body: string): string {
  const yamlStr = serializeFrontmatter(fm);
  return `---\n${yamlStr}---\n${body}`;
}
