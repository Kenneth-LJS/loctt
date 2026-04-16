import { describe, it, expect } from "vitest";
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
    expect(config.queries[0]).toEqual({
      name: "recent-open",
      query: 'archived != true and status != done',
      sort: [{ field: "updated_at", direction: "desc" }],
    });
    expect(config.queries[1]?.sort).toHaveLength(2);
    expect(config.queries[2]).toEqual({
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
    expect(() => parseQueriesConfig("{}")).toThrow("queries must be an array");
  });

  it("throws on missing query name", () => {
    const yaml = `queries:\n  - query: status = open`;
    expect(() => parseQueriesConfig(yaml)).toThrow(QueriesConfigError);
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
    expect(() => parseQueriesConfig(yaml)).toThrow("must be one of: asc, desc");
  });

  it("throws on non-object root", () => {
    expect(() => parseQueriesConfig("42")).toThrow(QueriesConfigError);
  });
});
