/**
 * K103 stage 3 — the MCP half of the three-shape entity colour.
 *
 * MCP speaks JSON, so unlike the CLI there is no flag-string syntax to
 * invent: **the accepted input IS the wire form**, exactly as it is
 * stored in `workflow.yaml` / `labels.yaml`.
 *
 *   "#1e6fcb"                          single — one value, both modes
 *   {"light": "#CC6600", "dark": "#F0A868"}   double — explicit pair
 *   {"palette": "teal"}                palette — a LIVE reference
 *
 * That parity is the point: an agent that reads a colour out of
 * `get_workflow_config` can write the same value back unchanged, and a
 * value written here renders identically in the web app. It still has
 * to be *said* in the tool description, or an agent will assume the
 * pre-K103 "hex string only" contract and never produce the other two.
 *
 * Validation is delegated to `EntityColorSchema` — contracts owns what
 * is legal. Re-deriving the rule here is the mistake that produced the
 * `dropInvalidColor` data-loss bug in this very feature; the previous
 * code in `workflow-entities.ts` made the same class of error more
 * quietly, accepting a colour only when `typeof v === "string"` and
 * SILENTLY DROPPING a palette or per-mode object.
 */

import type { EntityColor } from "@loctt/contracts";
import { EntityColorSchema } from "@loctt/contracts";
import { BUILTIN_PALETTE, resolveEntityColor } from "@loctt/core";

/** The prose every colour-accepting tool description shares. */
export const COLOR_INPUT_DOC =
  "A colour is one of three shapes, given as the JSON value itself: "
  + "a hex string \"#rrggbb\" (one value used in BOTH light and dark), "
  + "{\"light\": \"#rrggbb\", \"dark\": \"#rrggbb\"} for an explicit per-mode pair, "
  + "or {\"palette\": \"<id>\"} for a live reference to a built-in palette entry "
  + "(call `list_palette_colors` for the valid ids, and do not guess them). "
  + "A palette reference is resolved live on every read, so it follows the palette "
  + "if the palette changes; nothing stores a resolved hex.";

/** The zod schema for an optional colour argument on a create tool. */
export const colorInputSchema = EntityColorSchema.optional().describe(COLOR_INPUT_DOC);

/** The zod schema for a colour argument on an edit tool (null clears it). */
export const nullableColorInputSchema = EntityColorSchema.nullable().optional()
  .describe(`${COLOR_INPUT_DOC} Pass null to clear the colour.`);

/** The `list_palette_colors` result shape — ids plus both mode values. */
export function paletteListing(): {
  readonly colors: readonly { id: string; label: string; light: string; dark: string }[];
} {
  return { colors: BUILTIN_PALETTE.map(e => ({ ...e })) };
}

/**
 * Validates an arbitrary JSON value as an `EntityColor`, or throws with
 * a message naming the three shapes.
 *
 * `err` builds the surface's own error type so this module stays free of
 * a dependency on any one tool file's error class.
 */
export function parseColorValue(
  value: unknown,
  path: string,
  err: (message: string) => Error,
): EntityColor {
  const parsed = EntityColorSchema.safeParse(value);
  if (!parsed.success) {
    throw err(
      `\`${path}\` is not a valid colour. ${COLOR_INPUT_DOC}`,
    );
  }
  return parsed.data;
}

/**
 * A warning string when a colour names a palette id that does not
 * exist, else undefined.
 *
 * An unknown id is NOT rejected: it is legal on the wire (contracts
 * checks slug shape only) and core degrades it to a neutral swatch
 * rather than crashing, per the corruption guide's field-local rule.
 * But an agent that invented an id should be told so it can call
 * `list_palette_colors` rather than silently shipping a grey label.
 */
export function unknownPaletteIdWarning(color: EntityColor): string | undefined {
  const resolved = resolveEntityColor(color, "light");
  return resolved.ok ? undefined : `Warning: ${resolved.failure.message}`;
}
