import type { HistoryEntry, Task, TaskFrontmatter, WorkflowConfig } from "@loctt/contracts";

import { validateTaskAgainstWorkflow } from "../config/validation.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";

export class TaskUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskUpdateError";
  }
}

// Fields that cannot be set/unset — they are system-managed
const IMMUTABLE_FIELDS = new Set(["id", "key", "created_at", "project"]);

// Fields that are auto-managed by `setField` itself — users may not
// write to them directly even via the generic field setter. The
// `board_rank` field is auto-managed too: callers must use the
// dedicated `reorderBoardRank` API rather than `setField` so the
// rank-computation logic and rebalance trigger stays in one place.
const AUTO_MANAGED_FIELDS = new Set(["completed_date", "board_rank"]);

// Built-in optional fields that live at the top level of frontmatter
const BUILTIN_OPTIONAL_FIELDS = new Set([
  "status", "status_updated_at", "task_type", "priority",
  "labels", "assignee", "reporter", "start_date", "due_date",
  "estimate", "completed_date", "milestone", "archived", "archived_at",
  "relationships", "key_history", "board_rank",
]);

/**
 * Returns true when a status key falls into the `completed`
 * category. Used by the `completed_date` auto-management hook in
 * `setField`. Returns false when the workflow config is absent or
 * doesn't recognise the status — the date stays unset rather than
 * picking a wrong default.
 */
function isCompletedStatus(
  statusKey: unknown,
  workflowConfig: WorkflowConfig | undefined,
): boolean {
  if (typeof statusKey !== "string") return false;
  if (!workflowConfig) return false;
  const def = workflowConfig.statuses.find(s => s.key === statusKey);
  return def?.category === "completed";
}

/**
 * Returns today's date in ISO `YYYY-MM-DD` form. Used for
 * `completed_date` so the field reads as a calendar date rather
 * than a precise instant.
 */
function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Options bag for setField. */
export interface SetFieldOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly field: string;
  readonly value: unknown;
  readonly workflowConfig?: WorkflowConfig;
}

/**
 * Sets a field on a task's frontmatter.
 *
 * - Built-in optional fields are set at the top level.
 * - Other fields are set under `fields:` (custom fields).
 * - Immutable fields (id, key, created_at) cannot be set.
 * - Always updates `updated_at` timestamp.
 * - If setting `status`, also updates `status_updated_at`.
 */
export async function setField(opts: SetFieldOptions): Promise<Task> {
  const { locttDir, taskId, field, value, workflowConfig } = opts;
  if (IMMUTABLE_FIELDS.has(field)) {
    throw new TaskUpdateError(`cannot set immutable field "${field}"`);
  }
  if (AUTO_MANAGED_FIELDS.has(field)) {
    throw new TaskUpdateError(
      `cannot set auto-managed field "${field}" directly; ` +
      `it is updated automatically based on status changes`,
    );
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
      // Auto-manage `completed_date` based on the new status's
      // category. Set when transitioning into a `completed` status,
      // clear when transitioning out.
      const wasCompleted = isCompletedStatus(task.frontmatter.status, workflowConfig);
      const isNowCompleted = isCompletedStatus(value, workflowConfig);
      if (isNowCompleted && !wasCompleted) {
        patch["completed_date"] = todayDateString();
      } else if (!isNowCompleted && wasCompleted) {
        delete patch["completed_date"];
      }
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

  // Emit history entries
  const historyEntries = buildSetFieldHistory(task.frontmatter, field, value, now);
  if (historyEntries.length > 0) {
    await appendHistory(locttDir, taskId, historyEntries);
  }

  return updatedTask;
}

function buildSetFieldHistory(
  oldFm: TaskFrontmatter,
  field: string,
  value: unknown,
  timestamp: string,
): HistoryEntry[] {
  // Labels: diff old vs new array
  if (field === "labels") {
    const oldLabels = new Set(oldFm.labels ?? []);
    const newLabels = new Set(value as readonly string[]);
    const entries: HistoryEntry[] = [];
    for (const label of newLabels) {
      if (!oldLabels.has(label)) {
        entries.push({ timestamp, kind: "label_added", after: label });
      }
    }
    for (const label of oldLabels) {
      if (!newLabels.has(label)) {
        entries.push({ timestamp, kind: "label_removed", before: label });
      }
    }
    return entries;
  }

  // Custom field
  if (!BUILTIN_OPTIONAL_FIELDS.has(field) && field !== "title" && field !== "updated_at") {
    const before = oldFm.fields?.[field];
    if (before === value) return [];
    return [{ timestamp, kind: "custom_field_change", field, before: before ?? null, after: value }];
  }

  // Built-in field
  const before = (oldFm as unknown as Record<string, unknown>)[field];
  if (before === value) return [];
  return [{ timestamp, kind: "field_change", field, before: before ?? null, after: value }];
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
  if (AUTO_MANAGED_FIELDS.has(field)) {
    throw new TaskUpdateError(
      `cannot unset auto-managed field "${field}" directly; ` +
      `it is updated automatically based on status changes`,
    );
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

  // Emit history entries
  const historyEntries = buildUnsetFieldHistory(task.frontmatter, field, now);
  if (historyEntries.length > 0) {
    await appendHistory(locttDir, taskId, historyEntries);
  }

  return updatedTask;
}

function buildUnsetFieldHistory(
  oldFm: TaskFrontmatter,
  field: string,
  timestamp: string,
): HistoryEntry[] {
  // Labels: emit label_removed for each existing label
  if (field === "labels") {
    return (oldFm.labels ?? []).map(label => ({
      timestamp,
      kind: "label_removed" as const,
      before: label,
    }));
  }

  // Custom field
  if (!BUILTIN_OPTIONAL_FIELDS.has(field)) {
    const before = oldFm.fields?.[field];
    return [{ timestamp, kind: "custom_field_change", field, before: before ?? null, after: null }];
  }

  // Built-in field
  const before = (oldFm as unknown as Record<string, unknown>)[field];
  return [{ timestamp, kind: "field_change", field, before: before ?? null, after: null }];
}
