import type { TaskFrontmatter,WorkflowConfig } from "@loctt/contracts";
import { describe, expect,it } from "vitest";

import { validateTaskAgainstWorkflow, validateWorkflowConfig } from "./validation.js";

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
    { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", graph: "tree" },
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

  describe("strict non-enum custom field types", () => {
    // Phase 5: validator rejects values whose runtime type doesn't
    // match the declared custom_field type. Previously only `enum`
    // membership was checked; primitives were silently accepted.

    const typedConfig: WorkflowConfig = {
      ...config,
      custom_fields: [
        ...config.custom_fields,
        { key: "score", label: "Score", type: "number", multi: false, searchable: false },
        { key: "is_blocked", label: "Blocked?", type: "boolean", multi: false, searchable: false },
        { key: "due", label: "Due", type: "date", multi: false, searchable: false },
        { key: "tags", label: "Tags", type: "string", multi: true, searchable: false },
        { key: "scores", label: "Scores", type: "number", multi: true, searchable: false },
      ],
    };

    it("accepts a string value for a string field", () => {
      const fm = { ...validFm, fields: { notes: "hello" } };
      expect(validateTaskAgainstWorkflow(fm, typedConfig)).toEqual([]);
    });

    it("rejects a number value for a string field", () => {
      const fm = { ...validFm, fields: { notes: 42 } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("fields.notes");
      expect(errors[0]?.message).toMatch(/expected string/);
    });

    it("accepts a finite number for a number field", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", score: 3.14 } };
      expect(validateTaskAgainstWorkflow(fm, typedConfig)).toEqual([]);
    });

    it("rejects a string value for a number field", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", score: "abc" } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("fields.score");
      expect(errors[0]?.message).toMatch(/expected finite number/);
    });

    it("rejects NaN and Infinity for a number field (non-finite)", () => {
      for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
        const fm = { ...validFm, fields: { sprint: "sprint_1", score: bad } };
        const errors = validateTaskAgainstWorkflow(fm, typedConfig);
        expect(errors).toHaveLength(1);
        expect(errors[0]?.field).toBe("fields.score");
      }
    });

    it("accepts boolean true/false for a boolean field", () => {
      for (const b of [true, false]) {
        const fm = { ...validFm, fields: { sprint: "sprint_1", is_blocked: b } };
        expect(validateTaskAgainstWorkflow(fm, typedConfig)).toEqual([]);
      }
    });

    it("rejects a string for a boolean field (no truthiness coercion)", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", is_blocked: "true" } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toMatch(/expected boolean/);
    });

    it("accepts a YYYY-MM-DD string for a date field", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", due: "2026-05-12" } };
      expect(validateTaskAgainstWorkflow(fm, typedConfig)).toEqual([]);
    });

    it("rejects a non-date string for a date field", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", due: "tomorrow" } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toMatch(/YYYY-MM-DD/);
    });

    it("rejects a full timestamp for a date field (must be date-only)", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", due: "2026-05-12T00:00:00Z" } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors).toHaveLength(1);
    });

    it("accepts an array of strings for a multi:true string field", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", tags: ["a", "b"] } };
      expect(validateTaskAgainstWorkflow(fm, typedConfig)).toEqual([]);
    });

    it("rejects a scalar value for a multi:true string field", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", tags: "single" } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toMatch(/must be an array/);
    });

    it("rejects array with wrong-type elements for a multi:true string field", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", tags: ["a", 2, "c"] } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.field).toBe("fields.tags[1]");
    });

    it("reports the array index for each bad element in a multi field", () => {
      const fm = { ...validFm, fields: { sprint: "sprint_1", scores: [1, "two", 3, null] } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors).toHaveLength(2);
      expect(errors[0]?.field).toBe("fields.scores[1]");
      expect(errors[1]?.field).toBe("fields.scores[3]");
    });

    it("uses 'null' / 'array' in describeType error messages (not 'object')", () => {
      // Verifies the describeType helper surfaces useful labels.
      const fm = { ...validFm, fields: { sprint: "sprint_1", score: null } };
      const errors = validateTaskAgainstWorkflow(fm, typedConfig);
      expect(errors[0]?.message).toMatch(/got null/);
    });
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

describe("cross-referenced workflow config", () => {
  /** The shipped default, which must stay valid under any new rule. */
  async function defaultConfig() {
    const { parseWorkflowConfig } = await import("./workflow.js");
    const { defaultWorkflowYaml } = await import("../init/defaults.js");
    return parseWorkflowConfig(defaultWorkflowYaml("T-"));
  }

  it("accepts the shipped default", async () => {
    // Guards every rule below from over-reaching: if the default trips
    // one, the rule is wrong, not the config.
    expect(validateWorkflowConfig(await defaultConfig())).toEqual([]);
  });

  it("reports a board column naming a status that does not exist", async () => {
    const config = {
      ...(await defaultConfig()),
      boards: { columns: [{ key: "todo", label: "To Do", statuses: ["gone"] }] },
    };
    const errors = validateWorkflowConfig(config as never);
    // Deleting a status left a column no card can reach, rendering
    // permanently empty with nothing saying why.
    expect(errors.map(e => e.message).join(" ")).toMatch(/permanently empty/);
  });

  it("accepts a board column naming a status that does exist", async () => {
    const base = await defaultConfig();
    const first = base.statuses[0]?.key;
    expect(first).toBeDefined();
    const config = {
      ...base,
      boards: { columns: [{ key: "todo", label: "To Do", statuses: [first as string] }] },
    };
    expect(validateWorkflowConfig(config as never)).toEqual([]);
  });

  it("reports an inverse that is itself a declared relationship", async () => {
    const base = await defaultConfig();
    const config = {
      ...base,
      relationships: [
        { key: "blocks", label: "Blocks", inverse: "parent", inverse_label: "Parent" },
        { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child" },
      ],
    };
    const errors = validateWorkflowConfig(config as never);
    // Both definitions would write the same edge, and unlinking cannot
    // tell which one the user meant.
    expect(errors.map(e => e.message).join(" ")).toMatch(/same edge/);
  });
});
