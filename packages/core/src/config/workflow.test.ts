import { describe, expect,it } from "vitest";

import { parseWorkflowConfig, WorkflowConfigError } from "./workflow.js";

const CANONICAL_YAML = `
key:
  prefix: T-

statuses:
  - key: not_started
    label: Not started
    category: pending
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
    structural: true
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
  - key: relates_to
    label: Relates to
    inverse: relates_to
    inverse_label: Relates to

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
    expect(config.statuses[0]).toEqual({ key: "not_started", label: "Not started", category: "pending" });
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
      structural: true,
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

  it("allows omitting custom_fields", () => {
    const yaml = `
key:
  prefix: X-
statuses:
  - key: open
    label: Open
    category: pending
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
    const config = parseWorkflowConfig(yaml);
    expect(config.custom_fields).toEqual([]);
  });

  it("allows priorities without numeric value", () => {
    const yaml = `
key:
  prefix: T-
statuses:
  - key: open
    label: Open
    category: pending
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
    const config = parseWorkflowConfig(yaml);
    expect(config.priorities[0]?.value).toBeUndefined();
  });

  it("throws on missing key.prefix", () => {
    expect(() => parseWorkflowConfig(`key: {}\nstatuses: []\npriorities: []\ntask_types: []\nrelationships: []`))
      .toThrow(WorkflowConfigError);
  });

  it("throws on invalid status category", () => {
    const yaml = `
key:
  prefix: T-
statuses:
  - key: open
    label: Open
    category: invalid_cat
priorities: []
task_types: []
relationships: []
`;
    expect(() => parseWorkflowConfig(yaml)).toThrow("must be one of");
  });

  it("throws on invalid custom field type", () => {
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
    expect(() => parseWorkflowConfig(yaml)).toThrow("must be one of");
  });

  it("throws on non-object root", () => {
    expect(() => parseWorkflowConfig("just a string")).toThrow(WorkflowConfigError);
  });

  it("throws on missing statuses array", () => {
    expect(() => parseWorkflowConfig(`key:\n  prefix: T-\npriorities: []\ntask_types: []\nrelationships: []`))
      .toThrow("statuses must be an array");
  });
});
