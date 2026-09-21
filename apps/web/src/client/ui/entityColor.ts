import type { EntityColor } from "@loctt/contracts";
import { isDoubleColor, isPaletteColorRef } from "@loctt/contracts";
import { resolveEntityColorOr } from "@loctt/core";

import { useTheme } from "../theme/useTheme.ts";

/**
 * K103 stage 2 — the web surface's bridge from a stored `EntityColor`
 * to the one hex a DOM style can actually take.
 *
 * ## Why this file exists at all
 *
 * Before K103 a `color` was a `string`, so every consumer could write
 * `style={{ background: def.color }}` and be right. It is now one of
 * three shapes, and two of them are objects. React does not complain
 * about an object in a style value at runtime — it stringifies it — so
 * an un-migrated site renders `[object Object]` as a colour, which CSS
 * discards, and the entity silently loses its tint. That is a SILENT
 * failure: the site still compiles wherever inference widened to
 * `string | undefined`, and nothing throws.
 *
 * So the rule for this surface is: **an `EntityColor` never reaches
 * CSS.** It passes through `useResolvedColor` / `resolveForMode` first,
 * and what reaches CSS is always a `string | undefined`.
 *
 * ## Resolution is core's, not ours
 *
 * Every function here delegates to `resolveEntityColorOr`. Nothing in
 * this file inspects a hex, tests a regex, or picks a light/dark half
 * itself — that is core's single answer to "what colour is this in this
 * theme", and re-deriving it here is exactly how the CLI and the web
 * end up disagreeing (principle 3). `cells.tsx` previously hand-rolled
 * a hex regex to guard its CSS, which post-K103 would have rejected
 * every palette and per-mode colour to `undefined`: the same bug class
 * core already had to fix in `dropInvalidColor`.
 *
 * ## Palette references stay live
 *
 * Resolution happens at RENDER, every render, against the currently
 * resolved theme. Nothing here memoises a hex onto a `{palette}`
 * reference — Ken's explicit ruling — so editing a palette entry
 * repaints everything that points at it, and flipping the theme
 * repaints without a refetch.
 */

/**
 * The active theme as core's `ColorMode`.
 *
 * `useTheme().resolved` is already exactly `"light" | "dark"` — the
 * preference has been collapsed (`system` resolved against the OS) and
 * it is what is actually painted on `<html>`. It also re-renders on an
 * OS dark-mode flip and on a cross-user theme adoption, which is what
 * keeps a per-mode colour honest without a reload.
 */
export function useColorMode(): "light" | "dark" {
  return useTheme().resolved;
}

/**
 * Resolves one optional colour for the active theme.
 *
 * Returns `undefined` when there is no colour AND when the colour
 * cannot be resolved (an unknown palette id — reachable by hand-editing
 * config, or by a palette entry disappearing under a live reference).
 * `undefined` is the signal every call site already understands as "no
 * colour", so a broken reference degrades to the neutral default rather
 * than to a made-up hex or a crash. That is the MSL-22 field-local
 * behaviour, generalised to all three shapes.
 */
export function useResolvedColor(color: EntityColor | undefined): string | undefined {
  return resolveEntityColorOr(color, useColorMode());
}

/**
 * The non-hook form, for a call site resolving MANY colours in one
 * render (an option list, a row of pills) where a hook per colour is
 * not possible. The caller gets the mode once from `useColorMode()`
 * and maps with this.
 */
export function resolveForMode(
  color: EntityColor | undefined,
  mode: "light" | "dark",
): string | undefined {
  return resolveEntityColorOr(color, mode);
}

/**
 * Maps a list of rows carrying an optional `EntityColor` onto the same
 * rows with a resolved `string | undefined` colour.
 *
 * This is the shape nearly every consumer needs: the option lists
 * feeding `Combobox`/`OptionPicker`/`CreateTaskModal` are all
 * `{key, label, color?}` and all must hand CSS a string. Doing it in
 * one place means a new list cannot forget.
 *
 * The colour key is OMITTED rather than set to `undefined` when it does
 * not resolve — the repo runs `exactOptionalPropertyTypes`, and the
 * downstream option types spell `color?: string | undefined`, so an
 * explicit `undefined` and an absent key are not interchangeable at
 * every call site.
 */
export function resolveRowColors<T extends { readonly color?: EntityColor | undefined }>(
  rows: readonly T[],
  mode: "light" | "dark",
): (Omit<T, "color"> & { color?: string })[] {
  return rows.map(row => {
    const { color: raw, ...rest } = row;
    const hex = resolveEntityColorOr(raw, mode);
    return { ...rest, ...(hex !== undefined ? { color: hex } : {}) };
  });
}

/**
 * The stored shape of a colour, for the picker's own mode switch.
 *
 * Note this is about how the value is STORED, not how it renders: a
 * "single" bare hex and a "double" pair both render as one hex per
 * theme. The picker needs the distinction because the three shapes are
 * three different editing experiences.
 */
export type ColorShape = "palette" | "double" | "single";

export function colorShape(color: EntityColor): ColorShape {
  if (isPaletteColorRef(color)) return "palette";
  if (isDoubleColor(color)) return "double";
  return "single";
}
