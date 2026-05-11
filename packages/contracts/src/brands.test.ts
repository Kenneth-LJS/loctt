import { describe, expect, it } from "vitest";

import {
  HexColor,
  IanaTimezone,
  isIanaTimezoneShape,
  IsoDate,
  SlugKey,
  SprintKey,
} from "./brands.js";

describe("IsoDate", () => {
  it("accepts a YYYY-MM-DD string", () => {
    expect(IsoDate.parse("2026-01-15")).toBe("2026-01-15");
  });

  it("rejects YYYY/MM/DD", () => {
    expect(() => IsoDate.parse("2026/01/15")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects partial dates", () => {
    expect(() => IsoDate.parse("2026-01")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects ISO timestamps", () => {
    // The brand checks shape only; "2026-01-15T..." has the right
    // first 10 chars but trailing junk fails the anchored regex.
    expect(() => IsoDate.parse("2026-01-15T00:00:00Z")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects empty string", () => {
    expect(() => IsoDate.parse("")).toThrow();
  });

  it("rejects non-string", () => {
    expect(() => IsoDate.parse(20260115)).toThrow();
  });
});

describe("SlugKey", () => {
  it("accepts a lowercase letter-led slug", () => {
    expect(SlugKey.parse("backend")).toBe("backend");
    expect(SlugKey.parse("backend-api")).toBe("backend-api");
    expect(SlugKey.parse("a_b_c-1")).toBe("a_b_c-1");
  });

  it("rejects leading digit", () => {
    expect(() => SlugKey.parse("1bad")).toThrow(/slug starting with a letter/);
  });

  it("rejects leading underscore", () => {
    expect(() => SlugKey.parse("_x")).toThrow(/slug starting with a letter/);
  });

  it("rejects leading hyphen", () => {
    expect(() => SlugKey.parse("-x")).toThrow(/slug starting with a letter/);
  });

  it("rejects uppercase", () => {
    expect(() => SlugKey.parse("Backend")).toThrow();
  });

  it("rejects whitespace", () => {
    expect(() => SlugKey.parse("a b")).toThrow();
  });

  it("rejects dots (use SprintKey for sprints)", () => {
    expect(() => SlugKey.parse("v1.0")).toThrow();
  });

  it("rejects empty string", () => {
    expect(() => SlugKey.parse("")).toThrow();
  });
});

describe("SprintKey", () => {
  it("accepts dotted forms", () => {
    expect(SprintKey.parse("sprint_2026.q1")).toBe("sprint_2026.q1");
    expect(SprintKey.parse("2026.q1-iter-3")).toBe("2026.q1-iter-3");
  });

  it("accepts leading digit (different from SlugKey)", () => {
    expect(SprintKey.parse("2026q1")).toBe("2026q1");
  });

  it("rejects uppercase", () => {
    expect(() => SprintKey.parse("Q1")).toThrow();
  });
});

describe("HexColor", () => {
  it("accepts 6-digit lowercase with hash", () => {
    expect(HexColor.parse("#1e6fcb")).toBe("#1e6fcb");
  });

  it("accepts 6-digit uppercase with hash", () => {
    expect(HexColor.parse("#1E6FCB")).toBe("#1E6FCB");
  });

  it("accepts 6-digit without hash", () => {
    expect(HexColor.parse("1e6fcb")).toBe("1e6fcb");
  });

  it("accepts 3-digit short form", () => {
    expect(HexColor.parse("#f00")).toBe("#f00");
    expect(HexColor.parse("f00")).toBe("f00");
  });

  it("rejects 4-digit", () => {
    expect(() => HexColor.parse("#1234")).toThrow(/hex color/);
  });

  it("rejects 5-digit", () => {
    expect(() => HexColor.parse("#12345")).toThrow(/hex color/);
  });

  it("rejects 8-digit", () => {
    expect(() => HexColor.parse("#12345678")).toThrow(/hex color/);
  });

  it("rejects non-hex characters", () => {
    expect(() => HexColor.parse("#xyz")).toThrow(/hex color/);
    expect(() => HexColor.parse("#1g2h3i")).toThrow(/hex color/);
  });

  it("rejects color names", () => {
    expect(() => HexColor.parse("red")).toThrow(/hex color/);
  });
});

describe("IanaTimezone", () => {
  it("accepts UTC", () => {
    expect(IanaTimezone.parse("UTC")).toBe("UTC");
  });

  it("accepts a known IANA zone", () => {
    expect(IanaTimezone.parse("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(IanaTimezone.parse("Europe/London")).toBe("Europe/London");
    expect(IanaTimezone.parse("Asia/Tokyo")).toBe("Asia/Tokyo");
  });

  it("rejects an unknown zone", () => {
    expect(() => IanaTimezone.parse("Mars/Olympus_Mons")).toThrow(/timezone/);
  });

  it("rejects abbreviations like 'PST'", () => {
    expect(() => IanaTimezone.parse("PST")).toThrow(/timezone/);
  });

  it("rejects empty string", () => {
    expect(() => IanaTimezone.parse("")).toThrow();
  });

  it("rejects offset-only forms", () => {
    expect(() => IanaTimezone.parse("+05:00")).toThrow(/timezone/);
  });
});

describe("isIanaTimezoneShape (fallback validator)", () => {
  // This is the fallback path used when Intl.supportedValuesOf
  // isn't available (older Node). It can't distinguish a real
  // zone from a well-shaped string; the contract is only "looks
  // like an IANA zone." Testing it directly because the runtime
  // branch is hard to exercise via IanaTimezone.parse on a Node
  // version that does have supportedValuesOf.

  it("accepts UTC", () => {
    expect(isIanaTimezoneShape("UTC")).toBe(true);
  });

  it("accepts Region/City shape", () => {
    expect(isIanaTimezoneShape("America/Los_Angeles")).toBe(true);
    expect(isIanaTimezoneShape("Europe/London")).toBe(true);
    expect(isIanaTimezoneShape("Asia/Tokyo")).toBe(true);
  });

  it("accepts multi-segment paths (e.g. America/Argentina/Buenos_Aires)", () => {
    expect(isIanaTimezoneShape("America/Argentina/Buenos_Aires")).toBe(true);
    expect(isIanaTimezoneShape("America/Indiana/Indianapolis")).toBe(true);
  });

  it("accepts shapes with digits (e.g. Etc/GMT+5)", () => {
    expect(isIanaTimezoneShape("Etc/GMT+5")).toBe(true);
    expect(isIanaTimezoneShape("Etc/GMT-3")).toBe(true);
  });

  it("rejects bare abbreviations", () => {
    expect(isIanaTimezoneShape("PST")).toBe(false);
    expect(isIanaTimezoneShape("EST")).toBe(false);
  });

  it("rejects offset-only forms", () => {
    expect(isIanaTimezoneShape("+05:00")).toBe(false);
    expect(isIanaTimezoneShape("-08:00")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isIanaTimezoneShape("")).toBe(false);
  });

  it("rejects lowercase region prefixes", () => {
    // IANA zones use TitleCase region/city; the fallback enforces
    // this so a typo like "america/los_angeles" doesn't slip through.
    expect(isIanaTimezoneShape("america/Los_Angeles")).toBe(false);
  });

  it("rejects strings without a slash (except UTC)", () => {
    expect(isIanaTimezoneShape("Europe")).toBe(false);
    expect(isIanaTimezoneShape("Tokyo")).toBe(false);
  });
});
