/**
 * The two Unicode characters the UI is allowed to type as text.
 *
 * Everything interactive or decorative — carets, close, kebab, reorder,
 * checkmarks — is drawn by the SVG `<Icon>` component in `ui/Icon.tsx`.
 * Glyph affordances read as unfinished ASCII and drift in weight and
 * baseline; A208 ruled them out and built `Icon.tsx` to replace them.
 *
 * What survives here is text, not affordance:
 *
 * - `star` — the saved/favourite marker Ken asked to keep as a character.
 * - `warning` — a status marker that sits in a sentence, not on a control.
 *
 * Do not add to this map. A new affordance gets a path in `ui/Icon.tsx`.
 * The `no-restricted-syntax` glyph rule in `eslint.config.js` enforces
 * this; this file is the one place allowed to hold these characters.
 */
export const ICON = {
  /** Emphasis / default / favourite marker. Was `★` (Sidebar) vs `⭑` (Save-as-view). */
  star: "⭑", // ⭑ (BLACK SMALL STAR)
  /** Warning — already the app-wide convention in `list/cells.tsx`. */
  warning: "⚠", // ⚠ (WARNING SIGN)
} as const;

export type IconName = keyof typeof ICON;
