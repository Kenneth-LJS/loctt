import { parseQuery, tokenize } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { buildDslFromSearch } from "./buildDsl.ts";
import { dslToSearch } from "./dslToSearch.ts";

/**
 * The Basic ↔ Advanced bridge (VUE-10, VUE-11, VUE-18).
 *
 * Round-trips assert the **parsed structure**, not the string. A
 * string-equality check passes for an editor that does nothing at all,
 * and it also fails for a harmless whitespace difference — both wrong
 * answers. Comparing ASTs asks the question the case actually asks:
 * does the query still mean the same thing?
 */

/** Structural identity, independent of formatting. */
const ast = (dsl: string): unknown => JSON.parse(JSON.stringify(parseQuery(tokenize(dsl))));

describe("Basic → Advanced is lossless", () => {
  // @verifies VUE-10
  it("reproduces every predicate, and back again, with nothing dropped or added", () => {
    const search = {
      status: ["backlog", "in_progress"],
      priority: ["high"],
      assignee: ["alice"],
      labels: ["api", "urgent"],
    };

    const dsl = buildDslFromSearch(search);

    // Every predicate survives the trip out. Multi-select facets are
    // membership regardless of value count (Ken's ruling — no count-based
    // `=` downgrade), so a lone value is `in (…)`, not `= …`.
    expect(dsl).toContain("status in (backlog, in_progress)");
    expect(dsl).toContain("priority in (high)");
    expect(dsl).toContain("assignee in (alice)");
    expect(dsl).toContain("labels in (api, urgent)");

    // ...and the trip back restores the identical controls.
    const back = dslToSearch(dsl);
    expect(back.expressible).toBe(true);
    if (!back.expressible) return;
    expect(back.search).toEqual(search);

    // The second generation is structurally identical to the first —
    // this is what "lossless" means, and a string compare would not
    // survive a reordering that means the same thing.
    expect(ast(buildDslFromSearch(back.search))).toEqual(ast(dsl));
  });

  // @verifies VUE-10
  it("does not surface the default archived clause as a filter the user set", () => {
    const back = dslToSearch("status = backlog and archived != true");
    expect(back.expressible).toBe(true);
    if (!back.expressible) return;
    // `archived != true` is the default scope buildDsl always appends;
    // round-tripping it as a chip would invent a filter.
    expect(back.search).not.toHaveProperty("archived");
    expect(back.search).toEqual({ status: ["backlog"] });
  });
});

describe("Advanced → Basic refuses rather than approximating", () => {
  // @verifies VUE-11
  it("rejects a nested disjunction and names the construct", () => {
    const r = dslToSearch("(status = done or priority = high) and assignee = alice");
    expect(r.expressible).toBe(false);
    if (r.expressible) return;
    expect(r.reason).toMatch(/or/i);
  });

  // @verifies VUE-11
  it("rejects a negation, a comparison operator, and a relationship test distinctly", () => {
    const not = dslToSearch("not (status = done)");
    const cmp = dslToSearch("priority >= 3");
    const link = dslToSearch('has_link("blocks")');
    for (const r of [not, cmp, link]) expect(r.expressible).toBe(false);

    // Three different reasons, not one shared "cannot convert" — the
    // case requires the explanation to name *which* construct.
    const reasons = [not, cmp, link].map(r => (r.expressible ? "" : r.reason));
    expect(new Set(reasons).size).toBe(3);
    if (!not.expressible) expect(not.reason).toMatch(/not/i);
    if (!cmp.expressible) expect(cmp.reason).toMatch(/>=/);
    if (!link.expressible) expect(link.reason).toMatch(/has_link/);
  });

  // @verifies VUE-11
  it("rejects a field basic mode has no control for, naming it", () => {
    const r = dslToSearch("due_date <= today");
    expect(r.expressible).toBe(false);
    if (r.expressible) return;
    expect(r.reason).toContain("due_date");
  });

  // @verifies VUE-18
  it("is correctly disabled for the every-operator query, which still parses", () => {
    const q
      = '(status in (in_progress, blocked) or priority >= 3) and not (text ~ "spike") '
        + 'and due_date <= today and has_link("blocks") and parent = T-5';
    // It must parse — the case's first bullet.
    expect(() => parseQuery(tokenize(q))).not.toThrow();
    // ...and basic mode must decline it rather than truncate it.
    expect(dslToSearch(q).expressible).toBe(false);
  });

  // @verifies VUE-11
  it("re-enables for an expressible query, per the case's last bullet", () => {
    expect(dslToSearch("status in (backlog, done) and assignee = alice").expressible).toBe(true);
  });
});
