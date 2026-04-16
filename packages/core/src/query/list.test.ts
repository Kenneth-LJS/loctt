import { describe, it, expect } from "vitest";
import type { Task, QueriesConfig, WorkflowConfig } from "@loctt/contracts";
import { listTasks, resolveView } from "./list.js";

const config: WorkflowConfig = {
  key: { prefix: "T-" },
  statuses: [
    { key: "not_started", label: "Not started", category: "pending" },
    { key: "done", label: "Done", category: "completed" },
  ],
  priorities: [
    { key: "low", label: "Low", value: 1 },
    { key: "medium", label: "Medium", value: 2 },
    { key: "high", label: "High", value: 3 },
  ],
  task_types: [{ key: "task", label: "Task" }],
  relationships: [],
  custom_fields: [],
};

const queriesConfig: QueriesConfig = {
  queries: [
    {
      name: "recent-open",
      query: "status != done",
      sort: [{ field: "updated_at", direction: "desc" }],
    },
    {
      name: "by-priority",
      query: "status != done",
      sort: [{ field: "priority", direction: "desc" }],
    },
  ],
};

function makeTask(key: string, overrides: Partial<Task["frontmatter"]> = {}): Task {
  return {
    frontmatter: {
      id: `id-${key}`,
      key,
      title: `Task ${key}`,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      ...overrides,
    },
    body: "",
  };
}

const tasks: Task[] = [
  makeTask("T-1", { status: "not_started", priority: "low", updated_at: "2026-04-10T00:00:00Z" }),
  makeTask("T-2", { status: "not_started", priority: "high", updated_at: "2026-04-15T00:00:00Z" }),
  makeTask("T-3", { status: "done", priority: "medium", updated_at: "2026-04-12T00:00:00Z" }),
  makeTask("T-4", { status: "not_started", priority: "medium", updated_at: "2026-04-16T00:00:00Z" }),
];

describe("resolveView", () => {
  it("finds a view by name", () => {
    const view = resolveView(queriesConfig, "recent-open");
    expect(view?.query).toBe("status != done");
  });

  it("returns undefined for unknown view", () => {
    expect(resolveView(queriesConfig, "nonexistent")).toBeUndefined();
  });
});

describe("listTasks", () => {
  it("returns all tasks with default sort (most recent first) when no query", () => {
    const result = listTasks(tasks, {}, undefined, undefined);
    expect(result[0]?.frontmatter.key).toBe("T-4");
  });

  it("filters by ad hoc query", () => {
    const result = listTasks(tasks, { query: "status = done" }, undefined, undefined);
    expect(result).toHaveLength(1);
    expect(result[0]?.frontmatter.key).toBe("T-3");
  });

  it("filters using a saved view", () => {
    const result = listTasks(tasks, { view: "recent-open" }, queriesConfig, config);
    expect(result).toHaveLength(3);
    // Should not include done task
    expect(result.find(t => t.frontmatter.key === "T-3")).toBeUndefined();
  });

  it("sorts by view sort order", () => {
    const result = listTasks(tasks, { view: "recent-open" }, queriesConfig, config);
    // recent-open sorts by updated_at desc
    expect(result[0]?.frontmatter.key).toBe("T-4");
    expect(result[1]?.frontmatter.key).toBe("T-2");
    expect(result[2]?.frontmatter.key).toBe("T-1");
  });

  it("sorts by priority using numeric values", () => {
    const result = listTasks(tasks, { view: "by-priority" }, queriesConfig, config);
    // by-priority sorts priority desc: high(3), medium(2), low(1)
    expect(result[0]?.frontmatter.priority).toBe("high");
    expect(result[1]?.frontmatter.priority).toBe("medium");
    expect(result[2]?.frontmatter.priority).toBe("low");
  });

  it("respects limit", () => {
    const result = listTasks(tasks, { limit: 2 }, undefined, undefined);
    expect(result).toHaveLength(2);
  });

  it("defaults to limit 30", () => {
    const manyTasks = Array.from({ length: 40 }, (_, i) =>
      makeTask(`T-${i}`, { updated_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }),
    );
    const result = listTasks(manyTasks, {}, undefined, undefined);
    expect(result).toHaveLength(30);
  });

  it("explicit sort overrides view sort", () => {
    const result = listTasks(
      tasks,
      { view: "recent-open", sort: [{ field: "key", direction: "asc" }] },
      queriesConfig,
      config,
    );
    expect(result[0]?.frontmatter.key).toBe("T-1");
  });

  it("throws for unknown view", () => {
    expect(() => listTasks(tasks, { view: "bogus" }, queriesConfig, config))
      .toThrow("unknown view");
  });
});
