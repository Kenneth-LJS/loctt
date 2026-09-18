import type { TaskFrontmatterPublic } from "@loctt/contracts";
import type { ReactNode } from "react";
import { useState } from "react";

/**
 * SPR-17 — a sprint holding 400 tasks stays usable.
 *
 * ## Why a window rather than a virtualizer
 *
 * A measuring virtualizer (absolute positioning off a scroll offset)
 * would fight the drag: `useBoardDrag` resolves the drop slot with
 * `elementFromPoint` and each card's real `getBoundingClientRect`, and
 * SPR-4's drop lands between the neighbours the user *saw*. Cards
 * lifted out of normal flow into a transformed container make that
 * geometry disagree with the screen, which is the exact class of bug
 * the board's own comments record twice.
 *
 * So this renders a *prefix* of the column in ordinary flow and offers
 * the rest behind an explicit control. The properties SPR-17 asks for
 * hold:
 *
 *  - the page stays scrollable and interactive, because the DOM holds
 *    a bounded number of cards rather than 400;
 *  - **the header count is not this component's** — it reads the true
 *    total from the bucket, so 400 is 400 whatever is rendered here;
 *  - dragging a card out does not re-render every card, because the
 *    cards outside the window were never mounted.
 *
 * The cost is that a card beyond the window is not a drop *neighbour*
 * until revealed. That is honest — it is not on screen — and it is the
 * same bargain any windowing makes.
 */

/**
 * How many cards a column renders before offering the rest.
 *
 * Comfortably more than fills a column on any screen, so the control
 * is only ever reached by a column that genuinely has hundreds.
 */
export const CARD_WINDOW = 50;

export function VirtualCards({
  tasks,
  renderCard,
  trailing,
}: {
  readonly tasks: readonly TaskFrontmatterPublic[];
  readonly renderCard: (task: TaskFrontmatterPublic, index: number) => ReactNode;
  /** The end-of-column drop indicator, rendered after the last card. */
  readonly trailing?: ReactNode;
  /**
   * Accepted so the caller can pass the hovered slot without the
   * component needing to know what a drop is. Unused directly — the
   * indicator is drawn by `renderCard`/`trailing`.
   */
  readonly dropIndex?: number | undefined;
}) {
  const [limit, setLimit] = useState(CARD_WINDOW);
  const shown = tasks.length <= limit ? tasks : tasks.slice(0, limit);
  const remaining = tasks.length - shown.length;

  return (
    <>
      {shown.map((task, i) => renderCard(task, i))}
      {remaining > 0 && (
        <button
          type="button"
          data-testid="sprint-show-more"
          onClick={() => { setLimit(l => l + CARD_WINDOW); }}
          className="w-full rounded border border-dashed border-border-subtle px-3 py-2 text-[0.8571rem] text-text-tertiary hover:text-text-primary"
        >
          {/* Names the number still hidden, so the column never reads
              as though it held only what is drawn. */}
          Show {Math.min(remaining, CARD_WINDOW)} more ({remaining} not shown)
        </button>
      )}
      {remaining === 0 && trailing}
    </>
  );
}
