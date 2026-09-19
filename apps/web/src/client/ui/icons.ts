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
 * This map now holds ONLY the glyphs that are legitimately text: the ★
 * saved/favourite marker and the ⚠ status marker. Interactive/decorative
 * AFFORDANCES — carets, close, kebab, reorder — are drawn by the SVG
 * `<Icon>` component in `ui/Icon.tsx`, not typed as glyphs (they read as
 * gross ASCII otherwise; Ken's report). An earlier version of this comment
 * claimed "the app's decision is literal Unicode glyphs, no icon
 * component"; there is no such decision in `decisions.md` — that was an
 * unsupported constraint. Reach for `<Icon>` for affordances; keep this
 * map only for text glyphs.
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
