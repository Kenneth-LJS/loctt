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

  it("rejects a malformed target_date", () => {
    const yaml = `milestones:
  - id: 01HX0000000000000000000001
    name: V1
    target_date: "06-2026"
`;
    expect(() => parseMilestonesConfig(yaml)).toThrow(MilestonesConfigError);
    expect(() => parseMilestonesConfig(yaml)).toThrow(/YYYY-MM-DD/);
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

  it("rejects empty name", () => {
    const yaml = `milestones:
  - id: 01HX0000000000000000000001
    name: ""
`;
    expect(() => parseMilestonesConfig(yaml)).toThrow(MilestonesConfigError);
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseMilestonesConfig("{ milestones: [")).toThrow(YamlSyntaxError);
    expect(() => parseMilestonesConfig("{ milestones: [")).toThrow(/milestones\.yaml/);
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
});
