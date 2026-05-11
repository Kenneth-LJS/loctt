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
  - key: v1
    label: Version 1.0
`);
    expect(cfg.milestones[0]).toEqual({ key: "v1", label: "Version 1.0" });
  });

  it("accepts a YYYY-MM-DD target_date as a string or YAML date", () => {
    // Unquoted YYYY-MM-DD is parsed as Date by yaml; the parser
    // coerces it back to a string before zod runs.
    const cfg = parseMilestonesConfig(`milestones:
  - key: v1
    label: Version 1.0
    target_date: 2026-06-30
`);
    expect(cfg.milestones[0]?.target_date).toBe("2026-06-30");
  });

  it("preserves archived", () => {
    const cfg = parseMilestonesConfig(`milestones:
  - key: v1
    label: V1
    archived: true
`);
    expect(cfg.milestones[0]?.archived).toBe(true);
  });

  it("rejects a leading-digit key (slug rules)", () => {
    const yaml = `milestones:
  - key: 1v1
    label: Bad
`;
    expect(() => parseMilestonesConfig(yaml)).toThrow(MilestonesConfigError);
    expect(() => parseMilestonesConfig(yaml)).toThrow(/slug starting with a letter/);
  });

  it("rejects a malformed target_date", () => {
    const yaml = `milestones:
  - key: v1
    label: V1
    target_date: "06-2026"
`;
    expect(() => parseMilestonesConfig(yaml)).toThrow(MilestonesConfigError);
    expect(() => parseMilestonesConfig(yaml)).toThrow(/YYYY-MM-DD/);
  });

  it("rejects duplicate keys", () => {
    const yaml = `milestones:
  - key: v1
    label: A
  - key: v1
    label: B
`;
    expect(() => parseMilestonesConfig(yaml)).toThrow("duplicate milestone key: v1");
  });

  it("rejects empty label", () => {
    const yaml = `milestones:
  - key: v1
    label: ""
`;
    expect(() => parseMilestonesConfig(yaml)).toThrow("milestones[0].label must be a non-empty string");
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
        { key: "v1", label: "V1.0", target_date: "2026-06-30" as const },
      ],
    };
    const yaml = serializeMilestonesConfig(cfg);
    const reparsed = parseMilestonesConfig(yaml);
    expect(reparsed.milestones).toEqual(cfg.milestones);
  });
});
