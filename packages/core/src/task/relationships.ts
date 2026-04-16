import type { Task, TaskFrontmatter, TaskRelationship, WorkflowConfig } from "@loctt/contracts";

import { readTask, writeTask } from "./io.js";

export class RelationshipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationshipError";
  }
}

/**
 * Adds a relationship to a task.
 * Throws if the relationship already exists (same type+target).
 */
export async function linkTask(
  locttDir: string,
  taskId: string,
  type: string,
  target: string,
  workflowConfig?: WorkflowConfig,
): Promise<Task> {
  if (workflowConfig) {
    const validTypes = new Set(workflowConfig.relationships.flatMap(r => [r.key, r.inverse]));
    if (!validTypes.has(type)) {
      throw new RelationshipError(
        `unknown relationship type "${type}"; valid: ${[...validTypes].join(", ")}`,
      );
    }
  }

  const task = await readTask(locttDir, taskId);
  const existing = task.frontmatter.relationships ?? [];

  const alreadyExists = existing.some(
    r => r.type === type && r.target === target
  );
  if (alreadyExists) {
    throw new RelationshipError(
      `relationship ${type} -> ${target} already exists on task ${taskId}`
    );
  }

  const newRel: TaskRelationship = { type, target };
  const now = new Date().toISOString();
  const updated: TaskFrontmatter = {
    ...task.frontmatter,
    relationships: [...existing, newRel],
    updated_at: now,
  };

  const result: Task = { frontmatter: updated, body: task.body };
  await writeTask(locttDir, taskId, result);
  return result;
}

/**
 * Removes a relationship from a task.
 * Throws if the relationship doesn't exist.
 */
export async function unlinkTask(
  locttDir: string,
  taskId: string,
  type: string,
  target: string,
): Promise<Task> {
  const task = await readTask(locttDir, taskId);
  const existing = task.frontmatter.relationships ?? [];

  const idx = existing.findIndex(
    r => r.type === type && r.target === target
  );
  if (idx === -1) {
    throw new RelationshipError(
      `relationship ${type} -> ${target} does not exist on task ${taskId}`
    );
  }

  const now = new Date().toISOString();
  const remaining = [...existing.slice(0, idx), ...existing.slice(idx + 1)];

  const copy = { ...task.frontmatter } as Record<string, unknown>;
  if (remaining.length > 0) {
    copy["relationships"] = remaining;
  } else {
    delete copy["relationships"];
  }
  copy["updated_at"] = now;
  const updated = copy as unknown as TaskFrontmatter;

  const result: Task = { frontmatter: updated, body: task.body };
  await writeTask(locttDir, taskId, result);
  return result;
}
