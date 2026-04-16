import { describe, it, expect } from "vitest";
import { evaluateQuery } from "./evaluator.js";
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
