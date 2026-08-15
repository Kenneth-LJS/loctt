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
    // No workflowConfig passed, so there is no default to resolve. With
    // config present the default status IS assigned — see the
    // default-status cases below.
    expect(task.frontmatter.status).toBeUndefined();
    expect(task.body).toBe("");

    // State should be updated
    expect(state.keys["task"]?.next_number).toBe(2);
  });

  describe("default status (0b)", () => {
    // A task created without a status used to have no `status` key at
    // all — and a task with no status matches neither `status = backlog`
    // nor `status != done`, so it was invisible to ordinary filtering.
    // All three surfaces funnel through createTask, so all three
    // produced them.
    async function wf() {
      const { parseWorkflowConfig } = await import("../config/workflow.js");
      const { defaultWorkflowYaml } = await import("../init/defaults.js");
      return parseWorkflowConfig(defaultWorkflowYaml("T-"));
    }

    it("assigns the default status when none is given", async () => {
      const task = await createTask({
        locttDir,
        state: makeState(),
        options: { project: "task", title: "No status" },
        workflowConfig: await wf(),
      });
      expect(task.frontmatter.status).toBe("backlog");
    });

    it("does not override an explicit status", async () => {
      const task = await createTask({
        locttDir,
        state: makeState(),
        options: { project: "task", title: "Explicit", status: "in_progress" },
        workflowConfig: await wf(),
      });
      expect(task.frontmatter.status).toBe("in_progress");
    });

    it("follows the config's default rather than list order", async () => {
      // The old documented rules were "the first status" and "the first
      // pending status" — neither implemented. Marking a later status
      // default proves position no longer decides.
      const base = await wf();
      const config = {
        ...base,
        statuses: base.statuses.map(s =>
          s.key === "backlog"
            ? { key: s.key, label: s.label, category: s.category }
            : s.key === "wont_do"
              ? { ...s, default: true as const }
              : s,
        ),
      };
      const task = await createTask({
        locttDir,
        state: makeState(),
        options: { project: "task", title: "Reordered" },
        workflowConfig: config,
      });
      expect(task.frontmatter.status).toBe("wont_do");
    });

    it("the created task is reachable by an ordinary status filter", async () => {
      // The point of the fix: the task must be findable, not merely
      // carry a key.
      const config = await wf();
      const task = await createTask({
        locttDir,
        state: makeState(),
        options: { project: "task", title: "Findable" },
        workflowConfig: config,
      });
      const { evaluateQuery } = await import("../query/evaluator.js");
      const { parseQuery } = await import("../query/parser.js");
      const { tokenize } = await import("../query/tokenizer.js");
      const run = (q: string) =>
        evaluateQuery(parseQuery(tokenize(q)), task.frontmatter, { workflow: config });

      expect(run("status = backlog")).toBe(true);
      expect(run("status != done")).toBe(true);
    });
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
