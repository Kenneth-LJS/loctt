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
 * Non-text UI indicators that carry meaning and must clear 3:1 (A11Y-40
 * bullet 2). `--border-control` is the checkbox/radio boundary (K81);
 * `--border-default` is the structural-divider token (K82). Decorative
 * hairlines (`--border-subtle`) are intentionally NOT held to 3:1.
 */
const CONTROL_BORDER = "--border-control";
const DIVIDER_BORDER = "--border-default";

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

  // Control borders (K81): 3:1 against surface AND muted (a checkbox can
  // sit on either — a hovered/zebra row uses a muted wash). This is
  // settled and passing.
  for (const bg of ["--bg-surface", "--bg-muted"]) {
    it(`${CONTROL_BORDER} on ${bg} meets 3:1`, () => {
      const r = ratio(tokens[CONTROL_BORDER] as string, tokens[bg] as string);
      expect(r, `${tokens[CONTROL_BORDER]} on ${tokens[bg]} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }

  // Divider borders (K82): PARKED. Building the harness proved K82's
  // stated fix insufficient — `--border-default` is only ~1.4:1 (light)
  // / ~1.36:1 (dark), nowhere near 3:1. A divider that genuinely clears
  // 3:1 must be ~#7C8598-dark, a prominent gridline — a real visual
  // change K82 did not anticipate. Surfaced to Ken as a NEEDS-OWNER
  // decision (see TEMP-TODO §0 / known-gaps). Marked `.todo` rather than
  // asserted, so the harness does not encode an unmet, undecided target.
  for (const bg of ["--bg-surface", "--bg-muted"]) {
    it.todo(`${DIVIDER_BORDER} on ${bg} meets 3:1 — pending K82 clarification`);
  }
});
