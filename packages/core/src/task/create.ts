import type { LocttState,Task, TaskFrontmatter, WorkflowConfig } from "@loctt/contracts";
import { ulid } from "ulid";

import { validateTaskAgainstWorkflow } from "../config/validation.js";
import { allocateKey } from "../state/keys.js";
import { appendHistory } from "./history.js";
import { writeTask } from "./io.js";
import { clearLookupCaches } from "./lookup-cache.js";

/** Options for creating a new task. */
export interface CreateTaskOptions {
  readonly title: string;
  /**
   * Project the task belongs to (matches `ProjectDef.key`).
   * Required — caller must resolve the default-project rules
   * before invoking createTask.
   */
  readonly project: string;
  readonly status?: string;
  readonly task_type?: string;
  readonly priority?: string;
  readonly parent?: string;
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly reporter?: string;
  readonly start_date?: string;
  readonly due_date?: string;
  readonly estimate?: string;
  readonly milestone?: string;
  readonly sprint?: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

/** Full options bag for createTask. */
export interface CreateTaskParams {
  readonly locttDir: string;
  readonly state: LocttState;
  readonly options: CreateTaskOptions;
  readonly workflowConfig?: WorkflowConfig;
}

/**
 * Creates a new task on disk and updates key allocation state.
 *
 * Caller is responsible for persisting the updated state afterwards.
 * Returns the created task.
 */
export async function createTask(params: CreateTaskParams): Promise<Task> {
  const { locttDir, state, options, workflowConfig } = params;
  const id = ulid();
  // Each project owns its own counter in state.yaml. The project
  // key doubles as the entity-type for `allocateKey`.
  const key = allocateKey(state, options.project);
  const now = new Date().toISOString();

  // Normalize parent option into a relationship edge
  const relationships: { type: string; target: string }[] = [];
  if (options.parent !== undefined) {
    relationships.push({ type: "parent", target: options.parent });
  }

  const frontmatter: TaskFrontmatter = {
    id,
    key,
    project: options.project,
    title: options.title,
    created_at: now,
    updated_at: now,
    ...(options.status !== undefined ? { status: options.status } : {}),
    ...(options.task_type !== undefined ? { task_type: options.task_type } : {}),
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
    ...(options.labels !== undefined ? { labels: [...options.labels] } : {}),
    ...(options.assignee !== undefined ? { assignee: options.assignee } : {}),
    ...(options.reporter !== undefined ? { reporter: options.reporter } : {}),
    ...(options.start_date !== undefined ? { start_date: options.start_date } : {}),
    ...(options.due_date !== undefined ? { due_date: options.due_date } : {}),
    ...(options.estimate !== undefined ? { estimate: options.estimate } : {}),
    ...(options.milestone !== undefined ? { milestone: options.milestone } : {}),
    ...(options.sprint !== undefined ? { sprint: options.sprint } : {}),
    ...(options.fields !== undefined ? { fields: options.fields } : {}),
    ...(relationships.length > 0 ? { relationships } : {}),
  };

  // If the task is being created directly into a completed-category
  // status, auto-stamp completed_date so it matches the behavior of
  // setField on a status transition. Same date format (YYYY-MM-DD).
  if (workflowConfig && frontmatter.status !== undefined) {
    const statusDef = workflowConfig.statuses.find(s => s.key === frontmatter.status);
    if (statusDef?.category === "completed") {
      (frontmatter as { completed_date?: string }).completed_date = now.slice(0, 10);
    }
  }

  if (workflowConfig) {
    const errors = validateTaskAgainstWorkflow(frontmatter, workflowConfig);
    if (errors.length > 0) {
      throw new Error(`invalid task: ${errors.map(e => `${e.field}: ${e.message}`).join("; ")}`);
    }
  }

  const task: Task = {
    frontmatter,
    body: options.body ?? "",
  };

  await writeTask(locttDir, id, task);
  await appendHistory(locttDir, id, [{ timestamp: now, kind: "created" }]);
  // Invalidate any in-process "key not found" verdicts cached by
  // lookupByKey — the new task's key/key_history may now resolve.
  clearLookupCaches(locttDir);
  return task;
}
