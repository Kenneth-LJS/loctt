import { describe, expect, it } from "vitest";

import {
  parseSprintsConfig,
  serializeSprintsConfig,
  SprintsConfigError,
} from "./sprints.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

describe("parseSprintsConfig", () => {
  it("parses a minimal sprint", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint 1
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: active
`);
    expect(cfg.sprints[0]).toEqual({
      id: "01HX0000000000000000000001",
      name: "Sprint 1",
      start_date: "2026-01-01",
      end_date: "2026-01-14",
      state: "active",
    });
  });

  it("accepts dates already quoted as strings", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: "2026-01-01"
    end_date: "2026-01-14"
    state: future
`);
    expect(cfg.sprints[0]?.start_date).toBe("2026-01-01");
  });

  it("preserves goal and archived", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: completed
    goal: "Ship X"
    archived: true
`);
    expect(cfg.sprints[0]).toEqual({
      id: "01HX0000000000000000000001",
      name: "Sprint",
      start_date: "2026-01-01",
      end_date: "2026-01-14",
      state: "completed",
      goal: "Ship X",
      archived: true,
    });
  });

  // Was: "rejects a malformed start_date" — asserted that one per-entry
  // corruption threw and blanked the whole config. Phase-7B P5 makes a
  // per-entry fault degrade to `broken` instead (queries.ts precedent), so
  // this now asserts the corrupt entry is surfaced, not that the file 500s.
  it("degrades a malformed start_date to `broken`", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: "01/01/2026"
    end_date: 2026-01-14
    state: future
`);
    expect(cfg.sprints).toEqual([]);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.error).toMatch(/YYYY-MM-DD/);
  });

  // Was: "rejects end_date before start_date" — same bug-asserting shape.
  // The per-entry superRefine now degrades the entry rather than throwing.
  it("degrades an end_date-before-start_date entry to `broken`", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: 2026-01-14
    end_date: 2026-01-01
    state: future
`);
    expect(cfg.sprints).toEqual([]);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.error).toContain(
      "end_date (2026-01-01) must not be before start_date (2026-01-14)",
    );
  });

  it("accepts end_date equal to start_date", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: 2026-01-01
    end_date: 2026-01-01
    state: future
`);
    expect(cfg.sprints[0]?.end_date).toBe("2026-01-01");
  });

  // Was: "rejects an unknown state" (threw). An unknown enum value is a
  // per-entry fault under P5 — the entry degrades to `broken`.
  it("degrades an unknown state to `broken`", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: planning
`);
    expect(cfg.sprints).toEqual([]);
    expect(cfg.broken).toHaveLength(1);
  });

  it("rejects duplicate sprint ids", () => {
    const yaml = `sprints:
  - id: 01HX0000000000000000000001
    name: A
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: future
  - id: 01HX0000000000000000000001
    name: B
    start_date: 2026-02-01
    end_date: 2026-02-14
    state: future
`;
    expect(() => parseSprintsConfig(yaml)).toThrow(/duplicate sprint id/);
  });

  // Was: "rejects unknown per-sprint keys" (threw). An extra key on ONE
  // sprint is a per-entry fault under P5 — that entry degrades to `broken`
  // rather than blanking the rest. (An unknown TOP-LEVEL key is still
  // object-fatal and throws — see the object-fatal suite below.)
  it("degrades a sprint with an unknown per-sprint key to `broken`", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: future
    velocity: 42
`);
    expect(cfg.sprints).toEqual([]);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.error).toMatch(/velocity/);
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseSprintsConfig("{ sprints: [")).toThrow(YamlSyntaxError);
    expect(() => parseSprintsConfig("{ sprints: [")).toThrow(/sprints\.yaml/);
  });

  describe("per-entry corruption (P5 degrade)", () => {
    it("degrades one corrupt sprint to `broken` while valid ones load", () => {
      const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Good
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: active
  - id: 01HX0000000000000000000002
    name: Bad date
    start_date: "01/01/2026"
    end_date: 2026-01-14
    state: future
  - id: 01HX0000000000000000000003
    name: Also good
    start_date: 2026-02-01
    end_date: 2026-02-14
    state: completed
`);
      // Valid entries load intact.
      expect(cfg.sprints.map(s => s.id)).toEqual([
        "01HX0000000000000000000001",
        "01HX0000000000000000000003",
      ]);
      // The corrupt one is surfaced, not hidden — with its index, id and
      // the validator's message.
      expect(cfg.broken).toHaveLength(1);
      expect(cfg.broken?.[0]).toMatchObject({
        id: "01HX0000000000000000000002",
        index: 1,
      });
      expect(cfg.broken?.[0]?.error).toMatch(/YYYY-MM-DD/);
    });

    it("degrades an end_date-before-start_date entry (per-entry superRefine)", () => {
      const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Backwards
    start_date: 2026-01-14
    end_date: 2026-01-01
    state: future
  - id: 01HX0000000000000000000002
    name: Fine
    start_date: 2026-02-01
    end_date: 2026-02-14
    state: future
`);
      expect(cfg.sprints.map(s => s.id)).toEqual(["01HX0000000000000000000002"]);
      expect(cfg.broken).toHaveLength(1);
      expect(cfg.broken?.[0]?.error).toMatch(
        /end_date \(2026-01-01\) must not be before start_date \(2026-01-14\)/,
      );
    });

    it("degrades an entry with an unknown key rather than blanking the file", () => {
      const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Extra key
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: future
    velocity: 42
  - id: 01HX0000000000000000000002
    name: Clean
    start_date: 2026-02-01
    end_date: 2026-02-14
    state: future
`);
      expect(cfg.sprints.map(s => s.id)).toEqual(["01HX0000000000000000000002"]);
      expect(cfg.broken).toHaveLength(1);
      expect(cfg.broken?.[0]?.error).toMatch(/velocity/);
    });

    it("omits `broken` entirely when every entry is valid", () => {
      const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint 1
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: active
`);
      expect(cfg.broken).toBeUndefined();
    });
  });

  describe("object-fatal corruption still throws", () => {
    it("throws when `sprints` is not an array", () => {
      expect(() => parseSprintsConfig("sprints: not-a-list")).toThrow(
        SprintsConfigError,
      );
    });

    it("throws on an unknown top-level key", () => {
      const yaml = `sprints: []
extraneous: true
`;
      expect(() => parseSprintsConfig(yaml)).toThrow(/unrecognized key/);
    });

    it("still throws on duplicate ids among valid entries (object-fatal)", () => {
      const yaml = `sprints:
  - id: 01HX0000000000000000000001
    name: A
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: future
  - id: 01HX0000000000000000000001
    name: B
    start_date: 2026-02-01
    end_date: 2026-02-14
    state: future
`;
      expect(() => parseSprintsConfig(yaml)).toThrow(/duplicate sprint id/);
    });
  });
});

describe("serializeSprintsConfig", () => {
  it("round-trips through parse", () => {
    const cfg = {
      sprints: [
        {
          id: "01HX0000000000000000000001",
          name: "Sprint 1",
          start_date: "2026-01-01",
          end_date: "2026-01-14",
          state: "active" as const,
          goal: "Ship X",
        },
      ],
    };
    const yaml = serializeSprintsConfig(cfg);
    const reparsed = parseSprintsConfig(yaml);
    expect(reparsed.sprints).toEqual(cfg.sprints);
  });

  // K28: a corrupt-but-degraded sibling another process left must survive
  // a serialize that only touched the valid entries. Dropping the
  // `brokenEntriesToPlain(config.broken)` append reddens this.
  it("preserves a broken sibling through serialize + reparse (K28)", () => {
    const cfg = parseSprintsConfig(`sprints:
  - id: 01HX0000000000000000000001
    name: Sprint 1
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: active
  - id: 01HX0000000000000000000002
    name: Sprint 2
    start_date: not-a-date
    end_date: 2026-02-14
    state: planned
`);
    expect(cfg.sprints).toHaveLength(1);
    expect(cfg.broken).toHaveLength(1);

    const reparsed = parseSprintsConfig(serializeSprintsConfig(cfg));
    expect(reparsed.sprints).toEqual(cfg.sprints);
    expect(reparsed.broken).toHaveLength(1);
    expect(reparsed.broken?.[0]?.id).toBe("01HX0000000000000000000002");
    expect(reparsed.broken?.[0]?.rawText).toContain("not-a-date");
  });
});
