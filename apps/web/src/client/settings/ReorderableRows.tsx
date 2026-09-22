import { type ReactNode, useState } from "react";

/**
 * A drag-reorderable list of rows (SET-6, SET-21, SET-34).
 *
 * HTML5 drag-and-drop plus a keyboard handle, matching the pattern
 * already in `relationships/RelationshipsPanel.tsx` rather than pulling
 * in a drag library for one panel.
 *
 * Two things here are load-bearing for the cases:
 *
 *  - **The drop indicator is a `data-` attribute, not only a class.**
 *    SET-6 asserts a live drop indicator; a Tailwind ring is not
 *    something a test can distinguish from any other ring, and three
 *    M3 cases went unassertable for exactly that reason.
 *  - **The order rendered is the order the parent holds.** This
 *    component keeps no copy of the list. SET-34 needs a failed write
 *    to snap back to the previous order, and it can only do that if
 *    there is one source of truth — the parent's, which it reverts.
 */

export interface ReorderableRowsProps<T> {
  readonly items: readonly T[];
  readonly rowKey: (item: T) => string;
  /** Accessible name for the handle, e.g. the status label. */
  readonly rowLabel: (item: T) => string;
  readonly onMove: (from: number, to: number) => void;
  /** False while a write is in flight or the panel cannot reorder. */
  readonly enabled?: boolean;
  readonly testIdPrefix: string;
  /**
   * The DOM `id` for a row's outer `<li>` — the deep-link anchor a
   * point-of-use "Edit X…" link scrolls to (K100). Defaults to
   * `row-<rowKey>`, matching the K100 `#row-<id>` convention that
   * `useScrollToHash` resolves. Returning `undefined` omits the id.
   */
  readonly rowId?: (item: T) => string | undefined;
  readonly children: (item: T, index: number) => ReactNode;
}

export function ReorderableRows<T>({
  items,
  rowKey,
  rowLabel,
  onMove,
  enabled = true,
  testIdPrefix,
  rowId = item => `row-${rowKey(item)}`,
  children,
}: ReorderableRowsProps<T>) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const move = (from: number, to: number, via: string): void => {
    if (to < 0 || to >= items.length || from === to) return;
    const item = items[from];
    if (item === undefined) return;
    setAnnouncement(
      `${rowLabel(item)} moved to position ${String(to + 1)} of ${String(items.length)} (${via})`,
    );
    onMove(from, to);
  };

  return (
    <div>
      <span role="status" aria-live="polite" className="sr-only" data-testid={`${testIdPrefix}-announcement`}>
        {announcement}
      </span>
      <ul className="m-0 list-none space-y-1 p-0">
        {items.map((item, i) => (
          <li
            key={rowKey(item)}
            id={rowId(item)}
            data-testid={`${testIdPrefix}-row-${rowKey(item)}`}
            data-position={String(i + 1)}
            // SET-6: the live drop indicator, exposed so a test can see
            // it. `above`/`below` says which edge the row would land on.
            data-drop-indicator={
              over === i && dragging !== null && dragging !== i
                ? (dragging < i ? "below" : "above")
                : undefined
            }
            data-dragging={dragging === i ? "true" : undefined}
            draggable={enabled}
            onDragStart={() => { setDragging(i); }}
            onDragOver={e => {
              if (!enabled || dragging === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDragLeave={() => { setOver(prev => (prev === i ? null : prev)); }}
            onDrop={e => {
              if (!enabled || dragging === null) return;
              e.preventDefault();
              move(dragging, i, "drag");
              setDragging(null);
              setOver(null);
            }}
            onDragEnd={() => { setDragging(null); setOver(null); }}
            className={
              "flex items-center gap-2 rounded-md border px-2 py-1.5 "
              + (over === i && dragging !== null && dragging !== i
                ? "border-accent bg-bg-muted"
                : "border-border-subtle bg-bg-surface")
            }
          >
            <button
              type="button"
              data-testid={`${testIdPrefix}-handle-${rowKey(item)}`}
              disabled={!enabled}
              aria-label={
                `Reorder ${rowLabel(item)}, position ${String(i + 1)} of ${String(items.length)}. `
                + `Arrow up and down to move.`
              }
              onKeyDown={e => {
                if (e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1, "keyboard"); }
                if (e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1, "keyboard"); }
              }}
              className="shrink-0 cursor-grab px-1 text-[0.8571rem] text-text-tertiary disabled:cursor-not-allowed"
            >
              ⠿
            </button>
            <div className="min-w-0 flex-1">{children(item, i)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
