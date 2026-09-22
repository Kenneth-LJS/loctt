import { describe, expect, it } from "vitest";

import { timelineSearchSchema } from "./timelineSearch.ts";

/**
 * The timeline search-param parser. Grouping now spans the eight
 * builtins plus a `field.<key>` custom-field reference, and parses
 * *leniently* to a well-formed token — whether a `field.*` ref actually
 * resolves is `resolveGrouping`'s job (it holds the workflow catalog),
 * not the router's. Syntactic garbage still parses to `undefined` so the
 * route never throws.
 */
function grouping(v: unknown): unknown {
  return timelineSearchSchema.parse({ grouping: v }).grouping;
}

describe("timelineSearchSchema — grouping", () => {
  it("accepts each builtin, lowercasing", () => {
    for (const g of ["none", "project", "milestone", "sprint", "assignee", "status", "priority", "task_type"]) {
      expect(grouping(g)).toBe(g);
    }
    expect(grouping("ASSIGNEE")).toBe("assignee");
  });

  it("accepts a well-formed field.<key> ref, preserving key case", () => {
    expect(grouping("field.area")).toBe("field.area");
    expect(grouping("field.myField_2")).toBe("field.myField_2");
  });

  it("parses garbage and a malformed field ref to undefined, not a throw", () => {
    expect(grouping("fortnight")).toBeUndefined();
    expect(grouping("field.")).toBeUndefined();
    expect(grouping("field.bad key")).toBeUndefined();
    expect(grouping(undefined)).toBeUndefined();
  });
});
