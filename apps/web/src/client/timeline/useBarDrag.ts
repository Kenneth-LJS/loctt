import type { TimelineZoom } from "@loctt/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DateRange } from "./geometry.ts";
import { addDays, DAY_WIDTH, daysBetween } from "./geometry.ts";

/**
 * The timeline's bar-drag gesture (M3.3b).
 *
 * Pointer events rather than HTML5 drag-and-drop, for the reasons
 * `useBoardDrag` states and two more of its own:
 *
 *  - TML-17's third bullet needs a *threshold* — a click that was the
 *    tail of a drag must not navigate, and a 2px twitch must still be
 *    a click. The browser's own `dragstart` threshold is not ours to
 *    set and it suppresses the click entirely.
 *  - TML-38 needs `Esc` to cancel a drag in flight with no request.
 *  - TML-37 needs the release to commit "the dates the user saw at
 *    release", which means owning the drag's origin snapshot rather
 *    than reading live task data that a poll may have replaced.
 *
 * ## Snapping is done in days, not pixels
 *
 * The gesture tracks a **day delta**, computed from the pointer's
 * pixel travel divided by the zoom's day width and floored to a whole
 * day. TML-12: "the resulting dates are whole days; no time component
 * and no half-day landing". Working in days throughout means the
 * candidate dates shown live during the drag are the *same values*
 * that get written at release — a preview computed from pixels and a
 * commit computed from dates is how the label and the payload come to
 * disagree.
 *
 * A consequence worth naming: at month zoom a day is 4px, so a delta
 * of one day needs 4px of travel. That is TML-12's aiming problem, and
 * the live candidate-date label is what answers it.
 */

/** Which part of the bar was grabbed. */
export type DragEdge = "start" | "end" | "body";

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * Below this it stays a click and navigates (TML-17). Matches the
 * board's `DRAG_THRESHOLD_PX` — the same gesture distinction, and a
 * user who learns the board's feel should not find the timeline
 * different.
 */
export const DRAG_THRESHOLD_PX = 4;

/** A drag in flight. */
export interface BarDragState {
  readonly taskId: string;
  readonly key: string;
  readonly edge: DragEdge;
  /** Dates as they were when the drag began — the revert target. */
  readonly originStart: string;
  readonly originDue: string;
  /** Whole days the gesture has travelled, snapped. */
  readonly deltaDays: number;
  /** The dates the bar is currently drawn at. */
  readonly start: string;
  readonly due: string;
  /** Pointer position, for the candidate-date label. */
  readonly x: number;
  readonly y: number;
}

/** What a released drag asks to be written. */
export interface BarDropRequest {
  readonly taskId: string;
  readonly key: string;
  readonly edge: DragEdge;
  readonly originStart: string;
  readonly originDue: string;
  /** Present only for a left-edge or body drag. */
  readonly start_date?: string;
  /** Present only for a right-edge or body drag. */
  readonly due_date?: string;
}

interface PendingPress {
  readonly taskId: string;
  readonly key: string;
  readonly edge: DragEdge;
  readonly originStart: string;
  readonly originDue: string;
  readonly startX: number;
  readonly startY: number;
}

/**
 * Applies a day delta to a bar, per the edge that was grabbed.
 *
 * Exported and pure because this is the whole of TML-9/10/11's
 * arithmetic, and a UI test asserting "the bar moved" passes whether
 * or not the delta was applied to the right ends.
 *
 * TML-11's third bullet — "the delta applied to both dates is
 * identical — no off-by-one where the start moves 4 days and the due
 * moves 3" — is held structurally: the body branch calls `addDays`
 * with the *same* `delta` on both, so an off-by-one is not expressible
 * without changing both call sites. TML-11's second bullet (duration
 * preserved) follows from the same fact.
 *
 * TML-36's last bullet — "a bar can never be dragged to a zero-day or
 * negative duration; the resize stops at one day" — is the clamp on
 * the two edge branches. It is a clamp rather than a rejection because
 * the case offers both and clamping keeps the gesture continuous: the
 * bar stops shrinking and the user sees why, instead of the bar
 * inverting and the write failing later.
 */
export function applyDelta(
  edge: DragEdge,
  start: string,
  due: string,
  delta: number,
): { readonly start: string; readonly due: string } {
  if (edge === "body") {
    return { start: addDays(start, delta), due: addDays(due, delta) };
  }
  if (edge === "start") {
    // Clamped so the start never passes the due date: at most
    // `daysBetween(start, due)` days later than it began.
    const max = daysBetween(start, due);
    return { start: addDays(start, Math.min(delta, max)), due };
  }
  // The end edge, clamped the other way: never earlier than the start.
  const min = -daysBetween(start, due);
  return { start, due: addDays(due, Math.max(delta, min)) };
}

export interface BarDragOptions {
  readonly range: DateRange;
  readonly zoom: TimelineZoom;
  /** Origin dates by task id, read once at press. */
  readonly datesById: ReadonlyMap<string, { readonly start: string; readonly due: string }>;
  /** Task keys by id, so the drop names the task the API expects. */
  readonly keyById: ReadonlyMap<string, string>;
  readonly onDrop: (req: BarDropRequest) => void;
}

export function useBarDrag(opts: BarDragOptions) {
  const { zoom, datesById, keyById, onDrop } = opts;
  const [drag, setDrag] = useState<BarDragState | null>(null);
  const pending = useRef<PendingPress | null>(null);
  const dragRef = useRef<BarDragState | null>(null);
  dragRef.current = drag;

  /**
   * Set when a drag actually happened, cleared on the next press.
   *
   * TML-17: "a click that was actually the tail of a drag does not
   * navigate". The bar's `onClick` fires after `pointerup`, so the
   * suppression has to outlive the drag state by one event — a flag
   * the click handler reads and the next press resets.
   */
  const draggedRef = useRef(false);

  const cancel = useCallback(() => {
    pending.current = null;
    setDrag(null);
  }, []);

  /** TML-38: `Esc` restores the original geometry and issues no request. */
  useEffect(() => {
    if (drag === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // Suppress the click that a later `pointerup` would otherwise
      // turn into a navigation: the user cancelled, they did not ask
      // to open the task.
      draggedRef.current = true;
      cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [drag, cancel]);

  const onBarPointerDown = useCallback(
    (e: React.PointerEvent, taskId: string, edge: DragEdge): void => {
      // Left button only; a right-click opens a context menu and must
      // not arm a drag.
      if (e.button !== 0) return;
      const dates = datesById.get(taskId);
      const key = keyById.get(taskId);
      if (dates === undefined || key === undefined) return;
      // An edge handle sits inside the bar's own box, so its press
      // would also reach the body handler and the last one to run
      // would win. Stopping propagation here makes the grabbed edge
      // unambiguous — TML-36's "edge-drag and body-drag hit targets
      // are distinguishable".
      if (edge !== "body") e.stopPropagation();
      draggedRef.current = false;
      pending.current = {
        taskId,
        key,
        edge,
        originStart: dates.start,
        originDue: dates.due,
        startX: e.clientX,
        startY: e.clientY,
      };
    },
    [datesById, keyById],
  );

  /**
   * Whether the click now being dispatched is a drag's tail (TML-17).
   *
   * Reads *and clears*: the flag is consumed by the one click it is
   * about, so a genuine click on the same bar immediately afterwards
   * still navigates.
   */
  const consumeDragTail = useCallback((): boolean => {
    const was = draggedRef.current;
    draggedRef.current = false;
    return was;
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const p = pending.current;
      const d = dragRef.current;

      if (d === null && p !== null) {
        // TML-17: below the threshold this is still a click.
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD_PX) return;
        draggedRef.current = true;
        setDrag({
          taskId: p.taskId,
          key: p.key,
          edge: p.edge,
          originStart: p.originStart,
          originDue: p.originDue,
          deltaDays: 0,
          start: p.originStart,
          due: p.originDue,
          x: e.clientX,
          y: e.clientY,
        });
        return;
      }

      if (d === null || p === null) return;
      e.preventDefault();
      // Pixel travel → whole days. `Math.round` here, not `floor`:
      // this is a *delta* from the grab point, not a lookup of the day
      // under an absolute pixel, so the nearest whole day is the one
      // the user is aiming at. `xToDate`'s floor is right for its own
      // question (which column contains this pixel) and wrong for
      // this one — flooring a delta would bias every drag one day
      // backwards.
      const delta = Math.round((e.clientX - p.startX) / DAY_WIDTH[zoom]);
      const next = applyDelta(p.edge, p.originStart, p.originDue, delta);
      setDrag({
        taskId: p.taskId,
        key: p.key,
        edge: p.edge,
        originStart: p.originStart,
        originDue: p.originDue,
        deltaDays: delta,
        start: next.start,
        due: next.due,
        x: e.clientX,
        y: e.clientY,
      });
    };

    const onUp = (): void => {
      const d = dragRef.current;
      pending.current = null;
      if (d === null) {
        // A press that never became a drag; the bar's click handler
        // navigates (TML-17).
        return;
      }
      cancel();

      // TML-39: "dragging a bar back to its original dates is a no-op
      // ... no request is issued". Compared on the resulting *dates*
      // rather than on `deltaDays`, because a clamped edge drag can
      // travel a nonzero delta and still land where it started — and
      // that is just as much a no-op to the file.
      if (d.start === d.originStart && d.due === d.originDue) return;

      onDrop({
        taskId: d.taskId,
        key: d.key,
        edge: d.edge,
        originStart: d.originStart,
        originDue: d.originDue,
        // TML-9 / TML-10: the untouched date is absent from the
        // request, not resent at its current value.
        ...(d.edge !== "end" ? { start_date: d.start } : {}),
        ...(d.edge !== "start" ? { due_date: d.due } : {}),
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
  }, [zoom, cancel, onDrop]);

  return { drag, onBarPointerDown, consumeDragTail };
}
