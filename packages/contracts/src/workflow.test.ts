import { describe, expect, it } from "vitest";

import {
  BoardsConfigSchema,
  CustomFieldDefSchema,
  defaultStatus,
  EstimationConfigSchema,
  IconStringSchema,
  PriorityDefSchema,
  RelationshipDefSchema,
  StatusDefSchema,
  TaskTypeDefSchema,
  TimelineConfigSchema,
  WorkflowConfigSchema,
} from "./workflow.js";

describe("IconString", () => {
  it("accepts a Lucide-style identifier", () => {
    expect(IconStringSchema.parse("circle-check")).toBe("circle-check");
  });

  it("accepts an emoji", () => {
    expect(IconStringSchema.parse("🚀")).toBe("🚀");
  });

  it("rejects an empty string", () => {
    expect(() => IconStringSchema.parse("")).toThrow();
  });

  it("rejects whitespace-only strings", () => {
    expect(() => IconStringSchema.parse(" ")).toThrow();
    expect(() => IconStringSchema.parse("   ")).toThrow();
    expect(() => IconStringSchema.parse("\t")).toThrow();
  });
});

describe("StatusDef icon + color", () => {
  it("accepts both icon and color", () => {
    const parsed = StatusDefSchema.parse({
      key: "doing",
      label: "Doing",
      category: "active",
      icon: "loader",
      color: "#1e6fcb",
    });
    expect(parsed.icon).toBe("loader");
    expect(parsed.color).toBe("#1e6fcb");
  });

  it("treats icon and color as optional", () => {
    const parsed = StatusDefSchema.parse({
      key: "doing",
      label: "Doing",
      category: "active",
    });
    expect(parsed.icon).toBeUndefined();
    expect(parsed.color).toBeUndefined();
  });

  it("rejects a non-hex color", () => {
    expect(() =>
      StatusDefSchema.parse({
        key: "doing",
        label: "Doing",
        category: "active",
        color: "blueish",
      }),
    ).toThrow();
  });

  it("rejects unknown keys (strict mode)", () => {
    expect(() =>
      StatusDefSchema.parse({
        key: "doing",
        label: "Doing",
        category: "active",
        unknown: 1,
      }),
    ).toThrow();
  });
});

describe("PriorityDef / TaskTypeDef / RelationshipDef icon + color", () => {
  it("PriorityDef accepts icon + color", () => {
    const parsed = PriorityDefSchema.parse({
      key: "high",
      label: "High",
      icon: "🔥",
      color: "#cc0000",
    });
    expect(parsed.icon).toBe("🔥");
    expect(parsed.color).toBe("#cc0000");
  });

  it("TaskTypeDef accepts icon + color", () => {
    const parsed = TaskTypeDefSchema.parse({
      key: "bug",
      label: "Bug",
      icon: "bug",
      color: "#ff0000",
    });
    expect(parsed.icon).toBe("bug");
    expect(parsed.color).toBe("#ff0000");
  });

  it("RelationshipDef accepts icon + color", () => {
    const parsed = RelationshipDefSchema.parse({
      key: "blocks",
      label: "Blocks",
      inverse: "is_blocked_by",
      inverse_label: "Is Blocked By",
      icon: "shield",
      color: "#ffa500",
    });
    expect(parsed.icon).toBe("shield");
    expect(parsed.color).toBe("#ffa500");
  });
});

describe("EstimationConfig weights", () => {
  it("accepts a weights map for custom_enum", () => {
    const parsed = EstimationConfigSchema.parse({
      enabled: true,
      unit: "custom_enum",
      unit_label: "size",
      preset_values: ["XS", "S", "M", "L", "XL"],
      weights: { XS: 1, S: 2, M: 3, L: 5, XL: 8 },
    });
    expect(parsed.weights).toEqual({ XS: 1, S: 2, M: 3, L: 5, XL: 8 });
  });

  it("treats weights as optional", () => {
    const parsed = EstimationConfigSchema.parse({
      enabled: true,
      unit: "custom_enum",
      unit_label: "size",
      preset_values: ["S", "M", "L"],
    });
    expect(parsed.weights).toBeUndefined();
  });

  it("rejects weights for non-enum units", () => {
    expect(() =>
      EstimationConfigSchema.parse({
        enabled: true,
        unit: "points",
        weights: { foo: 1 },
      }),
    ).toThrow(/weights is only valid when unit is custom_enum/);
  });

  it("rejects a weights key not in preset_values", () => {
    expect(() =>
      EstimationConfigSchema.parse({
        enabled: true,
        unit: "custom_enum",
        unit_label: "size",
        preset_values: ["S", "M", "L"],
        weights: { S: 1, XXL: 13 },
      }),
    ).toThrow(/weights key 'XXL' is not in preset_values/);
  });

  it("rejects a negative weight", () => {
    expect(() =>
      EstimationConfigSchema.parse({
        enabled: true,
        unit: "custom_enum",
        unit_label: "size",
        preset_values: ["S"],
        weights: { S: -1 },
      }),
    ).toThrow();
  });

  it("rejects a non-finite weight", () => {
    expect(() =>
      EstimationConfigSchema.parse({
        enabled: true,
        unit: "custom_enum",
        unit_label: "size",
        preset_values: ["S"],
        weights: { S: Number.POSITIVE_INFINITY },
      }),
    ).toThrow();
  });

  it("matches numeric preset_values to weights via string coercion", () => {
    // preset_values may store numbers (e.g. fibonacci scale); weights
    // keys are always strings. The cross-validation compares them as
    // strings — "5" matches preset_values entry 5.
    const parsed = EstimationConfigSchema.parse({
      enabled: true,
      unit: "custom_enum",
      unit_label: "points",
      preset_values: [1, 2, 5, 8],
      weights: { "1": 1, "5": 5 },
    });
    expect(parsed.weights).toEqual({ "1": 1, "5": 5 });
  });

  it("matches string preset_values to numeric-literal weight keys", () => {
    // Object literal `{ 1: 1 }` produces a string key at the JS layer
    // before zod sees it. preset_values stored as string "1" still
    // matches the resulting key.
    const parsed = EstimationConfigSchema.parse({
      enabled: true,
      unit: "custom_enum",
      unit_label: "size",
      preset_values: ["1"],
      weights: { 1: 1 },
    });
    expect(parsed.weights).toEqual({ "1": 1 });
  });

  it("rejects an empty weights map", () => {
    // Empty weights would silently produce a flat burndown. Force the
    // user to either declare entries or omit the field.
    expect(() =>
      EstimationConfigSchema.parse({
        enabled: true,
        unit: "custom_enum",
        unit_label: "size",
        preset_values: ["S"],
        weights: {},
      }),
    ).toThrow(/at least one entry/);
  });

  it("does not pile per-key errors when preset_values is missing", () => {
    // custom_enum with no preset_values fires one "preset_values is
    // required" issue. We must NOT also emit "key not in preset_values"
    // for every weight entry — that buries the real error.
    let err: unknown;
    try {
      EstimationConfigSchema.parse({
        enabled: true,
        unit: "custom_enum",
        unit_label: "size",
        weights: { S: 1, M: 2, L: 3 },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    const message = (err as Error).message;
    expect(message).toMatch(/preset_values is required/);
    expect(message).not.toMatch(/key 'S' is not in preset_values/);
    expect(message).not.toMatch(/key 'M' is not in preset_values/);
    expect(message).not.toMatch(/key 'L' is not in preset_values/);
  });
});

describe("CustomFieldDef enum values", () => {
  /**
   * `schema-reference.md:365` says `values` is "Required for
   * `type: enum`". Nothing enforced it: the schema marked it optional,
   * and core's task-validation branch is guarded
   * `if (def.type === "enum" && def.values)` — so with `values` absent
   * the condition is false, no other branch matches, and the value falls
   * through completely unvalidated.
   *
   * A field declared as a closed enum accepted arbitrary strings,
   * numbers and objects at every surface.
   */

  const base = { key: "size", label: "Size", multi: false, searchable: false };

  it("rejects an enum field with no values", () => {
    const r = CustomFieldDefSchema.safeParse({ ...base, type: "enum" });
    expect(r.success).toBe(false);
  });

  it("rejects an enum field with an empty values list", () => {
    // An empty list is the same hole with extra steps: nothing can match
    // it, so either the field is unusable or it is not really an enum.
    const r = CustomFieldDefSchema.safeParse({ ...base, type: "enum", values: [] });
    expect(r.success).toBe(false);
  });

  it("names the field in the error, so a bad workflow.yaml is fixable", () => {
    const r = CustomFieldDefSchema.safeParse({ ...base, type: "enum" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toContain("values");
    }
  });

  it("accepts an enum field that declares its values", () => {
    const r = CustomFieldDefSchema.safeParse({
      ...base,
      type: "enum",
      values: [{ key: "s", label: "Small" }],
    });
    expect(r.success).toBe(true);
  });

  it("leaves non-enum fields free to omit values", () => {
    // The requirement is conditional; a string field has no values and
    // must stay valid.
    for (const type of ["string", "number", "date", "boolean"]) {
      expect(CustomFieldDefSchema.safeParse({ ...base, type }).success).toBe(true);
    }
  });
});

describe("BoardsConfig", () => {
  it("accepts a column with a single status and no WIP", () => {
    const parsed = BoardsConfigSchema.parse({
      columns: [{ key: "todo", label: "To Do", statuses: ["backlog"] }],
    });
    expect(parsed.columns[0]?.wip).toBeUndefined();
  });

  it("accepts a column grouping multiple statuses with a WIP limit", () => {
    const parsed = BoardsConfigSchema.parse({
      columns: [
        {
          key: "doing",
          label: "In Progress",
          statuses: ["doing", "in_review"],
          wip: 3,
        },
      ],
    });
    expect(parsed.columns[0]?.wip).toBe(3);
    expect(parsed.columns[0]?.statuses).toEqual(["doing", "in_review"]);
  });

  it("rejects an empty columns array", () => {
    expect(() => BoardsConfigSchema.parse({ columns: [] })).toThrow();
  });

  it("rejects a column with no statuses", () => {
    expect(() =>
      BoardsConfigSchema.parse({
        columns: [{ key: "x", label: "x", statuses: [] }],
      }),
    ).toThrow();
  });

  it("rejects wip <= 0", () => {
    expect(() =>
      BoardsConfigSchema.parse({
        columns: [{ key: "x", label: "x", statuses: ["a"], wip: 0 }],
      }),
    ).toThrow();
  });

  it("rejects non-integer wip", () => {
    expect(() =>
      BoardsConfigSchema.parse({
        columns: [{ key: "x", label: "x", statuses: ["a"], wip: 1.5 }],
      }),
    ).toThrow();
  });

  it("rejects duplicate column keys", () => {
    expect(() =>
      BoardsConfigSchema.parse({
        columns: [
          { key: "doing", label: "A", statuses: ["a"] },
          { key: "doing", label: "B", statuses: ["b"] },
        ],
      }),
    ).toThrow(/duplicate column key 'doing'/);
  });

  it("rejects a status appearing in two columns", () => {
    expect(() =>
      BoardsConfigSchema.parse({
        columns: [
          { key: "doing", label: "Doing", statuses: ["doing", "in_review"] },
          { key: "qa", label: "QA", statuses: ["in_review"] },
        ],
      }),
    ).toThrow(/'in_review' already appears in column index 0/);
  });

  it("rejects a duplicate status inside the same column", () => {
    expect(() =>
      BoardsConfigSchema.parse({
        columns: [{ key: "x", label: "x", statuses: ["a", "a"] }],
      }),
    ).toThrow(/'a' already appears/);
  });
});

describe("TimelineConfig", () => {
  it("accepts a relationship key", () => {
    const parsed = TimelineConfigSchema.parse({ dependency_relationship: "blocks" });
    expect(parsed.dependency_relationship).toBe("blocks");
  });

  it("accepts null (no arrows)", () => {
    const parsed = TimelineConfigSchema.parse({ dependency_relationship: null });
    expect(parsed.dependency_relationship).toBeNull();
  });

  it("accepts an empty object (field omitted; absent ≠ null)", () => {
    const parsed = TimelineConfigSchema.parse({});
    expect(parsed.dependency_relationship).toBeUndefined();
  });

  it("preserves the absent-vs-null distinction", () => {
    const absent = TimelineConfigSchema.parse({});
    const explicitNull = TimelineConfigSchema.parse({ dependency_relationship: null });
    expect(absent.dependency_relationship).toBeUndefined();
    expect(explicitNull.dependency_relationship).toBeNull();
  });

  it("rejects empty string", () => {
    expect(() =>
      TimelineConfigSchema.parse({ dependency_relationship: "" }),
    ).toThrow();
  });
});

describe("WorkflowConfig integration", () => {
  describe("default status (0b)", () => {
    function cfg(statuses: unknown[]) {
      return {
        key: { prefix: "T-" },
        statuses,
        priorities: [],
        task_types: [],
        relationships: [],
        custom_fields: [],
      };
    }

    it("accepts exactly one default", () => {
      const parsed = WorkflowConfigSchema.parse(cfg([
        { key: "a", label: "A", category: "pending", default: true },
        { key: "b", label: "B", category: "active" },
      ]));
      expect(parsed.statuses[0]?.default).toBe(true);
    });

    it("rejects no default", () => {
      // The rule cannot live on StatusDefSchema: a single def cannot
      // see its siblings.
      expect(() => WorkflowConfigSchema.parse(cfg([
        { key: "a", label: "A", category: "pending" },
        { key: "b", label: "B", category: "active" },
      ]))).toThrow(/none does/);
    });

    it("rejects two defaults, naming them", () => {
      expect(() => WorkflowConfigSchema.parse(cfg([
        { key: "a", label: "A", category: "pending", default: true },
        { key: "b", label: "B", category: "active", default: true },
      ]))).toThrow(/but 2 do: a, b/);
    });

    it("allows an empty status list", () => {
      // Nothing to default to. A config with no statuses is degenerate
      // but not this rule's business.
      expect(() => WorkflowConfigSchema.parse(cfg([]))).not.toThrow();
    });

    it("defaultStatus() returns the marked status regardless of position", () => {
      const parsed = WorkflowConfigSchema.parse(cfg([
        { key: "a", label: "A", category: "pending" },
        { key: "b", label: "B", category: "active", default: true },
      ]));
      expect(defaultStatus(parsed)?.key).toBe("b");
    });
  });

  it("accepts boards + timeline + estimation weights together", () => {
    const parsed = WorkflowConfigSchema.parse({
      key: { prefix: "T-" },
      statuses: [{ key: "doing", label: "Doing", category: "active", default: true }],
      priorities: [{ key: "high", label: "High" }],
      task_types: [{ key: "bug", label: "Bug" }],
      relationships: [
        {
          key: "blocks",
          label: "Blocks",
          inverse: "is_blocked_by",
          inverse_label: "Is Blocked By",
        },
      ],
      custom_fields: [],
      estimation: {
        enabled: true,
        unit: "custom_enum",
        unit_label: "size",
        preset_values: ["S", "M", "L"],
        weights: { S: 1, M: 3, L: 5 },
      },
      boards: {
        columns: [
          { key: "todo", label: "To Do", statuses: ["backlog"] },
          { key: "doing", label: "Doing", statuses: ["doing"], wip: 3 },
        ],
      },
      timeline: { dependency_relationship: "blocks" },
    });
    expect(parsed.boards?.columns).toHaveLength(2);
    expect(parsed.timeline?.dependency_relationship).toBe("blocks");
    expect(parsed.estimation?.weights?.M).toBe(3);
  });
});
