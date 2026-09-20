import { describe, expect,it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { queryToConditions } from "../query/builderTree.js";
import { parseQueriesConfig, QueriesConfigError, serializeQueriesConfig } from "./queries.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

/**
 * A `conditions:` YAML block derived from a DSL query, indented to sit
 * under a `queries:` list item. `conditions` is a required field on a
 * saved view (it is the source of truth the `query` string is derived
 * from), so every VALID fixture entry needs one; these tests exercise
 * sort/display/broken-entry behavior, not the conditions shape, so we
 * derive a matching tree from the DSL rather than hand-author it.
 */
function conditionsBlock(dsl: string, indent = "    "): string {
  const res = queryToConditions(dsl);
  if (!res.ok) throw new Error(`fixture DSL does not parse: ${dsl}`);
  const yaml = stringifyYaml({ conditions: res.tree }).trimEnd();
  return yaml.split("\n").map(line => indent + line).join("\n");
}

const CANONICAL_YAML = `
queries:
  - id: 01HQ000000000000000000000A
    name: recent-open
    query: archived != true and status != done
${conditionsBlock("archived != true and status != done")}
    sort:
      - field: updated_at
        direction: desc

  - id: 01HQ000000000000000000000B
    name: blocked
    query: archived != true and status = blocked
${conditionsBlock("archived != true and status = blocked")}
    sort:
      - field: priority
        direction: desc
      - field: updated_at
        direction: desc

  - id: 01HQ000000000000000000000C
    name: init-work
    query: text ~ "init"
${conditionsBlock('text ~ "init"')}
    sort:
      - field: key
        direction: asc
`;

describe("parseQueriesConfig", () => {
  it("parses the canonical queries.yaml from the design doc", () => {
    const config = parseQueriesConfig(CANONICAL_YAML);

    expect(config.queries).toHaveLength(3);
    expect(config.queries[0]).toMatchObject({
      id: "01HQ000000000000000000000A",
      name: "recent-open",
      query: 'archived != true and status != done',
      sort: [{ field: "updated_at", direction: "desc" }],
    });
    expect(config.queries[1]?.sort).toHaveLength(2);
    expect(config.queries[2]).toMatchObject({
      id: "01HQ000000000000000000000C",
      name: "init-work",
      query: 'text ~ "init"',
      sort: [{ field: "key", direction: "asc" }],
    });
  });

  it("allows queries without sort", () => {
    const yaml = `
queries:
  - id: 01HQ000000000000000000000Z
    name: all
    query: archived != true
${conditionsBlock("archived != true")}
`;
    const config = parseQueriesConfig(yaml);
    expect(config.queries[0]?.sort).toBeUndefined();
  });

  it("allows an empty queries array", () => {
    const config = parseQueriesConfig("queries: []");
    expect(config.queries).toEqual([]);
  });

  it("throws on missing queries array", () => {
    expect(() => parseQueriesConfig("{}")).toThrow(QueriesConfigError);
    expect(() => parseQueriesConfig("{}")).toThrow("queries is required (expected array)");
  });

  it("throws on missing query id", () => {
    const yaml = `queries:\n  - name: x\n    query: status = open`;
    expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
  });

  it("throws on missing query name", () => {
    const yaml = `queries:\n  - id: 01HQ000000000000000000000Y\n    query: status = open`;
    expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
    expect(() => parseQueriesConfig(yaml)).toThrow("queries[0].name is required (expected string)");
  });

  it("throws on invalid sort direction", () => {
    const yaml = `
queries:
  - id: 01HQ000000000000000000000Y
    name: bad
    query: status = open
    sort:
      - field: key
        direction: sideways
`;
    expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
    expect(() => parseQueriesConfig(yaml)).toThrow(
      `queries[0].sort[0].direction must be one of: "asc", "desc"`,
    );
  });

  it("throws on non-object root", () => {
    expect(() => parseQueriesConfig("42")).toThrow(QueriesConfigError);
  });

  // VUE-22 / north-star principle 5. This test previously asserted that
  // one unparseable entry threw and took down the whole config — the bug
  // the fix removes. A per-ENTRY DSL failure now degrades to a broken
  // marker; the throw is reserved for object-fatal problems (see the
  // "throws" tests above, which still stand).
  describe("per-entry degradation (VUE-22)", () => {
    // @verifies DEG-22
    it("collects an unparseable query as a broken marker instead of throwing", () => {
      const yaml = `
queries:
  - id: 01HQ000000000000000000000Y
    name: broken
    query: "status =="
${conditionsBlock("status = x")}
`;
      // @verifies VUE-22
      const config = parseQueriesConfig(yaml);
      expect(config.queries).toHaveLength(0);
      expect(config.broken).toHaveLength(1);
      expect(config.broken?.[0]).toMatchObject({
        id: "01HQ000000000000000000000Y",
        name: "broken",
        query: "status ==",
        index: 0,
      });
      // The parser's own message and the offending position are carried
      // so a surface can mark the fault in place.
      expect(config.broken?.[0]?.error).toBeTruthy();
      expect(typeof config.broken?.[0]?.position).toBe("number");
    });

    it("keeps a healthy entry sitting next to a broken one (one bad row never blanks the view)", () => {
      const yaml = `
queries:
  - id: 01HQ00000000000000000000OK
    name: ok
    query: status = backlog
${conditionsBlock("status = backlog")}
  - id: 01HQ0000000000000000000BAD
    name: broken
    query: "status = = done"
${conditionsBlock("status = x")}
`;
      // @verifies VUE-22
      const config = parseQueriesConfig(yaml);
      expect(config.queries).toHaveLength(1);
      expect(config.queries[0]).toMatchObject({ id: "01HQ00000000000000000000OK", name: "ok" });
      expect(config.broken).toHaveLength(1);
      // `index` is the original position, so the broken one was second.
      expect(config.broken?.[0]).toMatchObject({ name: "broken", index: 1 });
    });

    // @verifies DEG-24
    it("PRESERVES a broken entry on write (K28 — dropping it is silent data loss)", () => {
      // This test previously asserted serialize DROPS the broken marker —
      // which was the P1 data-loss bug (a UI write over a file holding a
      // broken view silently deleted that view). K28: a config write must
      // preserve an untouched degraded sibling, byte-value-for-value. The
      // broken entry round-trips: it re-serializes as an ordinary query
      // whose `query` string still does not parse, so re-loading re-sorts
      // it back into `broken` — never lost.
      const yaml = `
queries:
  - id: 01HQ00000000000000000000OK
    name: ok
    query: status = backlog
${conditionsBlock("status = backlog")}
  - id: 01HQ0000000000000000000BAD
    name: broken
    query: "status = = done"
${conditionsBlock("status = x")}
`;
      const config = parseQueriesConfig(yaml);
      const serialized = serializeQueriesConfig(config);
      // The broken entry's query text survives verbatim (K27 value-preserved).
      expect(serialized).toContain("status = = done");
      const roundTripped = parseQueriesConfig(serialized);
      expect(roundTripped.queries).toHaveLength(1);
      // The broken entry is still present after a round-trip, not dropped.
      expect(roundTripped.broken).toHaveLength(1);
      expect(roundTripped.broken?.[0]).toMatchObject({ id: "01HQ0000000000000000000BAD", name: "broken" });
    });

    // @verifies DEG-24
    // Phase Z finding C2: the K28 preserve-on-write closed the loss of the
    // whole entry, but the broken carrier only re-emitted {id,name,query} —
    // a broken view's `sort`/`display`/`archived` (all schema-valid; only
    // the DSL failed) were silently dropped on any unrelated write. This
    // asserts they survive a save byte-value-for-value and the entry stays
    // in `broken` (its DSL still does not parse — never promoted to valid).
    it("PRESERVES a broken entry's sort/display/archived on write (Phase Z C2)", () => {
      const yaml = `
queries:
  - id: 01HQ00000000000000000000OK
    name: ok
    query: status = backlog
${conditionsBlock("status = backlog")}
  - id: 01HQ0000000000000000000BAD
    name: broken
    query: "status = = done"
${conditionsBlock("status = x")}
    archived: true
    sort:
      - field: created_at
        direction: desc
    display:
      mode: board
      group_by: priority
`;
      const config = parseQueriesConfig(yaml);
      // The broken entry carries all its optional fields, unparsed DSL and all.
      expect(config.broken).toHaveLength(1);

      // An unrelated write (any create/edit/archive/delete rewrites the file).
      const serialized = serializeQueriesConfig(config);
      const roundTripped = parseQueriesConfig(serialized);

      // Still broken — its DSL does not parse, so it never promotes to valid.
      expect(roundTripped.queries).toHaveLength(1);
      expect(roundTripped.broken).toHaveLength(1);
      const revived = roundTripped.broken?.[0];
      expect(revived).toMatchObject({ id: "01HQ0000000000000000000BAD", name: "broken", query: "status = = done" });

      // The optional fields survive. They are not on BrokenSavedQuery, so
      // re-parse the serialized YAML and inspect the raw `bad` entry.
      const raw = parseYaml(serialized) as { queries: Record<string, unknown>[] };
      const badRaw = raw.queries.find(q => q.id === "01HQ0000000000000000000BAD");
      expect(badRaw?.archived).toBe(true);
      expect(badRaw?.sort).toEqual([{ field: "created_at", direction: "desc" }]);
      expect(badRaw?.display).toEqual({ mode: "board", group_by: "priority" });
    });

    it("still throws QueriesConfigError on a duplicate id even when a query is broken (object-fatal)", () => {
      const yaml = `
queries:
  - id: 01HQ000000000000000000DUPE
    name: a
    query: status = backlog
${conditionsBlock("status = backlog")}
  - id: 01HQ000000000000000000DUPE
    name: b
    query: "status =="
${conditionsBlock("status = x")}
`;
      expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
      expect(() => parseQueriesConfig(yaml)).toThrow(/duplicate query id/);
    });
  });

  it("throws YamlSyntaxError on malformed YAML (tagged with file label)", () => {
    expect(() => parseQueriesConfig("{ queries: [")).toThrow(YamlSyntaxError);
    expect(() => parseQueriesConfig("{ queries: [")).toThrow(/queries\.yaml/);
  });

  describe("display block (CW-2)", () => {
    it("parses a saved view with full timeline display config", () => {
      const yaml = `
queries:
  - id: 01HX0000000000000000000001
    name: sprint-12-timeline
    query: sprint = S-12
${conditionsBlock("sprint = S-12")}
    display:
      mode: timeline
      zoom: month
      grouping: assignee
      show_arrows: false
`;
      const config = parseQueriesConfig(yaml);
      const view = config.queries[0];
      expect(view?.display?.mode).toBe("timeline");
      expect(view?.display?.zoom).toBe("month");
      expect(view?.display?.grouping).toBe("assignee");
      expect(view?.display?.show_arrows).toBe(false);
    });

    it("parses a saved view with list columns + sort", () => {
      const yaml = `
queries:
  - id: 01HX0000000000000000000002
    name: my-bugs
    query: assignee = me and task_type = bug
${conditionsBlock("assignee = me and task_type = bug")}
    sort:
      - field: priority
        direction: desc
    display:
      mode: list
      columns: [key, title, status, priority, due]
`;
      const config = parseQueriesConfig(yaml);
      const view = config.queries[0];
      expect(view?.display?.mode).toBe("list");
      expect(view?.display?.columns).toEqual(["key", "title", "status", "priority", "due"]);
      expect(view?.sort?.[0]?.field).toBe("priority");
    });

    it("parses a saved view with board grouping", () => {
      const yaml = `
queries:
  - id: 01HX0000000000000000000003
    name: by-assignee
    query: archived != true
${conditionsBlock("archived != true")}
    display:
      mode: board
      group_by: assignee
`;
      const config = parseQueriesConfig(yaml);
      const view = config.queries[0];
      expect(view?.display?.mode).toBe("board");
      expect(view?.display?.group_by).toBe("assignee");
    });

    it("omits display when not provided (existing views unchanged)", () => {
      const yaml = `
queries:
  - id: 01HX0000000000000000000004
    name: plain
    query: archived != true
${conditionsBlock("archived != true")}
`;
      const config = parseQueriesConfig(yaml);
      expect(config.queries[0]?.display).toBeUndefined();
    });

    it("round-trips display through serialize + parse", () => {
      const yaml = `
queries:
  - id: 01HX0000000000000000000006
    name: rt
    query: archived != true
${conditionsBlock("archived != true")}
    display:
      mode: timeline
      zoom: day
      show_arrows: true
`;
      const parsed = parseQueriesConfig(yaml);
      const reparsed = parseQueriesConfig(serializeQueriesConfig(parsed));
      expect(reparsed).toEqual(parsed);
    });

    it("rejects unknown fields inside display (strict)", () => {
      const yaml = `
queries:
  - id: 01HX0000000000000000000005
    name: bad
    query: archived != true
${conditionsBlock("archived != true")}
    display:
      mode: list
      unknown_key: foo
`;
      expect(() => parseQueriesConfig(yaml)).toThrow();
    });
  });
});
