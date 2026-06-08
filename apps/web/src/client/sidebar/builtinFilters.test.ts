import { describe, expect, it } from "vitest";

import { addDays, BUILTIN_FILTERS } from "./builtinFilters.ts";

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

describe("built-in filter resolution", () => {
  const ctx = { currentUserId: "u_ken", today: "2026-06-08" };

  it("'Assigned to me' embeds the current user id and excludes closed tasks", () => {
    const search = byId("assigned-to-me").resolve(ctx);
    expect(search?.q).toContain('assignee = "u_ken"');
    expect(search?.q).toContain("status.category not in [completed, discarded]");
  });

  it("'Assigned to me' is unresolvable without a current user", () => {
    expect(byId("assigned-to-me").resolve({ currentUserId: null, today: ctx.today })).toBeNull();
  });

  it("'Due this week' spans today..today+7d", () => {
    const search = byId("due-this-week").resolve(ctx);
    expect(search?.q).toContain("due_date >= 2026-06-08");
    expect(search?.q).toContain("due_date <= 2026-06-15");
  });

  it("'Overdue' is strictly before today", () => {
    expect(byId("overdue").resolve(ctx)?.q).toContain("due_date < 2026-06-08");
  });

  it("'High priority' matches high or critical", () => {
    expect(byId("high-priority").resolve(ctx)?.q).toContain("priority in [high, critical]");
  });

  it("'Mentions me' is deferred (never resolves) until comments land", () => {
    expect(byId("mentions-me").resolve(ctx)).toBeNull();
  });
});
