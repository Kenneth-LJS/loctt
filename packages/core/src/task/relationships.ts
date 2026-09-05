import type { HistoryEntry, Task, TaskFrontmatter, TaskRelationship, WorkflowConfig } from "@loctt/contracts";
import { effectiveInverseKey, isSymmetricRelationship, relationshipTypeKeys } from "@loctt/contracts";

import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import { withStateLock } from "../state/lock.js";
import { CorruptFieldError } from "./health.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { lookupById, TaskNotFoundError } from "./lookup.js";
import { toFrontmatter, toMutable } from "./mutable.js";

/**
 * The derived operation rule (proposal § 3.2): link/unlink must *read*
 * `relationships` to merge an edge into it, so a wrong-typed
 * `relationships` value (lifted into `health`) is a refuse, not a
 * silent overwrite that discards the corrupt array. A135 keeps the
 * shipped refusal here rather than defaulting the structure away.
 */
function assertRelationshipsReadable(task: Task): void {
  const bad = (task.health ?? []).find(
    h => h.field === "relationships" && h.kind === "wrong_type",
  );
  if (bad) throw new CorruptFieldError("relationships", bad.rawText);
}

/** Carries a task's health forward across a relationships write. */
function carryRelHealth(task: Task): Task["health"] {
  const carried = (task.health ?? []).filter(h => h.field !== "relationships");
  return carried.length > 0 ? carried : undefined;
}

export class RelationshipError extends LocttError {
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, {
      field: "relationships",
      dataState: "not_saved",
      ...opts,
    });
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

/**
 * True for the two shapes "this task does not exist" takes.
 *
 * `lookupById` raises `TaskNotFoundError`; `readTask` opens the file
 * directly and raises the platform's `ENOENT`. Callers that must
 * tolerate a missing task have to accept both, and must accept
 * *only* these — an `EACCES` or a parse failure is a different fact
 * and swallowing it would report a readable task as a deleted one.
 */
function isMissingTask(err: unknown): boolean {
  if (err instanceof TaskNotFoundError) return true;
  return (
    err instanceof Error
    && (err as NodeJS.ErrnoException).code === "ENOENT"
  );
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
    // Link must read+merge `relationships`; a wrong-typed value refuses
    // rather than being overwritten (§ 3.2, A135).
    assertRelationshipsReadable(task);

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
      assertRelationshipsReadable(inverseTask);
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
      const carried = carryRelHealth(task);
      result = { frontmatter: updatedFrontmatter, body: task.body, ...(carried ? { health: carried } : {}) };
      await writeTask(locttDir, taskId, result, new Set(["relationships", "updated_at"]));
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
      const carriedInv = carryRelHealth(inverseTask);
      await writeTask(locttDir, target,
        { frontmatter: updatedInverse, body: inverseTask.body, ...(carriedInv ? { health: carriedInv } : {}) },
        new Set(["relationships", "updated_at"]));
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
    // Unlink must read+edit `relationships`; a wrong-typed value refuses
    // rather than being overwritten (§ 3.2, A135).
    assertRelationshipsReadable(task);
    const forwardExisting = task.frontmatter.relationships ?? [];
    const forwardUpdatedRels = removeEdge(forwardExisting, type, target);

    // Inverse side
    let inverseTask: Task | undefined;
    let inverseUpdatedRels: TaskRelationship[] | null = null;

    if (inverseType && !isSelfLink) {
      /**
       * A target that no longer exists is not a reason to refuse the
       * unlink — it is the main reason to want one.
       *
       * When a task is deleted out of band, every edge pointing at it
       * becomes dangling, and this call is how the surviving side gets
       * cleaned up. Reading the target unguarded made that impossible,
       * so the forward edge could not be removed from any surface.
       * Measured before the fix: the web API answered 404 (its route
       * resolved the target first) and `loctt unlink T-1 blocks
       * <deleted-id>` exited 1 — both naming the target that is
       * *supposed* to be gone.
       *
       * There is no inverse edge to remove on a task that does not
       * exist, so skipping the inverse side is not merely tolerable
       * here, it is correct: the forward removal below still runs, and
       * `forwardUpdatedRels === null && inverseUpdatedRels === null`
       * still catches the genuinely-absent case.
       */
      try {
        inverseTask = await readTask(locttDir, target);
        const inverseExisting = inverseTask.frontmatter.relationships ?? [];
        inverseUpdatedRels = removeEdge(inverseExisting, inverseType, taskId);
      } catch (err) {
        // `readTask` reads the file directly, so a deleted task surfaces
        // as a raw ENOENT rather than as `TaskNotFoundError` — measured;
        // catching only the latter left this route answering 500 with
        // the ENOENT path in `detail`. Both are matched, and nothing
        // else is: a permission failure or a corrupt file must still
        // propagate rather than be silently treated as "target gone".
        if (!isMissingTask(err)) throw err;
        inverseTask = undefined;
      }
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
      const carried = carryRelHealth(task);
      result = { frontmatter: updatedFrontmatter, body: task.body, ...(carried ? { health: carried } : {}) };
      await writeTask(locttDir, taskId, result, new Set(["relationships", "updated_at"]));
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
      const carriedInv = carryRelHealth(inverseTask);
      await writeTask(locttDir, target,
        { frontmatter: updatedInverse, body: inverseTask.body, ...(carriedInv ? { health: carriedInv } : {}) },
        new Set(["relationships", "updated_at"]));
      await appendHistory(locttDir, target, [{
        timestamp: now,
        kind: "link_removed",
        meta: { type: inverseType, target: taskId },
      }]);
    }

    return result;
  });
}
