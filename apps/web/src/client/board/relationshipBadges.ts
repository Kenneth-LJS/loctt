import type { TaskFrontmatterPublic, WorkflowConfig } from "@loctt/contracts";
import { effectiveInverseKey } from "@loctt/contracts";

/**
 * BRD-50 (UX-5): the board card surfaces two relationship-derived
 * signals that are otherwise invisible on a card — a task is *blocked*,
 * and a task is an *epic/parent* with children (or, conversely, a
 * subtask that belongs to one).
 *
 * A card only ever receives `task.relationships` (the same frontmatter
 * the list feed carries), so the signals are computed here from that
 * array plus the workflow config, rather than by a second API read.
 * LocTT writes both sides of every relationship (P-12), so the blocked
 * task itself carries the `is_blocked_by` edge and the parent task
 * itself carries the `child` edges — nothing has to be traversed.
 *
 * The relationship *type keys* are configurable, so the semantics are
 * resolved from config, not hardcoded:
 *
 *  - **blocked** — the inverse of `timeline.dependency_relationship`
 *    (the "blocks" axis, defaulting to `blocks` → `is_blocked_by`). A
 *    task with ≥1 edge of that inverse key is blocked. The blocker is
 *    the edge's target; on a board feed we cannot cheaply resolve
 *    whether the blocker is itself resolved, so BRD-50's "unresolved
 *    blocker" is taken as "has a blocker" — the card marks blocked and
 *    the count of blockers, and detail is where resolution lives.
 *  - **children / subtask** — the `graph: "tree"` relationship. Its own
 *    `key` (e.g. `parent`) is held by the *subtask* pointing up; its
 *    inverse (e.g. `child`) is held by the *epic* pointing down. So an
 *    epic's child count is the number of inverse-key edges it carries,
 *    and a subtask is any task carrying ≥1 own-key edge.
 */
export interface BoardCardBadges {
  /** The task has at least one "is-blocked-by" edge. */
  readonly blocked: boolean;
  /** How many blockers, for the marker's title/label. */
  readonly blockerCount: number;
  /** Number of children (epic/parent card). 0 when not an epic. */
  readonly childCount: number;
  /** The task itself points up at a parent (a subtask). */
  readonly isSubtask: boolean;
}

/** The relationship-type keys that drive the badges, resolved from config. */
interface BadgeKeys {
  /** The "is-blocked-by" key — an edge of this key means the task is blocked. */
  readonly blockedByKey: string | undefined;
  /** The tree relationship's own key — held by a subtask (points up). */
  readonly parentKey: string | undefined;
  /** The tree relationship's inverse key — held by an epic (points down). */
  readonly childKey: string | undefined;
}

/**
 * Resolves the badge-driving type keys from the workflow config.
 *
 * Falls back to the shipped defaults (`blocks`/`is_blocked_by`,
 * `parent`/`child`) when the config is absent or does not name a
 * dependency relationship, so a board with a stock workflow still marks
 * blocked cards even though nothing in config is *explicitly* the
 * "blocks" axis beyond the default.
 */
export function resolveBadgeKeys(workflow: WorkflowConfig | undefined): BadgeKeys {
  const rels = workflow?.relationships ?? [];

  // The blocking axis: `timeline.dependency_relationship` names the
  // forward ("blocks") key; the card wants its inverse.
  //
  // The schema distinguishes ABSENT (undefined → use the default `blocks`
  // axis) from an explicit `null` ("no dependency axis" / no arrows — a
  // deliberate opt-out). `null` must yield NO blocked badge; only
  // `undefined` falls back to the default. (Fix-review: `?? "blocks"`
  // treated `null` like absent and still marked cards blocked.)
  const depConfigured = workflow?.timeline?.dependency_relationship;
  const blockedByKey =
    depConfigured === null
      ? undefined // explicit opt-out: no blocking axis, no blocked marker
      : (() => {
          const depKey = depConfigured ?? "blocks";
          const depRel = rels.find(r => r.key === depKey);
          return depRel !== undefined
            ? effectiveInverseKey(depRel)
            : rels.length === 0
              ? "is_blocked_by"
              : undefined;
        })();

  // The hierarchy axis: the first `graph: "tree"` relationship. Its own
  // key is the subtask→parent edge; its inverse is the epic→child edge.
  const treeRel = rels.find(r => r.graph === "tree");
  const parentKey = treeRel?.key ?? (rels.length === 0 ? "parent" : undefined);
  const childKey =
    treeRel !== undefined
      ? effectiveInverseKey(treeRel)
      : rels.length === 0
        ? "child"
        : undefined;

  return { blockedByKey, parentKey, childKey };
}

/**
 * Computes the board-card badges for a task from its relationships and
 * the workflow config. Pure — no I/O, no traversal.
 */
export function boardCardBadges(
  task: TaskFrontmatterPublic,
  workflow: WorkflowConfig | undefined,
): BoardCardBadges {
  const { blockedByKey, parentKey, childKey } = resolveBadgeKeys(workflow);
  const rels = task.relationships ?? [];

  const blockerCount =
    blockedByKey === undefined ? 0 : rels.filter(r => r.type === blockedByKey).length;
  const childCount =
    childKey === undefined ? 0 : rels.filter(r => r.type === childKey).length;
  const isSubtask =
    parentKey !== undefined && rels.some(r => r.type === parentKey);

  return {
    blocked: blockerCount > 0,
    blockerCount,
    childCount,
    isSubtask,
  };
}
