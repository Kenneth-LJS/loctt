import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LocttState } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { createTask } from "./create.js";
import { readTask } from "./io.js";
import { listTaskIds } from "./list-ids.js";

describe("createTask", () => {
  let locttDir: string;

  beforeEach(async () => {
    const tmp = await mkdtemp(join(tmpdir(), "loctt-create-"));
    locttDir = join(tmp, ".loctt");
  });

  afterEach(async () => {
    await rm(join(locttDir, ".."), { recursive: true, force: true });
  });

  function makeState(): LocttState {
    return { keys: { task: { prefix: "T-", next_number: 1 } } };
  }

  it("creates a task with only required fields", async () => {
    const state = makeState();
    const task = await createTask({ locttDir, state, options: { project: "task", title: "My task" } });

    expect(task.frontmatter.title).toBe("My task");
    expect(task.frontmatter.key).toBe("T-1");
    expect(task.frontmatter.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(task.frontmatter.created_at).toBeTruthy();
    expect(task.frontmatter.status).toBeUndefined();
    expect(task.body).toBe("");

    // State should be updated
    expect(state.keys["task"]?.next_number).toBe(2);
  });

  it("creates a task with optional fields", async () => {
    const state = makeState();
    const task = await createTask({ locttDir, state, options: {
      project: "task",
      title: "Full task",
      status: "in_progress",
      priority: "high",
      task_type: "task",
      labels: ["urgent"],
      fields: { sprint: "sprint_1" },
      body: "Some description.\n",
    } });

    expect(task.frontmatter.status).toBe("in_progress");
    expect(task.frontmatter.priority).toBe("high");
    expect(task.frontmatter.labels).toEqual(["urgent"]);
    expect(task.frontmatter.fields).toEqual({ sprint: "sprint_1" });
    expect(task.body).toBe("Some description.\n");
  });

  it("persists the task to disk", async () => {
    const state = makeState();
    const task = await createTask({ locttDir, state, options: { project: "task", title: "Persisted" } });

    const loaded = await readTask(locttDir, task.frontmatter.id);
    expect(loaded.frontmatter.title).toBe("Persisted");
    expect(loaded.frontmatter.key).toBe("T-1");
  });

  it("allocates sequential keys", async () => {
    const state = makeState();
    const t1 = await createTask({ locttDir, state, options: { project: "task", title: "First" } });
    const t2 = await createTask({ locttDir, state, options: { project: "task", title: "Second" } });

    expect(t1.frontmatter.key).toBe("T-1");
    expect(t2.frontmatter.key).toBe("T-2");
    expect(state.keys["task"]?.next_number).toBe(3);
  });

  it("creates unique IDs for each task", async () => {
    const state = makeState();
    const t1 = await createTask({ locttDir, state, options: { project: "task", title: "A" } });
    const t2 = await createTask({ locttDir, state, options: { project: "task", title: "B" } });

    expect(t1.frontmatter.id).not.toBe(t2.frontmatter.id);
    const ids = await listTaskIds(locttDir);
    expect(ids).toHaveLength(2);
  });

  it("persists sprint when supplied", async () => {
    const state = makeState();
    const task = await createTask({
      locttDir,
      state,
      options: { project: "task", title: "with sprint", sprint: "sprint_1" },
    });
    expect(task.frontmatter.sprint).toBe("sprint_1");
    const round = await readTask(locttDir, task.frontmatter.id);
    expect(round.frontmatter.sprint).toBe("sprint_1");
  });

  it("auto-stamps completed_date when created directly into a completed-category status", async () => {
    const state = makeState();
    const workflowConfig = {
      key: { prefix: "T-" },
      statuses: [
        { key: "todo", label: "Todo", category: "pending" as const },
        { key: "done", label: "Done", category: "completed" as const },
      ],
      priorities: [],
      task_types: [{ key: "task", label: "Task" }],
      relationships: [],
      custom_fields: [],
    };
    const task = await createTask({
      locttDir,
      state,
      options: { project: "task", title: "born done", status: "done" },
      workflowConfig,
    });
    expect(task.frontmatter.completed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // No completed_date when starting in a non-completed status.
    const t2 = await createTask({
      locttDir,
      state,
      options: { project: "task", title: "in flight", status: "todo" },
      workflowConfig,
    });
    expect(t2.frontmatter.completed_date).toBeUndefined();
  });
});
