import { describe, expect,it } from "vitest";

import { parseWorkflowConfig, WorkflowConfigError } from "./workflow.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

const CANONICAL_YAML = `
key:
  prefix: T-

statuses:
  - key: not_started
    label: Not started
    category: pending
    default: true
  - key: in_progress
    label: In progress
    category: active
  - key: blocked
    label: Blocked
    category: active
  - key: done
    label: Done
    category: completed

priorities:
  - key: low
    label: Low
    value: 1
  - key: medium
    label: Medium
    value: 2
  - key: high
    label: High
    value: 3

task_types:
  - key: task
    label: Task

relationships:
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
    graph: tree
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
  - key: relates_to
    label: Relates to
    kind: symmetric

custom_fields:
  - key: sprint
    label: Sprint
    type: enum
    multi: false
    searchable: true
    values:
      - key: sprint_1
        label: Sprint 1
        value: 1
      - key: sprint_2
        label: Sprint 2
        value: 2
  - key: owner_team
    label: Owner team
    type: string
    multi: false
    searchable: true
`;

describe("parseWorkflowConfig", () => {
  it("parses the canonical workflow.yaml from the design doc", () => {
    const config = parseWorkflowConfig(CANONICAL_YAML);

    expect(config.key.prefix).toBe("T-");
    expect(config.statuses).toHaveLength(4);
    expect(config.statuses[0]).toEqual({ key: "not_started", label: "Not started", category: "pending", default: true });
    expect(config.priorities).toHaveLength(3);
    expect(config.priorities[2]).toEqual({ key: "high", label: "High", value: 3 });
    expect(config.task_types).toHaveLength(1);
    expect(config.task_types[0]).toEqual({ key: "task", label: "Task" });
    expect(config.relationships).toHaveLength(3);
    expect(config.relationships[0]).toEqual({
      key: "parent",
      label: "Parent",
      inverse: "child",
      inverse_label: "Child",
      graph: "tree",
    });
    expect(config.relationships[1]).toEqual({
      key: "blocks",
      label: "Blocks",
      inverse: "is_blocked_by",
      inverse_label: "Is blocked by",
    });
    expect(config.custom_fields).toHaveLength(2);
    expect(config.custom_fields[0]?.key).toBe("sprint");
    expect(config.custom_fields[0]?.values).toHaveLength(2);
    expect(config.custom_fields[1]?.key).toBe("owner_team");
    expect(config.custom_fields[1]?.values).toBeUndefined();
  });

  it("rejects files missing custom_fields", () => {
    const yaml = `
key:
  prefix: X-
statuses:
  - key: open
    label: Open
    category: pending
    default: true
priorities:
  - key: normal
    label: Normal
task_types:
  - key: task
    label: Task
relationships:
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
  });

  it("allows priorities without numeric value", () => {
    const yaml = `
key:
  prefix: T-
statuses:
  - key: open
    label: Open
    category: pending
    default: true
priorities:
  - key: normal
    label: Normal
task_types:
  - key: task
    label: Task
relationships:
  - key: parent
    label: Parent
    inverse: child
    inverse_label: Child
custom_fields: []
`;
    const config = parseWorkflowConfig(yaml);
    expect(config.priorities[0]?.value).toBeUndefined();
  });

  it("throws on missing key.prefix", () => {
    expect(() => parseWorkflowConfig(`key: {}\nstatuses: []\npriorities: []\ntask_types: []\nrelationships: []`))
      .toThrow(WorkflowConfigError);
  });

  // O6: an invalid status category is a per-ENTRY fault. In STRICT mode
  // (the default, used by the write gate) it still throws — this is the
  // behaviour the previous version of this test asserted and the write path
  // depends on. In TOLERANT mode (the read path) it degrades to a
  // `BrokenEntry` instead of blanking the whole workflow.
  // (`custom_fields` added so the file is a complete, object-valid record;
  // its absence is object-fatal and would mask the per-entry outcome.)
  it("throws on an invalid status category in strict mode (the write gate)", () => {
    const yaml = `
key:
  prefix: T-
statuses:
  - key: open
    label: Open
    category: invalid_cat
    default: true
priorities: []
task_types: []
relationships: []
custom_fields: []
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
    expect(() => parseWorkflowConfig(yaml)).toThrow(
      `category must be one of: "pending", "active", "completed", "discarded"`,
    );
  });

  it("degrades an invalid status category to a broken entry in tolerant mode", () => {
    const yaml = `
key:
  prefix: T-
statuses:
  - key: real
    label: Real
    category: pending
    default: true
  - key: open
    label: Open
    category: invalid_cat
priorities: []
task_types: []
relationships: []
custom_fields: []
`;
    const config = parseWorkflowConfig(yaml, { tolerant: true });
    expect(config.statuses.map(s => s.key)).toEqual(["real"]);
    expect(config.broken?.statuses?.[0]?.id).toBe("open");
    expect(config.broken?.statuses?.[0]?.error).toContain(
      `category must be one of: "pending", "active", "completed", "discarded"`,
    );
  });

  // O6: an invalid custom-field type is a per-ENTRY fault: strict throws,
  // tolerant degrades.
  it("throws on an invalid custom field type in strict mode", () => {
    const yaml = `
key:
  prefix: T-
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields:
  - key: foo
    label: Foo
    type: invalid_type
    multi: false
    searchable: true
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
    expect(() => parseWorkflowConfig(yaml)).toThrow(
      `type must be one of: "string", "number", "date", "boolean", "enum"`,
    );
  });

  it("degrades an invalid custom field type to a broken entry in tolerant mode", () => {
    const yaml = `
key:
  prefix: T-
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields:
  - key: foo
    label: Foo
    type: invalid_type
    multi: false
    searchable: true
`;
    const config = parseWorkflowConfig(yaml, { tolerant: true });
    expect(config.custom_fields).toHaveLength(0);
    expect(config.broken?.custom_fields?.[0]?.id).toBe("foo");
    expect(config.broken?.custom_fields?.[0]?.error).toContain(
      `type must be one of: "string", "number", "date", "boolean", "enum"`,
    );
  });

  it("throws on non-object root", () => {
    expect(() => parseWorkflowConfig("just a string")).toThrow(WorkflowConfigError);
  });

  it("throws on missing statuses array", () => {
    expect(() => parseWorkflowConfig(`key:\n  prefix: T-\npriorities: []\ntask_types: []\nrelationships: []`))
      .toThrow("statuses is required (expected array)");
  });

  it("parses estimation config (numeric)", () => {
    const yaml = `
key:
  prefix: T-
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields: []
estimation:
  enabled: true
  unit: points
  scale: fibonacci
  preset_values: [1, 2, 3, 5, 8, 13]
`;
    const cfg = parseWorkflowConfig(yaml);
    expect(cfg.estimation).toEqual({
      enabled: true,
      unit: "points",
      scale: "fibonacci",
      preset_values: [1, 2, 3, 5, 8, 13],
    });
  });

  it("parses estimation config (custom_enum requires preset_values)", () => {
    const yaml = `
key:
  prefix: T-
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields: []
estimation:
  enabled: true
  unit: custom_enum
  unit_label: t-shirt
  preset_values: [XS, S, M, L, XL]
`;
    const cfg = parseWorkflowConfig(yaml);
    expect(cfg.estimation?.unit).toBe("custom_enum");
    expect(cfg.estimation?.preset_values).toEqual(["XS", "S", "M", "L", "XL"]);
  });

  it("rejects custom_enum without preset_values", () => {
    const yaml = `
key:
  prefix: T-
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields: []
estimation:
  enabled: true
  unit: custom_enum
  unit_label: t-shirt
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(/preset_values is required/);
  });

  it("rejects custom_numeric without unit_label", () => {
    const yaml = `
key:
  prefix: T-
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields: []
estimation:
  enabled: true
  unit: custom_numeric
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(/unit_label is required/);
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseWorkflowConfig("{ statuses: [")).toThrow(YamlSyntaxError);
    expect(() => parseWorkflowConfig("{ statuses: [")).toThrow(/workflow\.yaml/);
  });
});

describe("parseWorkflowConfig — per-entry corruption tolerance (O6)", () => {
  it("degrades one corrupt status to broken and keeps the good statuses resolvable", () => {
    // The middle status has an invalid category. Before O6 this blanked
    // the WHOLE workflow (every task lost status resolution); now the good
    // statuses load and the bad one is set aside.
    const yaml = `
key:
  prefix: T-
statuses:
  - key: not_started
    label: Not started
    category: pending
    default: true
  - key: rotten
    label: Rotten
    category: not_a_category
  - key: done
    label: Done
    category: completed
priorities: []
task_types: []
relationships: []
custom_fields: []
`;
    const config = parseWorkflowConfig(yaml, { tolerant: true });
    // Good statuses survive — resolution for tasks on them is intact.
    expect(config.statuses.map(s => s.key)).toEqual(["not_started", "done"]);
    // The corrupt one is surfaced, named by its key, under its sub-list.
    expect(config.broken?.statuses).toHaveLength(1);
    expect(config.broken?.statuses?.[0]?.id).toBe("rotten");
    expect(config.broken?.statuses?.[0]?.index).toBe(1);
    expect(config.broken?.statuses?.[0]?.error).toMatch(/category/);
  });

  it("preserves the corrupt entry's raw text rather than dropping it", () => {
    const yaml = `
key:
  prefix: T-
statuses:
  - key: open
    label: Open
    category: pending
    default: true
priorities:
  - key: weird
    label: Weird
    value: not_a_number
task_types: []
relationships: []
custom_fields: []
`;
    const config = parseWorkflowConfig(yaml, { tolerant: true });
    expect(config.priorities).toHaveLength(0);
    expect(config.broken?.priorities?.[0]?.rawText).toContain("weird");
  });

  it("groups corruption by sub-list, keeping per-list indices", () => {
    const yaml = `
key:
  prefix: T-
statuses:
  - key: open
    label: Open
    category: pending
    default: true
priorities: []
task_types:
  - key: bug
    label: Bug
  - 42
relationships:
  - key: blocks
    label: Blocks
custom_fields: []
`;
    const config = parseWorkflowConfig(yaml, { tolerant: true });
    // task_types: the scalar 42 at index 1 degrades; the good one stays.
    expect(config.task_types.map(t => t.key)).toEqual(["bug"]);
    expect(config.broken?.task_types?.[0]?.index).toBe(1);
    // relationships: `blocks` is missing its required inverse/inverse_label
    // (a per-entry superRefine failure) — degrades rather than throwing.
    expect(config.relationships).toHaveLength(0);
    expect(config.broken?.relationships?.[0]?.id).toBe("blocks");
    // Untouched sub-lists never appear in `broken`.
    expect(config.broken?.priorities).toBeUndefined();
    expect(config.broken?.statuses).toBeUndefined();
  });

  it("omits `broken` entirely when every entry parses (both modes)", () => {
    expect(parseWorkflowConfig(CANONICAL_YAML).broken).toBeUndefined();
    expect(parseWorkflowConfig(CANONICAL_YAML, { tolerant: true }).broken).toBeUndefined();
  });

  it("strict mode (default) throws on a per-entry fault — the write gate contract", () => {
    // A corrupt priority the tolerant read would degrade. Strict mode must
    // still throw so `assertWorkflowConfigValid` (which round-trips a
    // caller's config through the default mode) rejects a bad WRITE before
    // it lands on disk. Regressing this to a degrade let empty-enum and
    // bad-category edits persist silently.
    const yaml = `
key:
  prefix: T-
statuses:
  - key: open
    label: Open
    category: pending
    default: true
priorities:
  - key: weird
    label: Weird
    value: not_a_number
task_types: []
relationships: []
custom_fields: []
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
    expect(() => parseWorkflowConfig(yaml)).toThrow(/priorities\[0\].*weird/);
    // Same input, tolerant mode: degrades instead of throwing.
    expect(parseWorkflowConfig(yaml, { tolerant: true }).broken?.priorities).toHaveLength(1);
  });

  it("does not blank the workflow when the ONLY default status is corrupt", () => {
    // The single status carrying `default: true` is otherwise malformed
    // (bad category). Degrading it leaves zero valid defaults, but the
    // default-count check is skipped whenever a status degraded — the
    // workflow must still load rather than throw over a lone bad entry.
    const yaml = `
key:
  prefix: T-
statuses:
  - key: broken_default
    label: Broken default
    category: bogus
    default: true
  - key: done
    label: Done
    category: completed
priorities: []
task_types: []
relationships: []
custom_fields: []
`;
    const config = parseWorkflowConfig(yaml, { tolerant: true });
    expect(config.statuses.map(s => s.key)).toEqual(["done"]);
    expect(config.broken?.statuses).toHaveLength(1);
  });

  it("still throws when statuses are ALL valid but have zero defaults", () => {
    // No corruption present, so the exactly-one-default invariant fires
    // exactly as before — this is a real config error, not degradable.
    const yaml = `
key:
  prefix: T-
statuses:
  - key: open
    label: Open
    category: pending
priorities: []
task_types: []
relationships: []
custom_fields: []
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
    expect(() => parseWorkflowConfig(yaml)).toThrow(/exactly one status with 'default: true'/);
  });

  it("still throws when statuses are ALL valid but have two defaults", () => {
    const yaml = `
key:
  prefix: T-
statuses:
  - key: a
    label: A
    category: pending
    default: true
  - key: b
    label: B
    category: active
    default: true
priorities: []
task_types: []
relationships: []
custom_fields: []
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(/exactly one status with 'default: true', but 2/);
  });

  it("keeps a non-array sub-list object-fatal (no collection to degrade)", () => {
    const yaml = `
key:
  prefix: T-
statuses: not_a_list
priorities: []
task_types: []
relationships: []
custom_fields: []
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
  });

  it("keeps a malformed scalar `estimation` object-fatal (single record, not a list)", () => {
    const yaml = `
key:
  prefix: T-
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields: []
estimation:
  enabled: true
  unit: not_a_unit
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
  });

  it("keeps an unknown top-level key object-fatal", () => {
    const yaml = `
key:
  prefix: T-
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields: []
surprise: true
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
  });

  it("keeps a malformed `key` object-fatal (identity-bearing)", () => {
    const yaml = `
key: not_a_record
statuses: []
priorities: []
task_types: []
relationships: []
custom_fields: []
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow(WorkflowConfigError);
  });
});
