import type { TaskFrontmatterPublic } from "@loctt/contracts";

import type { BoardColumn } from "./columns.ts";

/**
 * The board drag's pure logic (M3.2).
 *
 * Kept out of the React component deliberately. Everything here —
 * which slot a pointer is over, which neighbours a drop lands
 * between, whether a drop is a no-op, which status a column writes —
 * is decidable from plain data, and a drag-and-drop test that has to
 * synthesize pointer events to reach it is slow and easy to write
 * dishonestly. These are unit-tested directly; the spec then checks
 * the wiring end-to-end.
 */

/**
 * How far the pointer must travel before a press becomes a drag.
 *
 * BRD-37: pressing a card and moving 2px must *not* start a drag —
 * it is a click, and the card navigates. Without a threshold every
 * click with a shaky hand became a drag, and BRD-8's "click opens the
 * task" stopped working for anyone using a trackpad.
 */
export const DRAG_THRESHOLD_PX = 5;

/**
 * A drop position expressed as its two neighbours.
 *
 * The server interpolates a rank between these, so the pair *is* the
 * position — an index would be meaningless to a peer whose column
 * changed since the drag began (BRD-32, BRD-34).
 *
 * `after` is the card the dropped card lands *below*; `before` is the
 * card it lands *above*. Either may be absent at the ends.
 */
export interface DropNeighbours {
  readonly after?: string;
  readonly before?: string;
}

/**
 * The slot a drop would land in, within one column.
 *
 * `index` is the position among the column's cards *excluding* the
 * dragged card, so it is directly comparable with the card's current
 * index for the no-op check.
 */
export interface DropSlot {
  readonly columnId: string;
  readonly index: number;
}

/**
 * Picks the insertion index for a pointer position over a column.
 *
 * Uses each card's vertical midpoint: above the midpoint the card
 * lands before that card, below it lands after. Comparing against the
 * *top* edge instead makes the last slot in a column unreachable,
 * because the pointer must pass the whole card to get there.
 *
 * `rects` must be in render order and exclude the dragged card — the
 * dragged card is lifted out of the flow, so its own box is not a
 * drop boundary.
 */
export function insertionIndex(
  pointerY: number,
  rects: readonly { readonly top: number; readonly bottom: number }[],
): number {
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    if (r === undefined) continue;
    const midpoint = r.top + (r.bottom - r.top) / 2;
    if (pointerY < midpoint) return i;
  }
  return rects.length;
}

/**
 * The two neighbours flanking a slot in a column.
 *
 * `cards` must already exclude the dragged card, so that dropping
 * "where it already is" yields the same neighbours the card sits
 * between right now — which is what makes {@link isNoOpDrop} able to
 * recognise it.
 */
export function neighboursAt(
  cards: readonly TaskFrontmatterPublic[],
  index: number,
): DropNeighbours {
  const after = cards[index - 1]?.key;
  const before = cards[index]?.key;
  return {
    ...(after !== undefined ? { after } : {}),
    ...(before !== undefined ? { before } : {}),
  };
}

/**
 * True when a drop would put the card exactly where it already is.
 *
 * BRD-31: such a drop must issue **no request at all**, so this is
 * checked on the client before the mutation fires. Core has a matching
 * guard (a rerank computing an unchanged rank writes nothing), but
 * relying on it alone would still send a request the case forbids.
 *
 * ## Why this compares neighbours, not indices
 *
 * An index comparison looks right and is wrong, which is worth
 * spelling out because the first version of this function got it
 * wrong and the spec caught it.
 *
 * While a card is held, it is lifted out of its column's flow, so the
 * cards below it shift up by one slot. Returning the pointer to the
 * exact pixel the drag started from therefore resolves to a *different*
 * index than the card began at — measured on a 3-card column: origin
 * index 1, and holding the pointer still over that same point reported
 * index 2, because the card that moved up now owns that space and the
 * pointer is past its midpoint. Comparing indices sent a request for a
 * drop that had not moved anything.
 *
 * The neighbours are stable under that shift: dropping between the
 * same two cards is the same position no matter what the indices
 * renumber to. `cards` must already exclude the dragged card.
 */
export function isNoOpDrop(
  originColumnId: string,
  target: DropSlot,
  cardsWithoutDragged: readonly TaskFrontmatterPublic[],
  currentNeighbours: DropNeighbours,
): boolean {
  if (originColumnId !== target.columnId) return false;
  const dropped = neighboursAt(cardsWithoutDragged, target.index);
  return dropped.after === currentNeighbours.after
    && dropped.before === currentNeighbours.before;
}

/**
 * The status a card adopts when dropped into a column.
 *
 * BRD-13: a column collapsing several statuses writes the **first**
 * entry of its `statuses` array — deterministically, so reordering
 * that array in `workflow.yaml` changes which status a drop writes.
 * Picking the last, or the card's nearest neighbour's status, would
 * make the same gesture mean different things on different days.
 */
export function statusForColumn(column: BoardColumn): string | undefined {
  return column.statuses[0];
}

/**
 * Whether a drop needs to write `status` as well as `board_rank`.
 *
 * BRD-12 is the case this exists for: a column may collapse several
 * statuses, so a card dragged *within* such a column keeps whatever
 * status it has — a `blocked` card reordered above an `in_progress`
 * one stays `blocked`. Only leaving the column rewrites it.
 *
 * XS-9 pins the payload shape that follows: an intra-column reorder
 * sends `board_rank` alone, with `status` **absent**, not resent at
 * its current value.
 */
export function needsStatusWrite(
  originColumnId: string,
  targetColumn: BoardColumn,
): boolean {
  return originColumnId !== targetColumn.id;
}
