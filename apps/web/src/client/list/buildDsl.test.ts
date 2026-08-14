import { parseQuery, tokenize } from "@loctt/core";
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

  it("uses `in (...)` for multi-value facets and maps type→task_type", () => {
    expect(buildDslFromSearch({ type: ["bug", "feature"], archived: true })).toBe(
      "task_type in (bug, feature)",
    );
  });

  it("wraps free-text q and AND-s every active facet", () => {
    const dsl = buildDslFromSearch({
      q: "text ~ login",
      priority: ["high"],
      labels: ["l_fe", "l_be"],
      archived: true,
    });
    expect(dsl).toBe("(text ~ login) and priority = high and labels in (l_fe, l_be)");
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

  // Every case above asserts the string this builds and nothing more.
  // That is exactly how `in [...]` shipped: the expected strings were
  // written to match the code, so both agreed on a syntax the grammar
  // never had. Parsing the output tests it against the real tokenizer
  // and parser instead of against our own expectations.
  describe("output parses as real DSL", () => {
    const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
      ["single-value facet", { status: ["in_progress"] }],
      ["multi-value facet", { type: ["bug", "feature"] }],
      ["free text plus facets", { q: "text ~ login", priority: ["high"], labels: ["l_fe", "l_be"] }],
      ["custom field", { "field.impact": ["p0", "p1"] }],
      ["no filters at all", {}],
      ["values needing quoting", { assignee: ["a b", 'c"d'] }],
    ];

    for (const [name, search] of cases) {
      it(name, () => {
        const dsl = buildDslFromSearch(search);
        expect(() => parseQuery(tokenize(dsl))).not.toThrow();
      });
    }
  });
});
