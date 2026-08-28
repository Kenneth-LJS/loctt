import { describe, expect, it } from "vitest";

import {
  LabelsConfigError,
  parseLabelsConfig,
  serializeLabelsConfig,
} from "./labels.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

describe("parseLabelsConfig", () => {
  it("parses a minimal config", () => {
    const cfg = parseLabelsConfig(`labels:
  - id: 01HX0000000000000000000001
    name: Bug
`);
    expect(cfg.labels).toHaveLength(1);
    expect(cfg.labels[0]).toEqual({ id: "01HX0000000000000000000001", name: "Bug" });
  });

  it("preserves color and archived", () => {
    const cfg = parseLabelsConfig(`labels:
  - id: 01HX0000000000000000000001
    name: Bug
    color: "#cc0000"
    archived: true
`);
    expect(cfg.labels[0]).toEqual({
      id: "01HX0000000000000000000001",
      name: "Bug",
      color: "#cc0000",
      archived: true,
    });
  });

  it("rejects an empty name", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: ""
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
  });

  it("rejects an empty id", () => {
    const yaml = `labels:
  - id: ""
    name: Bug
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
  });

  // @verifies MSL-22
  it("keeps a label whose hex color is malformed, dropping only the color", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
    color: "not-a-color"
`;
    // This previously threw, which took the *whole file* down: one bad
    // cosmetic field made every label in it unresolvable, so every task
    // rendered "unknown label" (MSL-22). V9's refuse-rather-than-build
    // reasoning is about a definition that cannot render — a bad colour
    // does not stop a label having an id and a name.
    //
    // Per CLAUDE.md, a fix that requires editing a green test means
    // that test was asserting the bug.
    const cfg = parseLabelsConfig(yaml);
    expect(cfg.labels[0]?.name).toBe("Bug");
    expect(cfg.labels[0]?.color).toBeUndefined();
  });

  it("accepts a 3-digit hex color", () => {
    const cfg = parseLabelsConfig(`labels:
  - id: 01HX0000000000000000000001
    name: Bug
    color: "#f00"
`);
    expect(cfg.labels[0]?.color).toBe("#f00");
  });

  // @verifies MSL-22
  it("drops an 8-digit hex color rather than rejecting the file (no alpha support)", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
    color: "#1e6fcb80"
`;
    // Alpha is still unsupported; what changed is the consequence.
    const cfg = parseLabelsConfig(yaml);
    expect(cfg.labels[0]?.name).toBe("Bug");
    expect(cfg.labels[0]?.color).toBeUndefined();
  });

  it("rejects an archived field of the wrong type", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
    archived: "yes"
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
  });

  it("rejects duplicate ids", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
  - id: 01HX0000000000000000000001
    name: BugDup
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
    expect(() => parseLabelsConfig(yaml)).toThrow(/duplicate label id/);
  });

  it("rejects unknown top-level keys", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
extra: nope
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
    expect(() => parseLabelsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("rejects unknown per-label keys", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
    description: nope
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseLabelsConfig("{ labels: [")).toThrow(YamlSyntaxError);
    expect(() => parseLabelsConfig("{ labels: [")).toThrow(/labels\.yaml/);
  });
});

describe("serializeLabelsConfig", () => {
  it("round-trips through parse", () => {
    const cfg = {
      labels: [
        { id: "01HX0000000000000000000001", name: "Bug", color: "#cc0000" },
        { id: "01HX0000000000000000000002", name: "UI", archived: true as const },
      ],
    };
    const yaml = serializeLabelsConfig(cfg);
    const reparsed = parseLabelsConfig(yaml);
    expect(reparsed.labels).toEqual(cfg.labels);
  });

  it("does not emit archived when false/undefined", () => {
    const cfg = {
      labels: [{ id: "01HX0000000000000000000001", name: "Bug" }],
    };
    const yaml = serializeLabelsConfig(cfg);
    expect(yaml).not.toContain("archived:");
  });
});
