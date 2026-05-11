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
  - key: bug
    label: Bug
`);
    expect(cfg.labels).toHaveLength(1);
    expect(cfg.labels[0]).toEqual({ key: "bug", label: "Bug" });
  });

  it("preserves color and archived", () => {
    const cfg = parseLabelsConfig(`labels:
  - key: bug
    label: Bug
    color: "#cc0000"
    archived: true
`);
    expect(cfg.labels[0]).toEqual({
      key: "bug",
      label: "Bug",
      color: "#cc0000",
      archived: true,
    });
  });

  it("rejects a leading-digit key", () => {
    const yaml = `labels:
  - key: 1bug
    label: X
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
    expect(() => parseLabelsConfig(yaml)).toThrow(/slug starting with a letter/);
  });

  it("rejects an empty label", () => {
    const yaml = `labels:
  - key: bug
    label: ""
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
    expect(() => parseLabelsConfig(yaml)).toThrow("labels[0].label must be a non-empty string");
  });

  it("rejects a malformed hex color", () => {
    const yaml = `labels:
  - key: bug
    label: Bug
    color: "not-a-color"
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
    expect(() => parseLabelsConfig(yaml)).toThrow(/hex color/);
  });

  it("accepts a 3-digit hex color", () => {
    const cfg = parseLabelsConfig(`labels:
  - key: bug
    label: Bug
    color: "#f00"
`);
    expect(cfg.labels[0]?.color).toBe("#f00");
  });

  it("rejects an 8-digit hex color (no alpha support)", () => {
    const yaml = `labels:
  - key: bug
    label: Bug
    color: "#1e6fcb80"
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(/hex color/);
  });

  it("rejects an archived field of the wrong type", () => {
    const yaml = `labels:
  - key: bug
    label: Bug
    archived: "yes"
`;
    expect(() => parseLabelsConfig(yaml)).toThrow("labels[0].archived must be a boolean, got: string");
  });

  it("rejects duplicate keys", () => {
    const yaml = `labels:
  - key: bug
    label: Bug
  - key: bug
    label: BugDup
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
    expect(() => parseLabelsConfig(yaml)).toThrow("duplicate label key: bug");
  });

  it("rejects unknown top-level keys", () => {
    const yaml = `labels:
  - key: bug
    label: Bug
extra: nope
`;
    expect(() => parseLabelsConfig(yaml)).toThrow(LabelsConfigError);
    expect(() => parseLabelsConfig(yaml)).toThrow(/unrecognized key/);
  });

  it("rejects unknown per-label keys", () => {
    const yaml = `labels:
  - key: bug
    label: Bug
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
        { key: "bug", label: "Bug", color: "#cc0000" },
        { key: "ui", label: "UI", archived: true as const },
      ],
    };
    const yaml = serializeLabelsConfig(cfg);
    const reparsed = parseLabelsConfig(yaml);
    expect(reparsed.labels).toEqual(cfg.labels);
  });

  it("does not emit archived when false/undefined", () => {
    const cfg = {
      labels: [{ key: "bug", label: "Bug" }],
    };
    const yaml = serializeLabelsConfig(cfg);
    expect(yaml).not.toContain("archived:");
  });
});
