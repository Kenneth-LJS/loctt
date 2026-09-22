// @vitest-environment node
/// <reference types="node" />

/**
 * WCAG contrast harness for the design tokens (A11Y-40, A11Y-51; K81/K82).
 *
 * A fast, deterministic guard on the *palette*: it parses the token
 * values out of `tokens.css` (the shipped source of truth) and asserts
 * each foreground/background pair clears its WCAG threshold — body text
 * ≥ 4.5:1, meaningful non-text UI indicators (control/divider borders)
 * ≥ 3:1 — in BOTH themes.
 *
 * This is the supplement, not the whole story: axe-in-Playwright
 * (`tests/ui/flow-accessibility.spec.ts`) is the primary A11Y-40 gate
 * because it measures the *rendered* page (opacity, layering,
 * user-chosen label colours) — things a static palette test cannot see.
 * But this test fails in milliseconds when someone lightens a token
 * below its ratio, which is the regression that actually happens (a
 * token edit), and it is where K81 (`--border-control`) and K82
 * (dividers → `--border-default`) are pinned. See decisions.md A-CONTRAST.
 *
 * @verifies A11Y-40
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cssText = readFileSync(resolve(here, "tokens.css"), "utf8");

/**
 * Extract the token map for a scope. `:root` is light; `.dark` is dark.
 * We read only the FIRST `:root {…}` and `.dark {…}` blocks that define
 * colours (the spacing `:root` block has no color tokens, so it is
 * harmless if matched — its keys just never appear in the pairs below).
 */
function readScope(selector: string): Record<string, string> {
  // Concatenate every block for the selector (there are two :root blocks:
  // spacing and colours) so all tokens are visible.
  const re = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`, "g");
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(cssText)) !== null) {
    const body = m[1] ?? "";
    const decl = /--([\w-]+):\s*(#[0-9A-Fa-f]{6});/g;
    let d: RegExpExecArray | null;
    while ((d = decl.exec(body)) !== null) {
      out[`--${d[1] ?? ""}`] = (d[2] ?? "").toUpperCase();
    }
  }
  return out;
}

const light = readScope(":root");
const dark = readScope(".dark");

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function ratio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Foreground text tokens that must clear 4.5:1 against the backgrounds
 * they are actually painted on. `--text-disabled` is deliberately
 * excluded — WCAG exempts disabled controls, and A11Y-31 handles their
 * distinguishability separately.
 */
const TEXT_TOKENS = ["--text-primary", "--text-secondary", "--text-tertiary"];
const TEXT_BACKGROUNDS = ["--bg-surface", "--bg-canvas", "--bg-muted"];

/**
 * Status / feedback chip fg-on-its-own-bg pairs. These carry small (12px)
 * text, so they owe 4.5:1. The axe sweep (A11Y-40) found `--status-active`
 * at 4.35:1; asserting the pairs here catches the next such regression in
 * ms. Each entry is [fg-token, bg-token].
 */
const CHIP_PAIRS: readonly [string, string][] = [
  ["--status-pending-fg", "--status-pending-bg"],
  ["--status-active-fg", "--status-active-bg"],
  ["--status-completed-fg", "--status-completed-bg"],
  ["--status-discarded-fg", "--status-discarded-bg"],
  ["--feedback-danger-fg", "--feedback-danger-bg"],
  ["--feedback-success-fg", "--feedback-success-bg"],
];

/**
 * Chip pairs held to the WCAG **AA-Large** bar (3:1), not AA-normal.
 *
 * K99: Ken chose a VIBRANT orange for the warn / high-priority chip over a
 * muddy AA-normal amber, accepting AA-Large. This is legitimate because the
 * chip and priority-dot text is **bold** (≥14px bold qualifies for the 3:1
 * large-text threshold). This is the ONE deliberate AA-Large token in the
 * palette; every other chip stays at 4.5:1 above. Recorded so a future
 * darken-for-AA "fix" does not silently revert Ken's call — and so a drop
 * below 3:1 (which WOULD fail even large text) still turns this red.
 */
const AA_LARGE_CHIP_PAIRS: readonly [string, string][] = [
  ["--feedback-warn-fg", "--feedback-warn-bg"],
];

/**
 * Non-text UI indicators that carry meaning and must clear 3:1 (A11Y-40
 * bullet 2). `--border-control` is the checkbox/radio boundary (K81);
 * `--border-default` is the structural-divider token (K82). Decorative
 * hairlines (`--border-subtle`) are intentionally NOT held to 3:1.
 */
const CONTROL_BORDER = "--border-control";
// The ≥3:1 region-separator token (K82-REV) — for borders that are the
// sole signal between semantically distinct regions (sticky action bars).
// `--border-default`/`--border-subtle` are decorative and NOT asserted at
// 3:1, per K82-REV (WCAG 3:1 is for indicators required to understand
// content; row separators/hairlines are decoration).
const DIVIDER_BORDER = "--border-divider";

describe.each([
  ["light", light],
  ["dark", dark],
])("token contrast (%s theme)", (_theme, tokens) => {
  it("has the tokens under test", () => {
    for (const t of [...TEXT_TOKENS, CONTROL_BORDER, DIVIDER_BORDER, ...TEXT_BACKGROUNDS]) {
      expect(tokens[t], `missing ${t}`).toBeDefined();
    }
  });

  for (const fg of TEXT_TOKENS) {
    for (const bg of TEXT_BACKGROUNDS) {
      it(`${fg} on ${bg} meets 4.5:1`, () => {
        const r = ratio(tokens[fg] as string, tokens[bg] as string);
        expect(r, `${tokens[fg]} on ${tokens[bg]} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const [fg, bg] of CHIP_PAIRS) {
    it(`${fg} on ${bg} meets 4.5:1 (chip text)`, () => {
      const r = ratio(tokens[fg] as string, tokens[bg] as string);
      expect(r, `${tokens[fg]} on ${tokens[bg]} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  // K99 vibrant-orange exception: bold chip text held to AA-Large (3:1).
  for (const [fg, bg] of AA_LARGE_CHIP_PAIRS) {
    it(`${fg} on ${bg} meets 3:1 (AA-Large, bold chip text — K99)`, () => {
      const r = ratio(tokens[fg] as string, tokens[bg] as string);
      expect(r, `${tokens[fg]} on ${tokens[bg]} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }

  // Control borders (K81): 3:1 against surface AND muted (a checkbox can
  // sit on either — a hovered/zebra row uses a muted wash). This is
  // settled and passing.
  for (const bg of ["--bg-surface", "--bg-muted"]) {
    it(`${CONTROL_BORDER} on ${bg} meets 3:1`, () => {
      const r = ratio(tokens[CONTROL_BORDER] as string, tokens[bg] as string);
      expect(r, `${tokens[CONTROL_BORDER]} on ${tokens[bg]} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }

  // Region-separator borders (K82-REV): the ≥3:1 token used where a
  // border is the sole signal between semantically distinct regions
  // (sticky action bars). Decorative dividers (--border-subtle,
  // --border-default) are intentionally NOT asserted here.
  for (const bg of ["--bg-surface", "--bg-muted"]) {
    it(`${DIVIDER_BORDER} on ${bg} meets 3:1`, () => {
      const r = ratio(tokens[DIVIDER_BORDER] as string, tokens[bg] as string);
      expect(r, `${tokens[DIVIDER_BORDER]} on ${tokens[bg]} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }
});
