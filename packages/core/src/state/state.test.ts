import { describe, expect,it } from "vitest";

import { parseState, serializeState, StateError } from "./state.js";

const CANONICAL_YAML = `
keys:
  task:
    prefix: T-
    next_number: 124
`;

describe("parseState", () => {
  it("parses the canonical state.yaml from the design doc", () => {
    const state = parseState(CANONICAL_YAML);
    expect(state.keys["task"]).toEqual({ prefix: "T-", next_number: 124 });
  });

  it("supports multiple entity types", () => {
    const yaml = `
keys:
  task:
    prefix: T-
    next_number: 10
  epic:
    prefix: E-
    next_number: 3
`;
    const state = parseState(yaml);
    expect(Object.keys(state.keys)).toEqual(["task", "epic"]);
    expect(state.keys["epic"]).toEqual({ prefix: "E-", next_number: 3 });
  });

  it("throws on missing keys object", () => {
    expect(() => parseState("foo: bar")).toThrow("keys must be an object");
  });

  it("throws on non-positive next_number", () => {
    const yaml = `keys:\n  task:\n    prefix: T-\n    next_number: 0`;
    expect(() => parseState(yaml)).toThrow("must be a positive integer");
  });

  it("throws on missing prefix", () => {
    const yaml = `keys:\n  task:\n    next_number: 1`;
    expect(() => parseState(yaml)).toThrow("must be a non-empty string");
  });

  it("throws on non-object root", () => {
    expect(() => parseState("42")).toThrow(StateError);
  });
});

describe("serializeState", () => {
  it("round-trips through parse/serialize", () => {
    const original = parseState(CANONICAL_YAML);
    const serialized = serializeState(original);
    const reparsed = parseState(serialized);
    expect(reparsed).toEqual(original);
  });

  it("produces valid YAML", () => {
    const state = { keys: { task: { prefix: "X-", next_number: 42 } } };
    const yaml = serializeState(state);
    expect(yaml).toContain("prefix: X-");
    expect(yaml).toContain("next_number: 42");
  });
});
