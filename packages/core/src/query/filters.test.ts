import type { AdvancedFilter, Filter, SimpleFilter } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  FilterError,
  filtersToNode,
  filtersToSummary,
  filterToNode,
  filterToSummary,
  normalizeFilter,
  normalizeFilters,
} from "./filters.js";

function simple(field: string, op: SimpleFilter["op"], values: string[]): SimpleFilter {
  return { kind: "simple", field, op, values };
}

function advanced(query: string): AdvancedFilter {
  return { kind: "advanced", query };
}

describe("filtersToNode", () => {
  it("returns undefined for an empty list", () => {
    expect(filtersToNode([])).toBeUndefined();
  });

  it("turns a single simple filter into the right comparison node", () => {
    const node = filtersToNode([simple("status", "!=", ["done"])]);
    expect(node).toEqual({
      type: "comparison",
      field: "status",
      op: "!=",
      value: { type: "string", value: "done" },
    });
  });

  describe("multi-value simple filters", () => {
    it("widens '=' with multiple values to an 'in' list node", () => {
      const node = filtersToNode([simple("status", "=", ["a", "b"])]);
      expect(node).toEqual({
        type: "comparison",
        field: "status",
        op: "in",
        value: { type: "list", values: [{ type: "string", value: "a" }, { type: "string", value: "b" }] },
      });
    });

    it("widens '!=' with multiple values to a 'not in' list node", () => {
      const node = filtersToNode([simple("status", "!=", ["a", "b"])]);
      expect(node).toEqual({
        type: "comparison",
        field: "status",
        op: "not in",
        value: { type: "list", values: [{ type: "string", value: "a" }, { type: "string", value: "b" }] },
      });
    });

    it("throws FilterError for a multi-value '<' (no sensible widening)", () => {
      expect(() => filtersToNode([simple("priority", "<", ["a", "b"])])).toThrow(FilterError);
    });
  });

  describe("presence operators", () => {
    it("'is empty' produces an empty-value node and needs no values", () => {
      const node = filterToNode(simple("due_date", "is empty", []));
      expect(node).toEqual({
        type: "comparison",
        field: "due_date",
        op: "is empty",
        value: { type: "empty" },
      });
    });

    it("'is not empty' produces an empty-value node and needs no values", () => {
      const node = filterToNode(simple("due_date", "is not empty", []));
      expect(node).toEqual({
        type: "comparison",
        field: "due_date",
        op: "is not empty",
        value: { type: "empty" },
      });
    });
  });

  describe("value coercion", () => {
    it('coerces "true"/"false" to boolean', () => {
      const node = filterToNode(simple("archived", "=", ["true"]));
      expect(node).toMatchObject({ value: { type: "boolean", value: true } });
      const nodeFalse = filterToNode(simple("archived", "=", ["false"]));
      expect(nodeFalse).toMatchObject({ value: { type: "boolean", value: false } });
    });

    it('coerces "42" to number', () => {
      const node = filterToNode(simple("fields.points", "=", ["42"]));
      expect(node).toMatchObject({ value: { type: "number", value: 42 } });
    });

    it('keeps "007" as a string — the round trip is not exact', () => {
      const node = filterToNode(simple("key", "=", ["007"]));
      expect(node).toMatchObject({ value: { type: "string", value: "007" } });
    });

    it('keeps "1.10" as a string — Number("1.10") stringifies back to "1.1"', () => {
      const node = filterToNode(simple("fields.version", "=", ["1.10"]));
      expect(node).toMatchObject({ value: { type: "string", value: "1.10" } });
    });
  });

  it("parses an advanced filter's DSL", () => {
    const node = filterToNode(advanced("status = done"));
    expect(node).toEqual({
      type: "comparison",
      field: "status",
      op: "=",
      value: { type: "string", value: "done" },
      position: 0,
    });
  });

  it("throws FilterError for an unparseable advanced filter", () => {
    expect(() => filterToNode(advanced("status =="))).toThrow(FilterError);
  });

  it("folds several filters left with 'and', in array order", () => {
    const filters: Filter[] = [
      simple("status", "!=", ["done"]),
      simple("priority", "=", ["high"]),
      advanced("archived = false"),
    ];
    const node = filtersToNode(filters);
    // Left fold: ((f1 and f2) and f3)
    expect(node?.type).toBe("and");
    if (node?.type !== "and") throw new Error("expected and node");
    expect(node.right).toEqual(filterToNode(filters[2] as Filter));
    expect(node.left.type).toBe("and");
    if (node.left.type !== "and") throw new Error("expected nested and node");
    expect(node.left.left).toEqual(filterToNode(filters[0] as Filter));
    expect(node.left.right).toEqual(filterToNode(filters[1] as Filter));
  });
});

describe("normalizeFilter", () => {
  it("normalizes ONLY spacing on an advanced filter", () => {
    const result = normalizeFilter(advanced("status=done"));
    expect(result).toEqual(advanced("status = done"));
  });

  it("leaves a simple filter byte-identical", () => {
    const f = simple("status", "!=", ["done", "in_progress"]);
    const result = normalizeFilter(f);
    expect(result).toEqual(f);
    expect(result).toBe(f); // same reference: simple filters pass through untouched
  });

  it("throws FilterError normalizing an advanced filter whose DSL does not parse", () => {
    expect(() => normalizeFilter(advanced("status =="))).toThrow(FilterError);
  });

  it("normalizeFilters preserves order across a mixed list", () => {
    const filters: Filter[] = [advanced("status=done"), simple("priority", "=", ["high"])];
    expect(normalizeFilters(filters)).toEqual([advanced("status = done"), simple("priority", "=", ["high"])]);
  });

  /**
   * Ken, K102: *"i think we should store parens as needed to prevent
   * ambiguity or whatever, but if the user adds more parens for clarity,
   * we should keep."*
   *
   * Before this, `queryNodeToDsl` re-derived every paren from precedence,
   * so a pair the author wrote for readability silently vanished on save.
   */
  describe("parentheses (authored kept, required added)", () => {
    it("keeps a top-level clarity paren that precedence does not require", () => {
      expect(normalizeFilter(advanced("(priority = high or priority = critical)")))
        .toEqual(advanced("(priority = high or priority = critical)"));
    });

    it("keeps a redundant INNER paren around an already-bound branch", () => {
      expect(normalizeFilter(advanced("((a = 1 or b = 2)) and c = 3")))
        .toEqual(advanced("((a = 1 or b = 2)) and c = 3"));
    });

    it("keeps every pair of a doubly-parenthesised query", () => {
      expect(normalizeFilter(advanced("((status = a))"))).toEqual(advanced("((status = a))"));
    });

    it("keeps a binding paren (the pre-existing behaviour)", () => {
      expect(normalizeFilter(advanced("status = a and (b = 1 or c = 2)")))
        .toEqual(advanced("status = a and (b = 1 or c = 2)"));
    });

    it("adds the paren precedence requires around an unparenthesised not-operand", () => {
      expect(normalizeFilter(advanced("not a = 1"))).toEqual(advanced("not (a = 1)"));
    });

    it("adds no parens to a query that was written without any", () => {
      expect(normalizeFilter(advanced("a = 1 and b = 2 or c = 3")))
        .toEqual(advanced("a = 1 and b = 2 or c = 3"));
    });

    /**
     * The load-bearing one: if emitted parens were ADDED to authored ones
     * rather than maxed with them, every save of an unchanged view would
     * grow another pair. A view's stored text must not drift.
     */
    it.each([
      "(priority = high or priority = critical)",
      "((status = a))",
      "status = a and (b = 1 or c = 2)",
      "not a = 1",
      "not ((a = 1))",
      "a = 1 or (b = 2 and c = 3)",
      "(a = 1) and (b = 2)",
      "((status in (a, b)))",
    ])("normalizing %j twice equals normalizing it once", (query) => {
      const once = normalizeFilter(advanced(query)) as AdvancedFilter;
      expect(normalizeFilter(once)).toEqual(once);
    });
  });
});

describe("filtersToSummary / filterToSummary", () => {
  it("renders a simple filter as 'field op values'", () => {
    expect(filterToSummary(simple("status", "=", ["done"]))).toBe("status = done");
    expect(filterToSummary(simple("status", "!=", ["done", "in_progress"])))
      .toBe("status != done, in_progress");
  });

  it("renders an advanced filter verbatim", () => {
    expect(filterToSummary(advanced("status = done and priority = high")))
      .toBe("status = done and priority = high");
  });

  it("joins several filters' summaries", () => {
    const summary = filtersToSummary([
      simple("status", "!=", ["done"]),
      advanced("priority = high"),
    ]);
    expect(summary).toBe("status != done · priority = high");
  });

  it("renders '(no filters)' for an empty list", () => {
    expect(filtersToSummary([])).toBe("(no filters)");
  });
});
