import { describe, expect, it } from "vitest";

import { coerceYaml, safeParseYaml, YamlSyntaxError } from "./yaml-coerce.js";

describe("safeParseYaml", () => {
  it("returns parsed value for well-formed YAML", () => {
    expect(safeParseYaml("a: 1\nb: 2\n", "test.yaml")).toEqual({ a: 1, b: 2 });
  });

  it("returns null for empty content", () => {
    // The `yaml` library treats an empty document as null. The
    // domain loaders handle that case themselves; safeParseYaml
    // should not synthesize a different shape.
    expect(safeParseYaml("", "test.yaml")).toBeNull();
  });

  it("wraps a parse failure as YamlSyntaxError tagged with the file label", () => {
    // Unterminated flow mapping is reliably a parse error.
    expect(() => safeParseYaml("{ a: 1, b: 2", "labels.yaml")).toThrow(YamlSyntaxError);
    // The file leads the headline: it is the one thing the user needs
    // in order to fix it, and SHL-43 asks for it by name.
    expect(() => safeParseYaml("{ a: 1, b: 2", "labels.yaml")).toThrow(/labels\.yaml/);

    // The parser's own wording stays available, but in `detail` rather
    // than the headline. This assertion used to be on `message`, which
    // is where "malformed YAML" lived before 2026-08-28 — the M1 gate
    // (F4) found that shape reaching the surface as a 500 with
    // `code: "unknown"`, so the class became a `LocttError` and the
    // machinery moved behind a disclosure (ERR-16).
    const err = (() => {
      try { safeParseYaml("{ a: 1, b: 2", "labels.yaml"); return null; }
      catch (e) { return e as YamlSyntaxError; }
    })();
    expect(err).toBeInstanceOf(YamlSyntaxError);
    expect(err?.code).toBe("config_invalid");
    expect(err?.detail).toMatch(/malformed YAML/);
    expect(err?.detail).toMatch(/labels\.yaml/);
    // And the headline stays free of it.
    expect(err?.message).not.toMatch(/malformed YAML/);
  });

  it("preserves the underlying parser message in the wrapped error", () => {
    try {
      safeParseYaml("[a, b, c", "queries.yaml");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(YamlSyntaxError);
      // The detail should contain SOME hint from the yaml library
      // (line/column or a description), not just the generic label —
      // losing it would make the disclosure pointless.
      const detail = (err as YamlSyntaxError).detail ?? "";
      expect(detail.length).toBeGreaterThan("queries.yaml: malformed YAML: ".length);
    }
  });
});

describe("coerceYaml", () => {
  it("turns Date values into YYYY-MM-DD strings", () => {
    const d = new Date("2026-05-11T12:00:00Z");
    expect(coerceYaml(d)).toBe("2026-05-11");
  });

  it("walks nested objects and arrays", () => {
    const input = {
      a: new Date("2026-01-01T00:00:00Z"),
      b: [new Date("2026-02-02T00:00:00Z"), { c: new Date("2026-03-03T00:00:00Z") }],
    };
    expect(coerceYaml(input)).toEqual({
      a: "2026-01-01",
      b: ["2026-02-02", { c: "2026-03-03" }],
    });
  });

  it("passes through primitives unchanged", () => {
    expect(coerceYaml("x")).toBe("x");
    expect(coerceYaml(42)).toBe(42);
    expect(coerceYaml(null)).toBeNull();
    expect(coerceYaml(undefined)).toBeUndefined();
    expect(coerceYaml(true)).toBe(true);
  });
});
