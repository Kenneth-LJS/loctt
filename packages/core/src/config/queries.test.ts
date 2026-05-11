import { describe, expect,it } from "vitest";

import { parseQueriesConfig, QueriesConfigError } from "./queries.js";
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
});
