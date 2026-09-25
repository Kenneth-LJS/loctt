
import type { Filter } from "@loctt/contracts";
import { describe, expect,it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { parseQueriesConfig, QueriesConfigError, serializeQueriesConfig } from "./queries.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

/**
 * A `filters:` YAML block, indented to sit under a `queries:` list item.
 * K102: a saved view's SOLE source of truth is its ordered `filters[]` —
 * there is no `query`/`conditions` pair any more. These tests exercise
 * sort/display/broken-entry behavior, not the filter shape itself, so a
 * small helper builds a matching block from a plain filter list.
 */
function filtersBlock(filters: Filter[], indent = "    "): string {
  const yaml = stringifyYaml({ filters }).trimEnd();
  return yaml.split("\n").map(line => indent + line).join("\n");
}

/** A single simple `status = <value>` filter, the common case in fixtures. */
function statusFilter(value: string): Filter[] {
  return [{ kind: "simple", field: "status", op: "=", values: [value] }];
}

const CANONICAL_YAML = `
queries:
  - id: 01HQ000000000000000000000A
    name: recent-open
${filtersBlock([
    { kind: "simple", field: "archived", op: "!=", values: ["true"] },
    { kind: "simple", field: "status", op: "!=", values: ["done"] },
  ])}
    sort:
      - field: updated_at
        direction: desc

  - id: 01HQ000000000000000000000B
    name: blocked
${filtersBlock([
    { kind: "simple", field: "archived", op: "!=", values: ["true"] },
    { kind: "simple", field: "status", op: "=", values: ["blocked"] },
  ])}
    sort:
      - field: priority
        direction: desc
      - field: updated_at
        direction: desc

  - id: 01HQ000000000000000000000C
    name: init-work
${filtersBlock([{ kind: "advanced", query: 'text ~ "init"' }])}
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
      filters: [
        { kind: "simple", field: "archived", op: "!=", values: ["true"] },
        { kind: "simple", field: "status", op: "!=", values: ["done"] },
      ],
      sort: [{ field: "updated_at", direction: "desc" }],
    });
    expect(config.queries[1]?.sort).toHaveLength(2);
    expect(config.queries[2]).toMatchObject({
      id: "01HQ000000000000000000000C",
      name: "init-work",
      filters: [{ kind: "advanced", query: 'text ~ "init"' }],
      sort: [{ field: "key", direction: "asc" }],
    });
  });

  it("allows queries without sort", () => {
    const yaml = `
queries:
  - id: 01HQ000000000000000000000Z
    name: all
${filtersBlock([{ kind: "simple", field: "archived", op: "!=", values: ["true"] }])}
`;
    const config = parseQueriesConfig(yaml);
    expect(config.queries[0]?.sort).toBeUndefined();
  });

  it("allows an empty queries array", () => {
    const config = parseQueriesConfig("queries: []");
    expect(config.queries).toEqual([]);
  });

  it("allows an entry with no filters key at all (empty list, not an error)", () => {
    const yaml = `
queries:
  - id: 01HQ0000000000000000NOFILT
    name: everything
`;
    const config = parseQueriesConfig(yaml);
    expect(config.queries).toHaveLength(1);
    expect(config.queries[0]?.filters).toEqual([]);
    expect(config.broken).toBeUndefined();
  });

  it("throws on missing queries array", () => {
    expect(() => parseQueriesConfig("{}")).toThrow(QueriesConfigError);
    expect(() => parseQueriesConfig("{}")).toThrow("queries is required (expected array)");
  });

  it("throws on missing query id", () => {
    const yaml = `queries:\n  - name: x\n${filtersBlock(statusFilter("open"))}`;
    expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
  });

  it("throws on missing query name", () => {
    const yaml = `queries:\n  - id: 01HQ000000000000000000000Y\n${filtersBlock(statusFilter("open"))}`;
    expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
    expect(() => parseQueriesConfig(yaml)).toThrow("queries[0].name is required (expected string)");
  });

  it("throws on invalid sort direction", () => {
    const yaml = `
queries:
  - id: 01HQ000000000000000000000Y
    name: bad
${filtersBlock(statusFilter("open"))}
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

  // VUE-22 / north-star principle 5. A per-ENTRY bad `filters` block
  // degrades to a broken marker; the throw is reserved for object-fatal
  // problems (see the "throws" tests above, which still stand).
  describe("per-entry degradation (VUE-22)", () => {
    // @verifies DEG-22
    it("collects an entry with an invalid filters block as a broken marker instead of throwing", () => {
      const yaml = `
queries:
  - id: 01HQ000000000000000000000Y
    name: broken
    filters:
      - kind: bogus
`;
      // @verifies VUE-22
      const config = parseQueriesConfig(yaml);
      expect(config.queries).toHaveLength(0);
      expect(config.broken).toHaveLength(1);
      expect(config.broken?.[0]).toMatchObject({
        id: "01HQ000000000000000000000Y",
        name: "broken",
        summary: "(unreadable filters)",
        index: 0,
      });
      // The validator's own message is carried so a surface can explain
      // what is wrong, and the raw YAML is preserved for a hand fix.
      expect(config.broken?.[0]?.error).toBeTruthy();
      expect(config.broken?.[0]?.rawText).toContain("bogus");
    });

    it("also degrades when filters is not a list at all", () => {
      const yaml = `
queries:
  - id: 01HQ0000000000000000NOTLST
    name: not-a-list
    filters: "not-a-list"
`;
      const config = parseQueriesConfig(yaml);
      expect(config.queries).toHaveLength(0);
      expect(config.broken).toHaveLength(1);
      expect(config.broken?.[0]).toMatchObject({
        id: "01HQ0000000000000000NOTLST",
        name: "not-a-list",
        summary: "(unreadable filters)",
      });
    });

    it("keeps a healthy entry sitting next to a broken one (one bad row never blanks the view)", () => {
      const yaml = `
queries:
  - id: 01HQ00000000000000000000OK
    name: ok
${filtersBlock(statusFilter("backlog"))}
  - id: 01HQ0000000000000000000BAD
    name: broken
    filters:
      - kind: bogus
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
      // whose `filters` still does not validate, so re-loading re-sorts
      // it back into `broken` — never lost.
      const yaml = `
queries:
  - id: 01HQ00000000000000000000OK
    name: ok
${filtersBlock(statusFilter("backlog"))}
  - id: 01HQ0000000000000000000BAD
    name: broken
    filters:
      - kind: bogus
`;
      const config = parseQueriesConfig(yaml);
      const serialized = serializeQueriesConfig(config);
      // The broken entry's raw filters text survives verbatim.
      expect(serialized).toContain("kind: bogus");
      const roundTripped = parseQueriesConfig(serialized);
      expect(roundTripped.queries).toHaveLength(1);
      // The broken entry is still present after a round-trip, not dropped.
      expect(roundTripped.broken).toHaveLength(1);
      expect(roundTripped.broken?.[0]).toMatchObject({ id: "01HQ0000000000000000000BAD", name: "broken" });
    });

    // @verifies DEG-24
    // Phase Z finding C2: the K28 preserve-on-write closed the loss of the
    // whole entry, but the broken carrier must re-emit ALL of its
    // schema-valid optional fields, not just {id,name} — a broken view's
    // `sort`/`display`/`archived` (only the filters failed) must survive a
    // save byte-value-for-value and the entry must stay in `broken` (its
    // filters still do not validate — never promoted to valid).
    it("PRESERVES a broken entry's sort/display/archived on write (Phase Z C2)", () => {
      const yaml = `
queries:
  - id: 01HQ00000000000000000000OK
    name: ok
${filtersBlock(statusFilter("backlog"))}
  - id: 01HQ0000000000000000000BAD
    name: broken
    filters:
      - kind: bogus
    archived: true
    sort:
      - field: created_at
        direction: desc
    display:
      mode: board
      group_by: priority
`;
      const config = parseQueriesConfig(yaml);
      // The broken entry carries all its optional fields, unparsed filters and all.
      expect(config.broken).toHaveLength(1);

      // An unrelated write (any create/edit/archive/delete rewrites the file).
      const serialized = serializeQueriesConfig(config);
      const roundTripped = parseQueriesConfig(serialized);

      // Still broken — its filters do not validate, so it never promotes to valid.
      expect(roundTripped.queries).toHaveLength(1);
      expect(roundTripped.broken).toHaveLength(1);
      const revived = roundTripped.broken?.[0];
      expect(revived).toMatchObject({ id: "01HQ0000000000000000000BAD", name: "broken" });

      // The optional fields survive. They are not on BrokenSavedQuery, so
      // re-parse the serialized YAML and inspect the raw `bad` entry.
      const raw = parseYaml(serialized) as { queries: Record<string, unknown>[] };
      const badRaw = raw.queries.find(q => q.id === "01HQ0000000000000000000BAD");
      expect(badRaw?.archived).toBe(true);
      expect(badRaw?.sort).toEqual([{ field: "created_at", direction: "desc" }]);
      expect(badRaw?.display).toEqual({ mode: "board", group_by: "priority" });
    });

    // The classification gap: a shape-valid advanced filter whose DSL text
    // does not parse used to load as an ordinary healthy view (the DSL was
    // never tokenized/parsed at load time, only when the view actually
    // ran). `resolveFilters` now also runs `filtersToNode`, so a parse
    // failure degrades the entry exactly like a shape failure does.
    it("degrades a shape-valid advanced filter whose DSL does not parse (the classification gap)", () => {
      const yaml = `
queries:
  - id: 01HQ0000000000000000BADDSL
    name: bad-dsl
${filtersBlock([{ kind: "advanced", query: "status = = = done AND" }])}
`;
      const config = parseQueriesConfig(yaml);
      expect(config.queries).toHaveLength(0);
      expect(config.broken).toHaveLength(1);
      expect(config.broken?.[0]).toMatchObject({
        id: "01HQ0000000000000000BADDSL",
        name: "bad-dsl",
        summary: "(unreadable filters)",
      });
      // The message must be the same one a run-time attempt produces
      // (filtersToNode → FilterError), so a user never sees two different
      // messages for one fault.
      expect(config.broken?.[0]?.error).toMatch(/advanced filter does not parse/i);
      expect(config.broken?.[0]?.rawText).toContain("status = = = done AND");
    });

    it("carries the parser's position when the DSL error reports one", () => {
      const yaml = `
queries:
  - id: 01HQ0000000000000000POSDSL
    name: bad-dsl-pos
${filtersBlock([{ kind: "advanced", query: "status ===" }])}
`;
      const config = parseQueriesConfig(yaml);
      expect(config.broken).toHaveLength(1);
      const entry = config.broken?.[0];
      expect(entry?.error).toMatch(/at position \d+/);
      expect(entry?.position).toBeTypeOf("number");
    });

    it("a healthy view loads fine sitting beside a DSL-broken one (degrading, not blanking the catalog)", () => {
      const yaml = `
queries:
  - id: 01HQ00000000000000000000OK
    name: ok
${filtersBlock(statusFilter("backlog"))}
  - id: 01HQ0000000000000000BADDSL
    name: bad-dsl
${filtersBlock([{ kind: "advanced", query: "status = = = done AND" }])}
`;
      const config = parseQueriesConfig(yaml);
      expect(config.queries).toHaveLength(1);
      expect(config.queries[0]).toMatchObject({ id: "01HQ00000000000000000000OK", name: "ok" });
      expect(config.broken).toHaveLength(1);
      expect(config.broken?.[0]).toMatchObject({ id: "01HQ0000000000000000BADDSL", name: "bad-dsl" });
    });

    it("still throws QueriesConfigError on a duplicate id when the surviving entry has a DSL-broken filter (object-fatal)", () => {
      const yaml = `
queries:
  - id: 01HQ000000000000000000DUPE
    name: a
${filtersBlock(statusFilter("backlog"))}
  - id: 01HQ000000000000000000DUPE
    name: b
${filtersBlock([{ kind: "advanced", query: "status = = = done AND" }])}
`;
      expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
      expect(() => parseQueriesConfig(yaml)).toThrow(/duplicate query id/);
    });

    it("an uncombinable simple filter (object-fatal shape but semantically bad op/values) still degrades, not throws", () => {
      // Multiple values under an op with no sensible multi-value reading
      // (e.g. "<") is shape-valid (FilterSchema accepts it) but rejected by
      // filtersToNode — same per-entry degrade path as a bad DSL string.
      const yaml = `
queries:
  - id: 01HQ0000000000000000UNCOMB
    name: uncombinable
${filtersBlock([{ kind: "simple", field: "priority", op: "<", values: ["a", "b"] }])}
`;
      const config = parseQueriesConfig(yaml);
      expect(config.queries).toHaveLength(0);
      expect(config.broken).toHaveLength(1);
      expect(config.broken?.[0]?.error).toMatch(/cannot combine/);
    });

    it("still throws QueriesConfigError on a duplicate id even when a query is broken (object-fatal)", () => {
      const yaml = `
queries:
  - id: 01HQ000000000000000000DUPE
    name: a
${filtersBlock(statusFilter("backlog"))}
  - id: 01HQ000000000000000000DUPE
    name: b
    filters:
      - kind: bogus
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
${filtersBlock([{ kind: "simple", field: "sprint", op: "=", values: ["S-12"] }])}
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
${filtersBlock([
        { kind: "simple", field: "assignee", op: "=", values: ["me"] },
        { kind: "simple", field: "task_type", op: "=", values: ["bug"] },
      ])}
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
${filtersBlock([{ kind: "simple", field: "archived", op: "!=", values: ["true"] }])}
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
${filtersBlock([{ kind: "simple", field: "archived", op: "!=", values: ["true"] }])}
`;
      const config = parseQueriesConfig(yaml);
      expect(config.queries[0]?.display).toBeUndefined();
    });

    it("round-trips display through serialize + parse", () => {
      const yaml = `
queries:
  - id: 01HX0000000000000000000006
    name: rt
${filtersBlock([{ kind: "simple", field: "archived", op: "!=", values: ["true"] }])}
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
${filtersBlock([{ kind: "simple", field: "archived", op: "!=", values: ["true"] }])}
    display:
      mode: list
      unknown_key: foo
`;
      expect(() => parseQueriesConfig(yaml)).toThrow();
    });
  });
});

/**
 * K103 colour on a saved view (Ken, 2026-09-23: "if icon and color, then
 * yea" — colour follows icon wherever both exist).
 *
 * What these catch: the three shapes must SURVIVE a round-trip, and a
 * colour the contract rejects must cost its own field and nothing else.
 * The second is the corruption-guide requirement — a decorative value
 * must never take a view's filters out of service — and it is the one
 * that silently regresses, because a loader that drops too much still
 * "works".
 */
describe("saved view colour — the three shapes round-trip", () => {
  function viewWithColor(colorBlock: string): string {
    return `
queries:
  - id: 01HQ000000000000000000000C
    name: coloured
${filtersBlock(statusFilter("open"))}
${colorBlock}
`;
  }

  it("keeps a bare hex (shape 1) through parse and serialize", () => {
    const config = parseQueriesConfig(viewWithColor(`    color: "#1e6fcb"`));
    expect(config.queries[0]?.color).toBe("#1e6fcb");
    // And it survives being written back out — a field the serializer
    // forgets is a field every unrelated write deletes.
    const round = parseQueriesConfig(serializeQueriesConfig(config));
    expect(round.queries[0]?.color).toBe("#1e6fcb");
  });

  it("keeps a per-mode pair (shape 2) through parse and serialize", () => {
    const config = parseQueriesConfig(viewWithColor(
      `    color:\n      light: "#0F766E"\n      dark: "#39A88F"`,
    ));
    expect(config.queries[0]?.color).toEqual({ light: "#0F766E", dark: "#39A88F" });
    const round = parseQueriesConfig(serializeQueriesConfig(config));
    expect(round.queries[0]?.color).toEqual({ light: "#0F766E", dark: "#39A88F" });
  });

  it("keeps a palette reference (shape 3) through parse and serialize", () => {
    const config = parseQueriesConfig(viewWithColor(`    color:\n      palette: teal`));
    expect(config.queries[0]?.color).toEqual({ palette: "teal" });
    const round = parseQueriesConfig(serializeQueriesConfig(config));
    // A palette ref is stored as the ID and resolved live — the stored
    // value must still be the id, never a snapshotted hex.
    expect(round.queries[0]?.color).toEqual({ palette: "teal" });
  });

  it("drops a malformed colour WITHOUT breaking the view", () => {
    const config = parseQueriesConfig(viewWithColor(`    color: "not-a-colour"`));
    // The field is gone...
    expect(config.queries[0]?.color).toBeUndefined();
    // ...and that is ALL that is gone. The view is still a healthy,
    // runnable view: it kept its id, name and filters, and it did NOT
    // degrade into a `broken` entry. This is the field-local rule; a
    // loader that made this object-fatal would take the filters out of
    // service over a decorative typo.
    expect(config.broken).toBeUndefined();
    expect(config.queries).toHaveLength(1);
    expect(config.queries[0]?.name).toBe("coloured");
    expect(config.queries[0]?.filters).toEqual(statusFilter("open"));
  });

  it("drops a malformed NESTED colour too — the schema is the judge", () => {
    // The shape a line-oriented hex regex cannot see. `integrity.ts`
    // records this exact defect class: a hand-rolled copy of the colour
    // rule silently disagreed with the contract once K103 widened it.
    const config = parseQueriesConfig(viewWithColor(
      `    color:\n      light: "#0F766E"\n      dark: "nonsense"`,
    ));
    expect(config.queries[0]?.color).toBeUndefined();
    expect(config.queries[0]?.filters).toEqual(statusFilter("open"));
    expect(config.broken).toBeUndefined();
  });
});
