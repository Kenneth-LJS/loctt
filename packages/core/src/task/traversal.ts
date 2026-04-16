import type { Task, WorkflowConfig } from "@loctt/contracts";
import { loadAllTasks } from "./lookup.js";

/** Validates that all relationship targets exist and types are valid. */
export interface RelationshipValidationError {
  readonly taskId: string;
  readonly field: string;
  readonly message: string;
}

/**
 * Validates relationships across all tasks.
 * Checks that targets exist and types are defined in config.
 */
export async function validateRelationships(
  locttDir: string,
  config: WorkflowConfig,
): Promise<readonly RelationshipValidationError[]> {
  const tasks = await loadAllTasks(locttDir);
  const taskIds = new Set(tasks.map(t => t.frontmatter.id));
  const validTypes = new Set(
    config.relationships.flatMap(r => [r.key, r.inverse]),
  );

  const errors: RelationshipValidationError[] = [];

  for (const task of tasks) {
    const rels = task.frontmatter.relationships ?? [];
    for (let i = 0; i < rels.length; i++) {
      const rel = rels[i]!;
      if (!validTypes.has(rel.type)) {
        errors.push({
          taskId: task.frontmatter.id,
          field: `relationships[${i}].type`,
          message: `unknown relationship type "${rel.type}"`,
        });
      }
      if (!taskIds.has(rel.target)) {
        errors.push({
          taskId: task.frontmatter.id,
          field: `relationships[${i}].target`,
          message: `target task "${rel.target}" does not exist`,
        });
      }
    }
  }

  return errors;
}

/**
 * Gets all tasks related to a given task by a specific relationship type.
 * Returns targets where the source task has the specified relationship type.
 */
export function getRelatedTasks(
  task: Task,
  relType: string,
): readonly string[] {
  return (task.frontmatter.relationships ?? [])
    .filter(r => r.type === relType)
    .map(r => r.target);
}

/**
 * Builds a parent-child tree from all tasks.
 * Returns a map of parent ID -> child IDs.
 * Tasks with no parent are roots (keyed under "").
 */
export function buildTree(
  tasks: readonly Task[],
  structuralType: string = "parent",
): Map<string, string[]> {
  const tree = new Map<string, string[]>();
  tree.set("", []); // root level

  for (const task of tasks) {
    const parentTargets = getRelatedTasks(task, structuralType);
    const parentId = parentTargets[0] ?? "";
    const children = tree.get(parentId) ?? [];
    children.push(task.frontmatter.id);
    tree.set(parentId, children);
  }

  return tree;
}

/**
 * Gets the children of a task using the structural relationship.
 * Uses the inverse of the structural relationship type.
 */
export function getChildren(
  tasks: readonly Task[],
  parentId: string,
  config: WorkflowConfig,
): readonly Task[] {
  const structuralDef = config.relationships.find(r => r.structural);
  if (!structuralDef) return [];

  // Children are tasks that have a "parent" relationship targeting parentId
  return tasks.filter(t =>
    (t.frontmatter.relationships ?? []).some(
      r => r.type === structuralDef.key && r.target === parentId,
    ),
  );
}

/**
 * Gets the parent of a task using the structural relationship.
 */
export function getParent(
  tasks: readonly Task[],
  childId: string,
  config: WorkflowConfig,
): Task | undefined {
  const structuralDef = config.relationships.find(r => r.structural);
  if (!structuralDef) return undefined;

  const child = tasks.find(t => t.frontmatter.id === childId);
  if (!child) return undefined;

  const parentRel = (child.frontmatter.relationships ?? []).find(
    r => r.type === structuralDef.key,
  );
  if (!parentRel) return undefined;

  return tasks.find(t => t.frontmatter.id === parentRel.target);
}
