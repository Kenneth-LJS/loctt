import { describe, it, expect } from "vitest";
import { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./validation.js";
import type { WorkflowConfig, TaskFrontmatter } from "@loctt/contracts";

const config: WorkflowConfig = {
  key: { prefix: "T-" },
  statuses: [
    { key: "not_started", label: "Not started", category: "pending" },
    { key: "done", label: "Done", category: "completed" },
  ],
  priorities: [
    { key: "low", label: "Low", value: 1 },
    { key: "high", label: "High", value: 3 },
  ],
  task_types: [{ key: "task", label: "Task" }],
  relationships: [
    { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", structural: true },
    { key: "blocks", label: "Blocks", inverse: "is_blocked_by", inverse_label: "Is blocked by" },
  ],
  custom_fields: [
    {
      key: "sprint",
      label: "Sprint",
      type: "enum",
      multi: false,
      searchable: true,
      values: [
        { key: "sprint_1", label: "Sprint 1", value: 1 },
        { key: "sprint_2", label: "Sprint 2", value: 2 },
      ],
    },
    { key: "notes", label: "Notes", type: "string", multi: false, searchable: true },
  ],
};

const validFm: TaskFrontmatter = {
  id: "abc",
  key: "T-1",
  title: "Test",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  status: "not_started",
  priority: "high",
  task_type: "task",
  relationships: [{ type: "parent", target: "xyz" }],
  fields: { sprint: "sprint_1" },
};

describe("validateTaskAgainstWorkflow", () => {
  it("returns no errors for a valid task", () => {
    const errors = validateTaskAgainstWorkflow(validFm, config);
    expect(errors).toEqual([]);
  });

  it("returns no errors when optional fields are omitted", () => {
    const minimal: TaskFrontmatter = {
      id: "abc",
      key: "T-1",
      title: "Minimal",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    expect(validateTaskAgainstWorkflow(minimal, config)).toEqual([]);
  });

  it("reports invalid status", () => {
    const errors = validateTaskAgainstWorkflow({ ...validFm, status: "bogus" }, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("status");
  });

  it("reports invalid priority", () => {
    const errors = validateTaskAgainstWorkflow({ ...validFm, priority: "critical" }, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("priority");
  });

  it("reports invalid task_type", () => {
    const errors = validateTaskAgainstWorkflow({ ...validFm, task_type: "epic" }, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("task_type");
  });

  it("reports invalid relationship type", () => {
    const fm = { ...validFm, relationships: [{ type: "depends_on", target: "xyz" }] };
    const errors = validateTaskAgainstWorkflow(fm, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("relationships[0].type");
  });

  it("accepts inverse relationship types", () => {
    const fm = { ...validFm, relationships: [{ type: "child", target: "xyz" }] };
    const errors = validateTaskAgainstWorkflow(fm, config);
    expect(errors).toEqual([]);
  });

  it("reports undeclared custom field", () => {
    const fm = { ...validFm, fields: { unknown_field: "value" } };
    const errors = validateTaskAgainstWorkflow(fm, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("fields.unknown_field");
  });

  it("reports invalid enum value for custom field", () => {
    const fm = { ...validFm, fields: { sprint: "sprint_99" } };
    const errors = validateTaskAgainstWorkflow(fm, config);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.field).toBe("fields.sprint");
  });

  it("collects multiple errors", () => {
    const fm = { ...validFm, status: "bogus", priority: "bogus" };
    const errors = validateTaskAgainstWorkflow(fm, config);
    expect(errors).toHaveLength(2);
  });
});

describe("validateWorkflowConfig", () => {
  it("returns no errors for a valid config", () => {
    expect(validateWorkflowConfig(config)).toEqual([]);
  });

  it("reports duplicate status keys", () => {
    const bad: WorkflowConfig = {
      ...config,
      statuses: [
        { key: "open", label: "Open", category: "pending" },
        { key: "open", label: "Open2", category: "active" },
      ],
    };
    const errors = validateWorkflowConfig(bad);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("duplicate status key");
  });

  it("reports duplicate custom field keys", () => {
    const bad: WorkflowConfig = {
      ...config,
      custom_fields: [
        { key: "x", label: "X", type: "string", multi: false, searchable: true },
        { key: "x", label: "X2", type: "number", multi: false, searchable: true },
      ],
    };
    const errors = validateWorkflowConfig(bad);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("duplicate custom field key");
  });
});
