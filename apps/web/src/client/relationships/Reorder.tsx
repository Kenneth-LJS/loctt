import { useState } from "react";

import { Icon } from "../ui/Icon.tsx";

/**
 * The one reorder control for every relationship group on the task page
 * (B40, K140, K143): the flat groups and the Children tree's direct
 * children use the same handle, the same keyboard model and the same
 * announcements, so moving a child works exactly like moving a blocker.
 *
 * ## Keyboard: pick up, move, drop (REL-15)
 *
 * Arrow up/down on a handle picks the row up and moves it *visually*;
 * nothing is written. Enter or Space drops it, committing one rerank;
 * Escape puts it back with no write ever leaving. Each move and the drop
 * or cancel are announced through a polite live region.
 *
 * ## Pointer: drag the row
 *
 * The row carrying `rowProps(i)` is draggable and a drop target; a drop
 * commits one rerank. In the Children tree the depth-0 `<li>` carries
 * them, so a child's own subtree moves with it and grandchildren get no
 * handle of their own (their edges belong to their own parent).
 *
 * ## The handle
 *
 * A button (tabbable, keyboard-drivable) at least 24×24px (WCAG 2.5.8),
 * drawn with the `drag` icon rather than the braille "⠿" (A208), named
 * "Reorder {key}, position N of M. …".
 */

export interface ReorderOptions {
  /** How many rows the group has. */
  readonly count: number;
  /** The key (or target) naming the row at stored index `i`, for announcements. */
  readonly nameAt: (i: number) => string;
  /** Commits a move from stored index `from` to visual index `to`. */
  readonly onMove: (from: number, to: number) => void;
  /** False for a group that cannot be reordered (an undeclared kind). */
  readonly enabled: boolean;
}

export interface Reorder {
  /** `items` (in stored order) in the order to render them right now. */
  readonly order: <T>(items: readonly T[]) => readonly T[];
  /** Drag-and-drop props for the element wrapping rendered row `i`. */
  readonly rowProps: (i: number) => React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
  /** The handle for rendered row `i`, named `name`; null when disabled. */
  readonly handle: (i: number, name: string) => React.ReactNode;
  /** The live region; render once per group. */
  readonly announcer: React.ReactNode;
}

export function useReorder({ count, nameAt, onMove, enabled }: ReorderOptions): Reorder {
  /** The row being dragged, by rendered index. */
  const [dragging, setDragging] = useState<number | null>(null);
  /**
   * A keyboard pickup in progress: the row's stored index and where it
   * sits now. While set, rows render in the buffered order; Escape drops
   * it with no write, a drop calls `onMove(origin, current)` once.
   */
  const [pickup, setPickup] = useState<{ origin: number; current: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const order = <T,>(items: readonly T[]): readonly T[] =>
    pickup === null ? items : moveInArray(items, pickup.origin, pickup.current);

  const step = (i: number, delta: number): void => {
    setPickup(prev => {
      const active = prev ?? { origin: i, current: i };
      const to = active.current + delta;
      if (to < 0 || to >= count) return active;
      setAnnouncement(`${nameAt(active.origin)} moved to position ${String(to + 1)} of ${String(count)}`);
      return { origin: active.origin, current: to };
    });
  };

  const onKeyDown = (i: number) => (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(i, -1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(i, 1);
    } else if ((e.key === "Enter" || e.key === " ") && pickup !== null) {
      e.preventDefault();
      setAnnouncement(
        `${nameAt(pickup.origin)} dropped at position ${String(pickup.current + 1)} of ${String(count)}`,
      );
      if (pickup.current !== pickup.origin) onMove(pickup.origin, pickup.current);
      setPickup(null);
    } else if (e.key === "Escape" && pickup !== null) {
      e.preventDefault();
      setPickup(null);
      setAnnouncement("Move cancelled");
    }
  };

  const rowProps = (i: number): React.HTMLAttributes<HTMLElement> & { draggable?: boolean } =>
    !enabled
      ? {}
      : {
          draggable: true,
          onDragStart: e => {
            // Only the row itself starts a drag, not a nested link or button.
            e.stopPropagation();
            setDragging(i);
          },
          onDragOver: e => { if (dragging !== null) e.preventDefault(); },
          onDrop: e => {
            if (dragging === null) return;
            e.preventDefault();
            e.stopPropagation();
            onMove(dragging, i);
            setDragging(null);
          },
          onDragEnd: () => { setDragging(null); },
        };

  const handle = (i: number, name: string): React.ReactNode =>
    !enabled
      ? null
      : (
          <ReorderHandle
            name={name}
            position={i + 1}
            count={count}
            onKeyDown={onKeyDown(i)}
          />
        );

  const announcer = (
    <span role="status" aria-live="polite" className="sr-only" data-testid="reorder-announcement">
      {announcement}
    </span>
  );

  return { order, rowProps, handle, announcer };
}

/** The drawn, ≥24px reorder handle (REL-6, REL-15, WCAG 2.5.8). */
export function ReorderHandle({
  name,
  position,
  count,
  onKeyDown,
}: {
  readonly name: string;
  readonly position: number;
  readonly count: number;
  readonly onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="drag-handle"
      aria-label={
        `Reorder ${name}, position ${String(position)} of ${String(count)}. `
        + `Arrow up and down to move, Enter to drop, Escape to cancel.`
      }
      onKeyDown={onKeyDown}
      className="inline-flex min-h-[24px] min-w-[24px] shrink-0 cursor-grab items-center justify-center rounded text-text-tertiary hover:bg-bg-muted"
    >
      <Icon name="drag" size={14} />
    </button>
  );
}

/**
 * A copy of `rows` with the element at `from` moved to `to`. Used only
 * for the in-flight keyboard pickup's visual order; it never touches disk.
 */
export function moveInArray<T>(rows: readonly T[], from: number, to: number): readonly T[] {
  if (from === to) return rows;
  const next = [...rows];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return rows;
  next.splice(to, 0, moved);
  return next;
}
