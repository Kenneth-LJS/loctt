import type { EntityColor } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { PaletteEntry } from "./color.js";
import {
  BUILTIN_PALETTE,
  getPaletteEntry,
  isKnownPaletteId,
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
