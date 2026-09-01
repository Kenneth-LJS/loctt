import type { PriorityDef } from "@loctt/contracts";
import { parseQuery, tokenize } from "@loctt/core";
import { describe, expect, it } from "vitest";

import { BUILTIN_FILTERS } from "../sidebar/builtinFilters.ts";
import { builtinToDsl } from "./builtinToDsl.ts";

/**
 * VUE-12: editing a built-in opens the editor pre-populated with the
 * built-in's own DSL.
 */

const PRIORITIES: readonly PriorityDef[] = [
  { key: "critical", label: "Critical", value: 4 },
  { key: "high", label: "High", value: 3 },
  { key: "medium", label: "Medium", value: 2 },
  { key: "low", label: "Low", value: 1 },
];

const ctx = { currentUserId: "u1", today: "2026-09-01", priorities: PRIORITIES };

describe("editing a built-in pre-populates its DSL", () => {
  // @verifies VUE-12
  it("gives 'High priority' the real query behind it, not an empty box", () => {
    const dsl = builtinToDsl("high-priority", ctx);
    expect(dsl).not.toBeNull();
    expect(dsl ?? "").not.toBe("");

    // The actual predicates the sidebar runs, not a placeholder.
    expect(dsl).toContain("priority in (critical, high)");
    expect(dsl).toContain("status.category not in");
    expect(() => parseQuery(tokenize(dsl ?? ""))).not.toThrow();
  });

  // @verifies VUE-12
  it("pre-populates from the same definition the sidebar runs, so rows cannot diverge", () => {
    // The case's second bullet: "the pre-populated DSL, run as-is,
    // returns the same rows the built-in returned". That holds only
    // if both come from one definition — so assert the editor's DSL
    // is derived from the built-in's own resolved search, not a
    // hand-copied string that could drift.
    const builtin = BUILTIN_FILTERS.find(b => b.id === "overdue");
    expect(builtin).toBeDefined();
    const resolved = builtin?.resolve(ctx) ?? null;
    expect(resolved).not.toBeNull();

    const dsl = builtinToDsl("overdue", ctx) ?? "";
    // Every predicate of the built-in's own `q` survives into the
    // editor's text.
    const q = (resolved as { q?: string }).q ?? "";
    expect(q).not.toBe("");
    expect(dsl).toContain(q);
  });

  // @verifies VUE-12
  it("every resolvable built-in pre-populates with a query that parses", () => {
    let resolvable = 0;
    for (const b of BUILTIN_FILTERS) {
      const dsl = builtinToDsl(b.id, ctx);
      if (dsl === null) continue;
      resolvable += 1;
      expect(() => parseQuery(tokenize(dsl)), `${b.id}: ${dsl}`).not.toThrow();
    }
    // POSITIVE CONTROL: "all of them parse" is vacuously true if none
    // resolved. Most of the six must actually produce a query.
    expect(resolvable).toBeGreaterThanOrEqual(5);
  });

  // @verifies VUE-12
  it("returns null rather than inventing a query for an unresolvable built-in", () => {
    // `mentions-me` is deliberately inert until the comment-scan
    // endpoint lands; pre-populating it would show a filter the
    // sidebar never ran.
    expect(builtinToDsl("mentions-me", ctx)).toBeNull();
    // ...and for a workspace whose priority scale cannot express "high".
    expect(builtinToDsl("high-priority", { ...ctx, priorities: [] })).toBeNull();
    expect(builtinToDsl("no-such-builtin", ctx)).toBeNull();
  });
});
