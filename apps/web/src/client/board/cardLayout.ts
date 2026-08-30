import type { CardLayoutField, UserSettings } from "@loctt/contracts";
import { CardLayoutSchema } from "@loctt/contracts";

/**
 * Resolves which fields a board card renders, and in what order
 * (BRD-5, CW-17).
 *
 * `card_layout` is an ordered array — position *is* the render order,
 * and absence from the array *is* hidden. One list carries both
 * concerns, so there is no second visibility map to drift from it.
 *
 * The three states are deliberately distinct, and the contract says
 * so:
 *
 *  - **absent** → the built-in default layout. A user who has never
 *    opened the settings editor gets a useful card, and the board does
 *    not error on the missing key (BRD-5's last bullet).
 *  - **explicit `[]`** → title only. A deliberate choice, not an
 *    absence — collapsing the two would make "show nothing but the
 *    title" unrepresentable.
 *  - **a list** → exactly those fields, in that order.
 *
 * The title is never a member: it is always shown, so it cannot be
 * turned off and has no position to order.
 */

/**
 * The built-in layout, used when the user has no `card_layout`.
 *
 * Chosen to match what the list table shows by default minus the
 * fields that make no sense on a card: `status` is the column the card
 * is *in*, so repeating it on every card in a 1:1 board is pure noise
 * — but it stays available, because a column collapsing several
 * statuses (BRD-2, BRD-12) is exactly where a user wants it back.
 */
export const DEFAULT_CARD_LAYOUT: readonly CardLayoutField[] = [
  "key",
  "priority",
  "assignee",
  "labels",
  "due_date",
];

export function resolveCardLayout(
  settings: UserSettings | undefined,
): readonly CardLayoutField[] {
  const raw = (settings as { card_layout?: unknown } | undefined)?.card_layout;
  if (raw === undefined) return DEFAULT_CARD_LAYOUT;

  // Parse rather than trust. Settings are stored schema-less on the
  // server (`handlePutUserSettings` bounds depth and nothing else), so
  // a hand-edited `settings.yaml` can carry anything at all. A bad
  // value falls back to the default instead of throwing — BRD-5 wants
  // the board to keep rendering, and a card layout is not worth a
  // crash surface.
  const parsed = CardLayoutSchema.safeParse(raw);
  if (!parsed.success) return DEFAULT_CARD_LAYOUT;
  return parsed.data;
}
