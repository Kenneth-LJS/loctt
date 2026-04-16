import type { Task, TaskFrontmatter, WorkflowConfig } from "@loctt/contracts";

import { validateTaskAgainstWorkflow } from "../config/validation.js";
import { readTask, writeTask } from "./io.js";

export class TaskUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskUpdateError";
  }
}

// Fields that cannot be set/unset — they are system-managed
const IMMUTABLE_FIELDS = new Set(["id", "key", "created_at"]);

// Built-in optional fields that live at the top level of frontmatter
const BUILTIN_OPTIONAL_FIELDS = new Set([
  "status", "status_updated_at", "task_type", "priority",
  "labels", "assignee", "reporter", "start_date", "due_date",
  "estimate", "completed_at", "milestone", "archived", "archived_at",
  "relationships", "key_history",
]);

/**
 * Sets a field on a task's frontmatter.
 *
 * - Built-in optional fields are set at the top level.
 * - Other fields are set under `fields:` (custom fields).
 * - Immutable fields (id, key, created_at) cannot be set.
 * - Always updates `updated_at` timestamp.
 * - If setting `status`, also updates `status_updated_at`.
 */
export async function setField(
  locttDir: string,
  taskId: string,
  field: string,
  value: unknown,
  workflowConfig?: WorkflowConfig,
): Promise<Task> {
  if (IMMUTABLE_FIELDS.has(field)) {
    throw new TaskUpdateError(`cannot set immutable field "${field}"`);
  }

  const task = await readTask(locttDir, taskId);
  const now = new Date().toISOString();

  let updated: TaskFrontmatter;

  if (field === "title") {
    if (typeof value !== "string" || value.length === 0) {
      throw new TaskUpdateError("title must be a non-empty string");
    }
    updated = { ...task.frontmatter, title: value, updated_at: now };
  } else if (field === "updated_at") {
    if (typeof value !== "string") {
      throw new TaskUpdateError("updated_at must be a string");
    }
    updated = { ...task.frontmatter, updated_at: value };
  } else if (BUILTIN_OPTIONAL_FIELDS.has(field)) {
    const patch: Record<string, unknown> = {
      ...task.frontmatter,
      [field]: value,
      updated_at: now,
    };
    if (field === "status") {
      patch["status_updated_at"] = now;
    }
    updated = patch as unknown as TaskFrontmatter;
  } else {
    // Custom field — goes under fields:
    const existingFields = task.frontmatter.fields ?? {};
    updated = {
      ...task.frontmatter,
      fields: { ...existingFields, [field]: value },
      updated_at: now,
    };
  }

  if (workflowConfig) {
    const errors = validateTaskAgainstWorkflow(updated, workflowConfig);
    if (errors.length > 0) {
      throw new TaskUpdateError(
        `invalid value: ${errors.map(e => `${e.field}: ${e.message}`).join("; ")}`,
      );
    }
  }

  const updatedTask: Task = { frontmatter: updated, body: task.body };
  await writeTask(locttDir, taskId, updatedTask);
  return updatedTask;
}

/**
 * Unsets (removes) a field from a task's frontmatter.
 *
 * - Built-in optional fields are removed from the top level.
 * - Other fields are removed from `fields:`.
 * - Required/immutable fields cannot be unset.
 * - Always updates `updated_at` timestamp.
 */
export async function unsetField(
  locttDir: string,
  taskId: string,
  field: string,
): Promise<Task> {
  if (IMMUTABLE_FIELDS.has(field) || field === "title" || field === "updated_at") {
    throw new TaskUpdateError(`cannot unset required field "${field}"`);
  }

  const task = await readTask(locttDir, taskId);
  const now = new Date().toISOString();

  let updated: TaskFrontmatter;

  if (BUILTIN_OPTIONAL_FIELDS.has(field)) {
    const copy = { ...task.frontmatter } as Record<string, unknown>;
    delete copy[field];
    copy["updated_at"] = now;
    updated = copy as unknown as TaskFrontmatter;
  } else {
    // Custom field under fields:
    const existingFields = { ...(task.frontmatter.fields ?? {}) };
    if (!(field in existingFields)) {
      throw new TaskUpdateError(`custom field "${field}" is not set`);
    }
    delete existingFields[field];
    const fields = Object.keys(existingFields).length > 0 ? existingFields : undefined;
    updated = {
      ...task.frontmatter,
      ...(fields !== undefined ? { fields } : {}),
      updated_at: now,
    };
    // Remove fields key entirely if empty
    if (fields === undefined) {
      const copy = { ...updated } as Record<string, unknown>;
      delete copy["fields"];
      updated = copy as unknown as TaskFrontmatter;
    }
  }

  const updatedTask: Task = { frontmatter: updated, body: task.body };
  await writeTask(locttDir, taskId, updatedTask);
  return updatedTask;
}
