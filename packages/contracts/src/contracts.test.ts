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
  projectTaskFrontmatter,
  RekeyPlanSchema,
  TaskFrontmatterPublicSchema,
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

  it("RekeyPlan validates a loser with keeper, timestamps, tiebreak and new key (GIT-8)", () => {
    // @verifies GIT-8
    const plan = RekeyPlanSchema.parse({
      losers: [{
        key: "T-1",
        loserId: "01BBB",
        loserCreatedAt: "2026-01-02T00:00:00.000Z",
        keeperId: "01AAA",
        keeperCreatedAt: "2026-01-01T00:00:00.000Z",
        tiebreak: "created_at",
        newKey: "T-5",
      }],
      skipped: [],
    });
    expect(plan.losers[0]?.tiebreak).toBe("created_at");
    expect(plan.losers[0]?.newKey).toBe("T-5");
    // A degraded/absent created_at is null, not omitted.
    expect(RekeyPlanSchema.parse({
      losers: [{
        key: "T-1", loserId: "b", loserCreatedAt: null,
        keeperId: "a", keeperCreatedAt: null, tiebreak: "ulid",
      }],
      skipped: [],
    }).losers[0]?.loserCreatedAt).toBeNull();
    // An unknown tiebreak is rejected — the UI copy branches on it (GIT-9).
    expect(() => RekeyPlanSchema.parse({
      losers: [{ key: "T-1", loserId: "b", loserCreatedAt: null, keeperId: "a", keeperCreatedAt: null, tiebreak: "coinflip" }],
      skipped: [],
    })).toThrow();
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

  it("projectTaskFrontmatter drops unknown top-level keys for API responses", () => {
    // Disk-level parsing preserves unknown keys (passthrough); the
    // public projection used for API responses strips them so the
    // response shape stays a stable contract.
    const onDisk = TaskFrontmatterSchema.parse({
      ...minimal,
      status: "in_progress",
      x_custom: "preserved-on-disk",
      x_legacy_marker: { whatever: 1 },
    });
    const apiShape = projectTaskFrontmatter(onDisk);
    expect((apiShape as Record<string, unknown>)["x_custom"]).toBeUndefined();
    expect((apiShape as Record<string, unknown>)["x_legacy_marker"]).toBeUndefined();
    // Known fields survive.
    expect(apiShape.status).toBe("in_progress");
    expect(apiShape.id).toBe(minimal.id);
    expect(apiShape.key).toBe(minimal.key);
  });

  it("projectTaskFrontmatter carries every field the public schema declares", () => {
    // The projection used to hold a hand-written key list beside the
    // schema. A field added to the schema and forgotten there was
    // dropped from the CLI's JSON, the MCP tools' output and the web
    // API at once, silently. This asserts the two agree, so adding a
    // public field cannot half-land.
    //
    // Asserting a fixed count would be weaker: it passes when one
    // field is added and another removed, and it says nothing about
    // WHICH field went missing.
    const declared = Object.keys(TaskFrontmatterPublicSchema.shape);
    const populated: Record<string, unknown> = {
      ...minimal,
      status: "in_progress",
      project: "proj", status_updated_at: minimal.created_at,
      task_type: "task", priority: "high", labels: ["l1"],
      assignee: "u1", reporter: "u2",
      start_date: "2026-01-01", due_date: "2026-01-02",
      estimate: 3, completed_date: "2026-01-03",
      milestone: "m1", sprint: "s1",
      archived: true, archived_at: minimal.created_at,
      relationships: [], key_history: [], fields: { a: 1 },
      board_rank: "n",
    };
    const apiShape = projectTaskFrontmatter(
      TaskFrontmatterSchema.parse(populated),
    ) as Record<string, unknown>;
    const missing = declared.filter(k => apiShape[k] === undefined);
    expect(missing).toEqual([]);
  });

  it("projectTaskFrontmatter preserves the custom fields map", () => {
    const onDisk = TaskFrontmatterSchema.parse({
      ...minimal,
      fields: { story_points: 5, flagged: true },
    });
    const apiShape = projectTaskFrontmatter(onDisk);
    expect(apiShape.fields).toEqual({ story_points: 5, flagged: true });
  });
});
