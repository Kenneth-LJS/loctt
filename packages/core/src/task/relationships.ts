import type { HistoryEntry, Task, TaskFrontmatter, TaskRelationship, WorkflowConfig } from "@loctt/contracts";

import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";

export class RelationshipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelationshipError";
  }
}

/** Options bag for linkTask. */
export interface LinkTaskOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly type: string;
  readonly target: string;
  readonly workflowConfig?: WorkflowConfig;
}

/** Options bag for unlinkTask. */
export interface UnlinkTaskOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly type: string;
  readonly target: string;
  readonly workflowConfig?: WorkflowConfig;
}

/**
 * Looks up the inverse type for a forward relationship type.
 * Searches both `key` and `inverse` columns so callers can pass either side.
 * Returns undefined if the workflow config is missing or the type isn't found.
 */
function findInverseType(workflowConfig: WorkflowConfig | undefined, type: string): string | undefined {
  if (!workflowConfig) return undefined;
  for (const rel of workflowConfig.relationships) {
    if (rel.key === type) return rel.inverse;
    if (rel.inverse === type) return rel.key;
  }
  return undefined;
}

/**
 * Adds an edge (type -> target) to a task if not already present.
 * Returns the updated relationships array, or `null` if the edge already existed.
 */
function addEdge(
  existing: readonly TaskRelationship[],
  type: string,
  target: string,
): TaskRelationship[] | null {
  if (existing.some(r => r.type === type && r.target === target)) {
    return null;
  }
  return [...existing, { type, target }];
}

/**
 * Removes an edge (type -> target) from a task's relationships.
 * Returns the updated relationships array, or `null` if the edge wasn't present.
 */
function removeEdge(
  existing: readonly TaskRelationship[],
  type: string,
  target: string,
): TaskRelationship[] | null {
  const idx = existing.findIndex(r => r.type === type && r.target === target);
  if (idx === -1) return null;
  return [...existing.slice(0, idx), ...existing.slice(idx + 1)];
}

function applyRelationships(
  frontmatter: TaskFrontmatter,
  relationships: TaskRelationship[],
  now: string,
): TaskFrontmatter {
  const copy = { ...frontmatter } as Record<string, unknown>;
  if (relationships.length > 0) {
    copy["relationships"] = relationships;
  } else {
    delete copy["relationships"];
  }
  copy["updated_at"] = now;
  return copy as unknown as TaskFrontmatter;
}

/**
 * Adds a relationship to a task (and the inverse on the target, if defined).
 *
 * Bilateral: writes the forward edge on `taskId` and, when the workflow config
 * defines an inverse, writes the inverse edge on `target`. If a relationship is
 * its own inverse (e.g. `related_to`), each side gets exactly one edge pointing
 * at the other (no duplicate on either task).
 *
 * Tolerant: if the forward edge already exists but the inverse is missing
 * (legacy one-sided data), the inverse is filled in instead of throwing.
 * Throws only when both sides already exist.
 */
export async function linkTask(opts: LinkTaskOptions): Promise<Task> {
  const { locttDir, taskId, type, target, workflowConfig } = opts;
  if (workflowConfig) {
    const validTypes = new Set(workflowConfig.relationships.flatMap(r => [r.key, r.inverse]));
    if (!validTypes.has(type)) {
      throw new RelationshipError(
        `unknown relationship type "${type}"; valid: ${[...validTypes].join(", ")}`,
      );
    }
  }

  const inverseType = findInverseType(workflowConfig, type);
  const isSelfLink = taskId === target;
  const now = new Date().toISOString();

  // Forward side
  const task = await readTask(locttDir, taskId);
  const forwardExisting = task.frontmatter.relationships ?? [];
  const forwardUpdatedRels = addEdge(forwardExisting, type, target);

  // Inverse side. Skip when there's no inverse defined or it's a self-link
  // (writing the inverse to the same task would either duplicate or be a no-op).
  let inverseTask: Task | undefined;
  let inverseUpdatedRels: TaskRelationship[] | null = null;

  if (inverseType && !isSelfLink) {
    inverseTask = await readTask(locttDir, target);
    const inverseExisting = inverseTask.frontmatter.relationships ?? [];
    inverseUpdatedRels = addEdge(inverseExisting, inverseType, taskId);
  }

  // If neither side needed to change, the relationship already fully exists.
  if (forwardUpdatedRels === null && inverseUpdatedRels === null) {
    throw new RelationshipError(
      `relationship ${type} -> ${target} already exists on task ${taskId}`,
    );
  }

  // Persist forward side
  let result: Task;
  if (forwardUpdatedRels !== null) {
    const updatedFrontmatter = applyRelationships(task.frontmatter, forwardUpdatedRels, now);
    result = { frontmatter: updatedFrontmatter, body: task.body };
    await writeTask(locttDir, taskId, result);
    await appendHistory(locttDir, taskId, [{
      timestamp: now,
      kind: "link_added",
      meta: { type, target },
    }]);
  } else {
    result = task;
  }

  // Persist inverse side
  if (inverseUpdatedRels !== null && inverseTask && inverseType) {
    const updatedInverse = applyRelationships(inverseTask.frontmatter, inverseUpdatedRels, now);
    await writeTask(locttDir, target, { frontmatter: updatedInverse, body: inverseTask.body });
    await appendHistory(locttDir, target, [{
      timestamp: now,
      kind: "link_added",
      meta: { type: inverseType, target: taskId },
    }]);
  }

  return result;
}

/**
 * Removes a relationship from a task (and the inverse on the target, if defined).
 *
 * Bilateral: removes the forward edge from `taskId` and, when the workflow
 * config defines an inverse, removes the inverse edge from `target`. Tolerant
 * of legacy one-sided data — if only one side exists, the present side is
 * removed and the missing side is silently skipped. Throws only when neither
 * side has the edge.
 */
export async function unlinkTask(opts: UnlinkTaskOptions): Promise<Task> {
  const { locttDir, taskId, type, target, workflowConfig } = opts;
  const inverseType = findInverseType(workflowConfig, type);
  const isSelfLink = taskId === target;
  const now = new Date().toISOString();

  // Forward side
  const task = await readTask(locttDir, taskId);
  const forwardExisting = task.frontmatter.relationships ?? [];
  const forwardUpdatedRels = removeEdge(forwardExisting, type, target);

  // Inverse side
  let inverseTask: Task | undefined;
  let inverseUpdatedRels: TaskRelationship[] | null = null;

  if (inverseType && !isSelfLink) {
    inverseTask = await readTask(locttDir, target);
    const inverseExisting = inverseTask.frontmatter.relationships ?? [];
    inverseUpdatedRels = removeEdge(inverseExisting, inverseType, taskId);
  }

  if (forwardUpdatedRels === null && inverseUpdatedRels === null) {
    throw new RelationshipError(
      `relationship ${type} -> ${target} does not exist on task ${taskId}`,
    );
  }

  // Persist forward side
  let result: Task;
  if (forwardUpdatedRels !== null) {
    const updatedFrontmatter = applyRelationships(task.frontmatter, forwardUpdatedRels, now);
    result = { frontmatter: updatedFrontmatter, body: task.body };
    await writeTask(locttDir, taskId, result);
    const entry: HistoryEntry = {
      timestamp: now,
      kind: "link_removed",
      meta: { type, target },
    };
    await appendHistory(locttDir, taskId, [entry]);
  } else {
    result = task;
  }

  // Persist inverse side
  if (inverseUpdatedRels !== null && inverseTask && inverseType) {
    const updatedInverse = applyRelationships(inverseTask.frontmatter, inverseUpdatedRels, now);
    await writeTask(locttDir, target, { frontmatter: updatedInverse, body: inverseTask.body });
    await appendHistory(locttDir, target, [{
      timestamp: now,
      kind: "link_removed",
      meta: { type: inverseType, target: taskId },
    }]);
  }

  return result;
}
