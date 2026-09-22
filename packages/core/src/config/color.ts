import type { ColorMode, EntityColor } from "@loctt/contracts";
import { isDoubleColor, isPaletteColorRef } from "@loctt/contracts";

/**
 * K103 — the built-in colour palette, and the ONE place an
 * `EntityColor` becomes a concrete hex for a given theme.
 *
 * Contracts owns the three colour *shapes*; core owns what the palette
 * IDs mean and what happens when one does not exist. Surfaces (web,
 * CLI, MCP) must call `resolveEntityColor` rather than reaching into a
 * colour themselves — otherwise "what colour is this label in dark
 * mode" gets three answers.
 */

/** One built-in palette entry: an id and its per-mode pair. */
export interface PaletteEntry {
  /** Stable id, stored in config as `{ palette: "<id>" }`. */
  readonly id: string;
  /** Human label for the picker. */
  readonly label: string;
  /** The value used in light mode. */
  readonly light: string;
  /** The value used in dark mode. */
  readonly dark: string;
}

/**
 * The built-in palette.
 *
 * **Sourced from the app's own design tokens**, not invented: every
 * value below is a literal from `apps/web/src/client/styles/tokens.css`
 * — the `:root` block for `light`, the dark-theme block for `dark`.
 * That file is the K99 ruling made concrete (brand teal accent, plus
 * the semantic status/priority/feedback colours "harmonised" to it),
 * and each of its values carries a recorded WCAG AA rationale in the
 * comments there. Reusing them means a palette colour reads correctly
 * on both canvases by construction, and matches the chrome around it.
 *
 * Mapping (light ← `:root`, dark ← `:root[data-theme="dark"]`):
 *  - `teal`    ← `--accent`               (K99 brand accent)
 *  - `blue`    ← `--status-active-fg` / `--priority-medium`
 *  - `green`   ← `--status-completed-fg` / `--feedback-success-fg`
 *  - `orange`  ← `--feedback-warn-fg` / `--priority-high`
 *  - `red`     ← `--feedback-danger-fg` / `--priority-critical`
 *  - `slate`   ← `--priority-low`
 *  - `gray`    ← `--status-discarded-fg` / `--status-pending-fg`
 *
 * Keep this list in sync by hand if the tokens change; it is
 * deliberately a copy rather than a CSS import, because core has no
 * DOM and the CLI and MCP need these values with no browser at all.
 */
export const BUILTIN_PALETTE: readonly PaletteEntry[] = [
  { id: "teal", label: "Teal", light: "#0F766E", dark: "#39A88F" },
  { id: "blue", label: "Blue", light: "#1868B0", dark: "#6FB6F0" },
  { id: "green", label: "Green", light: "#356E1A", dark: "#8FD46A" },
  { id: "orange", label: "Orange", light: "#CC6600", dark: "#F0A868" },
  { id: "red", label: "Red", light: "#B02F17", dark: "#FF8A73" },
  { id: "slate", label: "Slate", light: "#5F6B7E", dark: "#8A8A92" },
  { id: "gray", label: "Gray", light: "#5A6472", dark: "#909098" },
];

const PALETTE_BY_ID: ReadonlyMap<string, PaletteEntry> = new Map(
  BUILTIN_PALETTE.map(e => [e.id, e]),
);

/** Looks up a built-in palette entry, or `undefined` if the id is unknown. */
export function getPaletteEntry(id: string): PaletteEntry | undefined {
  return PALETTE_BY_ID.get(id);
}

/** True when `id` names a built-in palette entry. */
export function isKnownPaletteId(id: string): boolean {
  return PALETTE_BY_ID.has(id);
}

/**
 * Why a colour could not be resolved. Named rather than thrown — see
 * `resolveEntityColor`.
 */
export type ColorResolveFailure =
  /** A `{palette: id}` reference naming an entry that does not exist. */
  | { readonly reason: "unknown_palette_id"; readonly paletteId: string; readonly message: string };

/** The outcome of resolving one colour for one mode. */
export type ColorResolution =
  | { readonly ok: true; readonly hex: string }
  | { readonly ok: false; readonly failure: ColorResolveFailure };

/**
 * Resolves any of the three colour shapes to a concrete hex for `mode`.
 *
 * This is the ONE place resolution happens (principle 3 — two surfaces
 * must answer the same question the same way).
 *
 *  - **single** (a bare hex string): the same value in both modes.
 *  - **double** (`{light, dark}`): the half matching `mode`.
 *  - **palette** (`{palette: id}`): looked up LIVE, every call. The
 *    stored value is the id, never a snapshot, so editing a palette
 *    entry changes everything referencing it (Ken's explicit ruling).
 *
 * **An unknown palette id is a NAMED, recoverable failure, not a
 * crash** — it returns `{ok: false, failure}` and throws nothing.
 * Colour is a cosmetic field: per the corruption guide's field-local
 * rule (and the MSL-22 precedent already in `config/labels.ts`, where
 * a bad hex is dropped so the label still renders), a bad colour on
 * one entity must degrade that FIELD, leaving the entity and every
 * sibling in the config intact. Making it fatal would punish an entire
 * workflow.yaml for one typo in a decorative value — and operating
 * over a missing colour risks nothing worse, which is the only thing
 * that justifies fatal.
 */
export function resolveEntityColor(color: EntityColor, mode: ColorMode): ColorResolution {
  if (isPaletteColorRef(color)) {
    const entry = PALETTE_BY_ID.get(color.palette);
    if (entry === undefined) {
      return {
        ok: false,
        failure: {
          reason: "unknown_palette_id",
          paletteId: color.palette,
          message:
            `unknown palette colour '${color.palette}' — it is not one of the built-in palette colours `
            + `(${BUILTIN_PALETTE.map(e => e.id).join(", ")}). `
            + `Pick a palette colour, or set an explicit colour instead.`,
        },
      };
    }
    return { ok: true, hex: mode === "dark" ? entry.dark : entry.light };
  }
  if (isDoubleColor(color)) {
    return { ok: true, hex: mode === "dark" ? color.dark : color.light };
  }
  // Shape 1 — a bare hex string, used for BOTH modes.
  return { ok: true, hex: color };
}

/**
 * The lenient wrapper surfaces use when they just want something to
 * render: resolves, and falls back to `fallback` (default: nothing) on
 * a named failure. Returns `undefined` rather than a made-up colour so
 * the caller renders its own neutral default and the entity is still
 * visible — the MSL-22 behaviour, generalized to all three shapes.
 */
export function resolveEntityColorOr(
  color: EntityColor | undefined,
  mode: ColorMode,
  fallback?: string,
): string | undefined {
  if (color === undefined) return fallback;
  const resolved = resolveEntityColor(color, mode);
  return resolved.ok ? resolved.hex : fallback;
}
