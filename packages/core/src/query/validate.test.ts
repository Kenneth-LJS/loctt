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

describe("validateQuery — queries that would silently match nothing", () => {
  /**
   * Each of these parses, validates, and then evaluates false for every
   * task — indistinguishable from "nothing matched". That is the exact
   * failure class validate.ts was written to eliminate, and each of
   * these routed around it.
   */

  it("rejects `link_count(...) in (...)`, which can never be true", () => {
    // The evaluator resolves a list to `undefined` and returns false, so
    // the query is accepted and matches nothing.
    const err = expectInvalid('link_count("blocks") in (1, 2)');
    expect(err.message).toMatch(/link_count/);
  });

  it("rejects `link_count(...) not in (...)`, which is false for every task", () => {
    // Worse than the positive form: a negation that is false everywhere
    // reads as "no task lacks these counts", which is never what anyone
    // meant to ask.
    expectInvalid('link_count("blocks") not in (1, 2)');
  });

  it("rejects an empty list, which cannot match", () => {
    const err = expectInvalid("status in ()");
    expect(err.message).toMatch(/empty/i);
  });

  it("rejects a numeric literal that is not a number", () => {
    // `1.2.3` and `3-4` become NaN, and every comparison against NaN is
    // false — so the query runs and quietly returns nothing.
    expectInvalid("estimate = 1.2.3");
    expectInvalid("estimate = 3-4");
  });

  it("still accepts the forms these near-misses resemble", () => {
    // The guard must not swallow the legitimate query next door.
    validateQuery(q('link_count("blocks") = 2'), { workflow });
    validateQuery(q('link_count("blocks") > 0'), { workflow });
    validateQuery(q("status in (backlog, done)"), { workflow });
    validateQuery(q("estimate = 3"), { workflow });
    validateQuery(q("estimate = 1.5"), { workflow });
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
    'has_link("blocks")',
    'has_link("blocks", "T-9")',
    'has_link()',
    'link_count("blocks") > 2',
    "not (status = done)",
    "status = done or (priority = high and task_type = bug)",
  ])("accepts %s", query => {
    expect(() => validateQuery(q(query), { workflow })).not.toThrow();
  });
});

describe("validateQuery — the text alias only accepts ~ (Q2)", () => {
  // `text` is a substring-search alias. Every non-`~` operator parsed and
  // validated, then evaluated wrongly — `text = x` returned the tasks that
  // did NOT contain x (the evaluator's match exits all test `op === "~"`).
  // The operator is nonsensical on a substring alias, so reject it at
  // validation with a clear message rather than answer wrongly.
  it.each([
    ["=", "text = urgent"],
    ["!=", "text != urgent"],
    ["<", "text < urgent"],
    ["<=", "text <= urgent"],
    [">", "text > urgent"],
    [">=", "text >= urgent"],
    ["in", "text in (urgent, blocker)"],
  ])("rejects text with %s", (_op, query) => {
    const err = expectInvalid(query);
    expect(err.message).toContain('"text" is a substring search');
  });

  it("still accepts text ~ term", () => {
    expect(() => validateQuery(q("text ~ urgent"), { workflow })).not.toThrow();
  });

  it("rejects text = even without workflow config", () => {
    let caught: unknown;
    try {
      validateQuery(q("text = urgent"));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(QueryValidationError);
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

describe("validateQuery — link functions", () => {
  it("rejects an unknown relationship type", () => {
    const err = expectInvalid('has_link("blokcs")');
    expect(err.message).toContain('unknown relationship type "blokcs"');
    expect(err.suggestions).toContain("blocks");
  });

  it("accepts a configured forward key", () => {
    expect(() => validateQuery(q('has_link("blocks")'), { workflow })).not.toThrow();
  });

  it("accepts the INVERSE key", () => {
    // The previous validator mapped `r => r.key` only, so this failed
    // validation even though the evaluator handled it — rejecting
    // exactly the reverse-direction queries that make link querying
    // worth having. `linkTask` writes the inverse edge on the target,
    // so `blocked_by` is real stored data, not a synonym.
    expect(() => validateQuery(q('has_link("blocked_by")'), { workflow })).not.toThrow();
    expect(() => validateQuery(q('has_link("blocked_by", "T-1")'), { workflow })).not.toThrow();
    expect(() => validateQuery(q('link_count("blocked_by") > 0'), { workflow })).not.toThrow();
  });

  it("validates the kind inside link_count too", () => {
    const err = expectInvalid('link_count("blokcs") > 1');
    expect(err.message).toContain('unknown relationship type "blokcs"');
  });

  it("accepts the no-argument forms", () => {
    expect(() => validateQuery(q("has_link()"), { workflow })).not.toThrow();
    expect(() => validateQuery(q("link_count() = 0"), { workflow })).not.toThrow();
  });

  it("rejects the superseded relationship.* grammar by name", () => {
    for (const bad of ["relationship.blocks = T-9", "relationship.type = blocks", "relationship.target = T-1"]) {
      const err = expectInvalid(bad);
      expect(err.message).toContain("no longer supported");
      expect(err.message).toContain("has_link");
    }
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

  it("does not check relationship kinds", () => {
    expect(() => validateQuery(q('has_link("whatever")'))).not.toThrow();
    expect(() => validateQuery(q('link_count("whatever") > 0'))).not.toThrow();
  });

  it("still rejects the removed relationship.* grammar", () => {
    // Not a config-dependent check: the grammar is gone regardless of
    // whether a workflow is loaded, so the error must still name the
    // replacement rather than deferring.
    expect(() => validateQuery(q("relationship.whatever = T-1"))).toThrow(/has_link/);
  });
});
