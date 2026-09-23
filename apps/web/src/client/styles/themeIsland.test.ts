// @vitest-environment node
/// <reference types="node" />

/**
 * Nested theme islands: the `@theme` bridge must be re-aliased inside
 * `.dark`, or a nested dark island paints LIGHT.
 *
 * ## The bug this pins
 *
 * `index.css` wires the design tokens into Tailwind with an `@theme`
 * block of `--color-bg-surface: var(--bg-surface)` lines. Tailwind emits
 * those entries **once, on `:root`**, where each resolves immediately
 * against the light tokens and is thereafter inherited as that literal
 * value. `tokens.css`'s `.dark` scope re-declares `--bg-surface` and
 * friends — but NOT the `--color-*` aliases, which are what the
 * utilities actually read (`.bg-bg-surface { background-color:
 * var(--color-bg-surface) }`).
 *
 * On `<html>` this never showed: there is no outer scope to inherit a
 * stale alias from, so `--color-*` resolves against whichever tokens are
 * in force. It appears only when a `.dark` is **nested inside a light
 * page** — precisely what `ui/ThemePreview.tsx` does to show both themes
 * at once.
 *
 * And it failed in the worst possible way. Inspecting the island showed
 * `--bg-surface: #141416` — correct, convincing — while the computed
 * `background-color` was `rgb(255,255,255)`. Verified live at
 * localhost:5173 before the fix: the "Dark" half of the label preview
 * was white. A reviewer reading only the custom properties would have
 * signed it off.
 *
 * ## Why this test is a source parse, not a render
 *
 * jsdom does not implement the CSS cascade for custom properties, and
 * `colorTokens.test.ts` (the other CSS oracle here) needs `npm run
 * build` to have produced current output. This asserts the invariant
 * where it actually lives — the stylesheet source — the same way
 * `contrast.test.ts` reads `tokens.css` directly.
 *
 * The invariant: **every `--color-*` alias declared in `@theme` is also
 * re-declared, identically, in a `.dark` scope.** A new token added to
 * `@theme` and forgotten here would work everywhere except inside a
 * preview island, which is exactly the kind of gap that ships.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "index.css"), "utf8");

/** Body of the first `@theme { … }` block. */
function themeBlock(): string {
  const start = css.indexOf("@theme {");
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

/** Body of the nested-island `:where(.dark) { … }` re-alias block. */
function islandBlock(): string {
  const start = css.indexOf(":where(.dark) {");
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

const ALIAS_RE = /^\s*(--color-[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\);$/gm;

function aliases(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of block.matchAll(ALIAS_RE)) {
    if (m[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2]);
  }
  return out;
}

describe("nested theme islands", () => {
  it("re-declares every @theme colour alias inside .dark", () => {
    const theme = aliases(themeBlock());
    const island = aliases(islandBlock());

    // Sanity: the @theme block really is the alias bridge.
    expect(theme.size).toBeGreaterThan(30);
    expect(theme.get("--color-bg-surface")).toBe("--bg-surface");

    // Every alias, mapped to the SAME underlying token. A missing one
    // is a utility that stays light inside a dark island.
    const missing = [...theme.keys()].filter(k => !island.has(k));
    expect(missing).toEqual([]);

    const mismatched = [...theme.entries()]
      .filter(([k, v]) => island.get(k) !== v)
      .map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  /**
   * The re-alias must not outrank the utilities it feeds. `:where()`
   * holds specificity at zero; a bare `.dark { --color-…}` would still
   * work, but the zero-specificity form is what keeps this safe to
   * apply globally, so it is pinned rather than left to chance.
   */
  it("declares the island aliases at zero specificity", () => {
    expect(css).toContain(":where(.dark) {");
  });

  /**
   * The surfaces `ThemePreview` paints explicitly must be among the
   * re-aliased set — these are the ones whose failure is invisible
   * under inspection.
   */
  it("covers the tokens the two-mode preview depends on", () => {
    const island = aliases(islandBlock());
    for (const token of [
      "--color-bg-surface",
      "--color-text-primary",
      "--color-text-tertiary",
      "--color-border-subtle",
      "--color-bg-muted",
      "--color-text-secondary",
    ]) {
      expect(island.has(token)).toBe(true);
    }
  });
});
