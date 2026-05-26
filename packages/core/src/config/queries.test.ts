import { describe, expect,it } from "vitest";

import { parseQueriesConfig, QueriesConfigError, serializeQueriesConfig } from "./queries.js";
import { YamlSyntaxError } from "./yaml-coerce.js";

const CANONICAL_YAML = `
queries:
  - id: 01HQ000000000000000000000A
    name: recent-open
    query: archived != true and status != done
    sort:
      - field: updated_at
        direction: desc

  - id: 01HQ000000000000000000000B
    name: blocked
    query: archived != true and status = blocked
    sort:
      - field: priority
        direction: desc
      - field: updated_at
        direction: desc

  - id: 01HQ000000000000000000000C
    name: init-work
    query: text ~ "init"
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

  it("throws when a saved query string is unparseable", () => {
    const yaml = `
queries:
  - id: 01HQ000000000000000000000Y
    name: broken
    query: "status =="
`;
    expect(() => parseQueriesConfig(yaml)).toThrow(/not a valid query/);
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
    display:
      mode: list
      unknown_key: foo
`;
      expect(() => parseQueriesConfig(yaml)).toThrow();
    });
  });
});
