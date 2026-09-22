import { describe, expect, it } from "vitest";

import {
  COLOR_ARG_SYNTAX,
  formatEntityColor,
  formatPaletteList,
  parseEntityColorArg,
  unknownPaletteIdWarning,
} from "./color.js";
import { UsageError } from "./errors.js";

/**
 * @verifies K103 stage 3 — the CLI's rendering of, and input syntax for,
 * the three entity-colour shapes.
 *
 * What regression each block catches:
 *
 *  - **render**: the eight lint errors this ticket opened with were four
 *    call sites interpolating an `EntityColor` into a template literal,
 *    which prints `[object Object]` for the palette and per-mode shapes.
 *    Every assertion below is written so it FAILS on that string rather
 *    than merely "contains a hex" — a loose `toContain` would pass
 *    against garbage, which is the trap that already caught an agent in
 *    this feature.
 *  - **parse**: a `--color` value has to express three shapes in one
 *    string. These pin the spelling of each, and pin that a malformed
 *    one is a clean `UsageError` rather than a silently-stored bad value.
 *  - **palette listing**: `--color palette:<id>` is unusable if the ids
 *    are unlistable, so the listing is part of the contract, not a
 *    convenience.
 */

describe("formatEntityColor — every shape renders, none stringifies to [object Object]", () => {
  it("renders a single (bare hex) colour as the hex itself", () => {
    // Exact equality: `toContain("#1e6fcb")` would also pass on
    // "#1e6fcb[object Object]".
    expect(formatEntityColor("#1e6fcb")).toBe("#1e6fcb");
  });

  it("renders a double colour in its own input spelling, NOT [object Object]", () => {
    const rendered = formatEntityColor({ light: "#CC6600", dark: "#F0A868" });
    expect(rendered).toBe("light:#CC6600,dark:#F0A868");
    expect(rendered).not.toContain("[object Object]");
  });

  it("renders a palette ref as its id plus both live-resolved modes", () => {
    // teal resolves to #0F766E light / #39A88F dark in the built-in
    // palette. Both halves appear because a terminal has no theme
    // signal — picking one would print a value that is wrong half the
    // time, silently.
    const rendered = formatEntityColor({ palette: "teal" });
    expect(rendered).toBe("palette:teal (#0F766E/#39A88F)");
    expect(rendered).not.toContain("[object Object]");
  });

  it("renders an UNKNOWN palette id rather than throwing or blanking", () => {
    // Field-local degradation: a bad colour must not take down the row
    // it sits on, let alone the listing.
    const rendered = formatEntityColor({ palette: "chartreuse" });
    expect(rendered).toBe("palette:chartreuse (unknown)");
    expect(() => formatEntityColor({ palette: "chartreuse" })).not.toThrow();
  });
});

describe("parseEntityColorArg — one flag value, three shapes", () => {
  it("parses a bare hex into the single shape (a string, unchanged)", () => {
    expect(parseEntityColorArg("#1e6fcb")).toBe("#1e6fcb");
  });

  it("parses palette:<id> into a palette reference", () => {
    expect(parseEntityColorArg("palette:teal")).toEqual({ palette: "teal" });
  });

  it("parses light:…,dark:… into a per-mode pair", () => {
    expect(parseEntityColorArg("light:#CC6600,dark:#F0A868"))
      .toEqual({ light: "#CC6600", dark: "#F0A868" });
  });

  it("accepts the per-mode pair in either order (no positional trap)", () => {
    expect(parseEntityColorArg("dark:#F0A868,light:#CC6600"))
      .toEqual({ light: "#CC6600", dark: "#F0A868" });
  });

  it("round-trips ALL THREE rendered shapes back into the same value", () => {
    // The rendered form is the input syntax, so a value read out of
    // `loctt status list` can be pasted straight into `edit`. A display
    // format you cannot type back is a trap the user finds by hitting it.
    const double = { light: "#CC6600", dark: "#F0A868" } as const;
    expect(parseEntityColorArg(formatEntityColor(double))).toEqual(double);
    expect(parseEntityColorArg(formatEntityColor("#1e6fcb"))).toBe("#1e6fcb");
    // The palette line carries a derived "(light/dark)" suffix; pasting
    // it back must still yield the reference, not a parse error.
    expect(parseEntityColorArg(formatEntityColor({ palette: "teal" })))
      .toEqual({ palette: "teal" });
  });

  it("refuses a half-given per-mode pair instead of storing one side", () => {
    expect(() => parseEntityColorArg("light:#CC6600")).toThrow(UsageError);
  });

  it("refuses a non-hex value rather than writing it", () => {
    // Validation is EntityColorSchema's; this pins that the CLI actually
    // consults it rather than passing any string through.
    expect(() => parseEntityColorArg("red")).toThrow(UsageError);
    expect(() => parseEntityColorArg("#12345")).toThrow(UsageError);
  });

  it("names the three shapes in its refusal so the user can correct it", () => {
    expect(() => parseEntityColorArg("nonsense")).toThrow(/palette:/);
    expect(COLOR_ARG_SYNTAX).toContain("palette:<id>");
  });
});

describe("unknownPaletteIdWarning — a bad id warns, it does not refuse", () => {
  it("warns for an id that is not in the built-in palette", () => {
    const warning = unknownPaletteIdWarning({ palette: "chartreuse" });
    expect(warning).toMatch(/chartreuse/);
    expect(warning).toMatch(/^Warning:/);
  });

  it("stays silent for a known id and for the other two shapes", () => {
    expect(unknownPaletteIdWarning({ palette: "teal" })).toBeUndefined();
    expect(unknownPaletteIdWarning("#1e6fcb")).toBeUndefined();
    expect(unknownPaletteIdWarning({ light: "#CC6600", dark: "#F0A868" })).toBeUndefined();
  });

  it("does not block the write — an unknown id still parses to a value", () => {
    // Deliberate: the value is legal on the wire and core degrades it.
    // A hard refusal would mean a CLI that cannot write a colour the
    // file format accepts.
    expect(parseEntityColorArg("palette:chartreuse")).toEqual({ palette: "chartreuse" });
  });
});

describe("formatPaletteList — the ids are discoverable", () => {
  it("lists every built-in entry with its id and both mode values", () => {
    const lines = formatPaletteList();
    const teal = lines.find(l => l.startsWith("teal\t"));
    expect(teal).toBe("teal\tTeal\tlight #0F766E\tdark #39A88F");
    // The id is the first tab-separated field, so `cut -f1` is the id list.
    expect(lines.map(l => l.split("\t")[0])).toContain("blue");
    expect(lines.length).toBeGreaterThan(1);
  });
});
