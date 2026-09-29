import type { StatusDef } from "@loctt/contracts";
import { useMemo } from "react";

import { SortableTree } from "../ui/SortableTree.tsx";
import type { RelationshipGroup, RelationshipRow } from "./group.ts";
import { RelationshipRowView } from "./RelationshipRow.tsx";
import type { TaskIndex, TreeNode } from "./tree.ts";
import { buildTree, hasCycle } from "./tree.ts";

/**
 * One relationship group's rows on the task page, built on the shared
 * `ui/SortableTree` (K156). Every group uses it, so the handle, the key
 * and the title start at the same x in Blocks, Parent and Child alike:
 *
 * - a flat group (any kind whose `graph` is not `tree`) renders with
 *   nesting off;
 * - a `graph: tree` group renders nested (REL-5), unlimited depth,
 *   expanded, and reorders only its direct rows (B40).
 *
 * ## Only the top level is this task's (REL-5, B40)
 *
 * A descendant's edge lives on *its* parent, not on the task the user is
 * looking at. So only depth-0 rows carry the reorder handle and the
 * remove control; deeper rows show key, title and status and link to the
 * task that owns them. A row's subtree sits inside its `<li>`, so it
 * moves with it.
 *
 * ## Cycles and depth (REL-21)
 *
 * `buildTree` stops a hand-edited loop at the repeat and marks it; the
 * row names the ancestor it repeats, and the group says how to break it.
 * A hierarchy deeper than `MAX_TREE_DEPTH` says it stopped.
 *
 * ## Nothing moves locally (REL-46)
 *
 * The rows are the last response. A drop calls `onMove` with stored
 * indices; the panel sends one rerank and re-renders from the refetch,
 * so a refused rerank leaves the row where the file says it is. A
 * keyboard drop keeps its order on screen until that refetch lands (the
 * primitive's settling order), so the row neither flickers back nor
 * loses focus in between; a refused rerank puts it back at once.
 */

interface TaskTreeItem {
  readonly id: string;
  readonly row: RelationshipRow;
  /** True for the group's own (depth-0) rows: this task's edges. */
  readonly own: boolean;
  readonly node: TreeNode | undefined;
  readonly children: readonly TaskTreeItem[];
}

export function TaskTree({
  group,
  taskId,
  taskIndex,
  statusOf,
  removing,
  onRemove,
  onMove,
}: {
  readonly group: RelationshipGroup;
  /** The task whose page this is: the root of the tree's cycle path. */
  readonly taskId: string;
  readonly taskIndex: TaskIndex;
  readonly statusOf: (key: string | undefined) => StatusDef | undefined;
  readonly removing: boolean;
  readonly onRemove: (row: RelationshipRow) => void;
  /**
   * A depth-0 move, in the group's stored row indices. The promise settles
   * with the write, so a keyboard drop keeps its order on screen until
   * the refetch lands (a rejection puts the stored order back).
   */
  readonly onMove: (from: number, to: number) => Promise<unknown> | undefined;
}): React.JSX.Element {
  const nodes = useMemo(
    () => (group.tree ? buildTree(group.rows, group.key, taskIndex, taskId) : undefined),
    [group.tree, group.rows, group.key, taskIndex, taskId],
  );

  // `buildTree` maps `group.rows[i]` to `nodes[i]`, so the depth-0 items
  // keep the group's stored indices either way.
  const items = useMemo<readonly TaskTreeItem[]>(
    () => group.rows.map((row, i) => {
      const node = nodes?.[i];
      return {
        id: `${row.type}:${row.target}`,
        row,
        own: true,
        node,
        children: node === undefined ? [] : descendants(node),
      };
    }),
    [group.rows, nodes],
  );

  const cyclic = nodes !== undefined && hasCycle(nodes);

  return (
    <div>
      {cyclic && (
        /* REL-21's fourth bullet: which edges form the cycle, and where
           to fix them. The per-row marker names the ancestor. */
        <p
          role="alert"
          data-testid="relationship-cycle"
          className="mb-1 px-1 text-[0.8571rem] text-danger-fg"
        >
          This “{group.label}” hierarchy contains a cycle. The rows marked
          below repeat a task that already appears above them. Remove one of
          the two links to break it.
        </p>
      )}
      <SortableTree
        items={items}
        getId={item => item.id}
        getChildren={item => item.children}
        itemName={item => item.row.resolvedKey ?? item.row.target}
        nesting={group.tree}
        // Every declared kind is ordered (K143); core refuses to rerank a
        // kind workflow.yaml does not declare, so that group gets none.
        canReorder={level => level.depth === 0 && !group.unknown}
        onMove={m => onMove(m.fromIndex, m.toIndex)}
        listClassName="space-y-0.5"
        renderItem={(item, ctx) => {
          const view = (
            <RelationshipRowView
              row={item.row}
              statusOf={statusOf}
              removing={item.own && removing}
              onRemove={item.own ? () => { onRemove(item.row); } : undefined}
            >
              {ctx.leading}
            </RelationshipRowView>
          );
          if (item.node === undefined) return view;
          const node = item.node;
          return (
            <div
              data-testid="tree-node"
              data-depth={String(ctx.depth)}
              data-target={node.target}
              className="flex items-center gap-1"
            >
              <div className="min-w-0 flex-1">{view}</div>
              {node.cycleWith !== undefined && (
                /* REL-21's second bullet: the display stops at the
                   repeat and marks it. */
                <span
                  data-testid="tree-cycle-marker"
                  className="shrink-0 rounded border border-dashed border-danger-fg/60 px-1 py-0.5 text-[0.7857rem] text-danger-fg"
                >
                  cycle detected — {node.cycleWith} already appears above
                </span>
              )}
              {node.truncated && (
                <span className="shrink-0 text-[0.7857rem] text-text-tertiary">
                  deeper levels not shown
                </span>
              )}
            </div>
          );
        }}
      />
    </div>
  );
}

/** A node's children as tree items, with ids unique within each level. */
function descendants(node: TreeNode): readonly TaskTreeItem[] {
  const seen = new Map<string, number>();
  return node.children.map(child => {
    const n = seen.get(child.target) ?? 0;
    seen.set(child.target, n + 1);
    return {
      id: n === 0 ? child.target : `${child.target}~${String(n)}`,
      // A descendant: key, title and status so the subtree is scannable
      // (REL-5's third bullet), without a remove control it has no right to.
      row: {
        type: "",
        target: child.target,
        resolvedKey: child.resolvedKey,
        resolvedTitle: child.resolvedTitle,
        resolvedStatus: child.resolvedStatus,
        missing: child.missing,
        rank: undefined,
        index: 0,
        duplicates: 1,
      },
      own: false,
      node: child,
      children: descendants(child),
    };
  });
}
