import type { LocttState,Task, TaskFrontmatter } from "@loctt/contracts";
import { ulid } from "ulid";

import { allocateKey } from "../state/keys.js";
import { writeTask } from "./io.js";

/** Options for creating a new task. */
export interface CreateTaskOptions {
  readonly title: string;
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
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

/**
 * Creates a new task on disk and updates key allocation state.
 *
 * Caller is responsible for persisting the updated state afterwards.
 * Returns the created task.
 */
export async function createTask(
  locttDir: string,
  state: LocttState,
  options: CreateTaskOptions,
): Promise<Task> {
  const id = ulid();
  const key = allocateKey(state, "task");
  const now = new Date().toISOString();

  const frontmatter: TaskFrontmatter = {
    id,
    key,
    title: options.title,
    created_at: now,
    updated_at: now,
    ...(options.status !== undefined ? { status: options.status } : {}),
    ...(options.task_type !== undefined ? { task_type: options.task_type } : {}),
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
    ...(options.parent !== undefined ? { parent: options.parent } : {}),
    ...(options.labels !== undefined ? { labels: options.labels } : {}),
    ...(options.assignee !== undefined ? { assignee: options.assignee } : {}),
    ...(options.reporter !== undefined ? { reporter: options.reporter } : {}),
    ...(options.start_date !== undefined ? { start_date: options.start_date } : {}),
    ...(options.due_date !== undefined ? { due_date: options.due_date } : {}),
    ...(options.estimate !== undefined ? { estimate: options.estimate } : {}),
    ...(options.milestone !== undefined ? { milestone: options.milestone } : {}),
    ...(options.fields !== undefined ? { fields: options.fields } : {}),
  };

  const task: Task = {
    frontmatter,
    body: options.body ?? "",
  };

  await writeTask(locttDir, id, task);
  return task;
}
