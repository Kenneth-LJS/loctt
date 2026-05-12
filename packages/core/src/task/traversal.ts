import type { Task, WorkflowConfig } from "@loctt/contracts";

import { loadAllTasks } from "./load-all.js";

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
    for (const [i, rel] of rels.entries()) {
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
 * Builds a parent-child map from all tasks.
 * Returns a map of parent ID -> child IDs.
 * Tasks with no parent are roots (keyed under "").
 * Tasks with multiple parents appear under each parent (DAG).
 */
export function buildTree(
  tasks: readonly Task[],
  structuralType: string = "parent",
): Map<string, string[]> {
  const tree = new Map<string, string[]>();
  const roots: string[] = [];
  tree.set("", roots);

  for (const task of tasks) {
    const parentTargets = getRelatedTasks(task, structuralType);
    if (parentTargets.length === 0) {
      roots.push(task.frontmatter.id);
    } else {
      for (const parentId of parentTargets) {
        const children = tree.get(parentId) ?? [];
        children.push(task.frontmatter.id);
        tree.set(parentId, children);
      }
    }
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
 * A cycle found in the structural-relationship graph. The path
 * lists task ids in walk order; the last id is the same as the
 * first (closing the loop). Reported by `findStructuralCycles`.
 */
export interface StructuralCycle {
  readonly relationshipKey: string;
  readonly path: readonly string[];
}

/**
 * Walks every structural relationship in the workflow and returns
 * each cycle found in the in-memory task set. Used by `doctor` to
 * surface cycles that pre-date the link-time guard (which can be
 * bypassed by the inverse-key fix in earlier code, by direct
 * frontmatter edits, or by a sync that crossed paths).
 *
 * Each cycle is reported once per relationship — the canonical
 * path starts from the lowest-id node in the cycle so two runs
 * report the same edges in the same order.
 */
export function findStructuralCycles(
  tasks: readonly Task[],
  config: WorkflowConfig,
): readonly StructuralCycle[] {
  const cycles: StructuralCycle[] = [];
  const byId = new Map<string, Task>();
  for (const t of tasks) byId.set(t.frontmatter.id, t);

  for (const rel of config.relationships) {
    if (!rel.structural) continue;
    const seenCycles = new Set<string>();
    const colour = new Map<string, "white" | "grey" | "black">();
    const stack: { id: string; path: string[] }[] = [];

    function visit(start: string): void {
      stack.push({ id: start, path: [start] });
      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        if (!frame) break;
        const status = colour.get(frame.id) ?? "white";
        if (status === "black") {
          stack.pop();
          continue;
        }
        if (status === "white") {
          colour.set(frame.id, "grey");
          const task = byId.get(frame.id);
          if (!task) {
            colour.set(frame.id, "black");
            stack.pop();
            continue;
          }
          const outgoing = (task.frontmatter.relationships ?? [])
            .filter(r => r.type === rel.key)
            .map(r => r.target);
          // Push children onto the stack as new frames; iterate by
          // marking which child index we've processed.
          (frame as { id: string; path: string[]; outgoing?: string[]; cursor?: number }).outgoing = outgoing;
          (frame as { id: string; path: string[]; outgoing?: string[]; cursor?: number }).cursor = 0;
        }
        const f = frame as { id: string; path: string[]; outgoing?: string[]; cursor?: number };
        const outgoing = f.outgoing ?? [];
        const cursor = f.cursor ?? 0;
        if (cursor >= outgoing.length) {
          colour.set(frame.id, "black");
          stack.pop();
          continue;
        }
        const next = outgoing[cursor] as string;
        f.cursor = cursor + 1;
        const nextColour = colour.get(next) ?? "white";
        if (nextColour === "grey") {
          // Back-edge — close the cycle from where `next` first
          // entered the path.
          const idx = frame.path.indexOf(next);
          if (idx !== -1) {
            const cyclePath = [...frame.path.slice(idx), next];
            // Normalize: rotate so the lowest id starts the path.
            // Drop the trailing duplicate before rotating.
            const ring = cyclePath.slice(0, -1);
            let minIdx = 0;
            for (let i = 1; i < ring.length; i += 1) {
              const ringI = ring[i];
              const ringMin = ring[minIdx];
              if (ringI !== undefined && ringMin !== undefined && ringI < ringMin) minIdx = i;
            }
            const rotated = [...ring.slice(minIdx), ...ring.slice(0, minIdx)];
            rotated.push(rotated[0] as string);
            const key = rotated.join(",");
            if (!seenCycles.has(key)) {
              seenCycles.add(key);
              cycles.push({ relationshipKey: rel.key, path: rotated });
            }
          }
          continue;
        }
        if (nextColour === "black") continue;
        stack.push({ id: next, path: [...frame.path, next] });
      }
    }

    for (const t of tasks) {
      if ((colour.get(t.frontmatter.id) ?? "white") === "white") {
        visit(t.frontmatter.id);
      }
    }
  }

  return cycles;
}

/**
 * Gets the parent(s) of a task using the structural relationship.
 * Returns multiple parents if a task has more than one parent relationship.
 */
export function getParents(
  tasks: readonly Task[],
  childId: string,
  config: WorkflowConfig,
): readonly Task[] {
  const structuralDef = config.relationships.find(r => r.structural);
  if (!structuralDef) return [];

  const child = tasks.find(t => t.frontmatter.id === childId);
  if (!child) return [];

  const parentRels = (child.frontmatter.relationships ?? []).filter(
    r => r.type === structuralDef.key,
  );

  return parentRels
    .map(r => tasks.find(t => t.frontmatter.id === r.target))
    .filter((t): t is Task => t !== undefined);
}
