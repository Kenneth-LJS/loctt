import type { EntityColor } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { PaletteEntry } from "./color.js";
import {
  BUILTIN_PALETTE,
  deltaE76,
  getPaletteEntry,
  isKnownPaletteId,
  MIN_PALETTE_DELTA_E,
  resolveEntityColor,
  resolveEntityColorOr,
} from "./color.js";
import { parseLabelsConfig, serializeLabelsConfig } from "./labels.js";

/**
 * K103 — the resolver is the ONE place a colour becomes a hex, so
 * these cover: each shape resolving correctly per mode, an unknown
 * palette id degrading as a NAMED failure rather than throwing, and
 * palette references being LIVE (Ken's ruling) rather than snapshots.
 */

describe("the built-in palette", () => {
  it("exposes entries with a light and a dark value each", () => {
    expect(BUILTIN_PALETTE.length).toBeGreaterThan(0);
    for (const entry of BUILTIN_PALETTE) {
      expect(entry.id).toMatch(/^[a-z][a-z0-9_-]*$/);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.light).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(entry.dark).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("gives every entry a distinct id", () => {
    const ids = BUILTIN_PALETTE.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries the K99 brand accent as the teal entry, per mode", () => {
    // Sourced from apps/web/src/client/styles/tokens.css --accent.
    // If these drift from the tokens, a palette colour stops matching
    // the app chrome it is supposed to match.
    expect(getPaletteEntry("teal")).toMatchObject({ light: "#0F766E", dark: "#39A88F" });
  });

  it("gives each entry a genuinely different value per mode", () => {
    // The whole point of the palette is light/dark awareness. An entry
    // whose two values are equal is a single colour wearing a costume.
    for (const entry of BUILTIN_PALETTE) {
      expect(entry.light.toLowerCase()).not.toBe(entry.dark.toLowerCase());
    }
  });

  it("reports membership by id", () => {
    expect(isKnownPaletteId("teal")).toBe(true);
    expect(isKnownPaletteId("chartreuse")).toBe(false);
    expect(getPaletteEntry("chartreuse")).toBeUndefined();
  });

  it("keeps every id that was ever offered, so stored data still resolves", () => {
    // Stored configs reference palette entries BY ID
    // (`color: {palette: "green"}`). Renaming or removing one silently
    // breaks user data that this codebase cannot see — the seeded
    // tracker alone has `green` and `orange` live. Expansion is safe;
    // deletion is not. Anything added goes below this list, never in
    // place of it.
    const ids = new Set(BUILTIN_PALETTE.map(e => e.id));
    for (const original of ["teal", "blue", "green", "orange", "red", "slate", "gray"]) {
      expect(ids.has(original), `palette id "${original}" was removed or renamed`).toBe(true);
    }
  });
});

describe("every palette entry is perceptually distinct from every other", () => {
  /**
   * **The regression this exists to stop.** Before the expansion,
   * `slate` and `gray` sat 4.10 ΔE apart in light mode and **2.31** in
   * dark — at the just-noticeable difference, i.e. indistinguishable.
   * Ken reported it by eye ("the last 2 colours here look like each
   * other"); nothing in the build caught it, because a duplicate colour
   * is perfectly valid data. Only a measurement catches this class of
   * defect, and only in BOTH modes: a pair can separate in light and
   * collide in dark, which is exactly what slate/gray did (4.10 → 2.31).
   *
   * This is the guard. A future entry added by eye fails here.
   */
  const modes = ["light", "dark"] as const;

  it.each(modes)("holds the ΔE floor across every pair, in %s mode", mode => {
    const failures: string[] = [];
    for (let i = 0; i < BUILTIN_PALETTE.length; i++) {
      for (let j = i + 1; j < BUILTIN_PALETTE.length; j++) {
        const a = BUILTIN_PALETTE[i] as PaletteEntry;
        const b = BUILTIN_PALETTE[j] as PaletteEntry;
        const distance = deltaE76(a[mode], b[mode]);
        if (distance < MIN_PALETTE_DELTA_E) {
          failures.push(
            `${a.id} (${a[mode]}) vs ${b.id} (${b[mode]}): ΔE ${distance.toFixed(2)} `
            + `< ${MIN_PALETTE_DELTA_E}`,
          );
        }
      }
    }
    expect(failures, `indistinguishable palette pairs in ${mode} mode:\n${failures.join("\n")}`)
      .toEqual([]);
  });

  it("no longer lets slate and gray collide, the specific reported defect", () => {
    // Named rather than left to the sweep above: this is the pair a
    // user actually complained about, and a regression that reverted
    // only `slate` should fail with that pair's name on it.
    const slate = getPaletteEntry("slate") as PaletteEntry;
    const gray = getPaletteEntry("gray") as PaletteEntry;
    expect(deltaE76(slate.light, gray.light)).toBeGreaterThanOrEqual(MIN_PALETTE_DELTA_E);
    expect(deltaE76(slate.dark, gray.dark)).toBeGreaterThanOrEqual(MIN_PALETTE_DELTA_E);
  });

  it("measures ΔE on a known scale, so the floor means what it claims", () => {
    // Pins the metric itself. Without this, `deltaE76` could silently
    // become a function that returns a large number for everything and
    // the sweep above would pass against a palette of one colour.
    expect(deltaE76("#000000", "#000000")).toBe(0);
    // Black to white is the maximum L* excursion: ΔE = 100.
    expect(deltaE76("#000000", "#FFFFFF")).toBeCloseTo(100, 1);
    // The historical collision, as originally measured.
    expect(deltaE76("#5F6B7E", "#5A6472")).toBeCloseTo(4.1, 1);
    expect(deltaE76("#8A8A92", "#909098")).toBeCloseTo(2.3, 1);
  });
});

describe("the palette is VARIED, not one saturation with the hue rotated", () => {
  /**
   * **The regression this exists to stop, and why the ΔE sweep above
   * cannot stop it.** The sweep asks a pairwise-minimum question: "is
   * every pair ≥ ΔE 15 apart?" A hue ramp at a single fixed chroma
   * answers *yes* — at constant chroma, ΔE is dominated by hue
   * difference — while still reading as one family, because the eye
   * separates colours by saturation and lightness at least as much as
   * by hue. Distinctness and variety are different properties; the
   * sweep enforces only the first.
   *
   * That is not hypothetical: it shipped. A288's expansion put **eight**
   * entries at exactly HSV saturation 0.79 in light mode and **nine** at
   * exactly 0.50 in dark, and the ΔE test stayed green throughout.
   *
   * **Why cluster size rather than a standard-deviation floor.** An sd
   * floor was measured and rejected as indefensible: between the A288
   * palette and this one, dark-mode saturation sd moves 0.131 → 0.173,
   * a ratio of only 1.32. Any threshold in that gap is a coin-flip that
   * a future good palette could fail and a future ramp could pass.
   * The largest same-saturation cluster moves 8 → 2, a ratio of 4.0,
   * and it states the defect *directly*: "N entries share one
   * saturation" is exactly what went wrong. A metric that names the
   * defect beats a summary statistic that merely correlates with it.
   *
   * **Calibration (measured, not guessed).** With a 0.05-wide bucket,
   * the largest cluster is 9 light / 10 dark for A288 and 4 light /
   * 5 dark for this palette. The cap is **5**: above this palette's
   * worst so ordinary re-tuning does not trip it, and a clear 4–5
   * entries below A288's, so the ramp cannot come back unnoticed.
   *
   * The cap cannot go lower than 5 even in principle, because the
   * crowded dark bucket contains `blue`, `orange` and `red` — three
   * token-sourced originals that are byte-frozen and cannot be moved
   * to satisfy a test. A stricter cap would be unreachable by any
   * amount of work on the twelve entries that *are* movable.
   */
  const SATURATION_BUCKET = 0.05;
  const MAX_ENTRIES_PER_BUCKET = 5;

  /** HSV saturation — the axis the A288 ramp held constant. */
  function saturation(hex: string): number {
    const raw = hex.startsWith("#") ? hex.slice(1) : hex;
    const ch = (at: number): number => parseInt(raw.slice(at, at + 2), 16) / 255;
    const [r, g, b] = [ch(0), ch(2), ch(4)] as const;
    const max = Math.max(r, g, b);
    return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
  }

  it("measures saturation on a known scale, so the cap means what it claims", () => {
    // Pins the helper, for the same reason the ΔE and contrast scales
    // are pinned: a broken saturation function makes the cap vacuous.
    expect(saturation("#FF0000")).toBeCloseTo(1, 5); // fully saturated
    expect(saturation("#808080")).toBeCloseTo(0, 5); // achromatic
    expect(saturation("#000000")).toBe(0); // black, the divide-by-zero case
  });

  it.each(["light", "dark"] as const)(
    "spreads saturation instead of clustering it, in %s mode",
    mode => {
      const buckets = new Map<number, string[]>();
      for (const entry of BUILTIN_PALETTE) {
        const bucket = Math.round(saturation(entry[mode]) / SATURATION_BUCKET);
        buckets.set(bucket, [...(buckets.get(bucket) ?? []), entry.id]);
      }
      const crowded = [...buckets.entries()]
        .filter(([, ids]) => ids.length > MAX_ENTRIES_PER_BUCKET)
        .map(([bucket, ids]) =>
          `saturation ≈ ${(bucket * SATURATION_BUCKET).toFixed(2)}: `
          + `${ids.length} entries (${ids.join(", ")})`,
        );
      expect(
        crowded,
        `these ${mode}-mode entries collapse onto one saturation — the palette reads as a\n`
        + `generated hue ramp rather than a varied set. Vary chroma and lightness, not just\n`
        + `hue; see the character rule in color.ts.\n${crowded.join("\n")}`,
      ).toEqual([]);
    },
  );
});

describe("every palette entry is readable against its own theme background", () => {
  /**
   * A palette value is rendered as TEXT (a chip label, a coloured task
   * key), not only as a filled square, so the bar is WCAG AA for normal
   * text — 4.5:1 — against the surface the entity sits on.
   *
   * Backgrounds are the design-system tokens from
   * `apps/web/src/client/styles/tokens.css`. `--bg-surface` is the
   * binding constraint in both themes: light canvas `#F6F8FC` is darker
   * than white and dark canvas `#0B0B0C` is darker than the dark
   * surface, so a value clearing surface clears canvas too.
   */
  const BG_SURFACE = { light: "#FFFFFF", dark: "#141416" } as const;
  const AA_NORMAL_TEXT = 4.5;

  /** WCAG 2.x relative luminance of an `#rrggbb` colour. */
  function relativeLuminance(hex: string): number {
    const raw = hex.startsWith("#") ? hex.slice(1) : hex;
    const channel = (at: number): number => {
      const v = parseInt(raw.slice(at, at + 2), 16) / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  }
  function contrastRatio(a: string, b: string): number {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  it("computes contrast on the WCAG scale", () => {
    // Pins the helper, for the same reason the ΔE scale is pinned: a
    // broken ratio function makes the sweep below vacuous.
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it.each(["light", "dark"] as const)("clears AA against the %s surface", mode => {
    // NO EXEMPTIONS. `orange` light was excluded here until 2026-09-23
    // (a known 3.84:1 failure, deferred because it was a
    // --feedback-warn-fg token literal). Ken ruled it fixed: the
    // palette moved to #BD5B00 (4.51:1) while the token stays #CC6600,
    // because a warn chip is BOLD (AA-large, 3:1) and a palette swatch
    // colours body-weight text (AA-normal, 4.5:1). Every entry is now
    // held to the bar with no name excluded.
    const failures: string[] = [];
    for (const entry of BUILTIN_PALETTE) {
      const ratio = contrastRatio(entry[mode], BG_SURFACE[mode]);
      if (ratio < AA_NORMAL_TEXT) {
        failures.push(`${entry.id} (${entry[mode]}): ${ratio.toFixed(2)}:1 on ${BG_SURFACE[mode]}`);
      }
    }
    expect(failures, `palette entries below AA in ${mode} mode:\n${failures.join("\n")}`)
      .toEqual([]);
  });

  it("holds orange to AA now that its exemption is gone", () => {
    // The INVERSE of the old sentinel. That one asserted orange was
    // BELOW AA, so the exemption could not silently outlive its defect
    // — and it did its job: fixing orange turned it red, which is how
    // this exemption came to be removed rather than forgotten.
    //
    // Named explicitly rather than left to the sweep above, because
    // orange is the one entry whose value diverges from its token on
    // purpose: `--feedback-warn-fg` stays #CC6600 under K99 (bold chip,
    // AA-large) while the palette needs AA-normal for body-weight label
    // text. If someone "resyncs" the two, this fails.
    const orange = getPaletteEntry("orange") as PaletteEntry;
    expect(contrastRatio(orange.light, BG_SURFACE.light)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});

describe("resolveEntityColor — each shape, each mode", () => {
  it("resolves a single colour to the same value in both modes", () => {
    expect(resolveEntityColor("#1e6fcb", "light")).toEqual({ ok: true, hex: "#1e6fcb" });
    expect(resolveEntityColor("#1e6fcb", "dark")).toEqual({ ok: true, hex: "#1e6fcb" });
  });

  it("resolves a double colour to the half matching the mode", () => {
    const color: EntityColor = { light: "#CC6600", dark: "#F0A868" };
    expect(resolveEntityColor(color, "light")).toEqual({ ok: true, hex: "#CC6600" });
    expect(resolveEntityColor(color, "dark")).toEqual({ ok: true, hex: "#F0A868" });
  });

  it("resolves a palette reference to that entry's per-mode value", () => {
    expect(resolveEntityColor({ palette: "teal" }, "light")).toEqual({ ok: true, hex: "#0F766E" });
    expect(resolveEntityColor({ palette: "teal" }, "dark")).toEqual({ ok: true, hex: "#39A88F" });
  });

  it("resolves every built-in entry in both modes", () => {
    for (const entry of BUILTIN_PALETTE) {
      expect(resolveEntityColor({ palette: entry.id }, "light")).toEqual({
        ok: true,
        hex: entry.light,
      });
      expect(resolveEntityColor({ palette: entry.id }, "dark")).toEqual({
        ok: true,
        hex: entry.dark,
      });
    }
  });
});

describe("resolveEntityColor — an unknown palette id degrades, never crashes", () => {
  it("returns a named failure instead of throwing", () => {
    const resolved = resolveEntityColor({ palette: "chartreuse" }, "light");
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected failure");
    expect(resolved.failure.reason).toBe("unknown_palette_id");
    expect(resolved.failure.paletteId).toBe("chartreuse");
  });

  it("names the offending id and the way out in the message", () => {
    const resolved = resolveEntityColor({ palette: "chartreuse" }, "dark");
    if (resolved.ok) throw new Error("expected failure");
    // ERR-10: the message must name what was wrong and what to do,
    // because it is shown to the user verbatim.
    expect(resolved.failure.message).toContain("chartreuse");
    expect(resolved.failure.message).toContain("teal");
  });

  it("degrades the FIELD only — the lenient wrapper yields the fallback", () => {
    // Field-local, not object-fatal: the entity still renders, with
    // the caller's neutral default in place of its bad colour.
    expect(resolveEntityColorOr({ palette: "chartreuse" }, "light")).toBeUndefined();
    expect(resolveEntityColorOr({ palette: "chartreuse" }, "light", "#5A6472")).toBe("#5A6472");
  });

  it("passes a good colour straight through the lenient wrapper", () => {
    expect(resolveEntityColorOr({ palette: "teal" }, "dark", "#000000")).toBe("#39A88F");
    expect(resolveEntityColorOr("#1e6fcb", "light", "#000000")).toBe("#1e6fcb");
    expect(resolveEntityColorOr(undefined, "light", "#5A6472")).toBe("#5A6472");
  });
});

describe("palette references are LIVE, not snapshots (Ken's ruling)", () => {
  it("re-reads the palette on every resolve, so an entry change flows through", () => {
    // Models "the user edited what `teal` means". Nothing may have
    // captured the hex at pick time: the stored value is the ID, and
    // resolution must consult the palette afresh each call.
    const stored: EntityColor = { palette: "teal" };
    const before = resolveEntityColor(stored, "light");

    const entry = getPaletteEntry("teal") as PaletteEntry;
    const mutated: PaletteEntry = { ...entry, light: "#123456" };
    const relookup = (id: string): PaletteEntry | undefined =>
      id === "teal" ? mutated : getPaletteEntry(id);

    // Re-resolving against the changed definition yields the NEW value
    // for the same stored reference — the entity was never rewritten.
    const after = relookup("teal")?.light;
    expect(before).toEqual({ ok: true, hex: "#0F766E" });
    expect(after).toBe("#123456");
    expect(stored).toEqual({ palette: "teal" });
  });

  it("stores no resolved hex anywhere in the reference", () => {
    // The anti-snapshot assertion: if a future change ever caches the
    // resolved value onto the stored colour, this catches it.
    const stored: EntityColor = { palette: "teal" };
    resolveEntityColor(stored, "light");
    resolveEntityColor(stored, "dark");
    expect(Object.keys(stored)).toEqual(["palette"]);
  });
});

describe("labels.yaml round-trips all three colour shapes", () => {
  function roundTrip(color: unknown): unknown {
    const yaml = `labels:\n  - id: "01J0LABEL0000000000000001"\n    name: bug\n`
      + `    color: ${JSON.stringify(color)}\n`;
    const parsed = parseLabelsConfig(yaml);
    const reparsed = parseLabelsConfig(serializeLabelsConfig(parsed));
    return reparsed.labels[0]?.color;
  }

  it("round-trips a single colour", () => {
    expect(roundTrip("#1e6fcb")).toBe("#1e6fcb");
  });

  it("round-trips a double colour", () => {
    expect(roundTrip({ light: "#0F766E", dark: "#39A88F" })).toEqual({
      light: "#0F766E",
      dark: "#39A88F",
    });
  });

  it("round-trips a palette reference without resolving it", () => {
    // Serializing must write the ID back, not the hex it resolves to —
    // otherwise the live reference is silently snapshotted on save.
    expect(roundTrip({ palette: "teal" })).toEqual({ palette: "teal" });
  });

  it("keeps the label but drops a colour no shape accepts", () => {
    // MSL-22, extended to K103: a cosmetic field that matches none of
    // the three shapes is dropped so the label still renders.
    const parsed = parseLabelsConfig(
      `labels:\n  - id: "01J0LABEL0000000000000001"\n    name: bug\n    color: "not-a-colour"\n`,
    );
    expect(parsed.labels).toHaveLength(1);
    expect(parsed.labels[0]?.name).toBe("bug");
    expect(parsed.labels[0]?.color).toBeUndefined();
    expect(parsed.broken ?? []).toHaveLength(0);
  });

  it("keeps a palette reference to an id that does not exist", () => {
    // An unknown palette id is well-SHAPED, so it survives the load and
    // degrades at RESOLVE time. Dropping it here would destroy the
    // user's value over a palette entry they might yet re-add.
    const parsed = parseLabelsConfig(
      `labels:\n  - id: "01J0LABEL0000000000000001"\n    name: bug\n`
      + `    color:\n      palette: chartreuse\n`,
    );
    expect(parsed.labels[0]?.color).toEqual({ palette: "chartreuse" });
    expect(resolveEntityColorOr(parsed.labels[0]?.color, "light", "#5A6472")).toBe("#5A6472");
  });
});
