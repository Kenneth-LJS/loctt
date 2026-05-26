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

  it("rejects a malformed hex color", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
    color: "not-a-color"
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
    expect(() => parseLabelsConfig(yaml)).toThrow(/hex color/);
  });

  it("accepts a 3-digit hex color", () => {
    const cfg = parseLabelsConfig(`labels:
  - id: 01HX0000000000000000000001
    name: Bug
    color: "#f00"
`);
    expect(cfg.labels[0]?.color).toBe("#f00");
  });

  it("rejects an 8-digit hex color (no alpha support)", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
    color: "#1e6fcb80"
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(/hex color/);
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
