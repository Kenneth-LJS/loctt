import type { TaskFrontmatterPublic } from "@loctt/contracts";

import type { RelationshipRow } from "./group.ts";

/**
 * The nested render for a `graph: tree` kind (REL-5), and the
 * cycle-safe walk that keeps a hand-edited loop from hanging the tab
 * (REL-21).
 *
 * ## Why the whole task list, rather than N requests
 *
 * `GET /api/tasks/:ref` resolves one task's *own* edges. A subtree
 * needs each child's children too, which the task route cannot answer
 * without one request per node — and REL-28's last bullet is explicit
 * that the panel must not refetch per row. `/api/tasks` already
 * returns full public frontmatter, `relationships` included, for every
 * task in one response the list view is caching anyway, so the tree is
 * built from that.
 *
 * When that query has not loaded, `buildTree` gets an empty index and
 * every row comes back as a leaf — the direct children still render
 * from the task's own edges, which are already in hand. A depth-1
 * tree is a truthful degradation; an empty panel would not be.
 *
 * ## The cycle guard is a path check, not a visited set
 *
 * REL-21 requires the repeat to be *marked where it repeats* ("cycle
 * detected — B already appears above"), so the guard tracks the
 * ancestors on the current path rather than every node seen anywhere.
 * A visited set would also terminate, but it would silently prune a
 * node that legitimately appears under two different parents — a
 * diamond is not a cycle — and it could not say which node above the
 * repeat closed the loop.
 *
 * `cycleWith` carries that node's key so the row can name it, which is
 * REL-21's fourth bullet: which two edges form the cycle.
 *
 * A depth cap backs the path check up. The path check alone terminates
 * on any finite graph, but a deep legitimate hierarchy would render
 * thousands of nested rows; the cap turns that into a stated truncation
 * rather than a frozen tab.
 */

/** How deep the nested render goes before saying it stopped. */
export const MAX_TREE_DEPTH = 20;

export interface TreeNode {
  /** The target's ULID — unique per node instance path. */
  readonly target: string;
  readonly resolvedKey: string | undefined;
  readonly resolvedTitle: string | undefined;
  readonly resolvedStatus: string | undefined;
  readonly missing: boolean;
  /** Nesting level; the group's direct rows are 0. */
  readonly depth: number;
  /**
   * When set, this node repeats an ancestor and its children are not
   * walked. The value is the repeated ancestor's key (or ULID when it
   * does not resolve) — REL-21's "B already appears above".
   */
  readonly cycleWith: string | undefined;
  /** True when the depth cap stopped the walk here rather than a leaf. */
  readonly truncated: boolean;
  readonly children: readonly TreeNode[];
}

/** Index of every task by ULID, for walking `relationships` onward. */
export type TaskIndex = ReadonlyMap<string, TaskFrontmatterPublic>;

export function buildTaskIndex(
  tasks: readonly TaskFrontmatterPublic[],
): TaskIndex {
  const m = new Map<string, TaskFrontmatterPublic>();
  for (const t of tasks) m.set(t.id, t);
  return m;
}

/**
 * Expands one group's rows into a forest.
 *
 * @param rows the group's direct rows, already ordered
 * @param type the edge type to follow downward — the same side the
 *   group holds, so a "Child" group walks `child` edges and a "Parent"
 *   group walks `parent` edges
 * @param index every task by ULID
 * @param rootId the task the panel is showing, which is an ancestor of
 *   every node here and so seeds the cycle path
 */
export function buildTree(
  rows: readonly RelationshipRow[],
  type: string,
  index: TaskIndex,
  rootId: string,
): readonly TreeNode[] {
  const walk = (
    row: { target: string; resolvedKey: string | undefined; resolvedTitle: string | undefined; resolvedStatus: string | undefined; missing: boolean },
    depth: number,
    ancestors: readonly string[],
  ): TreeNode => {
    const repeatIdx = ancestors.indexOf(row.target);
    if (repeatIdx !== -1) {
      const repeated = index.get(row.target);
      return {
        target: row.target,
        resolvedKey: row.resolvedKey,
        resolvedTitle: row.resolvedTitle,
        resolvedStatus: row.resolvedStatus,
        missing: row.missing,
        depth,
        cycleWith: repeated?.key ?? row.resolvedKey ?? row.target,
        truncated: false,
        children: [],
      };
    }

    if (depth >= MAX_TREE_DEPTH) {
      return {
        target: row.target,
        resolvedKey: row.resolvedKey,
        resolvedTitle: row.resolvedTitle,
        resolvedStatus: row.resolvedStatus,
        missing: row.missing,
        depth,
        cycleWith: undefined,
        truncated: true,
        children: [],
      };
    }

    const task = index.get(row.target);
    const nextAncestors = [...ancestors, row.target];
    const children = (task?.relationships ?? [])
      .filter(r => r.type === type)
      .map(r => {
        const child = index.get(r.target);
        return walk(
          {
            target: r.target,
            resolvedKey: child?.key,
            resolvedTitle: child?.title,
            resolvedStatus: child?.status,
            // The index holds every task the list route returned. A
            // target absent from it is either deleted or filtered out
            // of that page; either way the row cannot claim a title,
            // and saying so is REL-24's treatment.
            missing: child === undefined,
          },
          depth + 1,
          nextAncestors,
        );
      });

    return {
      target: row.target,
      resolvedKey: row.resolvedKey,
      resolvedTitle: row.resolvedTitle,
      resolvedStatus: row.resolvedStatus,
      missing: row.missing,
      depth,
      cycleWith: undefined,
      truncated: false,
      children,
    };
  };

  return rows.map(row => walk(row, 0, [rootId]));
}

/** True when any node in the forest repeats an ancestor (REL-21). */
export function hasCycle(nodes: readonly TreeNode[]): boolean {
  return nodes.some(n => n.cycleWith !== undefined || hasCycle(n.children));
}
