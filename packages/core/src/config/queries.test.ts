import { describe, expect,it } from "vitest";

import { parseQueriesConfig, QueriesConfigError } from "./queries.js";

const CANONICAL_YAML = `
queries:
  - name: recent-open
    query: archived != true and status != done
    sort:
      - field: updated_at
        direction: desc

  - name: blocked
    query: archived != true and status = blocked
    sort:
      - field: priority
        direction: desc
      - field: updated_at
        direction: desc

  - name: init-work
    query: text ~ "init"
    sort:
      - field: key
        direction: asc
`;

describe("parseQueriesConfig", () => {
  it("parses the canonical queries.yaml from the design doc", () => {
    const config = parseQueriesConfig(CANONICAL_YAML);

    expect(config.queries).toHaveLength(3);
    // `id` is auto-assigned (ulid) when missing from the YAML.
    expect(config.queries[0]).toMatchObject({
      name: "recent-open",
      query: 'archived != true and status != done',
      sort: [{ field: "updated_at", direction: "desc" }],
    });
    expect(config.queries[0]?.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(config.queries[1]?.sort).toHaveLength(2);
    expect(config.queries[2]).toMatchObject({
      name: "init-work",
      query: 'text ~ "init"',
      sort: [{ field: "key", direction: "asc" }],
    });
  });

  it("allows queries without sort", () => {
    const yaml = `
queries:
  - name: all
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

  it("throws on missing query name", () => {
    const yaml = `queries:\n  - query: status = open`;
    expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
    expect(() => parseQueriesConfig(yaml)).toThrow("queries[0].name is required (expected string)");
  });

  it("throws on invalid sort direction", () => {
    const yaml = `
queries:
  - name: bad
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
  - name: broken
    query: "status =="
`;
    expect(() => parseQueriesConfig(yaml)).toThrow(/not a valid query/);
  });
});
