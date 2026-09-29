import type { ReactNode } from "react";

import { SortableTree } from "../ui/SortableTree.tsx";

/**
 * A flat, boxed, reorderable Settings list (SET-6, SET-21, SET-34, SET-12)
 * on the shared `ui/SortableTree` (K156): statuses, priorities, task
 * types, relationships and card layout. (Customize sidebar, SET-13 and
 * SHL-45, is a nested tree and uses `SortableTree` directly.)
 *
 * It only fixes the Settings conventions around the primitive, which
 * owns the drag, the drop line, the keyboard pickup and the
 * announcements:
 *
 *  - test ids `{prefix}-row-{key}`, `{prefix}-handle-{key}` and
 *    `{prefix}-announcement`;
 *  - each row's `<li>` carries `id="row-{key}"`, the K100 deep-link
 *    anchor `useScrollToHash` resolves;
 *  - each row is a bordered box with the handle first.
 *
 * The order rendered is the order the parent holds, so a failed write
 * snaps back (SET-34) by the parent reverting its copy.
 */
export function SettingsSortableList<T>({
  items,
  rowKey,
  rowLabel,
  onMove,
  enabled = true,
  reorderable = true,
  testIdPrefix,
  children,
}: {
  readonly items: readonly T[];
  readonly rowKey: (item: T) => string;
  /** Accessible name for the handle, e.g. the status label. */
  readonly rowLabel: (item: T) => string;
  readonly onMove: (from: number, to: number) => void;
  /** False while a write is in flight or the list cannot reorder. */
  readonly enabled?: boolean;
  /**
   * False for a list whose order means nothing (card layout's hidden
   * fields): no handles, only their 24px slot, so rows line up with a
   * reorderable list above.
   */
  readonly reorderable?: boolean;
  readonly testIdPrefix: string;
  readonly children: (item: T, index: number) => ReactNode;
}): React.JSX.Element {
  return (
    <SortableTree
      items={items}
      getId={rowKey}
      itemName={rowLabel}
      onMove={m => { onMove(m.fromIndex, m.toIndex); }}
      disabled={!enabled}
      canReorder={() => reorderable}
      listClassName="space-y-1"
      testIds={{
        row: item => `${testIdPrefix}-row-${rowKey(item)}`,
        handle: item => `${testIdPrefix}-handle-${rowKey(item)}`,
        announcement: `${testIdPrefix}-announcement`,
      }}
      rowAttributes={item => ({ id: `row-${rowKey(item)}` })}
      renderItem={(item, ctx) => (
        <div
          className={
            "flex items-center gap-2 rounded-md border px-2 py-1.5 "
            + (ctx.moving ? "border-accent bg-bg-muted" : "border-border-subtle bg-bg-surface")
          }
        >
          {ctx.leading}
          <div className="min-w-0 flex-1">{children(item, ctx.index)}</div>
        </div>
      )}
    />
  );
}
