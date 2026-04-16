import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { TaskFrontmatter, TaskRelationship } from "@loctt/contracts";

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
  if (!match) {
    throw new TaskParseError("task.md must start with YAML frontmatter delimited by ---");
  }
  return { rawYaml: match[1]!, body: match[2]! };
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TaskParseError(`${path} must be a non-empty string`);
  }
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TaskParseError(`${path} must be an object`);
  }
}

function parseRelationships(raw: unknown): TaskRelationship[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new TaskParseError("relationships must be an array");
  }
  return raw.map((item, i) => {
    assertObject(item, `relationships[${i}]`);
    assertString(item["type"], `relationships[${i}].type`);
    assertString(item["target"], `relationships[${i}].target`);
    return { type: item["type"], target: item["target"] };
  });
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  assertString(value, path);
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new TaskParseError(`${path} must be an array`);
  }
  return value.map((item, i) => {
    if (typeof item !== "string") {
      throw new TaskParseError(`${path}[${i}] must be a string`);
    }
    return item;
  });
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new TaskParseError(`${path} must be a boolean`);
  }
  return value;
}

// Built-in frontmatter keys that are parsed explicitly
const BUILTIN_KEYS = new Set([
  "id", "key", "title", "created_at", "updated_at",
  "status", "status_updated_at", "task_type", "priority",
  "parent", "labels", "assignee", "reporter",
  "start_date", "due_date", "estimate", "completed_at",
  "milestone", "archived", "archived_at",
  "relationships", "key_history", "fields",
]);

/** Parses raw YAML frontmatter into a TaskFrontmatter. */
export function parseFrontmatter(rawYaml: string): TaskFrontmatter {
  const raw: unknown = parseYaml(rawYaml);
  assertObject(raw, "frontmatter");

  // Required fields
  assertString(raw["id"], "id");
  assertString(raw["key"], "key");
  assertString(raw["title"], "title");

  // created_at and updated_at may be parsed as Date objects by yaml lib
  const createdAt = raw["created_at"];
  const createdAtStr = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
  assertString(createdAtStr, "created_at");

  const updatedAt = raw["updated_at"];
  const updatedAtStr = updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt;
  assertString(updatedAtStr, "updated_at");

  const relationships = parseRelationships(raw["relationships"]);
  const keyHistory = optionalStringArray(raw["key_history"], "key_history");

  // Parse custom fields map
  const fieldsRaw = raw["fields"];
  let fields: Record<string, unknown> | undefined;
  if (fieldsRaw !== undefined) {
    assertObject(fieldsRaw, "fields");
    fields = { ...fieldsRaw };
  }

  // Handle optional date fields that yaml may parse as Date
  function optionalDateString(value: unknown, path: string): string | undefined {
    if (value === undefined) return undefined;
    if (value instanceof Date) return value.toISOString();
    assertString(value, path);
    return value;
  }

  // Warn about unknown top-level keys (not enforced, just tracked)
  for (const k of Object.keys(raw)) {
    if (!BUILTIN_KEYS.has(k)) {
      // Unknown keys are silently ignored — could be future extensions
    }
  }

  const result: TaskFrontmatter = {
    id: raw["id"],
    key: raw["key"],
    title: raw["title"],
    created_at: createdAtStr,
    updated_at: updatedAtStr,
    ...(raw["status"] !== undefined ? { status: raw["status"] as string } : {}),
    ...(optionalDateString(raw["status_updated_at"], "status_updated_at") !== undefined
      ? { status_updated_at: optionalDateString(raw["status_updated_at"], "status_updated_at")! }
      : {}),
    ...(raw["task_type"] !== undefined ? { task_type: raw["task_type"] as string } : {}),
    ...(raw["priority"] !== undefined ? { priority: raw["priority"] as string } : {}),
    ...(raw["parent"] !== undefined ? { parent: raw["parent"] as string } : {}),
    ...(optionalString(raw["assignee"], "assignee") !== undefined ? { assignee: optionalString(raw["assignee"], "assignee")! } : {}),
    ...(optionalString(raw["reporter"], "reporter") !== undefined ? { reporter: optionalString(raw["reporter"], "reporter")! } : {}),
    ...(optionalDateString(raw["start_date"], "start_date") !== undefined ? { start_date: optionalDateString(raw["start_date"], "start_date")! } : {}),
    ...(optionalDateString(raw["due_date"], "due_date") !== undefined ? { due_date: optionalDateString(raw["due_date"], "due_date")! } : {}),
    ...(optionalString(raw["estimate"], "estimate") !== undefined ? { estimate: optionalString(raw["estimate"], "estimate")! } : {}),
    ...(optionalDateString(raw["completed_at"], "completed_at") !== undefined ? { completed_at: optionalDateString(raw["completed_at"], "completed_at")! } : {}),
    ...(optionalString(raw["milestone"], "milestone") !== undefined ? { milestone: optionalString(raw["milestone"], "milestone")! } : {}),
    ...(optionalBoolean(raw["archived"], "archived") !== undefined ? { archived: optionalBoolean(raw["archived"], "archived")! } : {}),
    ...(optionalDateString(raw["archived_at"], "archived_at") !== undefined ? { archived_at: optionalDateString(raw["archived_at"], "archived_at")! } : {}),
    ...(raw["labels"] !== undefined ? { labels: optionalStringArray(raw["labels"], "labels")! } : {}),
    ...(relationships.length > 0 ? { relationships } : {}),
    ...(keyHistory !== undefined ? { key_history: keyHistory } : {}),
    ...(fields !== undefined ? { fields } : {}),
  };

  return result;
}

/**
 * Serializes a TaskFrontmatter to YAML string (without --- delimiters).
 * Fields are ordered for readability: required first, then optional.
 */
export function serializeFrontmatter(fm: TaskFrontmatter): string {
  // Build an ordered object for clean YAML output
  const obj: Record<string, unknown> = {
    id: fm.id,
    key: fm.key,
    title: fm.title,
    created_at: fm.created_at,
    updated_at: fm.updated_at,
  };

  if (fm.status !== undefined) obj["status"] = fm.status;
  if (fm.status_updated_at !== undefined) obj["status_updated_at"] = fm.status_updated_at;
  if (fm.task_type !== undefined) obj["task_type"] = fm.task_type;
  if (fm.priority !== undefined) obj["priority"] = fm.priority;
  if (fm.parent !== undefined) obj["parent"] = fm.parent;
  if (fm.labels !== undefined) obj["labels"] = [...fm.labels];
  if (fm.assignee !== undefined) obj["assignee"] = fm.assignee;
  if (fm.reporter !== undefined) obj["reporter"] = fm.reporter;
  if (fm.start_date !== undefined) obj["start_date"] = fm.start_date;
  if (fm.due_date !== undefined) obj["due_date"] = fm.due_date;
  if (fm.estimate !== undefined) obj["estimate"] = fm.estimate;
  if (fm.completed_at !== undefined) obj["completed_at"] = fm.completed_at;
  if (fm.milestone !== undefined) obj["milestone"] = fm.milestone;
  if (fm.archived !== undefined) obj["archived"] = fm.archived;
  if (fm.archived_at !== undefined) obj["archived_at"] = fm.archived_at;
  if (fm.relationships !== undefined && fm.relationships.length > 0) {
    obj["relationships"] = fm.relationships.map(r => ({ type: r.type, target: r.target }));
  }
  if (fm.key_history !== undefined) obj["key_history"] = [...fm.key_history];
  if (fm.fields !== undefined) obj["fields"] = { ...fm.fields };

  return stringifyYaml(obj, { lineWidth: 0 });
}

/** Assembles a full task.md file from frontmatter and body. */
export function assembleTaskFile(fm: TaskFrontmatter, body: string): string {
  const yamlStr = serializeFrontmatter(fm);
  return `---\n${yamlStr}---\n${body}`;
}
