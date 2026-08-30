import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import type { BoardColumn } from "./columns.ts";
import type { DropNeighbours, DropSlot } from "./dragModel.ts";
import { DRAG_THRESHOLD_PX, insertionIndex, isNoOpDrop, neighboursAt, statusForColumn } from "./dragModel.ts";

/**
 * The board's drag gesture (M3.2).
 *
 * Built on pointer events rather than HTML5 drag-and-drop or a
 * library. Three of the cases rule the alternatives out:
 *
 *  - BRD-37 needs a *threshold* — a 2px move must stay a click and
 *    navigate. HTML5 `dragstart` fires on the browser's own threshold,
 *    which is not ours to set, and it suppresses the click entirely.
 *  - BRD-37 and BRD-36 need `Esc` and an external event to cancel a
 *    drag in flight, returning the card to its origin with no request.
 *  - BRD-32 needs the drop to be computed against the neighbours the
 *    user *saw at release*, which means owning the drag's snapshot
 *    rather than letting a refetch re-sort underneath it.
 *
 * A drag library would also be a new dependency, which this ticket has
 * no mandate to add.
 */

export interface DragState {
  /** The card being dragged. */
  readonly key: string;
  readonly columnId: string;
  /**
   * The cards this one sat between when the drag began.
   *
   * Neighbours rather than an index because the index renumbers the
   * moment the card is lifted out of the flow — see `isNoOpDrop`.
   */
  readonly originNeighbours: DropNeighbours;
  /** Where the pointer is now, for the floating card. */
  readonly x: number;
  readonly y: number;
  /** Pointer offset within the card, so it does not jump on grab. */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  /** The slot the card would land in, or null when outside any column. */
  readonly over: DropSlot | null;
}

export interface DropRequest {
  readonly key: string;
  /** Absent for an intra-column reorder — see `useBoardMove`. */
  readonly status?: string;
  readonly before?: string;
  readonly after?: string;
}

interface PendingPress {
  readonly key: string;
  readonly columnId: string;
  readonly originNeighbours: DropNeighbours;
  readonly startX: number;
  readonly startY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly pointerId: number;
}

export interface BoardDragOptions {
  readonly columns: readonly BoardColumn[];
  readonly buckets: ReadonlyMap<string, readonly TaskFrontmatterPublic[]>;
  readonly onDrop: (req: DropRequest) => void;
}

export function useBoardDrag({ columns, buckets, onDrop }: BoardDragOptions) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pending = useRef<PendingPress | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  /**
   * The board as it was when the drag began.
   *
   * BRD-32: a poll landing mid-drag must not re-sort columns under the
   * cursor, and the drop must be computed against what the user saw at
   * release. Reading live `buckets` during the drag would do exactly
   * the opposite. New data still arrives — it is simply applied after
   * the drop, when this snapshot is dropped.
   */
  const snapshot = useRef<ReadonlyMap<string, readonly TaskFrontmatterPublic[]> | null>(null);

  const cancel = useCallback(() => {
    pending.current = null;
    snapshot.current = null;
    setDrag(null);
  }, []);

  /**
   * BRD-36: a column toggled off mid-drag must cancel the drag rather
   * than drop into a column that is no longer rendered. The drag is
   * cancelled when its origin *or* its hovered column disappears from
   * the rendered set.
   */
  useEffect(() => {
    const d = dragRef.current;
    if (d === null) return;
    const ids = new Set(columns.map(c => c.id));
    if (!ids.has(d.columnId) || (d.over !== null && !ids.has(d.over.columnId))) {
      cancel();
    }
  }, [columns, cancel]);

  /** BRD-37: `Esc` cancels, returns the card, and issues no request. */
  useEffect(() => {
    if (drag === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [drag, cancel]);

  /**
   * Resolves a pointer position to the slot it would drop into.
   *
   * Columns and cards are located by `data-` attributes rather than by
   * refs so this stays independent of how many columns render; the
   * dragged card is skipped because it is lifted out of the flow and
   * its own box is not a drop boundary.
   */
  const slotAt = useCallback((x: number, y: number, draggedKey: string): DropSlot | null => {
    const el = document.elementFromPoint(x, y);
    const columnEl = el?.closest<HTMLElement>("[data-column-id]");
    const columnId = columnEl?.dataset["columnId"];
    if (columnId === undefined) return null;

    // The dragged card is NOT filtered out: it still occupies its slot
    // in the column (see `rest` in BoardView), so its box is a real
    // boundary and the layout under the pointer is the one the user
    // sees. Filtering it out here while it still renders — or removing
    // it from the flow — makes the geometry disagree with the screen
    // by exactly one slot.
    const cardEls = Array.from(
      columnEl?.querySelectorAll<HTMLElement>("[data-task-key]") ?? [],
    );

    const rects = cardEls.map(c => {
      const r = c.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, key: c.dataset["taskKey"] };
    });

    const raw = insertionIndex(y, rects);
    // Report the index among the cards that will REMAIN once the
    // dragged card is lifted, which is the basis `neighboursAt` and
    // `isNoOpDrop` work from. A slot at or past the dragged card's own
    // position loses one to its removal.
    const draggedAt = rects.findIndex(r => r.key === draggedKey);
    const index = draggedAt !== -1 && raw > draggedAt ? raw - 1 : raw;

    return { columnId, index };
  }, []);

  const onPointerDown = useCallback(
    (
      e: React.PointerEvent,
      key: string,
      columnId: string,
      originNeighbours: DropNeighbours,
    ): void => {
      // Left button only; a right-click opens a context menu and must
      // not arm a drag.
      if (e.button !== 0) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      pending.current = {
        key,
        columnId,
        originNeighbours,
        startX: e.clientX,
        startY: e.clientY,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
        width: rect.width,
        pointerId: e.pointerId,
      };
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const p = pending.current;
      const d = dragRef.current;

      if (d === null && p !== null) {
        // BRD-37: below the threshold this is still a click.
        const dx = Math.abs(e.clientX - p.startX);
        const dy = Math.abs(e.clientY - p.startY);
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

        snapshot.current = buckets;
        setDrag({
          key: p.key,
          columnId: p.columnId,
          originNeighbours: p.originNeighbours,
          x: e.clientX,
          y: e.clientY,
          offsetX: p.offsetX,
          offsetY: p.offsetY,
          width: p.width,
          over: slotAt(e.clientX, e.clientY, p.key),
        });
        return;
      }

      if (d === null) return;
      e.preventDefault();
      setDrag({ ...d, x: e.clientX, y: e.clientY, over: slotAt(e.clientX, e.clientY, d.key) });
    };

    const onUp = (): void => {
      const d = dragRef.current;
      const snap = snapshot.current;
      pending.current = null;

      if (d === null) {
        // A press that never became a drag. The card's own click
        // handler navigates (BRD-8); nothing to do here.
        return;
      }

      // BRD-11: released outside any column — cancel, no request.
      if (d.over === null || snap === null) {
        cancel();
        return;
      }

      const target = d.over;
      const targetColumn = columns.find(c => c.id === target.columnId);
      if (targetColumn === undefined) {
        cancel();
        return;
      }

      // The neighbours the user actually saw at release (BRD-32),
      // taken from the drag's snapshot with the dragged card removed.
      const cards = (snap.get(target.columnId) ?? []).filter(t => t.key !== d.key);

      // BRD-31: dropped back between the same two cards. No request.
      if (isNoOpDrop(d.columnId, target, cards, d.originNeighbours)) {
        cancel();
        return;
      }

      const { after, before } = neighboursAt(cards, target.index);

      // BRD-12: staying inside the column writes rank only, even when
      // that column collapses several statuses.
      const crossing = d.columnId !== target.columnId;
      // BRD-13: a multi-status column's *first* status, deterministically.
      const status = crossing ? statusForColumn(targetColumn) : undefined;

      cancel();
      onDrop({
        key: d.key,
        ...(status !== undefined ? { status } : {}),
        ...(before !== undefined ? { before } : {}),
        ...(after !== undefined ? { after } : {}),
      });
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [buckets, columns, slotAt, cancel, onDrop]);

  return { drag, onPointerDown };
}
