/**
 * UI-12. Shared "whole row is clickable" behaviour for the task list
 * table and `MilestoneDetail`'s task table.
 *
 * ## Why not a stretched-link (`<a>` + `after:absolute after:inset-0`)
 *
 * The usual accessible way to make an entire row act like a link is to
 * give the row's own anchor an absolutely-positioned pseudo-element that
 * covers the row (Bootstrap's "stretched link"). It gets modifier-click
 * and middle-click for free, because the click really does land on the
 * anchor.
 *
 * It also intercepts every pointer event over the row — including a
 * mousedown-drag-mouseup used to select the title text, which is one of
 * this ticket's explicit "must not break" cases. A transparent overlay
 * sitting on top of the cells cannot both catch a plain click and let a
 * drag-select reach the text underneath: `pointer-events` is binary,
 * there is no "only when not dragging" CSS mode.
 *
 * ## What this does instead
 *
 * The row keeps ONE real anchor — the existing key-column `<Link>`,
 * which already gives that cell native Enter/keyboard activation and
 * (via the browser, untouched) modifier/middle-click. Clicking anywhere
 * ELSE in the row is handled by a plain `onClick` on the `<tr>`/`<li>`,
 * gated by {@link shouldNavigateRow}:
 *
 *  - Skipped when the click landed inside another interactive
 *    element (a link, button, checkbox, the label-filter pills, …) —
 *    those already call `stopPropagation` themselves; this is a second,
 *    independent guard in case a future cell adds a control and forgets
 *    to.
 *  - Skipped when the mouseup left a non-empty text selection, so
 *    dragging across the title to select it does not also navigate.
 *  - Skipped on a modifier click or a non-primary button — those are
 *    exactly the gestures a real anchor is for, and the row's own click
 *    handler cannot open a background tab the way a native anchor does.
 *    A modifier-click landing outside the key cell simply does nothing,
 *    which is the honest answer: there is no anchor there to carry the
 *    gesture. (The key cell's own `<Link>` still handles it natively.)
 *
 * This keeps the row's accessible shape exactly as it was: one row,
 * announced as a row with cells, one link inside it, one tab stop. No
 * `role="link"` on the row, no relabeling that would make a reader
 * announce the whole row as a single giant link.
 */
export function shouldNavigateRow(e: {
  readonly target: EventTarget | null;
  readonly currentTarget: EventTarget | null;
  readonly button: number;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}): boolean {
  if (e.button !== 0) return false;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;

  const target = e.target as HTMLElement | null;
  const row = e.currentTarget as HTMLElement | null;
  if (target === null || row === null) return false;

  // An interactive descendant (the key link, a checkbox, a label pill,
  // a kebab menu) already stops propagation on its own click — this is
  // a belt-and-braces check, not the primary guard, so a future control
  // that forgets `stopPropagation` still does not double-navigate.
  const interactive = target.closest("a,button,input,select,textarea,[role='button'],[role='menuitem']");
  if (interactive !== null && row.contains(interactive)) return false;

  // A drag-select of the title (or any cell text) leaves a non-collapsed
  // selection at mouseup/click time. Without this guard, releasing the
  // drag anywhere in the row navigated away with the selection still in
  // hand — the exact "must not break text selection" case.
  const selection = typeof window !== "undefined" ? window.getSelection() : null;
  if (selection !== null && !selection.isCollapsed && selection.toString().length > 0) {
    return false;
  }

  return true;
}
