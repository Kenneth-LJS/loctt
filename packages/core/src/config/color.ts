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
 * The minimum CIE76 ΔE any two palette entries must keep between them,
 * **in each mode independently**.
 *
 * Why 15. ΔE is a perceptual-distance metric where ~2.3 is the "just
 * noticeable difference" and values under ~10 read as shades of one
 * colour rather than two colours. The palette's job is *labelling*: a
 * user assigns `red` to one project and `rose` to another and must tell
 * the two chips apart at a glance, across a list, at 16px, without
 * putting them side by side. That is a harder task than "are these
 * different", so the JND is far too low a bar.
 *
 * The ceiling is arithmetic, but it is **much higher than A288
 * believed**. That pass recorded "the best achievable floor for 18
 * entries is ~18". Re-measured in A290 by farthest-point search over
 * every AA-passing sRGB colour, the true ceiling at 18 entries is
 * **ΔE ≈ 33 in both modes** — nearly double. A288 hit ~18 because it
 * searched a fixed-chroma hue ramp, not because the space was full.
 * 15 is therefore a floor with real headroom above it, which is what
 * lets the entries sit in the app's muted register instead of being
 * pushed to neon values that merely happen to be far apart.
 *
 * So 15 is a **defensible floor, not a comfortable one**: it is 6.5×
 * the JND, comfortably above the ~10 "shades of one colour" line, and
 * low enough that the entries can stay in the design system's own
 * saturation band. `deltaE76` and the test that walks every pair live
 * beside this constant — see `color.test.ts`.
 */
export const MIN_PALETTE_DELTA_E = 15;

/**
 * The built-in palette — 18 entries.
 *
 * ## The original seven, and what changed
 *
 * The first six entries below (`teal`, `blue`, `green`, `orange`, `red`,
 * `gray`) are **byte-identical to the pre-expansion palette**, and are
 * still sourced from `apps/web/src/client/styles/tokens.css` — the
 * `:root` block for `light`, the dark-theme block for `dark`:
 *
 *  - `teal`    ← `--accent`               (K99 brand accent)
 *  - `blue`    ← `--status-active-fg` / `--priority-medium`
 *  - `green`   ← `--status-completed-fg` / `--feedback-success-fg`
 *  - `orange`  ← `--feedback-warn-fg` / `--priority-high`
 *  - `red`     ← `--feedback-danger-fg` / `--priority-critical`
 *  - `gray`    ← `--status-discarded-fg` / `--status-pending-fg`
 *
 * **`slate` is the one existing entry whose hex MOVED**, and it has now
 * moved twice: `#5F6B7E`/`#8A8A92` (original) → `#384257`/`#91A0C0`
 * (A288) → `#2F4260`/`#7484BF` (A290). It had to move at all because
 * `slate` and `gray` were 4.10 ΔE apart in light mode and **2.31 in
 * dark** — at or below the just-noticeable difference, i.e. the same
 * colour twice. Ken reported exactly this ("the last 2 colours here
 * look like each other"). Of the two, `slate` moves because `gray` is
 * token-sourced (`--status-discarded-fg`) and `slate`'s old source
 * (`--priority-low`) is not a colour the palette must mirror.
 *
 * **`slate` must keep real chroma.** A290 tried to make it a neutral
 * grey-blue and every such value re-collided with `gray` (measured ΔE
 * 9.6–12.8 in dark). The A288 defect returns the moment `slate` is
 * desaturated, so it carries a deliberate violet lean instead.
 *
 * **Data impact of the `slate` move: ids keep resolving; only the
 * rendered colour shifts.** Nothing stored is rewritten and no
 * migration runs. A config holding `color: { palette: "slate" }` still
 * resolves — that is the point of a live reference (Ken's ruling) — it
 * simply paints a deeper, bluer slate than before. No id was renamed or
 * removed, so no stored value can dangle.
 *
 * ## The twelve non-token entries
 *
 * `amber`, `olive`, `emerald`, `cyan`, `sky`, `indigo`, `violet`,
 * `purple`, `magenta`, `pink`, `rose`, plus the relocated `slate`.
 * These are **not** token literals — the token file has no lilac — so
 * they are chosen under three hard constraints and one design rule:
 *
 *  1. **Contrast (hard).** Every `light` value holds ≥ 4.5:1 against
 *     `--bg-surface` (`#FFFFFF`), every `dark` value ≥ 4.5:1 against
 *     dark `--bg-surface` (`#141416`) — WCAG AA for normal text, so a
 *     value is readable as text and not only as a filled chip. The
 *     canvas tokens (`#F6F8FC` / `#0B0B0C`) are easier in both modes,
 *     so surface is the binding constraint.
 *  2. **Separation (hard).** ≥ `MIN_PALETTE_DELTA_E` from every other
 *     entry, in each mode, enforced by test.
 *  3. **Variety (hard, A290).** The set must not collapse onto one
 *     saturation — enforced by the cluster test in `color.test.ts`.
 *     See the design rule below for how that is achieved.
 *
 * **The design rule: character, not hue slot.** A288 picked the added
 * entries by rotating hue at a fixed saturation. That passes ΔE — at
 * constant chroma, ΔE is dominated by hue difference — while reading
 * as one family, because the eye separates colours by saturation and
 * lightness at least as much as by hue. Eight of its entries sat at
 * *exactly* HSV saturation 0.79 (light) and nine at 0.50 (dark).
 *
 * So each entry is instead assigned a CHARACTER, and the characters
 * are interleaved around the hue circle so adjacent hues differ on a
 * second axis:
 *
 *  - **deep**  — dark and saturated (`indigo`, `emerald`, `cyan`)
 *  - **vivid** — as light as AA allows, saturated (`rose`, `purple`,
 *    `magenta`, `amber`)
 *  - **muted** — deliberately LOW chroma (`olive`, `violet`, `pink`,
 *    `sky`, `slate`) — the register A288's ramp never used at all
 *
 * **Why some of these are darker than their name suggests.** Light
 * mode is the constrained mode: AA against white admits nothing above
 * L\* ≈ 51, and `teal`/`blue` (both fixed, token-sourced) already own
 * the mid-lightness blue-green region. `cyan` can therefore only clear
 * the floor by going deep (`#12484E`); a bright cyan collides with
 * `teal`. That is a structural fact of the space, not a stylistic whim
 * — re-deriving it is wasted effort.
 *
 * **`orange` DIVERGES from its token, deliberately (Ken, 2026-09-23).**
 * The palette's light orange is `#BD5B00` (4.51:1 on white); the
 * `--feedback-warn-fg` token stays `#CC6600` (3.84:1). That is not
 * drift — the two have different jobs and therefore different bars:
 *
 *  - A **warn chip** renders bold, so AA-LARGE (3:1) applies and
 *    `#CC6600` clears it. K99 is Ken's ruling choosing that vibrancy,
 *    and it still stands; `tokens.css` says so at its own definition.
 *  - A **palette swatch** colours a label pill's border AND its text
 *    (`list/cells.tsx`), at body weight — so AA-NORMAL (4.5:1) applies
 *    and `#CC6600` fails it at 3.84:1.
 *
 * `#BD5B00` is the most vivid true orange that clears 4.5:1: an
 * exhaustive RGB search over hue 25-45° found nothing with more chroma
 * at this hue. It holds hue 29° against the original's 30° and keeps
 * 93% of its chroma, so it reads as the same orange rather than
 * sliding toward red — which is what every more-saturated candidate
 * did.
 *
 * **Do not "fix" the mismatch by syncing the two values.** Whichever
 * you move breaks the other's requirement.
 *
 * Keep this list in sync by hand if the tokens change; it is
 * deliberately a copy rather than a CSS import, because core has no
 * DOM and the CLI and MCP need these values with no browser at all.
 */
/**
 * Order is a COLOUR WHEEL, neutrals last (Ken, 2026-09-22: "sort by a
 * sort of 'colour wheel' vibe, putting the grey at the last").
 *
 * The chromatic sixteen run by hue angle of their LIGHT value — red 9°
 * through pink 347° — so the picker grid reads as a spectrum rather
 * than the arbitrary order the entries were authored in. `gray` and
 * `slate` are pulled out and appended: both have a nominal hue (215°,
 * 217°) that would drop them between sky and blue, where two
 * desaturated swatches read as a gap in the ramp.
 *
 * This is presentation only. Nothing keys off the array's order —
 * lookup is by id through `PALETTE_BY_ID` — so reordering cannot
 * invalidate stored `{palette: "<id>"}` references.
 */
export const BUILTIN_PALETTE: readonly PaletteEntry[] = [
  // --- the token-sourced originals, hexes unchanged ---
  { id: "red", label: "Red", light: "#B02F17", dark: "#FF8A73" },
  { id: "orange", label: "Orange", light: "#BD5B00", dark: "#F0A868" },
  { id: "amber", label: "Amber", light: "#8C6E28", dark: "#F2D264" },
  { id: "olive", label: "Olive", light: "#6A704F", dark: "#C8CA9C" },
  { id: "green", label: "Green", light: "#356E1A", dark: "#8FD46A" },
  { id: "emerald", label: "Emerald", light: "#0D6139", dark: "#3FD99A" },
  { id: "teal", label: "Teal", light: "#0F766E", dark: "#39A88F" },
  { id: "cyan", label: "Cyan", light: "#12484E", dark: "#7CE8EF" },
  { id: "sky", label: "Sky", light: "#4A7BA0", dark: "#8FC8E0" },
  { id: "blue", label: "Blue", light: "#1868B0", dark: "#6FB6F0" },
  { id: "indigo", label: "Indigo", light: "#2B2E93", dark: "#7B8CEF" },
  { id: "violet", label: "Violet", light: "#6F4A86", dark: "#BC9AC4" },
  { id: "purple", label: "Purple", light: "#7E2090", dark: "#D285D3" },
  { id: "magenta", label: "Magenta", light: "#941A66", dark: "#F06AC0" },
  { id: "rose", label: "Rose", light: "#C42752", dark: "#F76F86" },
  { id: "pink", label: "Pink", light: "#9C5F6C", dark: "#F2BCC6" },
  { id: "gray", label: "Gray", light: "#5A6472", dark: "#909098" },
  { id: "slate", label: "Slate", light: "#2F4260", dark: "#7484BF" },
];

/**
 * CIE76 ΔE between two `#rrggbb` colours — the perceptual distance the
 * palette's distinctness guarantee is stated in.
 *
 * Exported from core rather than hidden in the test, because it is the
 * definition behind `MIN_PALETTE_DELTA_E`: anyone adding a palette entry
 * needs to be able to measure the thing the test will check, and a
 * surface that ever wants to explain "these two colours are too close"
 * needs the same number the test used.
 *
 * CIE76 rather than CIEDE2000: it is the simpler, *stricter-behaving*
 * metric at these distances (CIEDE2000 discounts hue differences at high
 * chroma, which would let two vivid colours pass a floor CIE76 rejects),
 * and it is the metric the measured collision was originally reported
 * in, so the numbers in the docs stay comparable.
 */
export function deltaE76(a: string, b: string): number {
  const [l1, a1, b1] = hexToLab(a);
  const [l2, a2, b2] = hexToLab(b);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

/** `#rrggbb` → CIE L*a*b*, via linear sRGB and XYZ (D65). */
function hexToLab(hex: string): readonly [number, number, number] {
  const raw = hex.startsWith("#") ? hex.slice(1) : hex;
  const channel = (at: number): number => {
    const v = parseInt(raw.slice(at, at + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(0);
  const g = channel(2);
  const b = channel(4);

  // sRGB → XYZ (D65), then normalised by the D65 white point.
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) / 1.0;
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;

  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

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
