// @vitest-environment node
/// <reference types="node" />

/**
 * The two rules that remove the browser's native `<details>` marker for
 * `ui/Disclosure.tsx`.
 *
 * ## Why this is a source parse, not a render
 *
 * Ken's bug was a literal `▸ Show details` on an error page — the user
 * agent's own marker, which no grep of our source can find. jsdom cannot
 * catch it either: it never loads the compiled Tailwind output, so
 * `getComputedStyle(summary).listStyle` reports jsdom's default whatever
 * the stylesheet says, and `::-webkit-details-marker` is not reachable
 * from script in ANY environment — not jsdom, not a real browser. The
 * only place the invariant is observable is the stylesheet source, so
 * that is where it is asserted, following `spinnerKeyframes.test.ts` and
 * `themeIsland.test.ts`.
 *
 * `ui/Disclosure.test.tsx` holds the render-side half (the
 * `.loctt-disclosure` hook is actually on the element). Both are needed:
 * the class with no rule, or the rule with no class, each leave the
 * marker drawn.
 *
 * ## Why BOTH rules are asserted separately
 *
 * `list-style: none` covers Chrome and Firefox. Safari draws the marker
 * through the legacy `::-webkit-details-marker` pseudo-element, which
 * `list-style` does not reach — and Safari is where Ken saw the glyph.
 * Deleting either rule alone must go red, so they are two expectations,
 * not one regex.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "index.css"), "utf8");

/** Body of the rule whose selector is exactly `selector`. */
function ruleBlock(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `rule \`${selector}\` not found in index.css`).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

describe("Disclosure: native <details> marker suppression", () => {
  it("kills the standards ::marker via list-style:none (Chrome, Firefox)", () => {
    expect(ruleBlock(".loctt-disclosure > summary")).toMatch(/list-style:\s*none/);
  });

  it("kills WebKit's ::-webkit-details-marker — the Safari path Ken's `▸` came down", () => {
    // Tailwind's `marker:` variant compiles to `::marker` only and cannot
    // express this pseudo-element, which is why it is hand-written here
    // rather than being a utility at the call site.
    expect(ruleBlock(".loctt-disclosure > summary::-webkit-details-marker")).toMatch(
      /display:\s*none/,
    );
  });

  it("rotates our caret on [open] rather than the component swapping icons", () => {
    // The CSS-only flip is what keeps `Disclosure` uncontrolled: no React
    // state, so the native element (including find-in-page's own expand)
    // stays the single source of truth.
    expect(
      ruleBlock(".loctt-disclosure[open] > summary .loctt-disclosure-caret"),
    ).toMatch(/transform:\s*rotate\(90deg\)/);
  });

  it("drops the caret transition under prefers-reduced-motion", () => {
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".loctt-disclosure-caret"));
    expect(start, "no reduced-motion guard for the disclosure caret").toBeGreaterThan(-1);
    expect(css.slice(start, start + 200)).toMatch(
      /\.loctt-disclosure-caret\s*\{\s*transition:\s*none/,
    );
  });
});
