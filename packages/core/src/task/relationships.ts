import type { HistoryEntry, Task, TaskFrontmatter, TaskRelationship, WorkflowConfig } from "@loctt/contracts";
import { effectiveInverseKey, isSymmetricRelationship, relationshipTypeKeys } from "@loctt/contracts";

import { withStateLock } from "../state/lock.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { lookupById, TaskNotFoundError } from "./lookup.js";
import { toFrontmatter, toMutable } from "./mutable.js";

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
  /**
   * When true (default), reject linking to an archived target task.
   * Internal callers (e.g. crash-recovery replay) can opt out by
   * setting this to false.
   */
  readonly blockArchivedTarget?: boolean;
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
export function findInverseType(workflowConfig: WorkflowConfig | undefined, type: string): string | undefined {
  if (!workflowConfig) return undefined;
  for (const rel of workflowConfig.relationships) {
    const inv = effectiveInverseKey(rel);
    if (rel.key === type) return inv;
    if (inv === type) return rel.key;
  }
  return undefined;
}

/**
 * Resolves the canonical direction of a relationship. Callers may
 * pass either side (`r.key` or `r.inverse`) as `type`; cycle
 * detection only makes sense against the canonical (`r.key`)
 * direction. Returns the matched workflow def and whether the
 * caller's `type` was the inverse side, so the caller can swap
 * source/target before walking.
 */
function resolveRelationshipDef(
  workflowConfig: WorkflowConfig,
  type: string,
): { def: WorkflowConfig["relationships"][number]; isInverse: boolean } | undefined {
  for (const def of workflowConfig.relationships) {
    if (def.key === type) {
      // For symmetric rels, the "inverse" call equals the forward call,
      // so isInverse should be false — there's no separate inverse direction.
      return { def, isInverse: false };
    }
    if (!isSymmetricRelationship(def) && def.inverse === type) {
      return { def, isInverse: true };
    }
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

/**
 * For a cycle-constrained relationship of canonical key `canonicalType`,
 * check whether adding the edge `sourceId -[canonicalType]-> targetId`
 * would form a cycle. Walks outgoing canonical-direction edges from
 * `targetId` (DFS over `frontmatter.relationships[].target` filtered
 * by `canonicalType`). If any path reaches `sourceId`, a cycle would
 * form.
 *
 * Returns the cycle path (target...sourceId) when a cycle would form,
 * else null. Stops walking branches that lead into deleted tasks.
 * Throws if the walk hits MAX_VISITS — a graph too large to verify
 * is treated as "refuse to add the link" rather than "looks fine."
 */
/**
 * Node budget for a structural cycle check. A graph larger than this is
 * refused rather than assumed acyclic — "too big to verify" must not
 * read as "verified fine".
 *
 * Exported so a test can build a chain sized to the cap instead of
 * hardcoding 1001 tasks: at ~1s per link the literal fixture takes
 * minutes, which is why this guard went untested (REL-C3).
 */
export const MAX_CYCLE_CHECK_VISITS = 1000;

async function findStructuralCycle(
  locttDir: string,
  sourceId: string,
  targetId: string,
  canonicalType: string,
): Promise<string[] | null> {
  const visited = new Set<string>();
  // DFS stack holds [nodeId, pathFromTargetIncludingThisNode]
  const stack: { id: string; path: string[] }[] = [{ id: targetId, path: [targetId] }];

  while (stack.length > 0) {
    if (visited.size > MAX_CYCLE_CHECK_VISITS) {
      throw new RelationshipError(
        `relationship graph too large to verify cycles (>${MAX_CYCLE_CHECK_VISITS} nodes); split the link or contact a maintainer`,
      );
    }
    const { id, path } = stack.pop() as { id: string; path: string[] };
    if (id === sourceId) {
      return path;
    }
    if (visited.has(id)) continue;
    visited.add(id);

    let task: Task;
    try {
      task = await lookupById(locttDir, id);
    } catch (err) {
      if (err instanceof TaskNotFoundError) continue;
      throw err;
    }

    const rels = task.frontmatter.relationships ?? [];
    for (const rel of rels) {
      if (rel.type !== canonicalType) continue;
      stack.push({ id: rel.target, path: [...path, rel.target] });
    }
  }
  return null;
}

function applyRelationships(
  frontmatter: TaskFrontmatter,
  relationships: TaskRelationship[],
  now: string,
): TaskFrontmatter {
  const copy = toMutable(frontmatter);
  if (relationships.length > 0) {
    copy["relationships"] = relationships;
  } else {
    delete copy["relationships"];
  }
  copy["updated_at"] = now;
  return toFrontmatter(copy);
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
  const blockArchived = opts.blockArchivedTarget !== false;
  if (workflowConfig) {
    const validTypes = new Set(workflowConfig.relationships.flatMap(relationshipTypeKeys));
    if (!validTypes.has(type)) {
      throw new RelationshipError(
        `unknown relationship type "${type}"; valid: ${[...validTypes].join(", ")}`,
      );
    }
  }

  // Wrap the read-modify-write in the tracker-wide state lock so the
  // cycle check, the forward write, and the inverse write
  // all happen against the same snapshot. Without the lock, two
  // concurrent linkTask calls could each see "no cycle yet" and both
  // commit, producing a cycle.
  return withStateLock(locttDir, async () => {
    const inverseType = findInverseType(workflowConfig, type);
    const now = new Date().toISOString();

    // Forward side
    const task = await readTask(locttDir, taskId);

    if (task.frontmatter.id === target) {
      throw new RelationshipError(
        `cannot link a task to itself (${task.frontmatter.key})`,
      );
    }

    if (blockArchived) {
      const targetTask = await readTask(locttDir, target);
      if (targetTask.frontmatter.archived === true) {
        const alreadyLinked = (task.frontmatter.relationships ?? []).some(
          r => r.type === type && r.target === target,
        );
        if (!alreadyLinked) {
          throw new RelationshipError(
            `cannot link to archived task ${targetTask.frontmatter.key}; unarchive it first`,
          );
        }
      }
    }

    // Cycle detection for cycle-constrained relationships only. The user
    // may pass either the forward (`r.key`) or inverse (`r.inverse`)
    // direction as `type`; resolve to the canonical direction first
    // so the walk runs against the right end of the edge.
    if (workflowConfig) {
      const resolved = resolveRelationshipDef(workflowConfig, type);
      // `graph: acyclic` and `graph: tree` both forbid cycles; the
      // difference is only whether the kind may be drawn as a tree.
      if (resolved !== undefined && (resolved.def.graph === "acyclic" || resolved.def.graph === "tree")) {
        // When the caller passed the inverse, the canonical edge is
        // target → source; swap before walking so the cycle search
        // starts from the right node.
        const canonicalSource = resolved.isInverse ? target : taskId;
        const canonicalTarget = resolved.isInverse ? taskId : target;
        const cyclePath = await findStructuralCycle(
          locttDir,
          canonicalSource,
          canonicalTarget,
          resolved.def.key,
        );
        if (cyclePath) {
          // Build a readable arrow trail using keys where possible.
          // Look up the canonical source for the prefix; on inverse
          // calls that's the target task, not the caller's `taskId`.
          let sourceKey = task.frontmatter.key;
          if (resolved.isInverse) {
            try {
              const src = await lookupById(locttDir, canonicalSource);
              sourceKey = src.frontmatter.key;
            } catch (err) {
              if (!(err instanceof TaskNotFoundError)) throw err;
              sourceKey = canonicalSource;
            }
          }
          const keys: string[] = [sourceKey];
          for (const id of cyclePath) {
            if (id === canonicalSource) {
              keys.push(sourceKey);
              continue;
            }
            try {
              const t = await lookupById(locttDir, id);
              keys.push(t.frontmatter.key);
            } catch (err) {
              if (!(err instanceof TaskNotFoundError)) throw err;
              keys.push(id);
            }
          }
          throw new RelationshipError(
            `cannot create cycle in relationship '${resolved.def.key}' (graph: ${resolved.def.graph}): ${keys.join(" -> ")}`,
          );
        }
      }
    }

    const forwardExisting = task.frontmatter.relationships ?? [];
    const forwardUpdatedRels = addEdge(forwardExisting, type, target);

    // Inverse side. Skip when there's no inverse defined.
    let inverseTask: Task | undefined;
    let inverseUpdatedRels: TaskRelationship[] | null = null;

    if (inverseType) {
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
  });
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

  // Same lock as linkTask for the same race-avoidance reason: forward
  // and inverse must be observed and written atomically against each
  // other.
  return withStateLock(locttDir, async () => {
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
  });
}
