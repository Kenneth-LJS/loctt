import { describe, expect, it } from "vitest";

import {
  MilestonesConfigError,
  parseMilestonesConfig,
  serializeMilestonesConfig,
} from "./milestones.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

describe("parseMilestonesConfig", () => {
  it("parses a minimal milestone", () => {
    const cfg = parseMilestonesConfig(`milestones:
  - id: 01HX0000000000000000000001
    name: Version 1.0
`);
    expect(cfg.milestones[0]).toEqual({ id: "01HX0000000000000000000001", name: "Version 1.0" });
  });

  it("accepts a YYYY-MM-DD target_date as a string or YAML date", () => {
    const cfg = parseMilestonesConfig(`milestones:
  - id: 01HX0000000000000000000001
    name: Version 1.0
    target_date: 2026-06-30
`);
    expect(cfg.milestones[0]?.target_date).toBe("2026-06-30");
  });

  it("preserves archived", () => {
    const cfg = parseMilestonesConfig(`milestones:
  - id: 01HX0000000000000000000001
    name: V1
    archived: true
`);
    expect(cfg.milestones[0]?.archived).toBe(true);
  });

  it("degrades a malformed target_date to a BrokenEntry (does not throw)", () => {
    // Was: asserted parse THREW on a per-entry field error. That encoded
    // the pre-7B bug — one bad field blanked the whole milestones surface.
    // A malformed target_date is now per-entry corruption: the entry
    // degrades to a BrokenEntry carrying the validator's message, and the
    // rest of the file still loads (north-star P5).
    const yaml = `milestones:
  - id: 01HX0000000000000000000001
    name: V1
    target_date: "06-2026"
`;
    const cfg = parseMilestonesConfig(yaml);
    expect(cfg.milestones).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.error).toMatch(/YYYY-MM-DD/);
  });

  it("rejects duplicate ids", () => {
    const yaml = `milestones:
  - id: 01HX0000000000000000000001
    name: A
  - id: 01HX0000000000000000000001
    name: B
`;
    expect(() => parseMilestonesConfig(yaml)).toThrow(/duplicate milestone id/);
  });

  it("degrades an empty name to a BrokenEntry (does not throw)", () => {
    // Was: asserted parse THREW on an empty name. Same pre-7B bug — an
    // empty `name` is a per-entry field error, so the entry now degrades
    // to a BrokenEntry rather than blanking the surface.
    const yaml = `milestones:
  - id: 01HX0000000000000000000001
    name: ""
`;
    const cfg = parseMilestonesConfig(yaml);
    expect(cfg.milestones).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.id).toBe("01HX0000000000000000000001");
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseMilestonesConfig("{ milestones: [")).toThrow(YamlSyntaxError);
    expect(() => parseMilestonesConfig("{ milestones: [")).toThrow(/milestones\.yaml/);
  });

  it("throws when milestones is not a list (object-fatal)", () => {
    expect(() => parseMilestonesConfig("milestones: not-a-list\n")).toThrow(MilestonesConfigError);
  });

  describe("per-entry corruption degrades (BrokenEntry)", () => {
    it("loads valid milestones and sets a corrupt one aside instead of throwing", () => {
      const cfg = parseMilestonesConfig(`milestones:
  - id: 01HX0000000000000000000001
    name: Good One
  - id: 01HX0000000000000000000002
    name: Bad Date
    target_date: "06-2026"
  - id: 01HX0000000000000000000003
    name: Good Two
`);
      // The two well-formed milestones still load.
      expect(cfg.milestones.map(m => m.id)).toEqual([
        "01HX0000000000000000000001",
        "01HX0000000000000000000003",
      ]);
      // The corrupt one is surfaced as broken, carrying its index and id.
      expect(cfg.broken).toHaveLength(1);
      expect(cfg.broken?.[0]).toMatchObject({
        id: "01HX0000000000000000000002",
        index: 1,
      });
      expect(cfg.broken?.[0]?.error).toMatch(/YYYY-MM-DD/);
    });

    it("omits broken (does not set it to []) when every entry parses", () => {
      const cfg = parseMilestonesConfig(`milestones:
  - id: 01HX0000000000000000000001
    name: Version 1.0
`);
      expect(cfg.broken).toBeUndefined();
    });

    it("preserves the raw text of a corrupt entry rather than dropping it", () => {
      const cfg = parseMilestonesConfig(`milestones:
  - id: 01HX0000000000000000000001
    name: 42
`);
      expect(cfg.milestones).toHaveLength(0);
      expect(cfg.broken).toHaveLength(1);
      // Raw value round-trips into the marker (K27: value-preserved).
      expect(cfg.broken?.[0]?.rawText).toMatch(/42/);
    });
  });
});

describe("serializeMilestonesConfig", () => {
  it("round-trips through parse", () => {
    const cfg = {
      milestones: [
        { id: "01HX0000000000000000000001", name: "V1.0", target_date: "2026-06-30" as const },
      ],
    };
    const yaml = serializeMilestonesConfig(cfg);
    const reparsed = parseMilestonesConfig(yaml);
    expect(reparsed.milestones).toEqual(cfg.milestones);
  });

  // K28: a corrupt-but-degraded sibling another process left must survive
  // a serialize that only touched the valid entries. Dropping the
  // `brokenEntriesToPlain(config.broken)` append reddens this.
  it("preserves a broken sibling through serialize + reparse (K28)", () => {
    const cfg = parseMilestonesConfig(`milestones:
  - id: 01HX0000000000000000000001
    name: V1.0
  - id: 01HX0000000000000000000002
    name: V2.0
    target_date: not-a-date
`);
    expect(cfg.milestones).toHaveLength(1);
    expect(cfg.broken).toHaveLength(1);

    const reparsed = parseMilestonesConfig(serializeMilestonesConfig(cfg));
    expect(reparsed.milestones).toEqual(cfg.milestones);
    expect(reparsed.broken).toHaveLength(1);
    expect(reparsed.broken?.[0]?.id).toBe("01HX0000000000000000000002");
    expect(reparsed.broken?.[0]?.rawText).toContain("not-a-date");
  });
});
