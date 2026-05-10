import type { TaskFrontmatter } from "@loctt/contracts";
import { TaskFrontmatterSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { formatZodIssues } from "../config/zod-error.js";

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
    // accepts it.
    if (v === null) continue;
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
 * Fields are ordered for readability: required first, then optional.
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

  return stringifyYaml(obj, { lineWidth: 0 });
}

/** Assembles a full task.md file from frontmatter and body. */
export function assembleTaskFile(fm: TaskFrontmatter, body: string): string {
  const yamlStr = serializeFrontmatter(fm);
  return `---\n${yamlStr}---\n${body}`;
}
