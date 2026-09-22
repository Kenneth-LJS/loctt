import { z } from "zod";

import { HexColor, SlugKey } from "./brands.js";

/**
 * K103 — an entity colour is one of THREE shapes.
 *
 * Ken's ruling: a colour picker must not be a text input, and a single
 * hex string has no light/dark awareness — one value shown in both
 * themes. So a colour is now:
 *
 *  1. **single** — a bare hex string, used for BOTH modes.
 *     `color: "#1e6fcb"`
 *  2. **double** — an explicit per-mode pair (a custom colour).
 *     `color: { light: "#1e6fcb", dark: "#6fb6f0" }`
 *  3. **palette** — a reference to a built-in palette entry, which
 *     carries its own light/dark pair. `color: { palette: "blue" }`
 *
 * **Shape 1 is the existing wire format, unchanged.** Every
 * `workflow.yaml` / `labels.yaml` written before K103 holds a bare hex
 * string, and a bare hex string IS the "single colour" shape by its own
 * definition ("one value used for both modes"). So there is NO
 * migration, NO file rewrite, and every existing valid file still
 * parses. The union is additive.
 *
 * **Discrimination is unambiguous at runtime** without a `kind` tag:
 *  - a `string` is shape 1 — no object shape can be a string;
 *  - an object with `palette` is shape 3;
 *  - an object with `light`+`dark` is shape 2.
 * Both object members are `.strict()`, so `{ palette }` can never also
 * satisfy `{ light, dark }` and vice versa — the arms are mutually
 * exclusive, not merely ordered. A plain `z.union` is therefore exact;
 * `z.discriminatedUnion` is not usable here because the arms are not
 * all objects sharing one literal key, and it would have required
 * inventing a tag that then has to be written to every user's file.
 *
 * **Palette references are LIVE, not snapshots** (Ken's explicit pick):
 * an entity set to `{ palette: "blue" }` re-renders with whatever
 * `blue` currently means in each mode. The stored value is the ID, so
 * changing a palette entry updates everything referencing it. Nothing
 * here stores a resolved hex.
 */

/** An explicit per-mode colour pair — shape 2, a custom colour. */
export const DoubleColorSchema = z.object({
  light: HexColor,
  dark: HexColor,
}).strict();
export type DoubleColor = z.infer<typeof DoubleColorSchema>;

/**
 * A reference to a built-in palette entry — shape 3.
 *
 * The ID is only checked for SHAPE here (a slug). Whether it names a
 * palette entry that actually exists is a *core* question — contracts
 * does not own the palette — and an unknown ID degrades at resolve
 * time rather than failing the parse, so one bad reference never takes
 * down the config file it sits in.
 */
export const PaletteColorRefSchema = z.object({
  palette: SlugKey,
}).strict();
export type PaletteColorRef = z.infer<typeof PaletteColorRefSchema>;

/** The three-shape entity colour. */
export const EntityColorSchema = z.union([
  HexColor,
  PaletteColorRefSchema,
  DoubleColorSchema,
]);
export type EntityColor = z.infer<typeof EntityColorSchema>;

/** Narrows an `EntityColor` to shape 1 (a bare hex, both modes). */
export function isSingleColor(color: EntityColor): color is string {
  return typeof color === "string";
}

/** Narrows an `EntityColor` to shape 3 (a live palette reference). */
export function isPaletteColorRef(color: EntityColor): color is PaletteColorRef {
  return typeof color === "object" && color !== null && "palette" in color;
}

/** Narrows an `EntityColor` to shape 2 (an explicit light/dark pair). */
export function isDoubleColor(color: EntityColor): color is DoubleColor {
  return typeof color === "object" && color !== null && "light" in color;
}

/** The two themes a colour resolves into. */
export const ColorModeSchema = z.enum(["light", "dark"]);
export type ColorMode = z.infer<typeof ColorModeSchema>;
