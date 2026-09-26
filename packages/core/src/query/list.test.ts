import type { ComparisonOp, QueriesConfig, SavedQuery, Task, WorkflowConfig } from "@loctt/contracts";
import { describe, expect,it } from "vitest";

import { QueriesConfigError } from "../config/queries.js";
import { buildListContext, listTasks, listTasksPaginated, resolveView } from "./list.js";
import { QueryValidationError } from "./validate.js";

/**
 * Build a SavedQuery fixture from a single simple filter — most of these
 * `listTasks`/`resolveView` fixtures only need one `field op values`
 * predicate, so this keeps the table below readable. Use `filters`
 * directly (or `advancedView` below) for anything more elaborate.
 */
function view(
  q: { id: string; name: string; field: string; op: ComparisonOp; values: string[]; sort?: SavedQuery["sort"]; archivedScope?: SavedQuery["archivedScope"] },
): SavedQuery {
  return {
    id: q.id,
    name: q.name,
    filters: [{ kind: "simple", field: q.field, op: q.op, values: q.values }],
    ...(q.sort !== undefined ? { sort: q.sort } : {}),
    ...(q.archivedScope !== undefined ? { archivedScope: q.archivedScope } : {}),
  };
}

/** Build a SavedQuery fixture from a single advanced (raw DSL) filter. */
function advancedView(q: { id: string; name: string; query: string; sort?: SavedQuery["sort"]; archivedScope?: SavedQuery["archivedScope"] }): SavedQuery {
  return {
    id: q.id,
    name: q.name,
    filters: [{ kind: "advanced", query: q.query }],
    ...(q.sort !== undefined ? { sort: q.sort } : {}),
    ...(q.archivedScope !== undefined ? { archivedScope: q.archivedScope } : {}),
  };
}

const config: WorkflowConfig = {
  key: { prefix: "T" },
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
    view({
      id: "01HSV0000000000000RECENT",
      name: "recent-open",
      field: "status", op: "!=", values: ["done"],
      sort: [{ field: "updated_at", direction: "desc" }],
    }),
    view({
      id: "01HSV0000000000000BYPRIORITY",
      name: "by-priority",
      field: "status", op: "!=", values: ["done"],
      sort: [{ field: "priority", direction: "desc" }],
    }),
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
    expect(view?.filters).toEqual([{ kind: "simple", field: "status", op: "!=", values: ["done"] }]);
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

  it("sorts by a custom field addressed as fields.<key>", () => {
    // **This was a silent no-op.** `getTaskFieldValue` looked for the
    // literal key "fields.points" in two places, and both missed: the
    // frontmatter has `fields` (an object), and `fields` has `points`.
    // So every task resolved to undefined, the comparator called them
    // all equal, and the stable sort returned scan order.
    //
    // Silent is the operative word. `isSortableTaskField` accepts
    // `fields.*` by shape, so the URL validated, the key persisted,
    // and a sort indicator appeared on the column — the state LST-29's
    // bullets 2 and 3 forbid, reached by a path LST-29 does not cover
    // because the key is *known* rather than unknown. The predicate
    // and the resolver disagreed.
    //
    // Measured over HTTP on three tasks before the fix: `asc` and
    // `desc` both returned ['Zeta', 'Alpha', 'Mid'] — identical,
    // which is the tell. Sorted output that ignores `direction` is not
    // sorted at all.
    const withFields: Task[] = [
      makeTask("C-1", { fields: { points: 9 } }),
      makeTask("C-2", { fields: { points: 1 } }),
      makeTask("C-3", { fields: { points: 5 } }),
    ];

    const asc = listTasks({
      tasks: withFields,
      options: { sort: [{ field: "fields.points", direction: "asc" }] },
    });
    expect(asc.map(t => t.frontmatter.key)).toEqual(["C-2", "C-3", "C-1"]);

    // Seeded in neither order, so "sorted" cannot coincide with "as
    // given" — and asserting both directions is what catches a
    // resolver that returns undefined for everything, since that
    // leaves input order intact whichever way you ask.
    const desc = listTasks({
      tasks: withFields,
      options: { sort: [{ field: "fields.points", direction: "desc" }] },
    });
    expect(desc.map(t => t.frontmatter.key)).toEqual(["C-1", "C-3", "C-2"]);
  });

  it("treats a missing custom field as absent, not as a prototype hit", () => {
    // The dotted-key branch must not reintroduce the prototype hazard
    // the tests around it exist for: `fields.toString` resolves on
    // every object.
    const withFields: Task[] = [
      makeTask("P-1", { fields: { points: 3 } }),
      makeTask("P-2", { fields: {} }),
    ];
    const result = listTasks({
      tasks: withFields,
      options: { sort: [{ field: "fields.toString", direction: "asc" }] },
    });
    expect(result.map(t => t.frontmatter.key)).toEqual(["P-1", "P-2"]);
  });

  it("sorts on a prototype key against tasks that carry a fields object", () => {
    // The test above never reached the hazard it describes: none of the
    // shared fixtures has a `fields` object, so the custom-field lookup
    // that `field in fm` would have poisoned was never entered.
    //
    // These fixtures do. `toString` and `constructor` exist on every
    // object's prototype, so an `in` check reports them present and
    // every task "has" a function as its sort key.
    const withFields: Task[] = [
      makeTask("F-1", { fields: { points: 3 } }),
      makeTask("F-2", { fields: { points: 1 } }),
      makeTask("F-3", { fields: {} }),
    ];

    for (const field of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
      const result = listTasks({
        tasks: withFields,
        options: { sort: [{ field, direction: "asc" }] },
      });
      // Every task must see *undefined*, not a function. The custom-field
      // branch used a bare `in`, so it returned `fields.toString` — a
      // function — as the sort value.
      expect(result.map(t => t.frontmatter.key), `sorting by ${field}`)
        .toEqual(["F-1", "F-2", "F-3"]);
      // Order across tasks that *all* carry `fields` is weak evidence:
      // every one resolves the same function, the comparator calls them
      // equal, and input order survives either way. The discriminating
      // case is a mix — see the test below.
    }
  });

  it("does not resolve a prototype key on some tasks and not others", () => {
    // This is the fixture that tells the two implementations apart. With
    // a bare `in`, the task carrying `fields` resolves `toString` to a
    // function while the task without `fields` stays undefined — and
    // since undefined is pushed to the end regardless of direction, the
    // pair comes back reordered. With hasOwnProperty both are undefined
    // and input order holds.
    const mixed: Task[] = [
      makeTask("F-1"),
      makeTask("F-2", { fields: { points: 1 } }),
    ];

    for (const direction of ["asc", "desc"] as const) {
      const result = listTasks({
        tasks: mixed,
        options: { sort: [{ field: "toString", direction }] },
      });
      expect(result.map(t => t.frontmatter.key), `sorting by toString ${direction}`)
        .toEqual(["F-1", "F-2"]);
    }
  });

  it("still sorts on a real custom field, so the guard is not over-broad", () => {
    const withFields: Task[] = [
      makeTask("F-1", { fields: { points: 3 } }),
      makeTask("F-2", { fields: { points: 1 } }),
    ];
    // Custom fields are addressed by bare key in a sort spec, not with
    // a `fields.` prefix (that form is the query DSL's).
    const result = listTasks({
      tasks: withFields,
      options: { sort: [{ field: "points", direction: "asc" }] },
    });
    expect(result.map(t => t.frontmatter.key)).toEqual(["F-2", "F-1"]);
  });

  it("throws for unknown view", () => {
    expect(() => listTasks({ tasks, options: { view: "bogus" }, queriesConfig, workflowConfig: config }))
      .toThrow(/unknown view/i);
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

    it("includes archived tasks when archivedScope='all'", () => {
      const result = listTasks({ tasks: archivedTasks, options: { archivedScope: "all" } });
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["T-1", "T-2", "T-3"]);
    });

    it("shows ONLY archived tasks when archivedScope='archived' (K107)", () => {
      const result = listTasks({ tasks: archivedTasks, options: { archivedScope: "archived" } });
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["T-2", "T-3"]);
    });

    it("respects an explicit archived filter in user query", () => {
      const result = listTasks({ tasks: archivedTasks, options: { query: "archived = true" } });
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["T-2", "T-3"]);
    });

    // K102 BEHAVIOUR CHANGE: pre-K102, running a saved view EXEMPTED the
    // call from archived scoping entirely — "views respected as
    // authored", because a view's stored `query` string could only
    // express scope as an `archived != true` filter term, which the
    // seed deliberately did not include. Under K102 a view stores its
    // scope as its OWN `archivedScope` field, not a filter term, so
    // running a view is no longer exempt — it resolves to that field
    // (defaulting to "active") exactly like an ad hoc call. This test
    // used to assert the OLD exemption (that the archived not_started
    // task leaked through); it now asserts the NEW default-active rule.
    it("defaults an unscoped view to archivedScope 'active' (no exemption) — K102 changed this", () => {
      const viewConfig: QueriesConfig = {
        queries: [view({ id: "01HSV0000000000000VIEW", name: "all-not-started", field: "status", op: "=", values: ["not_started"] })],
      };
      const result = listTasks({
        tasks: archivedTasks,
        options: { view: "all-not-started" },
        queriesConfig: viewConfig,
        workflowConfig: config,
      });
      // Archived T-2 is now hidden by the view's default "active" scope.
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["T-1"]);
    });

    it("a view's own archivedScope field is honoured when the caller does not override it", () => {
      const viewConfig: QueriesConfig = {
        queries: [
          view({
            id: "01HSV0000000000000VIEWALL",
            name: "all-not-started-scoped-all",
            field: "status", op: "=", values: ["not_started"],
            archivedScope: "all",
          }),
        ],
      };
      const result = listTasks({
        tasks: archivedTasks,
        options: { view: "all-not-started-scoped-all" },
        queriesConfig: viewConfig,
        workflowConfig: config,
      });
      // The view's own scope ("all") is applied, so the archived
      // not_started task is included.
      expect(result.map(t => t.frontmatter.key).sort()).toEqual(["T-1", "T-2"]);
    });

    it("an explicit caller archivedScope overrides the view's own scope", () => {
      const viewConfig: QueriesConfig = {
        queries: [
          view({
            id: "01HSV0000000000000VIEWACTIVE",
            name: "not-started-active",
            field: "status", op: "=", values: ["not_started"],
            archivedScope: "active",
          }),
        ],
      };
      const result = listTasks({
        tasks: archivedTasks,
        options: { view: "not-started-active", archivedScope: "all" },
        queriesConfig: viewConfig,
        workflowConfig: config,
      });
      // Caller's explicit "all" wins over the view's own "active".
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
        options: { project: "web", archivedScope: "all" },
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
        queries: [view({ id: "01HSV0000000000000ALLOPEN", name: "all-open", field: "status", op: "!=", values: ["done"] })],
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
      queries: [advancedView({
        id: "01HSV0000000000000STALE",
        name: "stale",
        query: "fields.deleted_field = x",
      })],
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
    queries: [advancedView({
      id: "01HSV0000000000000STALE2",
      name: "stale",
      query: "fields.deleted_field = x",
    })],
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

  // K102 BEHAVIOUR CHANGE: pre-K102, an ad-hoc `--query` REPLACED a
  // named view's query when both were present. Now the view's composed
  // filters and the ad-hoc query are ANDed together — both must match.
  it("ANDs the view's filters with an ad-hoc query rather than replacing them", () => {
    const viewConfig: QueriesConfig = {
      queries: [view({
        id: "01HSV0000000000000ANDVIEW",
        name: "not-done",
        field: "status", op: "!=", values: ["done"],
      })],
    };
    // View alone (status != done) matches T-1, T-2, T-4. Adding an
    // ad-hoc query for priority = high must narrow it further, not
    // replace the view's own predicate outright.
    const result = listTasks({
      tasks,
      options: { view: "not-done", query: "priority = high" },
      queriesConfig: viewConfig,
      workflowConfig: config,
    });
    expect(result.map(t => t.frontmatter.key)).toEqual(["T-2"]);
  });

  it("an ad-hoc query that contradicts the view's filters matches nothing (proves AND, not replace)", () => {
    // If the ad-hoc query REPLACED the view (the old behaviour), this
    // would return T-3 (the only status = done task). Under AND, the
    // view's own `status != done` rules T-3 out too, so nothing matches.
    const viewConfig: QueriesConfig = {
      queries: [view({
        id: "01HSV0000000000000ANDVIEW2",
        name: "not-done-2",
        field: "status", op: "!=", values: ["done"],
      })],
    };
    const result = listTasks({
      tasks,
      options: { view: "not-done-2", query: "status = done" },
      queriesConfig: viewConfig,
      workflowConfig: config,
    });
    expect(result).toEqual([]);
  });
});

describe("buildListContext", () => {
  function mk(id: string, key: string, title: string, body: string): Task {
    return {
      frontmatter: {
        id, key, title,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      } as Task["frontmatter"],
      body,
    };
  }

  it("supplies getBody so `text ~` reaches the body", () => {
    // Body search was documented and implemented in the evaluator, but
    // no caller ever supplied getBody — so it matched nothing on every
    // surface. The bodies are already on the tasks being listed.
    const tasks = [
      mk("a", "T-1", "nothing", "the body mentions a pelican"),
      mk("b", "T-2", "nothing either", "no birds here"),
    ];
    const result = listTasks({
      tasks,
      options: { query: 'text ~ "pelican"' },
      ctx: buildListContext(tasks),
    });
    expect(result.map(t => t.frontmatter.key)).toEqual(["T-1"]);
  });

  it("still resolves ids to keys", () => {
    const tasks = [mk("a", "T-1", "x", "")];
    expect(buildListContext(tasks).resolveKey?.("a")).toBe("T-1");
    expect(buildListContext(tasks).resolveKey?.("nope")).toBeUndefined();
  });
});

describe("SET-8: custom enum fields sort by configured value weights", () => {
  const weighted: WorkflowConfig = {
    ...config,
    custom_fields: [
      {
        key: "size",
        label: "Size",
        type: "enum",
        multi: false,
        searchable: false,
        // Deliberately NOT in alphabetical order of key, and the weights
        // invert the alphabetical order (xs<s<m<l alphabetically is
        // l,m,s,xs; by weight it is xs,s,m,l) so a passing test cannot be
        // alphabetical by accident.
        values: [
          { key: "xs", label: "XS", value: 1 },
          { key: "s", label: "S", value: 2 },
          { key: "m", label: "M", value: 3 },
          { key: "l", label: "L", value: 5 },
        ],
      },
      // A second enum with NO weights, to prove the fallback.
      {
        key: "colour",
        label: "Colour",
        type: "enum",
        multi: false,
        searchable: false,
        values: [
          { key: "red", label: "Red" },
          { key: "blue", label: "Blue" },
        ],
      },
    ],
  };

  const sized: Task[] = [
    makeTask("W-1", { fields: { size: "l" } }),
    makeTask("W-2", { fields: { size: "xs" } }),
    makeTask("W-3", { fields: { size: "m" } }),
    makeTask("W-4", { fields: { size: "s" } }),
  ];

  it("orders by weight ascending, not alphabetically by value key", () => {
    const result = listTasks({
      tasks: sized,
      options: { sort: [{ field: "fields.size", direction: "asc" }] },
      workflowConfig: weighted,
    });
    // Weight order xs(1) < s(2) < m(3) < l(5). Alphabetical by key would
    // be l, m, s, xs — the opposite of the front of this list.
    expect(result.map(t => t.frontmatter.fields?.["size"]))
      .toEqual(["xs", "s", "m", "l"]);
  });

  it("orders by weight descending too", () => {
    const result = listTasks({
      tasks: sized,
      options: { sort: [{ field: "fields.size", direction: "desc" }] },
      workflowConfig: weighted,
    });
    expect(result.map(t => t.frontmatter.fields?.["size"]))
      .toEqual(["l", "m", "s", "xs"]);
  });

  it("falls back to alphabetical when the enum has no weights", () => {
    const coloured: Task[] = [
      makeTask("C-1", { fields: { colour: "red" } }),
      makeTask("C-2", { fields: { colour: "blue" } }),
    ];
    const result = listTasks({
      tasks: coloured,
      options: { sort: [{ field: "fields.colour", direction: "asc" }] },
      workflowConfig: weighted,
    });
    // No weights → alphabetical: blue before red.
    expect(result.map(t => t.frontmatter.fields?.["colour"]))
      .toEqual(["blue", "red"]);
  });
});

// @verifies K80
describe("listTasks — date functions (K80)", () => {
  // Fixed clock: this week is Mon 2026-06-15 … Sun 2026-06-21 (Monday start).
  const clock = { today: "2026-06-15", now: "2026-06-15T09:00:00Z", weekStartsOn: 1 };
  const dated: Task[] = [
    makeTask("D-1", { due_date: "2026-06-17" }),               // this week
    makeTask("D-2", { due_date: "2026-06-21" }),               // Sunday, still this week
    makeTask("D-3", { due_date: "2026-06-22" }),               // next week
    makeTask("D-4", { due_date: "2026-06-10" }),               // last week
  ];

  it("filters 'due this week' against the injected clock and week start", () => {
    const result = listTasks({
      tasks: dated,
      options: {
        query: "due_date >= startOfWeek() and due_date <= endOfWeek()",
        ...clock,
      },
    });
    expect(result.map(t => t.frontmatter.key).sort()).toEqual(["D-1", "D-2"]);
  });

  it("a Sunday week start pulls the prior Sunday into the week", () => {
    const sundayStart = { ...clock, weekStartsOn: 0 };
    const result = listTasks({
      tasks: [...dated, makeTask("D-5", { due_date: "2026-06-14" })], // Sunday
      options: {
        query: "due_date >= startOfWeek() and due_date <= endOfWeek()",
        ...sundayStart,
      },
    });
    // With a Sunday start the week is 14th–20th: D-5 (14) and D-1 (17) are in,
    // D-2 (Sun 21) is now next week's start.
    expect(result.map(t => t.frontmatter.key).sort()).toEqual(["D-1", "D-5"]);
  });
});
