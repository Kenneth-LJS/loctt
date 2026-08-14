import type { QueriesConfig, Task, WorkflowConfig } from "@loctt/contracts";
import { describe, expect,it } from "vitest";

import { QueriesConfigError } from "../config/queries.js";
import { listTasks, listTasksPaginated, resolveView } from "./list.js";
import { QueryValidationError } from "./validate.js";

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
      id: "01HSV0000000000000RECENT",
      name: "recent-open",
      query: "status != done",
      sort: [{ field: "updated_at", direction: "desc" }],
    },
    {
      id: "01HSV0000000000000BYPRIORITY",
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
    const result = listTasks({ tasks, options: {} });
    expect(result[0]?.frontmatter.key).toBe("T-4");
  });

  it("filters by ad hoc query", () => {
    const result = listTasks({ tasks, options: { query: "status = done" } });
    expect(result).toHaveLength(1);
    expect(result[0]?.frontmatter.key).toBe("T-3");
  });

  it("filters using a saved view", () => {
    const result = listTasks({ tasks, options: { view: "recent-open" }, queriesConfig, workflowConfig: config });
    expect(result).toHaveLength(3);
    // Should not include done task
    expect(result.find(t => t.frontmatter.key === "T-3")).toBeUndefined();
  });

  it("sorts by view sort order", () => {
    const result = listTasks({ tasks, options: { view: "recent-open" }, queriesConfig, workflowConfig: config });
    // recent-open sorts by updated_at desc
    expect(result[0]?.frontmatter.key).toBe("T-4");
    expect(result[1]?.frontmatter.key).toBe("T-2");
    expect(result[2]?.frontmatter.key).toBe("T-1");
  });

  it("sorts by priority using numeric values", () => {
    const result = listTasks({ tasks, options: { view: "by-priority" }, queriesConfig, workflowConfig: config });
    // by-priority sorts priority desc: high(3), medium(2), low(1)
    expect(result[0]?.frontmatter.priority).toBe("high");
    expect(result[1]?.frontmatter.priority).toBe("medium");
    expect(result[2]?.frontmatter.priority).toBe("low");
  });

  it("respects limit", () => {
    const result = listTasks({ tasks, options: { limit: 2 } });
    expect(result).toHaveLength(2);
  });

  it("defaults to limit 30", () => {
    const manyTasks = Array.from({ length: 40 }, (_, i) =>
      makeTask(`T-${i}`, { updated_at: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z` }),
    );
    const result = listTasks({ tasks: manyTasks, options: {} });
    expect(result).toHaveLength(30);
  });

  it("explicit sort overrides view sort", () => {
    const result = listTasks({
      tasks,
      options: { view: "recent-open", sort: [{ field: "key", direction: "asc" }] },
      queriesConfig,
      workflowConfig: config,
    });
    expect(result[0]?.frontmatter.key).toBe("T-1");
  });

  it("sort by a prototype-chain field name treats values as undefined", () => {
    // Regression: prior implementations used `field in fm` to detect
    // built-in frontmatter fields, which would also match prototype
    // keys like "toString" — every task would then "have" a
    // toString function as its sort key, making sort order arbitrary
    // and crashing the YAML formatter elsewhere if such a value
    // leaked out. With hasOwnProperty narrowing, every task sees
    // undefined for these keys and the input order is preserved.
    const result = listTasks({
      tasks,
      options: { sort: [{ field: "toString", direction: "asc" }] },
    });
    expect(result.map(t => t.frontmatter.key)).toEqual([
      "T-1", "T-2", "T-3", "T-4",
    ]);
  });

  it("throws for unknown view", () => {
    expect(() => listTasks({ tasks, options: { view: "bogus" }, queriesConfig, workflowConfig: config }))
      .toThrow("unknown view");
  });

  it("throws QueriesConfigError when --view is requested but queriesConfig is missing", () => {
    expect(() => listTasks({ tasks, options: { view: "anything" } }))
      .toThrow(QueriesConfigError);
    expect(() => listTasks({ tasks, options: { view: "anything" } }))
      .toThrow(/Cannot use --view 'anything': no queries\.yaml found\./);
  });

  describe("archived filtering", () => {
    const archivedTasks: Task[] = [
      makeTask("T-1", { status: "not_started", updated_at: "2026-04-01T00:00:00Z" }),
      makeTask("T-2", { status: "not_started", archived: true, archived_at: "2026-04-02T00:00:00Z", updated_at: "2026-04-02T00:00:00Z" }),
      makeTask("T-3", { status: "done", archived: true, archived_at: "2026-04-03T00:00:00Z", updated_at: "2026-04-03T00:00:00Z" }),
    ];

    it("hides archived tasks by default with no query", () => {
      const result = listTasks({ tasks: archivedTasks, options: {} });
      expect(result.map(t => t.frontmatter.key)).toEqual(["T-1"]);
    });

    it("hides archived tasks by default with a query that does not mention archived", () => {
      const result = listTasks({ tasks: archivedTasks, options: { query: "status = not_started" } });
      expect(result.map(t => t.frontmatter.key)).toEqual(["T-1"]);
    });

    it("includes archived tasks when includeArchived=true", () => {
      const result = listTasks({ tasks: archivedTasks, options: { includeArchived: true } });
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["T-1", "T-2", "T-3"]);
    });

    it("respects an explicit archived filter in user query", () => {
      const result = listTasks({ tasks: archivedTasks, options: { query: "archived = true" } });
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["T-2", "T-3"]);
    });

    it("does not inject archived filter when using a saved view", () => {
      const viewConfig: QueriesConfig = {
        queries: [{ id: "01HSV0000000000000VIEW", name: "all-not-started", query: "status = not_started" }],
      };
      const result = listTasks({
        tasks: archivedTasks,
        options: { view: "all-not-started" },
        queriesConfig: viewConfig,
        workflowConfig: config,
      });
      // View is respected as authored — includes the archived not_started task
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["T-1", "T-2"]);
    });
  });

  describe("project filter interaction", () => {
    const multiProjectTasks: Task[] = [
      makeTask("WEB-1", { project: "web", status: "not_started" }),
      makeTask("WEB-2", { project: "web", status: "done" }),
      makeTask("API-1", { project: "api", status: "not_started" }),
      makeTask("API-2", { project: "api", status: "done" }),
    ];

    it("applies the project filter as a post-query equality check", () => {
      const result = listTasks({
        tasks: multiProjectTasks,
        options: { project: "web", includeArchived: true },
      });
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["WEB-1", "WEB-2"]);
    });

    it("project filter composes with an explicit query", () => {
      const result = listTasks({
        tasks: multiProjectTasks,
        options: { project: "web", query: "status = not_started" },
      });
      expect(result.map(t => t.frontmatter.key)).toEqual(["WEB-1"]);
    });

    it("project filter is IGNORED when a saved view is used (views are respected as authored)", () => {
      // This is the documented interaction: when `view` is set,
      // the `project` filter is NOT applied. The view's authored
      // query is the source of truth — surfaces would conflate the
      // two if they were AND-merged silently.
      const viewConfig: QueriesConfig = {
        queries: [{ id: "01HSV0000000000000ALLOPEN", name: "all-open", query: "status != done" }],
      };
      const result = listTasks({
        tasks: multiProjectTasks,
        options: { view: "all-open", project: "web" },
        queriesConfig: viewConfig,
        workflowConfig: config,
      });
      // View matches WEB-1 and API-1; the `project: "web"` filter
      // was supplied but the view-precedence policy ignores it.
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["API-1", "WEB-1"]);
    });
  });
});

describe("listTasksPaginated", () => {
  it("returns { items, total, limit, offset } with total unaffected by limit", () => {
    const result = listTasksPaginated({
      tasks,
      options: { limit: 2 },
    });
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(4); // all 4 tasks (none archived); total is unaffected by limit
    expect(result.limit).toBe(2);
    expect(result.offset).toBe(0);
  });

  it("honors offset to return a subsequent page", () => {
    const page1 = listTasksPaginated({ tasks, options: { limit: 2 }, offset: 0 });
    const page2 = listTasksPaginated({ tasks, options: { limit: 2 }, offset: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page2.items.length).toBeGreaterThanOrEqual(1);
    // No overlap between pages
    const page1Keys = new Set(page1.items.map(t => t.frontmatter.key));
    for (const t of page2.items) {
      expect(page1Keys.has(t.frontmatter.key)).toBe(false);
    }
  });

  it("returns empty items when offset is past total", () => {
    const result = listTasksPaginated({ tasks, options: { limit: 10 }, offset: 100 });
    expect(result.items).toEqual([]);
    expect(result.total).toBeGreaterThan(0);
  });

  it("total reflects post-filter count, not the input array size", () => {
    const result = listTasksPaginated({
      tasks,
      options: { query: "priority = high", limit: 10 },
    });
    expect(result.total).toBe(1); // only T-2 is high
    expect(result.items).toHaveLength(1);
  });

  it("clamps negative offset to 0", () => {
    const result = listTasksPaginated({ tasks, options: { limit: 1 }, offset: -5 });
    expect(result.offset).toBe(0);
    expect(result.items).toHaveLength(1);
  });
});

describe("listTasks — semantic query validation", () => {
  // The bug: `stat = done` (typo for `status`) matched nothing and read
  // as "no tasks match" rather than "your query is wrong".
  it("throws on a typo'd field in an ad hoc query", () => {
    expect(() => listTasks({ tasks, options: { query: "stat = done" } }))
      .toThrow(QueryValidationError);
  });

  it("throws on an unknown enum value when workflow config is available", () => {
    expect(() => listTasks({
      tasks,
      options: { query: "status = frobnik" },
      workflowConfig: config,
    })).toThrow(/unknown status value/);
  });

  it("still returns an empty list for a valid query that matches nothing", () => {
    // Must stay distinguishable from the errors above.
    const result = listTasks({
      tasks,
      options: { query: "status = done and priority = high" },
      workflowConfig: config,
    });
    expect(result).toEqual([]);
  });

  // Positions are validated against the query as authored. The
  // archived-wrapping rewrites it to `(stat = done) and archived != true`,
  // which would shift every offset by the `(` prefix.
  it("reports the position from the user's query, not the archived-wrapped rewrite", () => {
    let caught: QueryValidationError | undefined;
    try {
      listTasks({ tasks, options: { query: "stat = done" } });
    } catch (err) {
      caught = err as QueryValidationError;
    }
    expect(caught?.position).toBe(0);
  });

  describe("saved views warn rather than throw", () => {
    // A view referencing a since-deleted custom field used to work.
    // Breaking `--view` outright would regress existing trackers.
    const staleView: QueriesConfig = {
      queries: [{
        id: "01HSV0000000000000STALE",
        name: "stale",
        query: "fields.deleted_field = x",
      }],
    };

    it("runs the view and reports through onWarning", () => {
      const warnings: QueryValidationError[] = [];
      const result = listTasks({
        tasks,
        options: { view: "stale" },
        queriesConfig: staleView,
        workflowConfig: config,
        onWarning: err => warnings.push(err),
      });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toContain("unknown custom field");
      // Ran to completion rather than throwing; matches nothing.
      expect(result).toEqual([]);
    });

    it("does not throw when no onWarning handler is supplied", () => {
      expect(() => listTasks({
        tasks,
        options: { view: "stale" },
        queriesConfig: staleView,
        workflowConfig: config,
      })).not.toThrow();
    });
  });

  it("does not warn for a valid saved view", () => {
    const warnings: QueryValidationError[] = [];
    listTasks({
      tasks,
      options: { view: "recent-open" },
      queriesConfig,
      workflowConfig: config,
      onWarning: err => warnings.push(err),
    });
    expect(warnings).toEqual([]);
  });
});

describe("listTasks — `today` resolves in the workspace timezone", () => {
  // Was: `today` resolved via toISOString() (always UTC), so in a
  // UTC+8 workspace every query for the eight hours after local
  // midnight used yesterday's boundary and silently dropped tasks
  // due today.
  const dated: Task[] = [
    makeTask("D-1", { due_date: "2026-08-13" }),
    makeTask("D-2", { due_date: "2026-08-14" }),
  ];

  it("uses the supplied date rather than the process clock", () => {
    // Singapore has already rolled over to the 14th while UTC is
    // still on the 13th. With today = 14th, D-1 is overdue.
    const overdue = listTasks({
      tasks: dated,
      options: { query: "due_date < today", today: "2026-08-14" },
    });
    expect(overdue.map(t => t.frontmatter.key)).toEqual(["D-1"]);

    // Same tasks, same query, UTC's answer — D-1 is not yet overdue.
    const utc = listTasks({
      tasks: dated,
      options: { query: "due_date < today", today: "2026-08-13" },
    });
    expect(utc).toEqual([]);
  });

  it("resolves `today` inside an `in` list too", () => {
    const due = listTasks({
      tasks: dated,
      options: { query: "due_date in (today)", today: "2026-08-14" },
    });
    expect(due.map(t => t.frontmatter.key)).toEqual(["D-2"]);
  });

  it("falls back to the UTC date when no today is supplied", () => {
    // Not asserting a specific date — just that the path still works
    // and doesn't throw without the new option.
    expect(() => listTasks({
      tasks: dated,
      options: { query: "due_date < today" },
    })).not.toThrow();
  });
});

describe("listTasks — workflow config reaches the evaluator", () => {
  // `status.category` needs workflow config in EvalContext. It was
  // never passed through from listTasks, so category queries silently
  // matched nothing in every list surface.
  it("resolves status.category through the supplied workflow config", () => {
    const result = listTasks({
      tasks,
      options: { query: "status.category = completed" },
      workflowConfig: config,
    });
    expect(result.map(t => t.frontmatter.key)).toEqual(["T-3"]);
  });
});


describe("listTasks — view + ad hoc query", () => {
  // `--view` and `--query` can be passed together. The query is then
  // the user's own typing, so a typo in it must still throw rather
  // than being downgraded to a warning because a view was named.
  const staleView: QueriesConfig = {
    queries: [{
      id: "01HSV0000000000000STALE2",
      name: "stale",
      query: "fields.deleted_field = x",
    }],
  };

  it("throws on a typo'd ad hoc query even when a view is also named", () => {
    expect(() => listTasks({
      tasks,
      options: { view: "stale", query: "stat = done" },
      queriesConfig: staleView,
      workflowConfig: config,
    })).toThrow(QueryValidationError);
  });

  it("still warns rather than throws when the query comes from the view", () => {
    const warnings: QueryValidationError[] = [];
    expect(() => listTasks({
      tasks,
      options: { view: "stale" },
      queriesConfig: staleView,
      workflowConfig: config,
      onWarning: err => warnings.push(err),
    })).not.toThrow();
    expect(warnings).toHaveLength(1);
  });
});
