/**
 * The one class-join helper for the `ui/` primitives.
 *
 * The repo composes className strings with
 * `[...].filter(Boolean).join(" ")` (see `Menu.tsx`, `list/cells.tsx`).
 * `cn` is that idiom named once so the variant lookup tables in
 * `Button`/`Chip`/etc. read as `cn(base, SIZE[size], VARIANT[variant])`
 * rather than a nested array literal.
 *
 * Deliberately **not** `clsx`/`classnames`/`tailwind-merge`: no such
 * dependency exists in this repo and the design-system spec bans adding
 * one. This is ~4 lines and does exactly what the array-join did —
 * it drops falsy entries (so `cond && "cls"` and `undefined` are
 * skipped) and space-joins the rest. It does **not** de-duplicate or
 * resolve Tailwind conflicts; primitives own their own classes, so
 * there is nothing to merge.
 */
export type ClassValue = string | false | null | undefined;

export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
