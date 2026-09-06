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

  // @verifies DEG-12
  it("throws on missing keys object", () => {
    expect(() => parseState("foo: bar")).toThrow(StateError);
    expect(() => parseState("foo: bar")).toThrow("keys is required (expected record)");
  });

  it("throws on non-positive next_number", () => {
    const yaml = `keys:\n  task:\n    prefix: T-\n    next_number: 0`;
    expect(() => parseState(yaml)).toThrow(StateError);
    expect(() => parseState(yaml)).toThrow("keys.task.next_number must be >= 1");
  });

  it("throws on missing prefix", () => {
    const yaml = `keys:\n  task:\n    next_number: 1`;
    expect(() => parseState(yaml)).toThrow(StateError);
    expect(() => parseState(yaml)).toThrow("keys.task.prefix is required (expected string)");
  });

  it("throws on non-object root", () => {
    expect(() => parseState("42")).toThrow(StateError);
  });

  // --- Attribution guarantees (Phase 7B). state.yaml is object-fatal by
  // nature — a corrupt counter cannot be safely degraded (it would re-issue
  // a live key), so the value it adds is a well-attributed throw, not a
  // silent load. These lock that attribution.

  it("names the file in the message so the user knows what to fix", () => {
    const yaml = `keys:\n  task:\n    prefix: T-\n    next_number: 0`;
    expect(() => parseState(yaml)).toThrow("state.yaml is not valid:");
  });

  // @verifies DEG-12
  it("carries the config_invalid code, not the unknown/500 fallback", () => {
    // Before, StateError was a bare Error, so every surface reported a
    // hand-broken counter as an unattributed server failure. It is
    // identity-bearing user data, not a server fault.
    let thrown: unknown;
    try {
      parseState("foo: bar");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(StateError);
    expect((thrown as { code?: unknown }).code).toBe("config_invalid");
    expect((thrown as { dataState?: unknown }).dataState).toBe("not_saved");
  });

  it("attributes malformed YAML instead of leaking a raw parser error", () => {
    // Unterminated flow mapping — the `yaml` package throws its own error;
    // safeParseYaml must wrap it as a config_invalid naming the file.
    let thrown: unknown;
    try {
      parseState("keys: {task: {prefix: T-, next_number: 1");
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: unknown }).code).toBe("config_invalid");
    expect((thrown as { detail?: unknown }).detail).toContain("state.yaml");
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
