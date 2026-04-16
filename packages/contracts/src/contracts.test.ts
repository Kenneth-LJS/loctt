import { describe, it, expectTypeOf } from "vitest";
import type {
  WorkflowConfig,
  Task,
  QueriesConfig,
  LocttState,
  SyncState,
  ReconcileState,
  StatusCategory,
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
