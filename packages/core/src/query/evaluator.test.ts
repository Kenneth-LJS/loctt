import { describe, it, expect } from "vitest";
import { evaluateQuery } from "./evaluator.js";
import type { EvalContext } from "./evaluator.js";
import { parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";
import type { TaskFrontmatter } from "@loctt/contracts";

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
