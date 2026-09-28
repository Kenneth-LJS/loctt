import type { HistoryEntry, Task, TaskFrontmatter, TaskRelationship, WorkflowConfig } from "@loctt/contracts";
import { effectiveInverseKey, isSymmetricRelationship, relationshipTypeKeys } from "@loctt/contracts";

import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import { withStateLock } from "../state/lock.js";
import { CorruptFieldError } from "./health.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { loadAllTasks } from "./load-all.js";
import { lookupById, lookupTask, TaskNotFoundError } from "./lookup.js";
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
  /** The target's id (callers resolve a key first), or the ref as given when it resolves to nothing. */
  readonly target: string;
  /**
   * The target exactly as the user gave it (G1). When no edge to
   * `target` exists on either side, an edge whose **stored** target is
   * this string is removed instead. That
   * is how a link stored as a key more than one task has held (which
   * resolves to some other task's id, or to none) is removed.
   */
  readonly storedTarget?: string;
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
        `Relationship graph is too large to verify for cycles (over ${MAX_CYCLE_CHECK_VISITS} tasks). Split the link, or contact a maintainer.`,
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
 * What {@link checkLinkTarget} needs to know about the edge being added.
 *
 * The source is described by value rather than read from disk, because
 * `createTask` checks the link for a task that does not exist yet: the
 * whole point is to refuse *before* the new task is written (K140).
 */
interface LinkTargetCheck {
  readonly locttDir: string;
  /** The source task's id (for a create, the id about to be written). */
  readonly sourceId: string;
  /** The source task's key, for messages. */
  readonly sourceKey: string;
  /** The source's current edges (empty for a task being created). */
  readonly sourceRelationships: readonly TaskRelationship[];
  readonly type: string;
  /** The target task's **id**. Callers resolve keys first. */
  readonly target: string;
  readonly workflowConfig: WorkflowConfig | undefined;
  readonly blockArchived: boolean;
  /** The target, when the caller has already read it. */
  readonly targetTask?: Task;
  /** The field a refusal is attributed to (`parent` on create). */
  readonly errorField?: string;
}

/** The target task and the inverse edge type, once a link is allowed. */
interface CheckedLinkTarget {
  /** Read only when needed: an archived check or an inverse to write. */
  readonly targetTask: Task | undefined;
  readonly inverseType: string | undefined;
}

/**
 * Every check a new link must pass, with no lock and no write.
 *
 * Shared by `linkTask` and `createTask` so the two ways of making a
 * link cannot drift (K140): `create --parent` used to skip all of this
 * and write the parent's key verbatim with no inverse. The caller holds
 * the state lock (`withStateLock` is not re-entrant, and `createTask`
 * runs inside its caller's lock).
 */
async function checkLinkTarget(opts: LinkTargetCheck): Promise<CheckedLinkTarget> {
  const { locttDir, sourceId, sourceKey, type, target, workflowConfig } = opts;
  const fieldOpt: LocttErrorOptions = opts.errorField !== undefined ? { field: opts.errorField } : {};
  const inverseType = findInverseType(workflowConfig, type);

  if (sourceId === target) {
    throw new RelationshipError(
      `${sourceKey} is this task. A task can't link to itself.`,
      fieldOpt,
    );
  }

  let targetTask = opts.targetTask;
  const readTarget = async (): Promise<Task> => {
    targetTask ??= await readTask(locttDir, target);
    return targetTask;
  };

  if (opts.blockArchived) {
    const t = await readTarget();
    if (t.frontmatter.archived === true) {
      const alreadyLinked = opts.sourceRelationships.some(
        r => r.type === type && r.target === target,
      );
      if (!alreadyLinked) {
        throw new RelationshipError(
          `Cannot link to archived task ${t.frontmatter.key}. Unarchive it first.`,
          fieldOpt,
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
      const canonicalSource = resolved.isInverse ? target : sourceId;
      const canonicalTarget = resolved.isInverse ? sourceId : target;
      const cyclePath = await findStructuralCycle(
        locttDir,
        canonicalSource,
        canonicalTarget,
        resolved.def.key,
      );
      if (cyclePath) {
        // Build a readable arrow trail using keys where possible.
        // Look up the canonical source for the prefix; on inverse
        // calls that's the target task, not the caller's source.
        let canonicalSourceKey = sourceKey;
        if (resolved.isInverse) {
          try {
            const src = await lookupById(locttDir, canonicalSource);
            canonicalSourceKey = src.frontmatter.key;
          } catch (err) {
            if (!(err instanceof TaskNotFoundError)) throw err;
            canonicalSourceKey = canonicalSource;
          }
        }
        const keys: string[] = [canonicalSourceKey];
        for (const id of cyclePath) {
          if (id === canonicalSource) {
            keys.push(canonicalSourceKey);
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
          fieldOpt,
        );
      }
    }
  }

  if (inverseType) {
    // The inverse is merged into the target's `relationships`, so a
    // wrong-typed value there refuses rather than being overwritten.
    assertRelationshipsReadable(await readTarget());
  }

  return { targetTask, inverseType };
}

/**
 * Writes a task's new `relationships` (carrying its other health
 * forward) and appends the given history. Lock-free: the caller holds
 * the state lock. Shared by link, unlink, create and the repair.
 */
export async function persistRelationships(
  locttDir: string,
  task: Task,
  relationships: TaskRelationship[],
  now: string,
  history: readonly HistoryEntry[],
): Promise<Task> {
  const updatedFrontmatter = applyRelationships(task.frontmatter, relationships, now);
  const carried = carryRelHealth(task);
  const result: Task = { frontmatter: updatedFrontmatter, body: task.body, ...(carried ? { health: carried } : {}) };
  await writeTask(locttDir, task.frontmatter.id, result, new Set(["relationships", "updated_at"]));
  if (history.length > 0) await appendHistory(locttDir, task.frontmatter.id, [...history]);
  return result;
}

/**
 * The other side of a delete's links (K147, G4).
 *
 * Deleting a task used to remove only its directory, so every partner
 * kept an edge pointing at nothing and doctor reported it. For each
 * task in `deleted`, every task it links to loses **every** edge that
 * targets it (the inverse and any stray edge of another type), each
 * with a `link_removed` entry in the partner's history, the same entry
 * `unlink` writes there. Partners that are themselves being deleted are
 * skipped, and so is a partner that is gone or whose file or
 * `relationships` cannot be read: nothing can be written to it, and
 * doctor reports what is left.
 *
 * Lock-free: `deleteTask` and `bulkDelete` call it inside their own
 * state lock, after the directories are removed. That order means a
 * crash part-way leaves dangling edges (which `unlink` and doctor
 * handle), never a one-sided link the relationship repair would
 * complete back onto a deleted task.
 */
export async function detachDeletedTasks(
  locttDir: string,
  deleted: readonly Task[],
  now: string,
  bulkOpId?: string,
): Promise<void> {
  const deletedIds = new Set(deleted.map(t => t.frontmatter.id));
  const partners = new Set<string>();
  for (const t of deleted) {
    for (const r of t.frontmatter.relationships ?? []) {
      if (!deletedIds.has(r.target)) partners.add(r.target);
    }
  }
  for (const partnerId of partners) {
    let partner: Task;
    try {
      partner = await readTask(locttDir, partnerId);
    } catch {
      // Gone, never a task (a key-stored or dangling target), or will
      // not parse: nothing to write to.
      continue;
    }
    if ((partner.health ?? []).some(h => h.field === "relationships")) continue;
    const existing = partner.frontmatter.relationships ?? [];
    const kept = existing.filter(r => !deletedIds.has(r.target));
    if (kept.length === existing.length) continue;
    const removed = existing.filter(r => deletedIds.has(r.target));
    await persistRelationships(locttDir, partner, kept, now, removed.map(r => ({
      timestamp: now,
      kind: "link_removed" as const,
      meta: { type: r.type, target: r.target },
      ...(bulkOpId !== undefined ? { bulk_op_id: bulkOpId } : {}),
    })));
  }
}

/**
 * The link half of `createTask`'s `parent` option (K140).
 *
 * `prepareParentLink` resolves the parent (key, former key or id) and
 * runs every check `linkTask` runs, **before** the new task is written;
 * `commitParentLink` writes the inverse edge on the parent after it is.
 * Together they produce what `create` followed by `link <new> <tree
 * axis> <parent>` produces. Both are lock-free; `createTask`'s caller
 * holds the state lock.
 */
export interface PreparedParentLink {
  readonly type: string;
  readonly parentId: string;
  readonly checked: CheckedLinkTarget;
}

export async function prepareParentLink(opts: {
  readonly locttDir: string;
  readonly childId: string;
  readonly childKey: string;
  readonly parentRef: string;
  readonly type: string;
  readonly workflowConfig: WorkflowConfig | undefined;
}): Promise<PreparedParentLink> {
  let parent: Task;
  try {
    parent = await lookupTask(opts.locttDir, opts.parentRef);
  } catch (err) {
    // The same sentence `loctt link` prints for a target that does not
    // exist, but as a validation failure on the `parent` field: this is
    // a rejected create (400 at the field), not a missing page (404).
    if (err instanceof TaskNotFoundError) {
      throw new RelationshipError(err.message, { field: "parent" });
    }
    throw err;
  }
  const parentId = parent.frontmatter.id;
  const checked = await checkLinkTarget({
    locttDir: opts.locttDir,
    sourceId: opts.childId,
    sourceKey: opts.childKey,
    sourceRelationships: [],
    type: opts.type,
    target: parentId,
    workflowConfig: opts.workflowConfig,
    blockArchived: true,
    targetTask: parent,
    errorField: "parent",
  });
  return { type: opts.type, parentId, checked };
}

export async function commitParentLink(
  locttDir: string,
  childId: string,
  prepared: PreparedParentLink,
  now: string,
): Promise<void> {
  const { targetTask, inverseType } = prepared.checked;
  if (inverseType === undefined || targetTask === undefined) return;
  const updated = addEdge(targetTask.frontmatter.relationships ?? [], inverseType, childId);
  if (updated === null) return;
  await persistRelationships(locttDir, targetTask, updated, now, [{
    timestamp: now,
    kind: "link_added",
    meta: { type: inverseType, target: childId },
  }]);
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
        `Unknown relationship type "${type}". Valid types: ${[...validTypes].join(", ")}.`,
      );
    }
  }

  // Wrap the read-modify-write in the tracker-wide state lock so the
  // cycle check, the forward write, and the inverse write
  // all happen against the same snapshot. Without the lock, two
  // concurrent linkTask calls could each see "no cycle yet" and both
  // commit, producing a cycle.
  return withStateLock(locttDir, async () => {
    const now = new Date().toISOString();

    // Forward side
    const task = await readTask(locttDir, taskId);
    // Link must read+merge `relationships`; a wrong-typed value refuses
    // rather than being overwritten (§ 3.2, A135).
    assertRelationshipsReadable(task);

    const forwardExisting = task.frontmatter.relationships ?? [];
    const { targetTask: inverseTask, inverseType } = await checkLinkTarget({
      locttDir,
      sourceId: task.frontmatter.id,
      sourceKey: task.frontmatter.key,
      sourceRelationships: forwardExisting,
      type,
      target,
      workflowConfig,
      blockArchived,
    });

    const forwardUpdatedRels = addEdge(forwardExisting, type, target);

    // Inverse side. Skip when there's no inverse defined.
    const inverseUpdatedRels = inverseType && inverseTask
      ? addEdge(inverseTask.frontmatter.relationships ?? [], inverseType, taskId)
      : null;

    // If neither side needed to change, the relationship already fully exists.
    if (forwardUpdatedRels === null && inverseUpdatedRels === null) {
      throw new RelationshipError(
        `Relationship "${type}" to ${target} already exists on task ${taskId}.`,
      );
    }

    // Persist forward side
    const result = forwardUpdatedRels !== null
      ? await persistRelationships(locttDir, task, forwardUpdatedRels, now, [{
        timestamp: now,
        kind: "link_added",
        meta: { type, target },
      }])
      : task;

    // Persist inverse side
    if (inverseUpdatedRels !== null && inverseTask && inverseType) {
      await persistRelationships(locttDir, inverseTask, inverseUpdatedRels, now, [{
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

    // G1: no edge to the resolved id on this task, but one stored as the
    // ref the user gave. Checked before the inverse-only case below, so
    // the holder's inverse is not removed while this task keeps its side.
    const stored = opts.storedTarget;
    if (forwardUpdatedRels === null && stored !== undefined && stored !== target) {
      const byStored = removeEdge(forwardExisting, type, stored);
      if (byStored !== null) {
        return removeStoredEdge({
          locttDir, task, type, stored, remaining: byStored, inverseType, now,
        });
      }
    }

    if (forwardUpdatedRels === null && inverseUpdatedRels === null) {
      throw new RelationshipError(
        `Relationship "${type}" to ${target} does not exist on task ${taskId}.`,
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

/**
 * G1: removes an edge by the exact target it stores, when that target is
 * not an id: a key more than one task has held (the relationship repair
 * reports it and keeps it, A357 7), a task's own key, or a key no task
 * holds any more. Resolving such a key finds some other task's id, or
 * none, so the id-based removal never matched it and no surface could
 * remove the link.
 *
 * The other side is removed from whichever task that key could have
 * meant (any task holding it, as its key or a former key) when that task
 * has the inverse edge back to this one and this task has no link to it
 * by id that the inverse would belong to. Lock-free: `unlinkTask` holds
 * the state lock.
 */
async function removeStoredEdge(args: {
  readonly locttDir: string;
  readonly task: Task;
  readonly type: string;
  readonly stored: string;
  readonly remaining: TaskRelationship[];
  readonly inverseType: string | undefined;
  readonly now: string;
}): Promise<Task> {
  const { locttDir, task, type, stored, remaining, inverseType, now } = args;
  const taskId = task.frontmatter.id;
  const result = await persistRelationships(locttDir, task, remaining, now, [{
    timestamp: now,
    kind: "link_removed",
    meta: { type, target: stored },
  }]);
  if (inverseType === undefined) return result;
  const holders = (await loadAllTasks(locttDir)).filter(t =>
    t.frontmatter.id !== taskId
    && (t.frontmatter.key === stored || (t.frontmatter.key_history ?? []).includes(stored)));
  for (const holder of holders) {
    if ((holder.health ?? []).some(h => h.field === "relationships")) continue;
    if (remaining.some(r => r.type === type && r.target === holder.frontmatter.id)) continue;
    const updated = removeEdge(holder.frontmatter.relationships ?? [], inverseType, taskId);
    if (updated === null) continue;
    await persistRelationships(locttDir, holder, updated, now, [{
      timestamp: now,
      kind: "link_removed",
      meta: { type: inverseType, target: taskId },
    }]);
  }
  return result;
}
