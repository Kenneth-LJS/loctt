import type { TaskFrontmatter } from "@loctt/contracts";
import { describe, expect,it } from "vitest";

import type { EvalContext } from "./evaluator.js";
import { evaluateQuery } from "./evaluator.js";
import { parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";

function query(input: string) {
  return parseQuery(tokenize(input));
}

const task: TaskFrontmatter = {
  id: "abc",
  key: "T-1",
  title: "Test task for evaluation",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-04-16T14:30:00Z",
  status: "in_progress",
  priority: "high",
  task_type: "task",
  archived: false,
  relationships: [
    { type: "parent", target: "parent_id" },
    { type: "blocks", target: "blocked_id" },
  ],
  fields: { sprint: "sprint_2", owner_team: "platform" },
};

describe("evaluateQuery", () => {
  it("matches equality comparison", () => {
    expect(evaluateQuery(query("status = in_progress"), task)).toBe(true);
    expect(evaluateQuery(query("status = done"), task)).toBe(false);
  });

  it("matches inequality comparison", () => {
    expect(evaluateQuery(query("status != done"), task)).toBe(true);
    expect(evaluateQuery(query("status != in_progress"), task)).toBe(false);
  });

  it("matches contains (~) comparison", () => {
    expect(evaluateQuery(query('title ~ "evaluation"'), task)).toBe(true);
    expect(evaluateQuery(query('title ~ "nonexistent"'), task)).toBe(false);
  });

  it("matches boolean values", () => {
    expect(evaluateQuery(query("archived = false"), task)).toBe(true);
    expect(evaluateQuery(query("archived != true"), task)).toBe(true);
  });

  it("handles undefined fields with != as true", () => {
    expect(evaluateQuery(query("milestone != something"), task)).toBe(true);
  });

  it("handles undefined fields with = as false", () => {
    expect(evaluateQuery(query("milestone = something"), task)).toBe(false);
  });

  it("evaluates AND", () => {
    expect(evaluateQuery(query("status = in_progress and priority = high"), task)).toBe(true);
    expect(evaluateQuery(query("status = in_progress and priority = low"), task)).toBe(false);
  });

  it("evaluates OR", () => {
    expect(evaluateQuery(query("status = done or priority = high"), task)).toBe(true);
    expect(evaluateQuery(query("status = done or priority = low"), task)).toBe(false);
  });

  it("evaluates NOT", () => {
    expect(evaluateQuery(query("not status = done"), task)).toBe(true);
    expect(evaluateQuery(query("not status = in_progress"), task)).toBe(false);
  });

  it("evaluates IN", () => {
    expect(evaluateQuery(query("status in (in_progress, done)"), task)).toBe(true);
    expect(evaluateQuery(query("status in (done, blocked)"), task)).toBe(false);
  });

  it("evaluates NOT IN", () => {
    expect(evaluateQuery(query("status not in (done, blocked)"), task)).toBe(true);
    expect(evaluateQuery(query("status not in (in_progress, done)"), task)).toBe(false);
  });

  it("evaluates custom fields", () => {
    expect(evaluateQuery(query("sprint = sprint_2"), task)).toBe(true);
    expect(evaluateQuery(query("owner_team = platform"), task)).toBe(true);
    expect(evaluateQuery(query("sprint = sprint_1"), task)).toBe(false);
  });

  it("evaluates complex canonical query: archived != true and status != done", () => {
    expect(evaluateQuery(query("archived != true and status != done"), task)).toBe(true);
  });

  it("evaluates parenthesized expressions", () => {
    expect(evaluateQuery(query("(status = done or status = in_progress) and priority = high"), task)).toBe(true);
    expect(evaluateQuery(query("(status = done or status = blocked) and priority = high"), task)).toBe(false);
  });

  it("handles comparison operators for dates (string comparison)", () => {
    expect(evaluateQuery(query("updated_at > 2026-01-01"), task)).toBe(true);
    expect(evaluateQuery(query("created_at < 2027-01-01"), task)).toBe(true);
  });

  it("uses numeric comparison for ordering operators when both sides are numbers", () => {
    const numTask: TaskFrontmatter = {
      ...task,
      fields: { estimate: 9 },
    };
    // String comparison would give "9" > "10" = true, but numeric gives 9 < 10
    expect(evaluateQuery(query("estimate < 10"), numTask)).toBe(true);
    expect(evaluateQuery(query("estimate > 10"), numTask)).toBe(false);
    expect(evaluateQuery(query("estimate >= 9"), numTask)).toBe(true);
    expect(evaluateQuery(query("estimate <= 9"), numTask)).toBe(true);
  });

  it("undefined field with in returns false, not in returns true", () => {
    expect(evaluateQuery(query("milestone in (v1, v2)"), task)).toBe(false);
    expect(evaluateQuery(query("milestone not in (v1, v2)"), task)).toBe(true);
  });
});

describe("text alias", () => {
  it("searches title with ~", () => {
    expect(evaluateQuery(query('text ~ "evaluation"'), task)).toBe(true);
    expect(evaluateQuery(query('text ~ "nonexistent"'), task)).toBe(false);
  });

  it("searches key", () => {
    expect(evaluateQuery(query('text ~ "T-1"'), task)).toBe(true);
  });

  it("searches body when context provided", () => {
    const ctx: EvalContext = { body: "Contains important details about the feature." };
    expect(evaluateQuery(query('text ~ "important"'), task, ctx)).toBe(true);
    expect(evaluateQuery(query('text ~ "missing"'), task, ctx)).toBe(false);
  });

  it("searches custom fields", () => {
    expect(evaluateQuery(query('text ~ "platform"'), task)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(evaluateQuery(query('text ~ "EVALUATION"'), task)).toBe(true);
  });
});

describe("parent alias", () => {
  it("matches parent by ID when no resolveKey", () => {
    expect(evaluateQuery(query("parent = parent_id"), task)).toBe(true);
    expect(evaluateQuery(query("parent = other_id"), task)).toBe(false);
  });

  it("matches parent by key when resolveKey provided", () => {
    const ctx: EvalContext = {
      resolveKey: (id) => id === "parent_id" ? "T-5" : undefined,
    };
    expect(evaluateQuery(query("parent = T-5"), task, ctx)).toBe(true);
    expect(evaluateQuery(query("parent = T-99"), task, ctx)).toBe(false);
  });

  it("handles task with no parent", () => {
    const noParent: TaskFrontmatter = { ...task, relationships: [] };
    expect(evaluateQuery(query("parent = T-5"), noParent)).toBe(false);
    expect(evaluateQuery(query("parent != T-5"), noParent)).toBe(true);
  });
});

describe("array-valued field comparison (labels)", () => {
  const labeled: TaskFrontmatter = {
    id: "lab",
    key: "T-9",
    title: "Has labels",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: "in_progress",
    labels: ["bug", "ui"],
  };
  const unlabeled: TaskFrontmatter = { ...labeled, labels: undefined };

  it("= matches when the value is in the array", () => {
    expect(evaluateQuery(query("labels = bug"), labeled)).toBe(true);
    expect(evaluateQuery(query("labels = backend"), labeled)).toBe(false);
  });

  it("!= matches when the value is NOT in the array", () => {
    expect(evaluateQuery(query("labels != bug"), labeled)).toBe(false);
    expect(evaluateQuery(query("labels != backend"), labeled)).toBe(true);
  });

  it("~ matches case-insensitive substring against any element", () => {
    expect(evaluateQuery(query("labels ~ U"), labeled)).toBe(true); // matches 'ui'
    expect(evaluateQuery(query("labels ~ zzz"), labeled)).toBe(false);
  });

  it("in / not in evaluate set intersection with the array", () => {
    expect(evaluateQuery(query("labels in (bug, frontend)"), labeled)).toBe(true);
    expect(evaluateQuery(query("labels in (frontend, backend)"), labeled)).toBe(false);
    expect(evaluateQuery(query("labels not in (frontend, backend)"), labeled)).toBe(true);
    expect(evaluateQuery(query("labels not in (bug)"), labeled)).toBe(false);
  });

  it("empty / unset labels behaves as no match for =, match for !=", () => {
    expect(evaluateQuery(query("labels = bug"), unlabeled)).toBe(false);
    expect(evaluateQuery(query("labels != bug"), unlabeled)).toBe(true);
  });
});

describe("has_link / link_count", () => {
  it("has_link(kind) tests existence of that kind", () => {
    expect(evaluateQuery(query('has_link("blocks")'), task)).toBe(true);
    expect(evaluateQuery(query('has_link("parent")'), task)).toBe(true);
    expect(evaluateQuery(query('has_link("depends_on")'), task)).toBe(false);
  });

  it("has_link() with no args tests for any link at all", () => {
    expect(evaluateQuery(query("has_link()"), task)).toBe(true);
    const orphan: TaskFrontmatter = { ...task, relationships: [] };
    expect(evaluateQuery(query("has_link()"), orphan)).toBe(false);
    expect(evaluateQuery(query("not has_link()"), orphan)).toBe(true);
  });

  it("has_link(kind, target) matches a single edge on both", () => {
    expect(evaluateQuery(query('has_link("blocks", "blocked_id")'), task)).toBe(true);
    expect(evaluateQuery(query('has_link("blocks", "other")'), task)).toBe(false);
  });

  it("the same-edge trap is not expressible", () => {
    // THE defect this syntax replaces. The task blocks `blocked_id` and
    // has parent `parent_id`. Under the old grammar,
    //   relationship.type = blocks and relationship.target = parent_id
    // matched — two independent existential filters satisfied by two
    // DIFFERENT edges — while reading as "blocks parent_id", which is
    // false. has_link takes both in one call, so one edge must satisfy
    // both and the false reading cannot be written.
    expect(evaluateQuery(query('has_link("blocks", "parent_id")'), task)).toBe(false);
    expect(evaluateQuery(query('has_link("parent", "parent_id")'), task)).toBe(true);
  });

  it("negation means no edge matches, not some edge differs", () => {
    // Under the old Form A, `!=` meant "some edge differs", so a task
    // with two edges satisfied almost any inequality.
    expect(evaluateQuery(query('not has_link("blocks", "other")'), task)).toBe(true);
    expect(evaluateQuery(query('not has_link("blocks", "blocked_id")'), task)).toBe(false);
  });

  it("resolves a target by current key, not only stored id", () => {
    // The old Form A compared the raw ULID and never called
    // resolveKey, so the documented example could not match any task.
    const ctx: EvalContext = {
      resolveKey: (id: string) => (id === "blocked_id" ? "T-10" : undefined),
    };
    expect(evaluateQuery(query('has_link("blocks", "T-10")'), task, ctx)).toBe(true);
    expect(evaluateQuery(query('has_link("blocks", "T-99")'), task, ctx)).toBe(false);
  });

  it("link_count counts edges of a kind", () => {
    const many: TaskFrontmatter = {
      ...task,
      relationships: [
        { type: "child", target: "a" },
        { type: "child", target: "b" },
        { type: "child", target: "c" },
        { type: "blocks", target: "d" },
      ],
    };
    expect(evaluateQuery(query('link_count("child") > 2'), many)).toBe(true);
    expect(evaluateQuery(query('link_count("child") > 3'), many)).toBe(false);
    expect(evaluateQuery(query('link_count("child") = 3'), many)).toBe(true);
    expect(evaluateQuery(query('link_count("blocks") = 1'), many)).toBe(true);
  });

  it("link_count with no kind counts every edge", () => {
    expect(evaluateQuery(query("link_count() = 2"), task)).toBe(true);
  });

  it("link_count is 0 for an absent kind", () => {
    expect(evaluateQuery(query('link_count("depends_on") = 0'), task)).toBe(true);
  });

  it("the old relationship.* grammar errors with a message naming the new form", () => {
    // A hard break: silently matching nothing would be worse than an
    // error, since the old spelling is in saved views and scripts.
    expect(() => evaluateQuery(query("relationship.blocks = blocked_id"), task))
      .toThrow(/has_link/);
    expect(() => evaluateQuery(query("relationship.type = blocks"), task))
      .toThrow(/no longer supported/);
  });
});

describe("nested field access (CW-9)", () => {
  const workflow = {
    statuses: [
      { key: "in_progress", label: "In progress", category: "in_progress" },
      { key: "done", label: "Done", category: "completed" },
    ],
    priorities: [
      { key: "high", label: "High", weight: 1 },
      { key: "low", label: "Low", weight: 3 },
    ],
    task_types: [{ key: "task", label: "Task" }],
    relationships: [],
    custom_fields: [],
  } as unknown as Parameters<typeof evaluateQuery>[2] extends infer C
    ? C extends { workflow?: infer W }
      ? W
      : never
    : never;
  const ctx: EvalContext = { workflow };

  it("status.category resolves through workflow", () => {
    expect(evaluateQuery(query("status.category = in_progress"), task, ctx)).toBe(true);
    expect(evaluateQuery(query("status.category = completed"), task, ctx)).toBe(false);
    const done: TaskFrontmatter = { ...task, status: "done" };
    expect(evaluateQuery(query("status.category = completed"), done, ctx)).toBe(true);
  });

  it("priority.weight supports numeric ordering", () => {
    expect(evaluateQuery(query("priority.weight < 2"), task, ctx)).toBe(true);
    expect(evaluateQuery(query("priority.weight > 2"), task, ctx)).toBe(false);
  });

  it("returns undefined-shaped result (no match) when workflow context is absent", () => {
    expect(evaluateQuery(query("status.category = in_progress"), task)).toBe(false);
    expect(evaluateQuery(query("status.category != in_progress"), task)).toBe(true);
  });

  it("nested access on unknown status key yields no match", () => {
    const weird: TaskFrontmatter = { ...task, status: "ghost" };
    expect(evaluateQuery(query("status.category = in_progress"), weird, ctx)).toBe(false);
  });
});

/**
 * Direction and edge-shape behaviour of has_link. Both directions of a
 * link are queryable as plain predicates because `linkTask` writes the
 * forward edge on A and the inverse on B — "what blocks T-2" is a
 * forward lookup on the inverse key, which in Jira needs ScriptRunner.
 */
describe("has_link — directions and edge shapes", () => {
  const relCtx = { resolveKey: (id: string) => (id === "01BBB" ? "T-10" : undefined) };

  function relFm(rels: { type: string; target: string }[]): TaskFrontmatter {
    return {
      id: "01AAA", key: "T-1", title: "t",
      created_at: "2026-01-01", updated_at: "2026-01-01",
      relationships: rels,
    } as TaskFrontmatter;
  }

  it("queries the inverse direction as a plain predicate", () => {
    // The stored inverse edge on the target task.
    const fm = relFm([{ type: "is_blocked_by", target: "01BBB" }]);
    expect(evaluateQuery(query('has_link("is_blocked_by")'), fm, relCtx)).toBe(true);
    expect(evaluateQuery(query('has_link("is_blocked_by", "T-10")'), fm, relCtx)).toBe(true);
    expect(evaluateQuery(query('has_link("blocks")'), fm, relCtx)).toBe(false);
  });

  it("matches a target by stored id as well as current key", () => {
    const fm = relFm([{ type: "blocks", target: "01BBB" }]);
    expect(evaluateQuery(query('has_link("blocks", "01BBB")'), fm, relCtx)).toBe(true);
    expect(evaluateQuery(query('has_link("blocks", "T-10")'), fm, relCtx)).toBe(true);
  });

  it("distinguishes several edges of the same kind", () => {
    const fm = relFm([
      { type: "blocks", target: "x" },
      { type: "blocks", target: "y" },
    ]);
    expect(evaluateQuery(query('has_link("blocks", "x")'), fm)).toBe(true);
    expect(evaluateQuery(query('has_link("blocks", "y")'), fm)).toBe(true);
    expect(evaluateQuery(query('has_link("blocks", "z")'), fm)).toBe(false);
    expect(evaluateQuery(query('link_count("blocks") = 2'), fm)).toBe(true);
  });

  it("a task with no edges matches only negations", () => {
    const fm = relFm([]);
    expect(evaluateQuery(query('has_link("blocks")'), fm)).toBe(false);
    expect(evaluateQuery(query('not has_link("blocks")'), fm)).toBe(true);
    expect(evaluateQuery(query("not has_link()"), fm)).toBe(true);
    expect(evaluateQuery(query('link_count("blocks") = 0'), fm)).toBe(true);
  });

  it("composes with and / or / not like any other predicate", () => {
    const fm = relFm([
      { type: "blocks", target: "x" },
      { type: "parent", target: "p" },
    ]);
    expect(evaluateQuery(query('has_link("blocks") and has_link("parent")'), fm)).toBe(true);
    expect(evaluateQuery(query('has_link("blocks") and has_link("clones")'), fm)).toBe(false);
    expect(evaluateQuery(query('has_link("clones") or has_link("parent")'), fm)).toBe(true);
    expect(evaluateQuery(query('not has_link("clones")'), fm)).toBe(true);
  });

  it("a kind named like a grammar word is queryable", () => {
    // Kind names sit in quoted value position, so a workspace may name
    // a relationship `type`, `target` or `count` without colliding.
    // This is the main reason the function form beat a field form.
    const fm = relFm([{ type: "type", target: "x" }, { type: "count", target: "y" }]);
    expect(evaluateQuery(query('has_link("type")'), fm)).toBe(true);
    expect(evaluateQuery(query('has_link("count", "y")'), fm)).toBe(true);
    expect(evaluateQuery(query('has_link("target")'), fm)).toBe(false);
  });
});

describe("parent alias reads the configured hierarchy kind", () => {
  function fm(rels: { type: string; target: string }[]): TaskFrontmatter {
    return {
      id: "01AAA", key: "T-1", title: "t",
      created_at: "2026-01-01", updated_at: "2026-01-01",
      relationships: rels,
    } as TaskFrontmatter;
  }

  const wfWith = (key: string, graph: "tree" | "none") => ({
    key: { prefix: "T" },
    statuses: [], priorities: [], task_types: [],
    relationships: [{ key, label: key, inverse: `${key}_of`, inverse_label: "x", graph }],
    custom_fields: [],
  } as unknown as NonNullable<EvalContext["workflow"]>);

  it("follows a renamed hierarchy relationship", () => {
    // Hardcoding the literal "parent" meant a workspace that renamed
    // its hierarchy kind saw the alias silently stop matching while
    // still passing validation.
    const task = fm([{ type: "belongs_to", target: "T-5" }]);
    const ctx: EvalContext = { workflow: wfWith("belongs_to", "tree") };
    expect(evaluateQuery(query("parent = T-5"), task, ctx)).toBe(true);
  });

  it("falls back to the literal kind with no tree relationship configured", () => {
    const task = fm([{ type: "parent", target: "T-5" }]);
    expect(evaluateQuery(query("parent = T-5"), task)).toBe(true);
    expect(evaluateQuery(query("parent = T-9"), task)).toBe(false);
  });
});

describe("text ~ honours `searchable`", () => {
  function wf(searchable: boolean): NonNullable<EvalContext["workflow"]> {
    return {
      key: { prefix: "T" },
      statuses: [], priorities: [], task_types: [], relationships: [],
      custom_fields: [
        { key: "notes", label: "Notes", type: "string", multi: false, searchable },
      ],
    } as unknown as NonNullable<EvalContext["workflow"]>;
  }

  const fm = {
    id: "a", key: "T-1", title: "nothing in the title",
    created_at: "2026-01-01", updated_at: "2026-01-01",
    fields: { notes: "needle" },
  } as TaskFrontmatter;

  it("matches a custom field declared searchable", () => {
    expect(evaluateQuery(query('text ~ needle'), fm, { workflow: wf(true) })).toBe(true);
  });

  it("does NOT match a custom field declared searchable: false", () => {
    // `searchable` is required on every custom-field definition and the
    // docs promise `text` honours it, but every string-valued custom
    // field was searched regardless — so a field the user deliberately
    // excluded still matched. That is a leak, not just a wrong result.
    expect(evaluateQuery(query('text ~ needle'), fm, { workflow: wf(false) })).toBe(false);
  });

  it("searches every string custom field when no workflow config is given", () => {
    // Deliberate asymmetry: with no config there is nothing to check
    // `searchable` against. Every production path reaches the evaluator
    // through listTasks, which passes the loaded config, so this
    // permissive branch is confined to hand-built contexts — failing
    // closed here would weaken `text ~` for callers that simply have no
    // config to consult, without protecting any real workspace.
    expect(evaluateQuery(query('text ~ needle'), fm)).toBe(true);
  });

  it("still searches the title regardless of custom-field config", () => {
    const titled = { ...fm, title: "has a needle" } as TaskFrontmatter;
    expect(evaluateQuery(query('text ~ needle'), titled, { workflow: wf(false) })).toBe(true);
  });
});

describe("evaluateQuery — date fields compare by calendar day (Q1)", () => {
  // A `due_date` may store a full ISO timestamp (`DateOrIsoString` and the
  // MCP `DateLikeString` both permit it, and `setField` writes it
  // verbatim). Comparing it lexicographically against a date-only operand
  // sorts the longer timestamp after the bare date, so a task due *today*
  // at 09:00 was judged strictly greater than `today` — never equal, never
  // `<=`. The evaluator must treat such a value as its calendar day.
  const dueAt9amToday = {
    id: "a", key: "T-1", title: "timestamped due date",
    created_at: "2026-06-01", updated_at: "2026-06-01",
    due_date: "2026-06-01T09:00:00Z",
  } as TaskFrontmatter;

  const ctx: EvalContext = { today: "2026-06-01" };

  it("treats a timestamped due_date as due today for the equal-day boundary", () => {
    expect(evaluateQuery(query("due_date <= today"), dueAt9amToday, ctx)).toBe(true);
    expect(evaluateQuery(query("due_date = today"), dueAt9amToday, ctx)).toBe(true);
    expect(evaluateQuery(query("due_date >= today"), dueAt9amToday, ctx)).toBe(true);
    expect(evaluateQuery(query("due_date in (today)"), dueAt9amToday, ctx)).toBe(true);
  });

  it("does not count a task due today as in the future", () => {
    expect(evaluateQuery(query("due_date > today"), dueAt9amToday, ctx)).toBe(false);
  });

  it("keeps overdue (< today) correct for a timestamped value", () => {
    // Was already correct lexicographically; must stay correct.
    expect(evaluateQuery(query("due_date < today"), dueAt9amToday, ctx)).toBe(false);
    const overdue = { ...dueAt9amToday, due_date: "2026-05-31T23:00:00Z" } as TaskFrontmatter;
    expect(evaluateQuery(query("due_date < today"), overdue, ctx)).toBe(true);
  });

  it("compares against a plain date literal by day too", () => {
    expect(evaluateQuery(query("due_date <= 2026-06-01"), dueAt9amToday, ctx)).toBe(true);
    expect(evaluateQuery(query("due_date > 2026-06-01"), dueAt9amToday, ctx)).toBe(false);
  });

  it("leaves date-only-vs-date-only comparisons unchanged", () => {
    const dateOnly = { ...dueAt9amToday, due_date: "2026-06-01" } as TaskFrontmatter;
    expect(evaluateQuery(query("due_date = today"), dateOnly, ctx)).toBe(true);
    expect(evaluateQuery(query("due_date <= today"), dateOnly, ctx)).toBe(true);
    expect(evaluateQuery(query("due_date > today"), dateOnly, ctx)).toBe(false);
    expect(evaluateQuery(query("due_date < 2026-06-02"), dateOnly, ctx)).toBe(true);
  });
});

/**
 * K77: `is empty` / `is not empty` — the presence test that replaces the
 * broken `field != null` (which matched everything). The fixture `task`
 * has `status`/`priority` set and no `milestone`/`assignee`/`labels`.
 *
 * @verifies A80
 */
describe("is empty / is not empty (K77)", () => {
  it("`is empty` matches an unset field, `is not empty` a set one", () => {
    expect(evaluateQuery(query("milestone is empty"), task)).toBe(true);
    expect(evaluateQuery(query("milestone is not empty"), task)).toBe(false);
    expect(evaluateQuery(query("status is not empty"), task)).toBe(true);
    expect(evaluateQuery(query("status is empty"), task)).toBe(false);
  });

  it("treats an empty array (no labels) as empty", () => {
    expect(evaluateQuery(query("labels is empty"), task)).toBe(true);
    expect(evaluateQuery(query("labels is not empty"), { ...task, labels: ["bug"] })).toBe(true);
    expect(evaluateQuery(query("labels is empty"), { ...task, labels: ["bug"] })).toBe(false);
  });

  it("composes with and/or like any other comparison", () => {
    expect(evaluateQuery(query("status is not empty and milestone is empty"), task)).toBe(true);
    expect(evaluateQuery(query("milestone is not empty or status is not empty"), task)).toBe(true);
  });

  it("rejects `= null` / `!= null` with a pointer to `is empty` (the old silent-match bug)", () => {
    expect(() => query("milestone = null")).toThrow(/is empty/);
    expect(() => query("milestone != null")).toThrow(/is not empty/);
    expect(() => query("milestone = none")).toThrow(/is empty/);
  });

  it("rejects a bare `is` that isn't followed by empty/not empty", () => {
    expect(() => query("milestone is something")).toThrow(/empty/);
  });
});
