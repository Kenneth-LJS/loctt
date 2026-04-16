import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LocttState } from "@loctt/contracts";
import { afterEach,beforeEach, describe, expect, it } from "vitest";

import { createTask } from "./create.js";
import { readTask } from "./io.js";
import { listTaskIds } from "./lookup.js";

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
    const task = await createTask(locttDir, state, { title: "My task" });

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
    const task = await createTask(locttDir, state, {
      title: "Full task",
      status: "in_progress",
      priority: "high",
      task_type: "task",
      labels: ["urgent"],
      fields: { sprint: "sprint_1" },
      body: "Some description.\n",
    });

    expect(task.frontmatter.status).toBe("in_progress");
    expect(task.frontmatter.priority).toBe("high");
    expect(task.frontmatter.labels).toEqual(["urgent"]);
    expect(task.frontmatter.fields).toEqual({ sprint: "sprint_1" });
    expect(task.body).toBe("Some description.\n");
  });

  it("persists the task to disk", async () => {
    const state = makeState();
    const task = await createTask(locttDir, state, { title: "Persisted" });

    const loaded = await readTask(locttDir, task.frontmatter.id);
    expect(loaded.frontmatter.title).toBe("Persisted");
    expect(loaded.frontmatter.key).toBe("T-1");
  });

  it("allocates sequential keys", async () => {
    const state = makeState();
    const t1 = await createTask(locttDir, state, { title: "First" });
    const t2 = await createTask(locttDir, state, { title: "Second" });

    expect(t1.frontmatter.key).toBe("T-1");
    expect(t2.frontmatter.key).toBe("T-2");
    expect(state.keys["task"]?.next_number).toBe(3);
  });

  it("creates unique IDs for each task", async () => {
    const state = makeState();
    const t1 = await createTask(locttDir, state, { title: "A" });
    const t2 = await createTask(locttDir, state, { title: "B" });

    expect(t1.frontmatter.id).not.toBe(t2.frontmatter.id);
    const ids = await listTaskIds(locttDir);
    expect(ids).toHaveLength(2);
  });
});
