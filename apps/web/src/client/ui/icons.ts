/**
 * Canonical glyph map — one Unicode glyph per named affordance.
 *
 * The consistency review (§4) found the *same* affordance drawn with
 * *different* glyphs across the app: two stars (`★` vs `⭑`), two closes
 * (`×` vs `✕`), a heavy list-sort caret (`▼`) beside the app's `▾`
 * everywhere else. This map ends that drift: a caller writes
 * `ICON.close` instead of typing a glyph, so there is one close in the
 * whole app.
 *
 * This is **not** an `<Icon>` component. The app's decision (see
 * `docs/dev/decisions.md`) is literal Unicode glyphs, no icon font and
 * no icon component — glyphs are text. A string map is the whole fix;
 * do not grow this into a React component.
 *
 * Migration of existing call sites is B4's job (mechanical, lazy). This
 * file only introduces the canonical values so new/migrated code has
 * one place to import from.
 */
export const ICON = {
  /** Emphasis / default / favourite marker. Was `★` (Sidebar) vs `⭑` (Save-as-view). */
  star: "⭑", // ⭑ (BLACK SMALL STAR)
  /** Close / dismiss. Was `×` (Toast, dialogs, BulkBar) vs `✕` (FilterBar chip). */
  close: "✕", // ✕ (MULTIPLICATION X)
  /** Disclosure, expanded. Was `▾` (common) vs `▼` (ListView sort). */
  caretDown: "▾", // ▾ (BLACK DOWN-POINTING SMALL TRIANGLE)
  /** Disclosure, collapsed / next. */
  caretRight: "▸", // ▸ (BLACK RIGHT-POINTING SMALL TRIANGLE)
  /** Disclosure, ascending sort indicator (paired with caretDown). */
  caretUp: "▴", // ▴ (BLACK UP-POINTING SMALL TRIANGLE)
  /** Overflow / more / kebab. */
  more: "⋯", // ⋯ (MIDLINE HORIZONTAL ELLIPSIS)
  /** Affirmative tick (Checkbox mark, confirmations). */
  check: "✓", // ✓ (CHECK MARK)
  /** Warning — already the app-wide convention in `list/cells.tsx`. */
  warning: "⚠", // ⚠ (WARNING SIGN)
} as const;

export type IconName = keyof typeof ICON;
