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

  // Phase-7B: a per-ENTRY structural fault no longer blanks the whole
  // labels surface. The corrupt entry degrades to a `BrokenEntry` (its
  // index, raw text and the validator's message) and the rest still load
  // — object-fatal problems (see the YAML/array/duplicate-id tests) keep
  // throwing. These four tests previously asserted a throw; per CLAUDE.md,
  // a fix that requires editing a green test means that test was
  // asserting the bug.
  it("degrades a label with an empty name to a broken entry", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: ""
`;
    const cfg = parseLabelsConfig(yaml);
    expect(cfg.labels).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.index).toBe(0);
    expect(cfg.broken?.[0]?.id).toBe("01HX0000000000000000000001");
  });

  it("degrades a label with an empty id to a broken entry (no id on the marker)", () => {
    const yaml = `labels:
  - id: ""
    name: Bug
`;
    const cfg = parseLabelsConfig(yaml);
    expect(cfg.labels).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
    // The id itself is what failed, so the marker carries no id.
    expect(cfg.broken?.[0]?.id).toBeUndefined();
  });

  // @verifies MSL-22
  // @verifies DEG-9
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
  // @verifies DEG-9
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

  it("degrades a label with a wrong-typed archived field to a broken entry", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
    archived: "yes"
`;
    const cfg = parseLabelsConfig(yaml);
    expect(cfg.labels).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.index).toBe(0);
  });

  // The north-star guarantee (principle 5): one structurally-corrupt
  // label never blanks the valid ones beside it. This is the behaviour
  // the whole task exists to add — if the loader reverted to
  // whole-object `.parse()`, the good label here would be lost too.
  it("loads a valid label beside a structurally-corrupt one", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
  - id: 01HX0000000000000000000002
    name: Broken
    archived: "yes"
`;
    const cfg = parseLabelsConfig(yaml);
    expect(cfg.labels).toHaveLength(1);
    expect(cfg.labels[0]).toEqual({ id: "01HX0000000000000000000001", name: "Bug" });
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.index).toBe(1);
    expect(cfg.broken?.[0]?.id).toBe("01HX0000000000000000000002");
    // Value-preserved (K27): the broken entry round-trips its raw text.
    expect(cfg.broken?.[0]?.rawText).toContain("Broken");
  });

  it("omits broken (does not set []) when every entry parses", () => {
    const cfg = parseLabelsConfig(`labels:
  - id: 01HX0000000000000000000001
    name: Bug
`);
    expect(cfg.broken).toBeUndefined();
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

  it("degrades a label with an unknown per-label key to a broken entry", () => {
    const yaml = `labels:
  - id: 01HX0000000000000000000001
    name: Bug
    description: nope
`;
    const cfg = parseLabelsConfig(yaml);
    expect(cfg.labels).toHaveLength(0);
    expect(cfg.broken).toHaveLength(1);
    expect(cfg.broken?.[0]?.error).toMatch(/unrecognized key/);
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

  // K28: a corrupt-but-degraded sibling another process left must survive
  // a serialize that only touched the valid entries. Dropping the
  // `brokenEntriesToPlain(config.broken)` append reddens this — the broken
  // label vanishes from the re-parsed `.broken`.
  it("preserves a broken sibling through serialize + reparse (K28)", () => {
    const cfg = parseLabelsConfig(`labels:
  - id: 01HX0000000000000000000001
    name: Bug
  - id: 01HX0000000000000000000002
    name: Broken
    color: not-a-color
    bogus_key: 1
`);
    expect(cfg.labels).toHaveLength(1);
    expect(cfg.broken).toHaveLength(1);

    const reparsed = parseLabelsConfig(serializeLabelsConfig(cfg));
    expect(reparsed.labels).toEqual(cfg.labels);
    expect(reparsed.broken).toHaveLength(1);
    // Value-preserved (K27): the broken entry round-trips its stored id
    // and the field that failed validation.
    expect(reparsed.broken?.[0]?.id).toBe("01HX0000000000000000000002");
    expect(reparsed.broken?.[0]?.rawText).toContain("bogus_key");
  });
});
