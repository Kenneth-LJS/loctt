import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ReconcileDecision, Task, TaskConflictField, WorkflowConfig } from "@loctt/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readTask, writeTask } from "../task/io.js";
import { applyReconcile } from "./reconcile-apply.js";

const workflow: WorkflowConfig = {
  key: { prefix: "T" },
  statuses: [
    { key: "todo", label: "To Do", category: "pending", default: true },
    { key: "done", label: "Done", category: "completed" },
  ],
  priorities: [],
  task_types: [],
  relationships: [
    { key: "parent", label: "Parent", inverse: "child", inverse_label: "Child", graph: "tree" },
    { key: "child", label: "Child", inverse: "parent", inverse_label: "Parent", graph: "tree" },
  ],
  custom_fields: [],
} as WorkflowConfig;

function task(id: string, key: string, fm: Partial<Task["frontmatter"]> = {}): Task {
  return {
    frontmatter: {
      id, key, title: `Task ${key}`,
      created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
      ...fm,
    } as Task["frontmatter"],
    body: "",
  };
}

describe("applyReconcile", () => {
  let locttDir: string;
  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-apply-"));
    locttDir = join(tmp, ".loctt");
  });
  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  it("writes the chosen values to disk and reports them (GIT-7)", async () => {
    // @verifies GIT-7
    await writeTask(locttDir, "w3", task("w3", "WEB-3", { title: "local title", status: "todo" }));
    const conflicts: TaskConflictField[] = [
      { taskId: "w3", taskKey: "WEB-3", taskTitle: "Task WEB-3", field: "title", fieldLabel: "Title", kind: "scalar",
        local: { raw: "local title", display: "local title" }, remote: { raw: "remote title", display: "remote title" } },
      { taskId: "w3", taskKey: "WEB-3", taskTitle: "Task WEB-3", field: "status", fieldLabel: "Status", kind: "enum",
        local: { raw: "todo", display: "To Do" }, remote: { raw: "done", display: "Done" },
        options: [{ key: "todo", label: "To Do" }, { key: "done", label: "Done" }] },
    ];
    const decisions: ReconcileDecision[] = [
      { taskId: "w3", field: "title", choice: "local" },
      { taskId: "w3", field: "status", choice: "remote" },
    ];
    const result = await applyReconcile(locttDir, conflicts, decisions, workflow);
    expect(result.complete).toBe(true);
    const after = await readTask(locttDir, "w3");
    // keep-local title, keep-remote status.
    expect(after.frontmatter.title).toBe("local title");
    expect(after.frontmatter.status).toBe("done");
    expect(result.results[0]?.resolved).toEqual(
      expect.arrayContaining([{ field: "Title", value: "local title" }, { field: "Status", value: "Done" }]),
    );
  });

  it("writes a typed third value on choice 'value' (GIT-7)", async () => {
    // @verifies GIT-7
    await writeTask(locttDir, "w9", task("w9", "WEB-9", { due_date: "2026-02-01" }));
    const conflicts: TaskConflictField[] = [
      { taskId: "w9", taskKey: "WEB-9", taskTitle: "Task WEB-9", field: "due_date", fieldLabel: "Due date", kind: "scalar",
        local: { raw: "2026-02-01", display: "2026-02-01" }, remote: { raw: "2026-03-01", display: "2026-03-01" } },
    ];
    const decisions: ReconcileDecision[] = [
      { taskId: "w9", field: "due_date", choice: "value", value: "2026-06-15" },
    ];
    await applyReconcile(locttDir, conflicts, decisions, workflow);
    const after = await readTask(locttDir, "w9");
    expect(after.frontmatter.due_date).toBe("2026-06-15");
  });

  it("keep-remote on a parent fixes the inverse child edge (GIT-13, P-12)", async () => {
    // @verifies GIT-13
    // WEB-3's parent is WEB-2 locally; the decision moves it to WEB-7.
    await writeTask(locttDir, "w2", task("w2", "WEB-2", { relationships: [{ type: "child", target: "w3" }] }));
    await writeTask(locttDir, "w7", task("w7", "WEB-7"));
    await writeTask(locttDir, "w3", task("w3", "WEB-3", { relationships: [{ type: "parent", target: "w2" }] }));
    const conflicts: TaskConflictField[] = [
      { taskId: "w3", taskKey: "WEB-3", taskTitle: "Task WEB-3", field: "parent", fieldLabel: "Parent", kind: "relationship_parent",
        local: { raw: "w2", display: "WEB-2 · x" }, remote: { raw: "w7", display: "WEB-7 · y" },
        options: [{ key: "w2", label: "WEB-2" }, { key: "w7", label: "WEB-7" }] },
    ];
    await applyReconcile(locttDir, conflicts, [{ taskId: "w3", field: "parent", choice: "remote" }], workflow);
    const w3 = await readTask(locttDir, "w3");
    const w2 = await readTask(locttDir, "w2");
    const w7 = await readTask(locttDir, "w7");
    // WEB-3 now points at WEB-7…
    expect(w3.frontmatter.relationships).toEqual([{ type: "parent", target: "w7" }]);
    // …WEB-7 gained the inverse child edge…
    expect(w7.frontmatter.relationships).toEqual([{ type: "child", target: "w3" }]);
    // …and the losing parent WEB-2's child edge is GONE, not dangling.
    expect(w2.frontmatter.relationships ?? []).toEqual([]);
  });

  it("reports the true split when one task's write fails, keeping the rest (GIT-32/GIT-37)", async () => {
    // @verifies GIT-32
    // @verifies GIT-37
    await writeTask(locttDir, "ok", task("ok", "WEB-1", { title: "a" }));
    await writeTask(locttDir, "bad", task("bad", "WEB-2", { title: "b" }));
    // Make `bad`'s directory unwritable mid-operation — the atomic write
    // writes a temp file in that directory before renaming, so a
    // read-only dir blocks it the way a permission change mid-Apply would.
    await chmod(join(locttDir, "tasks", "bad"), 0o500);
    const conflicts: TaskConflictField[] = [
      { taskId: "ok", taskKey: "WEB-1", taskTitle: "t", field: "title", fieldLabel: "Title", kind: "scalar",
        local: { raw: "a", display: "a" }, remote: { raw: "a2", display: "a2" } },
      { taskId: "bad", taskKey: "WEB-2", taskTitle: "t", field: "title", fieldLabel: "Title", kind: "scalar",
        local: { raw: "b", display: "b" }, remote: { raw: "b2", display: "b2" } },
    ];
    const decisions: ReconcileDecision[] = [
      { taskId: "ok", field: "title", choice: "remote" },
      { taskId: "bad", field: "title", choice: "remote" },
    ];
    const result = await applyReconcile(locttDir, conflicts, decisions, workflow);
    expect(result.complete).toBe(false);
    const ok = result.results.find(r => r.taskKey === "WEB-1");
    const bad = result.results.find(r => r.taskKey === "WEB-2");
    expect(ok?.ok).toBe(true);
    expect(bad?.ok).toBe(false);
    // The honest journal: only the successful task id is recorded applied.
    expect(result.appliedTaskIds).toEqual(["ok"]);

    // Retry after fixing permissions re-applies ONLY the failed row (GIT-37).
    await chmod(join(locttDir, "tasks", "bad"), 0o700);
    const retry = await applyReconcile(locttDir, conflicts, decisions, workflow, result.appliedTaskIds);
    expect(retry.complete).toBe(true);
    // `ok` was not rewritten (it is in alreadyApplied); only `bad` ran.
    expect(retry.results.map(r => r.taskKey)).toEqual(["WEB-2"]);
    const bad2 = await readTask(locttDir, "bad");
    expect(bad2.frontmatter.title).toBe("b2");
  });
});
