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

  it("rejects a malformed start_date", () => {
    const yaml = `sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: "01/01/2026"
    end_date: 2026-01-14
    state: future
`;
    expect(() => parseSprintsConfig(yaml)).toThrow(SprintsConfigError);
    expect(() => parseSprintsConfig(yaml)).toThrow(/YYYY-MM-DD/);
  });

  it("rejects end_date before start_date", () => {
    const yaml = `sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: 2026-01-14
    end_date: 2026-01-01
    state: future
`;
    expect(() => parseSprintsConfig(yaml)).toThrow(SprintsConfigError);
    expect(() => parseSprintsConfig(yaml)).toThrow(
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

  it("rejects an unknown state", () => {
    const yaml = `sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: planning
`;
    expect(() => parseSprintsConfig(yaml)).toThrow(SprintsConfigError);
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

  it("rejects unknown per-sprint keys", () => {
    const yaml = `sprints:
  - id: 01HX0000000000000000000001
    name: Sprint
    start_date: 2026-01-01
    end_date: 2026-01-14
    state: future
    velocity: 42
`;
    expect(() => parseSprintsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseSprintsConfig("{ sprints: [")).toThrow(YamlSyntaxError);
    expect(() => parseSprintsConfig("{ sprints: [")).toThrow(/sprints\.yaml/);
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
});
