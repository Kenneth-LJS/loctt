// @vitest-environment node
/// <reference types="node" />

/**
 * The brand spinner's `@keyframes` (`ui/brand/LogoSpinner.tsx`,
 * `index.css`'s `.loctt-spin*` rules) carry Ken's 2026-09-23 timing
 * revision, ported verbatim from his supplied source SVGs.
 *
 * ## Why this test is a source parse, not a render
 *
 * jsdom does not run CSS animations, and there is nothing to observe at
 * runtime that would catch a timing regression (the geometry — where the
 * "L"/"o" end up — is identical at 0%/80%/100% either way; only the
 * anticipation dip's position, angle and easing changed). This asserts
 * the invariant where it actually lives — the stylesheet source — the
 * same way `themeIsland.test.ts` and `contrast.test.ts` read their CSS
 * directly rather than rendering.
 *
 * The three numbers this pins (Ken's diff, verified against his supplied
 * `loctt-animated-64-dark-color.svg`):
 *  - the anticipation dip moved from 24% to 18% of the cycle
 *  - it is shallower: rotation -22deg to -15deg
 *  - the entry easing (0% -> dip) is now `cubic-bezier(0.4, 0, 0.4, 1)`
 *    on all three of `loctt-rot`/`loctt-l`/`loctt-o`
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "index.css"), "utf8");

/** Body of a `@keyframes <name> { … }` block. */
function keyframesBlock(name: string): string {
  const start = css.indexOf(`@keyframes ${name} {`);
  expect(start, `@keyframes ${name} not found`).toBeGreaterThan(-1);
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

describe("loctt spinner keyframes (2026-09-23 timing revision)", () => {
  it("loctt-rot: dips at 18% to -15deg, entering on the new cubic-bezier", () => {
    const block = keyframesBlock("loctt-rot");
    expect(block).toMatch(/18%\s*\{\s*transform:\s*rotate\(-15deg\)/);
    expect(block).toMatch(
      /0%\s*\{\s*transform:\s*rotate\(0deg\);\s*animation-timing-function:\s*cubic-bezier\(0\.4,\s*0,\s*0\.4,\s*1\)/,
    );
    // The old values must not linger alongside the new ones.
    expect(block).not.toMatch(/24%/);
    expect(block).not.toMatch(/-22deg/);
  });

  it("loctt-l: dips at 18%, entering on the new cubic-bezier", () => {
    const block = keyframesBlock("loctt-l");
    expect(block).toMatch(/18%\s*\{\s*transform:\s*translate\(-5\.657px,\s*5\.657px\)/);
    expect(block).toMatch(
      /0%\s*\{\s*transform:\s*translate\(0,\s*0\);\s*animation-timing-function:\s*cubic-bezier\(0\.4,\s*0,\s*0\.4,\s*1\)/,
    );
    expect(block).not.toMatch(/\b20%/);
  });

  it("loctt-o: dips at 18%, entering on the new cubic-bezier", () => {
    const block = keyframesBlock("loctt-o");
    expect(block).toMatch(/18%\s*\{\s*transform:\s*translate\(5\.657px,\s*-5\.657px\)/);
    expect(block).toMatch(
      /0%\s*\{\s*transform:\s*translate\(0,\s*0\);\s*animation-timing-function:\s*cubic-bezier\(0\.4,\s*0,\s*0\.4,\s*1\)/,
    );
    expect(block).not.toMatch(/\b20%/);
  });

  it("keeps our colours: LogoSpinner themes fill from CSS vars, not the source SVG's hex literals", () => {
    const spinner = readFileSync(
      resolve(here, "..", "ui", "brand", "LogoSpinner.tsx"),
      "utf8",
    );
    expect(spinner).toContain('fill="var(--accent)"');
    expect(spinner).toContain('fill="var(--text-primary)"');
    // The source SVG's own hex literals are named in this file's prose
    // (documenting where the vars came from) but must never appear as
    // an actual `fill="..."` attribute value.
    expect(spinner).not.toMatch(/fill="#[0-9A-Fa-f]{6}"/);
  });
});
