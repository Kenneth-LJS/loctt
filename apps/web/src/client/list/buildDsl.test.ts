import { describe, expect, it } from "vitest";

import { buildDslFromSearch, dslAtom } from "./buildDsl.ts";

describe("dslAtom", () => {
  it("passes bare identifiers through unquoted", () => {
    expect(dslAtom("p_web")).toBe("p_web");
    expect(dslAtom("in_progress")).toBe("in_progress");
    expect(dslAtom("fields.impact")).toBe("fields.impact");
  });

  it("quotes and escapes values with specials", () => {
    expect(dslAtom("has space")).toBe('"has space"');
    expect(dslAtom('a"b')).toBe('"a\\"b"');
    expect(dslAtom("a\\b")).toBe('"a\\\\b"');
  });
});

describe("buildDslFromSearch", () => {
  it("AND-s a single-value facet with the default open filter", () => {
    expect(buildDslFromSearch({ status: ["in_progress"] })).toBe(
      "status = in_progress and archived != true",
    );
  });

  it("uses `in [...]` for multi-value facets and maps type→task_type", () => {
    expect(buildDslFromSearch({ type: ["bug", "feature"], archived: true })).toBe(
      "task_type in [bug, feature]",
    );
  });

  it("wraps free-text q and AND-s every active facet", () => {
    const dsl = buildDslFromSearch({
      q: "text ~ login",
      priority: ["high"],
      labels: ["l_fe", "l_be"],
      archived: true,
    });
    expect(dsl).toBe("(text ~ login) and priority = high and labels in [l_fe, l_be]");
  });

  it("includes archived != true by default and omits it when archived is on", () => {
    expect(buildDslFromSearch({})).toBe("archived != true");
    expect(buildDslFromSearch({ archived: true })).toBe("archived != true");
    // ^ with nothing else active, the fallback still yields a valid query.
  });

  it("maps custom field.<key> params to fields.<key>", () => {
    const search = { "field.impact": ["p0"], archived: true } as Record<string, unknown>;
    expect(buildDslFromSearch(search)).toBe("fields.impact = p0");
  });
});
