import { describe, expect,expectTypeOf,it } from "vitest";

import type {
  LocttState,
  QueriesConfig,
  ReconcileState,
  StatusCategory,
  SyncState,
  Task,
  WorkflowConfig,
} from "./index.js";
import {
  TaskFrontmatterSchema,
} from "./index.js";

describe("contracts type shapes", () => {
  it("WorkflowConfig has expected top-level keys", () => {
    expectTypeOf<WorkflowConfig>().toHaveProperty("key");
    expectTypeOf<WorkflowConfig>().toHaveProperty("statuses");
    expectTypeOf<WorkflowConfig>().toHaveProperty("priorities");
    expectTypeOf<WorkflowConfig>().toHaveProperty("task_types");
    expectTypeOf<WorkflowConfig>().toHaveProperty("relationships");
    expectTypeOf<WorkflowConfig>().toHaveProperty("custom_fields");
  });

  it("Task has frontmatter and body", () => {
    expectTypeOf<Task>().toHaveProperty("frontmatter");
    expectTypeOf<Task>().toHaveProperty("body");
  });

  it("QueriesConfig has queries array", () => {
    expectTypeOf<QueriesConfig>().toHaveProperty("queries");
  });

  it("LocttState has keys map", () => {
    expectTypeOf<LocttState>().toHaveProperty("keys");
  });

  it("SyncState has git section", () => {
    expectTypeOf<SyncState>().toHaveProperty("git");
  });

  it("ReconcileState has required fields", () => {
    expectTypeOf<ReconcileState>().toHaveProperty("mode");
    expectTypeOf<ReconcileState>().toHaveProperty("base_commit");
    expectTypeOf<ReconcileState>().toHaveProperty("remote_commit");
    expectTypeOf<ReconcileState>().toHaveProperty("started_at");
  });

  it("StatusCategory is a union of four string literals", () => {
    expectTypeOf<"pending">().toMatchTypeOf<StatusCategory>();
    expectTypeOf<"active">().toMatchTypeOf<StatusCategory>();
    expectTypeOf<"completed">().toMatchTypeOf<StatusCategory>();
    expectTypeOf<"discarded">().toMatchTypeOf<StatusCategory>();
    expectTypeOf<"invalid">().not.toMatchTypeOf<StatusCategory>();
  });
});

describe("TaskFrontmatter round-trip", () => {
  // Regression: the schema uses .passthrough() so unknown keys must
  // survive parse rather than be silently dropped. Authors can attach
  // experimental or tool-specific metadata; discarding here would
  // destroy that data on every read-modify-write cycle.

  const minimal = {
    id: "01HZX0000000000000000000",
    key: "T-1",
    title: "demo",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };

  it("preserves unknown top-level keys on parse", () => {
    const parsed = TaskFrontmatterSchema.parse({
      ...minimal,
      x_external_id: "ABC-123",
      x_tool_metadata: { plugin: "foo", version: 2 },
    }) as Record<string, unknown>;
    expect(parsed["x_external_id"]).toBe("ABC-123");
    expect(parsed["x_tool_metadata"]).toEqual({ plugin: "foo", version: 2 });
  });

  it("preserves known and unknown keys together (round-trip)", () => {
    const input = {
      ...minimal,
      status: "in_progress",
      x_custom: "preserved",
    };
    const parsed = TaskFrontmatterSchema.parse(input) as Record<string, unknown>;
    // Known field is normalized to its parsed shape.
    expect(parsed["status"]).toBe("in_progress");
    // Unknown field survives untouched.
    expect(parsed["x_custom"]).toBe("preserved");
  });

  it("accepts arbitrary shapes in the custom `fields` map", () => {
    // Custom field values are user-defined and typed by workflow
    // config at runtime; the contract layer must not reject them.
    const parsed = TaskFrontmatterSchema.parse({
      ...minimal,
      fields: {
        story_points: 5,
        flagged: true,
        tags: ["a", "b"],
        nested: { score: 0.7 },
      },
    });
    expect(parsed.fields?.["story_points"]).toBe(5);
    expect(parsed.fields?.["flagged"]).toBe(true);
    expect(parsed.fields?.["tags"]).toEqual(["a", "b"]);
    expect(parsed.fields?.["nested"]).toEqual({ score: 0.7 });
  });
});
