/**
 * K103 stage 3 — the CLI's half of the three-shape entity colour.
 *
 * An `EntityColor` is a bare hex (single), a `{light, dark}` pair
 * (double), or a `{palette: id}` live reference. Contracts owns the
 * shapes, core owns the palette and `resolveEntityColor`; this file owns
 * only the two things that are CLI-specific — how a colour is spelled in
 * a flag value, and how it reads back on a terminal.
 *
 * **Why the terminal renders BOTH halves rather than resolving.** Every
 * other surface has a theme: the web app knows whether it is in light or
 * dark mode, so `resolveEntityColor(color, mode)` has a real `mode` to
 * be given. A terminal does not expose one — there is no portable signal
 * for the emulator's background, and guessing would make
 * `loctt status list` print a value that is simply wrong half the time,
 * silently. So the CLI does not pick a mode. It prints what is *stored*
 * plus, for a palette ref, what that id currently resolves to in each
 * mode (resolved LIVE through core, never snapshotted):
 *
 *   single   #1e6fcb
 *   double   light:#CC6600,dark:#F0A868
 *   palette  palette:teal (#0F766E/#39A88F)      (id, then both modes)
 *
 * The rendered form is deliberately the INPUT syntax for the first two
 * shapes verbatim, so what a user reads out of `list` can be typed
 * straight back into `edit`. The double shape is therefore spelled
 * `light:…,dark:…` rather than a terser `#CC6600/#F0A868`: the slash
 * form reads well but is not something `--color` accepts, and a display
 * format you cannot type back is a trap the user only finds by hitting
 * it. A palette ref renders with its resolved pair appended for
 * legibility; `parseEntityColorArg` accepts the bare `palette:teal`
 * prefix that precedes the parenthesis.
 *
 * **An unknown palette id renders, it does not throw.** Core returns a
 * named failure for one; per the corruption guide's field-local rule the
 * colour degrades to `palette:chartreuse (unknown)` and the entity still
 * lists. This mirrors the web surface, where a bad id falls back to a
 * neutral swatch rather than blanking the row.
 */

import type { EntityColor } from "@loctt/contracts";
import { EntityColorSchema, isDoubleColor, isPaletteColorRef } from "@loctt/contracts";
import { BUILTIN_PALETTE, resolveEntityColor } from "@loctt/core";

import { UsageError } from "./errors.js";

/**
 * Renders a stored `EntityColor` for a terminal. Never throws, never
 * yields `[object Object]` — the bug class this function exists to
 * remove (lint caught four call sites interpolating a colour straight
 * into a template literal, which stringified both object shapes).
 */
export function formatEntityColor(color: EntityColor): string {
  if (isPaletteColorRef(color)) {
    const light = resolveEntityColor(color, "light");
    const dark = resolveEntityColor(color, "dark");
    // Both resolutions fail together (the id is either known or not),
    // but check each so a future failure reason cannot slip through.
    if (!light.ok || !dark.ok) return `palette:${color.palette} (unknown)`;
    return `palette:${color.palette} (${light.hex}/${dark.hex})`;
  }
  if (isDoubleColor(color)) return `light:${color.light},dark:${color.dark}`;
  return color;
}

/** The human syntax summary, reused by every `--color` usage string. */
export const COLOR_ARG_SYNTAX = `#rrggbb | palette:<id> | light:#rrggbb,dark:#rrggbb`;

/**
 * Parses a `--color` flag value into an `EntityColor`.
 *
 * Three spellings, one per shape, chosen to be mutually unambiguous
 * without a mode flag: a hex starts with `#`, a palette ref starts with
 * the `palette:` prefix, and a per-mode pair names both halves. Order
 * inside the pair does not matter (`dark:…,light:…` parses), because a
 * positional convention would be a silent-swap trap.
 *
 * Validation is delegated to `EntityColorSchema` rather than re-done
 * here — a hand-rolled copy of a schema rule is exactly what caused the
 * `dropInvalidColor` data-loss bug in this feature. This function only
 * turns a string into the candidate object; contracts decides whether
 * it is legal.
 *
 * Whether a palette id EXISTS is deliberately NOT checked here:
 * contracts checks slug shape, and core degrades an unknown id at
 * resolve time. Making it a write-time hard error would mean a CLI that
 * cannot write a colour the file format accepts. It is, however, worth
 * warning about — see `unknownPaletteIdWarning`.
 */
export function parseEntityColorArg(raw: string, flag = "--color"): EntityColor {
  const candidate = toColorCandidate(raw, flag);
  const parsed = EntityColorSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new UsageError(
      `${flag} is not a valid colour (got "${raw}"). Expected ${COLOR_ARG_SYNTAX}`,
    );
  }
  return parsed.data;
}

/** Turns the flag spelling into the wire shape, before validation. */
function toColorCandidate(raw: string, flag: string): unknown {
  const value = raw.trim();
  if (value.startsWith("palette:")) {
    // Accept the rendered form too — `palette:teal (#0F766E/#39A88F)` —
    // by dropping the resolved pair `list` appends for legibility. That
    // pair is derived, never stored, so it is read-only noise here; the
    // alternative is a display format that cannot be pasted back.
    const id = value.slice("palette:".length).trim().replace(/\s*\(.*\)$/, "").trim();
    return { palette: id };
  }
  if (value.includes("light:") || value.includes("dark:")) {
    const parts = value.split(",").map(p => p.trim()).filter(p => p.length > 0);
    const pair: Record<string, string> = {};
    for (const part of parts) {
      const colon = part.indexOf(":");
      const name = colon > 0 ? part.slice(0, colon).trim() : "";
      if (name !== "light" && name !== "dark") {
        throw new UsageError(
          `${flag} per-mode value must be light:<hex>,dark:<hex> (got "${raw}")`,
        );
      }
      pair[name] = part.slice(colon + 1).trim();
    }
    if (pair["light"] === undefined || pair["dark"] === undefined) {
      throw new UsageError(
        `${flag} per-mode value needs BOTH light: and dark: (got "${raw}"). `
        + `Pass a bare hex for one colour in both modes`,
      );
    }
    return { light: pair["light"], dark: pair["dark"] };
  }
  // Anything else is offered as shape 1 and judged by the hex schema.
  return value;
}

/**
 * A human warning when a parsed colour names a palette id that does not
 * exist, or `undefined` when there is nothing to say.
 *
 * Deliberately a WARNING, not a refusal (see `parseEntityColorArg`): the
 * value is legal on the wire and degrades gracefully, but an agent or
 * user who fat-fingered `palette:tael` should hear about it now rather
 * than wonder why the swatch is grey.
 */
export function unknownPaletteIdWarning(color: EntityColor): string | undefined {
  if (!isPaletteColorRef(color)) return undefined;
  const resolved = resolveEntityColor(color, "light");
  return resolved.ok ? undefined : `Warning: ${resolved.failure.message}`;
}

/**
 * Passes a parsed colour through, printing `unknownPaletteIdWarning` to
 * stderr first when there is one. Shared by every `--color` call site so
 * a bad palette id warns identically on labels and workflow entities.
 */
export function warnUnknownPalette(color: EntityColor): EntityColor {
  const warning = unknownPaletteIdWarning(color);
  if (warning !== undefined) console.error(warning);
  return color;
}

/** Renders the built-in palette as one line per entry, for `loctt palette`. */
export function formatPaletteList(): string[] {
  return BUILTIN_PALETTE.map(
    e => `${e.id}\t${e.label}\tlight ${e.light}\tdark ${e.dark}`,
  );
}
