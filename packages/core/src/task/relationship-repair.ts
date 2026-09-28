import type { HistoryEntry, Task, TaskRelationship, WorkflowConfig } from "@loctt/contracts";
import { relationshipTypeKeys } from "@loctt/contracts";

import { loadWorkflowConfig } from "../config/workflow.js";
import { withStateLock } from "../state/lock.js";
import { countUnranked, fillMissingRanks } from "./edge-rank.js";
import { listTaskIds } from "./list-ids.js";
import { loadAllTasksDetailed } from "./load-all.js";
import { findInverseType, persistRelationships } from "./relationships.js";

/**
 * Plans and applies the relationship repair (K140, K141).
 *
 * ## Why it exists
 *
 * `loctt create --parent GAME-4` (0.2.1 and earlier) stored the key
 * `GAME-4` as the edge's target and never wrote the `child` edge on the
 * parent. A tracker built that way cannot be fixed from any surface:
 * every `unlink` resolves the key to the id first, so the stored key
 * never matches. The reporter had 26 such edges and hand-edited them.
 *
 * ## What it does (K141, Ken's ruling)
 *
 * 1. **Key-valued targets are rewritten to the id.** A target that is
 *    not a task id but is exactly one task's current or former key
 *    (`key_history`) becomes that task's id. Its rank is kept.
 * 2. **Identical links are merged into one** (3a). The first stored
 *    position is kept; its rank, or the first rank among the copies.
 * 3. **Every one-sided link gets its missing side** (2a). This reverses
 *    the `17fae3f` "reported, not repaired" rule for one-sided edges.
 *    If adding the missing side would create a loop on an `acyclic` or
 *    `tree` kind, it is refused and reported instead.
 * 4. **Every link without a rank gets one** (K143), at the end of its
 *    type's group in stored order, which is where it is already listed.
 *    That includes the sides step 3 adds.
 *
 * ## What it never does
 *
 * - Delete a link. A target that resolves to nothing, or to a key more
 *   than one task has held, is reported and kept (P-11).
 * - Change a link's type, or a rank a link already has.
 * - Touch a task whose `relationships` could not be read (lifted into
 *   `health`), whether as the source or as the task that would receive
 *   the missing side. Writing it would overwrite what LocTT failed to
 *   read.
 * - Touch a link of a type `workflow.yaml` does not define: which side
 *   is missing is not knowable without the definition.
 *
 * ## History
 *
 * An added missing side gets `link_added` on the task that gains it, as
 * `link` writes. The key-to-id rewrite and the merge get **no** history
 * entry: no existing kind says "the same link, stored correctly", and a
 * `link_removed` + `link_added` pair would tell the activity feed a link
 * was removed and re-added, which did not happen (A357).
 *
 * The planner is pure, so `doctor` reports exactly what the repair will
 * do; the repair re-plans under the state lock and applies that.
 */

/** A key-valued target rewritten to its task's id. */
export interface RelationshipRewrite {
  readonly taskId: string;
  readonly taskKey: string;
  readonly type: string;
  readonly from: string;
  readonly to: string;
  readonly toKey: string;
}

/** Identical links on one task, merged into one. */
export interface RelationshipMerge {
  readonly taskId: string;
  readonly taskKey: string;
  readonly type: string;
  readonly target: string;
  /** How many copies were dropped (the total stored was `removed + 1`). */
  readonly removed: number;
}

/** A missing side added to the task at the other end of a link. */
export interface RelationshipInverseAdded {
  /** The task that gains the edge. */
  readonly taskId: string;
  readonly taskKey: string;
  /** The edge added: `type` pointing at `target`. */
  readonly type: string;
  readonly target: string;
  readonly targetKey: string;
}

/** A missing side the repair refused to add, and why. */
export interface RelationshipRefusal {
  /** The task holding the side that exists. */
  readonly taskId: string;
  readonly taskKey: string;
  readonly type: string;
  readonly target: string;
  readonly targetKey: string;
  /** The side that is missing on the target. */
  readonly missingType: string;
  readonly reason: "loop" | "target_unreadable";
}

/** Links on one task that had no rank and were given one (K143). */
export interface RelationshipRanked {
  readonly taskId: string;
  readonly taskKey: string;
  readonly count: number;
}

/** A stored target the repair cannot resolve to a single task. */
export interface RelationshipUnresolved {
  readonly taskId: string;
  readonly taskKey: string;
  readonly index: number;
  readonly type: string;
  readonly target: string;
  /**
   * `missing`: no task has this id or key. `ambiguous`: more than one
   * task has held this key. `self`: the key is this task's own.
   */
  readonly reason: "missing" | "ambiguous" | "self";
}

export interface RelationshipRepairPlan {
  readonly rewrites: readonly RelationshipRewrite[];
  readonly merges: readonly RelationshipMerge[];
  readonly inverses: readonly RelationshipInverseAdded[];
  /** Links given a rank, per task (step 4). */
  readonly ranked: readonly RelationshipRanked[];
  readonly refused: readonly RelationshipRefusal[];
  readonly unresolved: readonly RelationshipUnresolved[];
  /** Tasks whose `relationships` could not be read, so were left alone. */
  readonly unreadable: readonly { readonly taskId: string; readonly taskKey: string }[];
  /** Task id → its repaired `relationships`, for every task that changes. */
  readonly changes: ReadonlyMap<string, readonly TaskRelationship[]>;
}

/** The number of changes the repair would make. */
export function repairActionCount(plan: RelationshipRepairPlan): number {
  return plan.rewrites.length + plan.merges.length + plan.inverses.length
    + plan.ranked.reduce((n, r) => n + r.count, 0);
}

/**
 * Every key a task has held (current and former) → the ids that held it.
 * More than one id for a key means it is ambiguous: reconciliation can
 * leave a key current on one task and in another's `key_history`.
 */
export function buildKeyOwners(tasks: readonly Task[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  const add = (key: string, id: string): void => {
    if (key === "") return;
    const set = owners.get(key);
    if (set === undefined) owners.set(key, new Set([id]));
    else set.add(id);
  };
  for (const t of tasks) {
    add(t.frontmatter.key, t.frontmatter.id);
    for (const k of t.frontmatter.key_history ?? []) add(k, t.frontmatter.id);
  }
  return owners;
}

/** True when a task's `relationships` was lifted into `health` (unreadable). */
function relationshipsUnreadable(task: Task): boolean {
  return (task.health ?? []).some(
    h => h.field === "relationships" || h.field.startsWith("relationships["),
  );
}

/**
 * Works out the repair without touching disk.
 *
 * @param tasks every readable task
 * @param config the workflow, for inverse types and loop rules
 * @param onDiskIds ids of every task directory, including unreadable
 *   ones: a target naming an unreadable task is an id, not a key, and is
 *   left for the unreadable-file finding to explain
 */
export function planRelationshipRepair(
  tasks: readonly Task[],
  config: WorkflowConfig,
  onDiskIds: ReadonlySet<string> = new Set(),
): RelationshipRepairPlan {
  const sorted = [...tasks].sort((a, b) =>
    a.frontmatter.id < b.frontmatter.id ? -1 : a.frontmatter.id > b.frontmatter.id ? 1 : 0);
  const byId = new Map(sorted.map(t => [t.frontmatter.id, t]));
  const keyOf = (id: string): string => byId.get(id)?.frontmatter.key ?? id;
  const owners = buildKeyOwners(sorted);
  const validTypes = new Set(config.relationships.flatMap(relationshipTypeKeys));

  const rewrites: RelationshipRewrite[] = [];
  const merges: RelationshipMerge[] = [];
  const inverses: RelationshipInverseAdded[] = [];
  const refused: RelationshipRefusal[] = [];
  const unresolved: RelationshipUnresolved[] = [];
  const unreadable: { taskId: string; taskKey: string }[] = [];

  // Working copies of every readable `relationships`.
  const working = new Map<string, TaskRelationship[]>();
  const skip = new Set<string>();
  for (const t of sorted) {
    if (relationshipsUnreadable(t)) {
      skip.add(t.frontmatter.id);
      unreadable.push({ taskId: t.frontmatter.id, taskKey: t.frontmatter.key });
      continue;
    }
    working.set(t.frontmatter.id, (t.frontmatter.relationships ?? []).map(r => ({ ...r })));
  }

  // ── 1 + 2: rewrite key-valued targets, then merge identical links ──
  for (const t of sorted) {
    const id = t.frontmatter.id;
    const rels = working.get(id);
    if (rels === undefined) continue;
    rels.forEach((rel, index) => {
      if (byId.has(rel.target) || onDiskIds.has(rel.target)) return;
      const holders = owners.get(rel.target);
      if (holders === undefined || holders.size === 0) {
        unresolved.push({ taskId: id, taskKey: t.frontmatter.key, index, type: rel.type, target: rel.target, reason: "missing" });
        return;
      }
      if (holders.size > 1) {
        unresolved.push({ taskId: id, taskKey: t.frontmatter.key, index, type: rel.type, target: rel.target, reason: "ambiguous" });
        return;
      }
      const to = [...holders][0] as string;
      if (to === id) {
        unresolved.push({ taskId: id, taskKey: t.frontmatter.key, index, type: rel.type, target: rel.target, reason: "self" });
        return;
      }
      rewrites.push({ taskId: id, taskKey: t.frontmatter.key, type: rel.type, from: rel.target, to, toKey: keyOf(to) });
      rels[index] = { ...rel, target: to };
    });

    const firstAt = new Map<string, number>();
    const removedCount = new Map<string, number>();
    const merged: TaskRelationship[] = [];
    for (const rel of rels) {
      const pair = `${rel.type}\u0000${rel.target}`;
      const at = firstAt.get(pair);
      if (at === undefined) {
        firstAt.set(pair, merged.length);
        merged.push(rel);
        continue;
      }
      const kept = merged[at] as TaskRelationship;
      if (kept.rank === undefined && rel.rank !== undefined) merged[at] = { ...kept, rank: rel.rank };
      removedCount.set(pair, (removedCount.get(pair) ?? 0) + 1);
    }
    for (const [pair, removed] of removedCount) {
      const [type, target] = pair.split("\u0000") as [string, string];
      merges.push({ taskId: id, taskKey: t.frontmatter.key, type, target, removed });
    }
    if (removedCount.size > 0) working.set(id, merged);
  }

  // ── 3: add every missing side, unless that would make a loop ──
  /** The acyclic/tree definition whose *forward* key is `type`, if any. */
  const cycleDefFor = (type: string): string | undefined =>
    config.relationships.find(d =>
      d.key === type && (d.graph === "acyclic" || d.graph === "tree"))?.key;

  /** Whether `from` reaches `to` over `type` edges in the working graph. */
  const reaches = (from: string, to: string, type: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const node = stack.pop() as string;
      if (node === to) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const r of working.get(node) ?? []) {
        if (r.type === type) stack.push(r.target);
      }
    }
    return false;
  };

  const refusedPairs = new Set<string>();
  for (const t of sorted) {
    const id = t.frontmatter.id;
    const rels = working.get(id);
    if (rels === undefined) continue;
    // Snapshot: edges added to *this* task during the loop are complete
    // by construction (their other side is what caused them).
    for (const rel of [...rels]) {
      if (!validTypes.has(rel.type)) continue;
      if (rel.target === id) continue;
      const other = byId.get(rel.target);
      if (other === undefined) continue;
      const inverse = findInverseType(config, rel.type);
      if (inverse === undefined) continue;
      const otherId = other.frontmatter.id;
      const pairKey = `${id}\u0000${rel.type}\u0000${otherId}`;
      if (skip.has(otherId)) {
        if (!refusedPairs.has(pairKey)) {
          refusedPairs.add(pairKey);
          refused.push({
            taskId: id, taskKey: t.frontmatter.key, type: rel.type,
            target: otherId, targetKey: other.frontmatter.key,
            missingType: inverse, reason: "target_unreadable",
          });
        }
        continue;
      }
      const otherRels = working.get(otherId) as TaskRelationship[];
      if (otherRels.some(r => r.type === inverse && r.target === id)) continue;

      // Adding `inverse` on `other` → `id`. When `inverse` is the forward
      // key of a loop-forbidding kind, that adds the canonical edge
      // other → id, which closes a loop exactly when id already reaches
      // other.
      const cycleType = cycleDefFor(inverse);
      if (cycleType !== undefined && reaches(id, otherId, cycleType)) {
        if (!refusedPairs.has(pairKey)) {
          refusedPairs.add(pairKey);
          refused.push({
            taskId: id, taskKey: t.frontmatter.key, type: rel.type,
            target: otherId, targetKey: other.frontmatter.key,
            missingType: inverse, reason: "loop",
          });
        }
        continue;
      }
      otherRels.push({ type: inverse, target: id });
      inverses.push({
        taskId: otherId, taskKey: other.frontmatter.key,
        type: inverse, target: id, targetKey: t.frontmatter.key,
      });
    }
  }

  // ── 4: rank every link that has none (K143) ──
  // The sides step 3 added are ranked here too, but counted there: the
  // count is the links that were stored without a rank.
  const addedTo = new Map<string, number>();
  for (const a of inverses) addedTo.set(a.taskId, (addedTo.get(a.taskId) ?? 0) + 1);
  const ranked: RelationshipRanked[] = [];
  for (const t of sorted) {
    const rels = working.get(t.frontmatter.id);
    if (rels === undefined) continue;
    const unranked = countUnranked(rels);
    if (unranked === 0) continue;
    working.set(t.frontmatter.id, [...fillMissingRanks(rels)]);
    const count = unranked - (addedTo.get(t.frontmatter.id) ?? 0);
    if (count > 0) ranked.push({ taskId: t.frontmatter.id, taskKey: t.frontmatter.key, count });
  }

  const changes = new Map<string, readonly TaskRelationship[]>();
  for (const t of sorted) {
    const next = working.get(t.frontmatter.id);
    if (next === undefined) continue;
    const before = t.frontmatter.relationships ?? [];
    if (JSON.stringify(before) !== JSON.stringify(next)) changes.set(t.frontmatter.id, next);
  }

  return { rewrites, merges, inverses, ranked, refused, unresolved, unreadable, changes };
}

/** Loads what the planner needs: readable tasks and every on-disk id. */
async function loadForPlan(locttDir: string): Promise<{ tasks: Task[]; onDisk: Set<string> }> {
  const { tasks } = await loadAllTasksDetailed(locttDir);
  const onDisk = new Set(await listTaskIds(locttDir));
  return { tasks, onDisk };
}

/** Plans the repair against the tracker on disk, without writing. */
export async function planRelationshipRepairOnDisk(
  locttDir: string,
  config: WorkflowConfig,
): Promise<RelationshipRepairPlan> {
  const { tasks, onDisk } = await loadForPlan(locttDir);
  return planRelationshipRepair(tasks, config, onDisk);
}

/**
 * Applies the relationship repair (see the module docstring) and
 * returns what it did and what it left. Takes the state lock itself;
 * running it twice in a row is a no-op the second time.
 */
export async function repairRelationships(
  locttDir: string,
  workflowConfig?: WorkflowConfig,
): Promise<RelationshipRepairPlan> {
  const config = workflowConfig ?? await loadWorkflowConfig(locttDir);
  return withStateLock(locttDir, async () => {
    const { tasks, onDisk } = await loadForPlan(locttDir);
    const plan = planRelationshipRepair(tasks, config, onDisk);
    if (plan.changes.size === 0) return plan;
    const byId = new Map(tasks.map(t => [t.frontmatter.id, t]));
    const now = new Date().toISOString();
    for (const [id, rels] of plan.changes) {
      const task = byId.get(id);
      if (task === undefined) continue;
      const history: HistoryEntry[] = plan.inverses
        .filter(a => a.taskId === id)
        .map(a => ({ timestamp: now, kind: "link_added", meta: { type: a.type, target: a.target } }));
      await persistRelationships(locttDir, task, [...rels], now, history);
    }
    return plan;
  });
}
