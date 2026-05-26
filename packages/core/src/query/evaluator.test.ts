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

describe("relationship-based query filtering", () => {
  it("filters by relationship type and target", () => {
    expect(evaluateQuery(query("relationship.blocks = blocked_id"), task)).toBe(true);
    expect(evaluateQuery(query("relationship.blocks = other"), task)).toBe(false);
  });

  it("handles != for relationships", () => {
    expect(evaluateQuery(query("relationship.blocks != other"), task)).toBe(true);
  });

  it("handles missing relationship type", () => {
    expect(evaluateQuery(query("relationship.depends_on = x"), task)).toBe(false);
    expect(evaluateQuery(query("relationship.depends_on != x"), task)).toBe(true);
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
