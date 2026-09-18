import { parseQuery, tokenize } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { addDays, BUILTIN_FILTERS, highPriorityKeys } from "./builtinFilters.ts";

function byId(id: string) {
  const f = BUILTIN_FILTERS.find(b => b.id === id);
  if (!f) throw new Error(`no built-in ${id}`);
  return f;
}

describe("addDays", () => {
  it("adds days within a month", () => {
    expect(addDays("2026-06-08", 7)).toBe("2026-06-15");
  });

  it("rolls over month and year boundaries", () => {
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });

  it("does not drift across a DST seam (UTC math)", () => {
    // US spring-forward 2026-03-08. Local-time date math could land on
    // the 14th; UTC math must give the 15th.
    expect(addDays("2026-03-08", 7)).toBe("2026-03-15");
  });
});

/** The default LocTT priority scale, highest first. */
const PRIORITIES = [
  { key: "critical", label: "Critical", value: 4 },
  { key: "high", label: "High", value: 3 },
  { key: "medium", label: "Medium", value: 2 },
  { key: "low", label: "Low", value: 1 },
];

describe("built-in filter resolution", () => {
  const ctx = { currentUserId: "u_ken", today: "2026-06-08", priorities: PRIORITIES };

  it("'Assigned to me' embeds the current user id and excludes closed tasks", () => {
    const search = byId("assigned-to-me").resolve(ctx);
    expect(search?.q).toContain('assignee = "u_ken"');
    expect(search?.q).toContain("status.category not in (completed, discarded)");
  });

  it("'Assigned to me' is unresolvable without a current user", () => {
    expect(
      byId("assigned-to-me").resolve({ currentUserId: null, today: ctx.today }),
    ).toBeNull();
  });

  it("'Due this week' spans today..today+7d", () => {
    const search = byId("due-this-week").resolve(ctx);
    expect(search?.q).toContain("due_date >= 2026-06-08");
    expect(search?.q).toContain("due_date <= 2026-06-15");
  });

  it("'Overdue' is strictly before today", () => {
    expect(byId("overdue").resolve(ctx)?.q).toContain("due_date < 2026-06-08");
  });

  /**
   * @verifies VUE-24
   *
   * This test previously asserted the literal `priority in (high,
   * critical)` — it was encoding the bug. On a tracker with no `high`
   * key that query matches nothing, so the built-in sat at a permanent
   * zero: a filter that looks live and is structurally dead. The keys
   * come from the workspace now, so the assertion has to as well.
   */
  it("'High priority' resolves against the workspace's own priorities", () => {
    // The default scale ranks critical and high at the top.
    expect(byId("high-priority").resolve(ctx)?.q).toContain(
      "priority in (critical, high)",
    );

    // A workspace using different vocabulary entirely.
    const custom = byId("high-priority").resolve({
      ...ctx,
      priorities: [
        { key: "p0", label: "Drop everything", value: 3 },
        { key: "p1", label: "Soon", value: 2 },
        { key: "p2", label: "Whenever", value: 1 },
      ],
    });
    expect(custom?.q).toContain("priority in (p0, p1)");
    // And emphatically not the hardcoded pair.
    expect(custom?.q).not.toContain("high");
    expect(custom?.q).not.toContain("critical");
  });

  /**
   * @verifies VUE-24
   *
   * "…or the built-in is hidden when it cannot be expressed — it never
   * shows a permanently-zero badge caused by a key that does not
   * exist."
   */
  it("'High priority' is inert when the scale cannot express a high one", () => {
    expect(byId("high-priority").resolve({ ...ctx, priorities: [] })).toBeNull();
    expect(
      byId("high-priority").resolve({
        ...ctx,
        priorities: [{ key: "normal", label: "Normal" }],
      }),
    ).toBeNull();
    // Still loading is not the same as unexpressible, but it must not
    // resolve to a wrong query either.
    expect(byId("high-priority").resolve({ ...ctx, priorities: undefined })).toBeNull();
  });

  // CMT-10 / A183: this test previously asserted "Mentions me" was
  // deferred and always resolved to null. That expectation encoded the
  // pre-CMT-10 behaviour; the built-in now resolves to the
  // `comment_mentions` query field, so the test is updated to the real
  // contract rather than left asserting the old one.
  it("'Mentions me' resolves to comment_mentions with the current user id", () => {
    const search = byId("mentions-me").resolve(ctx);
    expect(search?.q).toBe('comment_mentions = "u_ken"');
  });

  it("'Mentions me' is unresolvable without a current user", () => {
    expect(
      byId("mentions-me").resolve({ currentUserId: null, today: ctx.today }),
    ).toBeNull();
  });

  // Every assertion above uses `toContain` on a substring the code was
  // written to produce, so all five built-ins shipped emitting
  // `in [...]` — a form the grammar has no `[` token for — while this
  // suite stayed green. Parsing each resolved query tests it against
  // the real tokenizer rather than against our own expectations.
  it("every built-in resolves to a query the DSL can actually parse", () => {
    const resolvable = BUILTIN_FILTERS
      .map(f => ({ id: f.id, search: f.resolve(ctx) }))
      .filter((r): r is { id: string; search: { q?: string } } => r.search !== null);

    // Guards against this passing vacuously if resolution regresses.
    expect(resolvable.length).toBeGreaterThanOrEqual(4);

    for (const { id, search } of resolvable) {
      const q = search.q;
      if (q === undefined) continue;
      expect(() => parseQuery(tokenize(q)), `built-in "${id}": ${q}`).not.toThrow();
    }
  });
});

/**
 * @verifies VUE-24
 *
 * The ranking rule on its own, away from the DSL string.
 */
describe("highPriorityKeys", () => {
  it("ranks by `value` when every priority declares one", () => {
    // Deliberately out of config order: `value` must win.
    expect(
      highPriorityKeys([
        { key: "low", label: "Low", value: 1 },
        { key: "critical", label: "Critical", value: 4 },
        { key: "medium", label: "Medium", value: 2 },
        { key: "high", label: "High", value: 3 },
      ]),
    ).toEqual(["critical", "high"]);
  });

  it("falls back to config order when any priority omits `value`", () => {
    expect(
      highPriorityKeys([
        { key: "urgent", label: "Urgent" },
        { key: "normal", label: "Normal" },
        { key: "later", label: "Later" },
      ]),
    ).toEqual(["urgent", "normal"]);
  });

  it("takes only the top one on a two-value scale", () => {
    expect(
      highPriorityKeys([
        { key: "hot", label: "Hot", value: 2 },
        { key: "cold", label: "Cold", value: 1 },
      ]),
    ).toEqual(["hot"]);
  });

  it("gives up on a scale that cannot express a high priority", () => {
    expect(highPriorityKeys([])).toEqual([]);
    expect(highPriorityKeys([{ key: "only", label: "Only" }])).toEqual([]);
  });
});
