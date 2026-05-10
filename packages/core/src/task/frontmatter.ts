import type { TaskFrontmatter, TaskRelationship } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { assertObject as _assertObject,assertString as _assertString } from "../utils/assert.js";

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

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, TaskParseError);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, TaskParseError);
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
    const rank = item["rank"];
    if (rank !== undefined && typeof rank !== "string") {
      throw new TaskParseError(`relationships[${i}].rank must be a string`);
    }
    return {
      type: item["type"],
      target: item["target"],
      ...(rank !== undefined ? { rank: rank } : {}),
    };
  });
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  assertString(value, path);
  return value;
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
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
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new TaskParseError(`${path} must be a boolean`);
  }
  return value;
}

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
    if (value === undefined || value === null) return undefined;
    if (value instanceof Date) return value.toISOString();
    assertString(value, path);
    return value;
  }

  const project = optionalString(raw["project"], "project");
  const boardRank = optionalString(raw["board_rank"], "board_rank");
  const status = optionalString(raw["status"], "status");
  const statusUpdatedAt = optionalDateString(raw["status_updated_at"], "status_updated_at");
  const taskType = optionalString(raw["task_type"], "task_type");
  const priority = optionalString(raw["priority"], "priority");
  const assignee = optionalString(raw["assignee"], "assignee");
  const reporter = optionalString(raw["reporter"], "reporter");
  const startDate = optionalDateString(raw["start_date"], "start_date");
  const dueDate = optionalDateString(raw["due_date"], "due_date");
  const estimate = optionalString(raw["estimate"], "estimate");
  const completedDate = optionalDateString(raw["completed_date"], "completed_date");
  const milestone = optionalString(raw["milestone"], "milestone");
  const sprint = optionalString(raw["sprint"], "sprint");
  const archived = optionalBoolean(raw["archived"], "archived");
  const archivedAt = optionalDateString(raw["archived_at"], "archived_at");
  const labels = optionalStringArray(raw["labels"], "labels");

  const result: TaskFrontmatter = {
    id: raw["id"],
    key: raw["key"],
    title: raw["title"],
    created_at: createdAtStr,
    updated_at: updatedAtStr,
    ...(project !== undefined ? { project } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(statusUpdatedAt !== undefined ? { status_updated_at: statusUpdatedAt } : {}),
    ...(taskType !== undefined ? { task_type: taskType } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(assignee !== undefined ? { assignee } : {}),
    ...(reporter !== undefined ? { reporter } : {}),
    ...(startDate !== undefined ? { start_date: startDate } : {}),
    ...(dueDate !== undefined ? { due_date: dueDate } : {}),
    ...(estimate !== undefined ? { estimate } : {}),
    ...(completedDate !== undefined ? { completed_date: completedDate } : {}),
    ...(milestone !== undefined ? { milestone } : {}),
    ...(sprint !== undefined ? { sprint } : {}),
    ...(archived !== undefined ? { archived } : {}),
    ...(archivedAt !== undefined ? { archived_at: archivedAt } : {}),
    ...(labels !== undefined ? { labels } : {}),
    ...(relationships.length > 0 ? { relationships } : {}),
    ...(keyHistory !== undefined ? { key_history: keyHistory } : {}),
    ...(fields !== undefined ? { fields } : {}),
    ...(boardRank !== undefined ? { board_rank: boardRank } : {}),
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
