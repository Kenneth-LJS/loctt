import type { WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { parseQuery } from "./parser.js";
import { tokenize } from "./tokenizer.js";
import { QueryValidationError, validateQuery } from "./validate.js";

const workflow: WorkflowConfig = {
  key: { prefix: "T-" },
  statuses: [
    { key: "backlog", label: "Backlog", category: "pending" },
    { key: "in_progress", label: "In progress", category: "active" },
    { key: "done", label: "Done", category: "completed" },
  ],
  priorities: [
    { key: "low", label: "Low", value: 1 },
    { key: "high", label: "High", value: 2 },
  ],
  task_types: [
    { key: "task", label: "Task" },
    { key: "bug", label: "Bug" },
  ],
  relationships: [
    { key: "blocks", label: "Blocks", inverse: "blocked_by", inverse_label: "Blocked by" },
  ],
  custom_fields: [
    { key: "impact", label: "Impact", type: "enum", multi: false, searchable: false,
      values: [{ key: "low", label: "Low" }, { key: "high", label: "High" }] },
    { key: "component", label: "Component", type: "string", multi: false, searchable: true },
  ],
};

const q = (s: string) => parseQuery(tokenize(s));

/** Asserts the query throws, and returns the error for further checks. */
function expectInvalid(query: string, opts = { workflow }): QueryValidationError {
  let caught: unknown;
  try {
    validateQuery(q(query), opts);
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(QueryValidationError);
  return caught as QueryValidationError;
}

describe("validateQuery — the four cases that must stay distinguishable", () => {
  // The bug: `stat = done` returned zero tasks, indistinguishable from
  // a correct query matching nothing. Case 1 of 4.
  it("rejects an unknown top-level field and suggests the near miss", () => {
    const err = expectInvalid("stat = done");
    expect(err.message).toContain('unknown field "stat"');
    expect(err.suggestions).toContain("status");
  });

  it("rejects an unknown fields.<key> custom field", () => {
    const err = expectInvalid("fields.imapct = high");
    expect(err.message).toContain('unknown custom field "imapct"');
    expect(err.suggestions).toContain("impact");
  });

  it("rejects a known field with an unknown enum value", () => {
    const err = expectInvalid("status = frobnik");
    expect(err.message).toContain('unknown status value "frobnik"');
  });

  // Case 4: this is NOT an error. A well-formed query that legitimately
  // matches nothing has to stay distinguishable from the three above.
  it("accepts a well-formed query that will match nothing", () => {
    expect(() => validateQuery(q("status = done and priority = high"), { workflow })).not.toThrow();
  });
});

describe("validateQuery — valid queries pass", () => {
  it.each([
    "status = done",
    "priority in (low, high)",
    "task_type = bug",
    "assignee = u_ken",
    "labels = urgent",
    "due_date < today",
    'text ~ "auth bug"',
    "parent = T-5",
    "archived = true",
    "fields.impact = high",
    "fields.component ~ api",
    "status.category = completed",
    "priority.value > 1",
    "relationship.blocks = T-9",
    "not (status = done)",
    "status = done or (priority = high and task_type = bug)",
  ])("accepts %s", query => {
    expect(() => validateQuery(q(query), { workflow })).not.toThrow();
  });
});

describe("validateQuery — error positions", () => {
  // Positions make the error underlinable, matching how the tokenizer
  // and parser already report syntax errors.
  it("points at the offending field token, not the start of the query", () => {
    const err = expectInvalid("status = done and stat = x");
    expect(err.position).toBe("status = done and ".length);
  });

  it("points at the field token for a bad enum value", () => {
    const err = expectInvalid("priority = urgent");
    expect(err.position).toBe(0);
  });
});

describe("validateQuery — recursion into every branch", () => {
  it.each([
    ["and (left)", "stat = x and status = done"],
    ["and (right)", "status = done and stat = x"],
    ["or (left)", "stat = x or status = done"],
    ["or (right)", "status = done or stat = x"],
    ["not", "not (stat = x)"],
    ["nested parens", "status = done and (priority = high or stat = x)"],
  ])("catches an unknown field inside %s", (_label, query) => {
    expectInvalid(query);
  });
});

describe("validateQuery — enum values", () => {
  it("checks every member of an `in` list", () => {
    expect(() => validateQuery(q("status in (backlog, done)"), { workflow })).not.toThrow();
    const err = expectInvalid("status in (backlog, ghost)");
    expect(err.message).toContain('unknown status value "ghost"');
  });

  // Comparing against a nonexistent status is a mistake even though it
  // happens to match every task rather than none.
  it("checks != and `not in` too, not just = and in", () => {
    expectInvalid("status != ghost");
    expectInvalid("status not in (ghost)");
  });

  // `~` is a substring match and ordering ops compare against `value`;
  // neither implies the RHS names an enum key.
  it("leaves ~ and ordering operators alone", () => {
    expect(() => validateQuery(q("status ~ prog"), { workflow })).not.toThrow();
    expect(() => validateQuery(q("priority > low"), { workflow })).not.toThrow();
  });

  it("ignores non-string values in enum position", () => {
    expect(() => validateQuery(q("status = 3"), { workflow })).not.toThrow();
    expect(() => validateQuery(q("status = true"), { workflow })).not.toThrow();
  });
});

describe("validateQuery — dotted paths", () => {
  it("rejects an unknown attribute on an enum field", () => {
    const err = expectInvalid("status.catgory = completed");
    expect(err.message).toContain('unknown attribute "catgory"');
    expect(err.suggestions).toContain("category");
  });

  it("rejects a dotted path whose head is not a real field", () => {
    expectInvalid("statuz.category = completed");
  });

  it("accepts deeper paths into an object-valued custom field", () => {
    // Custom field shapes are user-defined and unvalidated at the
    // contract layer, so there's nothing to check sub-paths against.
    expect(() => validateQuery(q("fields.impact.severity = high"), { workflow })).not.toThrow();
  });

  it("rejects a bare `fields.` with no key", () => {
    // The tokenizer keeps "fields." as one FIELD token.
    expectInvalid("fields. = x");
  });
});

describe("validateQuery — relationships", () => {
  it("rejects an unknown relationship type", () => {
    const err = expectInvalid("relationship.blokcs = T-9");
    expect(err.message).toContain('unknown relationship type "blokcs"');
    expect(err.suggestions).toContain("blocks");
  });

  it("accepts a configured relationship type", () => {
    expect(() => validateQuery(q("relationship.blocks = T-9"), { workflow })).not.toThrow();
  });
});

describe("validateQuery — without workflow config", () => {
  // Callers that haven't loaded config still catch typo'd field names;
  // anything config-dependent is deferred rather than guessed at.
  it("still catches unknown top-level fields", () => {
    expectInvalid("stat = done", {} as { workflow: WorkflowConfig });
  });

  it("does not check enum values", () => {
    expect(() => validateQuery(q("status = frobnik"))).not.toThrow();
  });

  it("does not check custom field keys", () => {
    expect(() => validateQuery(q("fields.anything = x"))).not.toThrow();
  });

  it("does not check relationship types", () => {
    expect(() => validateQuery(q("relationship.whatever = T-1"))).not.toThrow();
  });
});
