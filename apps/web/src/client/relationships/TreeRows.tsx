import type { StatusDef } from "@loctt/contracts";
import { useState } from "react";

import type { RelationshipRow } from "./group.ts";
import { RelationshipRowView } from "./RelationshipRow.tsx";
import type { TreeNode } from "./tree.ts";

/**
 * The nested rows of a `graph: tree` group (REL-5, REL-21).
 *
 * ## Depth is visible and collapsible
 *
 * REL-5's first and fourth bullets. Indentation carries depth; a node
 * with children gets a disclosure that hides its descendants. The
 * collapsed set lives here, in component state, and the panel is keyed
 * by task id one level up — so the state cannot leak into another
 * task's panel, which REL-5's last clause forbids.
 *
 * ## Only the top level can be unlinked
 *
 * A descendant's edge lives on *its* parent, not on the task the user
 * is looking at, so unlinking it from here would rewrite a file the
 * page is not showing. Depth-0 rows carry the remove control (they are
 * this task's own edges); deeper rows are navigational, and their link
 * takes the user to the task that owns them.
 */
export function TreeRows({
  nodes,
  rows,
  statusOf,
  removing,
  onRemove,
}: {
  readonly nodes: readonly TreeNode[];
  /** The group's own rows, by target, for the depth-0 remove control. */
  readonly rows: readonly RelationshipRow[];
  readonly statusOf: (key: string | undefined) => StatusDef | undefined;
  readonly removing: boolean;
  readonly onRemove: (row: RelationshipRow) => void;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const render = (node: TreeNode, path: string): React.JSX.Element => {
    const nodePath = `${path}/${node.target}`;
    const isCollapsed = collapsed.has(nodePath);
    const own = node.depth === 0
      ? rows.find(r => r.target === node.target)
      : undefined;

    return (
      <li key={nodePath} className="list-none">
        <div
          data-testid="tree-node"
          data-depth={String(node.depth)}
          data-target={node.target}
          style={{ paddingLeft: `${String(node.depth * 16)}px` }}
          className="flex items-center gap-1"
        >
          {node.children.length > 0 ? (
            <button
              type="button"
              data-testid="tree-toggle"
              aria-expanded={!isCollapsed}
              aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${node.resolvedKey ?? node.target}`}
              onClick={() => {
                setCollapsed(prev => {
                  const next = new Set(prev);
                  if (next.has(nodePath)) next.delete(nodePath);
                  else next.add(nodePath);
                  return next;
                });
              }}
              className="shrink-0 rounded px-1 text-[11px] text-text-tertiary hover:bg-bg-muted"
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          ) : (
            <span aria-hidden="true" className="inline-block w-[18px] shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            {own !== undefined ? (
              <RelationshipRowView
                row={own}
                statusOf={statusOf}
                removing={removing}
                onRemove={() => { onRemove(own); }}
              />
            ) : (
              /* A descendant: key, title and status so the subtree is
                 scannable (REL-5's third bullet), without a remove
                 control it has no right to. */
              <RelationshipRowView
                row={{
                  type: "",
                  target: node.target,
                  resolvedKey: node.resolvedKey,
                  resolvedTitle: node.resolvedTitle,
                  resolvedStatus: node.resolvedStatus,
                  missing: node.missing,
                  rank: undefined,
                  index: 0,
                  duplicates: 1,
                }}
                statusOf={statusOf}
                removing={false}
                onRemove={undefined}
              />
            )}
          </div>

          {node.cycleWith !== undefined && (
            /* REL-21's second bullet, verbatim in shape: the tree
               display stops at the repeat and marks it. */
            <span
              data-testid="tree-cycle-marker"
              className="shrink-0 rounded border border-dashed border-danger-fg/60 px-1 py-0.5 text-[11px] text-danger-fg"
            >
              cycle detected — {node.cycleWith} already appears above
            </span>
          )}

          {node.truncated && (
            <span className="shrink-0 text-[11px] text-text-tertiary">
              deeper levels not shown
            </span>
          )}
        </div>

        {!isCollapsed && node.children.length > 0 && (
          <ul className="m-0 list-none p-0">
            {node.children.map(child => render(child, nodePath))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul className="m-0 list-none p-0">
      {nodes.map(node => render(node, ""))}
    </ul>
  );
}
