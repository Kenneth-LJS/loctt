import { describe, expect, it } from "vitest";

import { ListViewConfigSchema } from "./list-view.js";

describe("ListViewConfig", () => {
  it("accepts an empty object (use all defaults)", () => {
    expect(ListViewConfigSchema.parse({})).toEqual({});
  });

  it("accepts visible and hidden arrays", () => {
    const parsed = ListViewConfigSchema.parse({
      filters: { visible: ["status", "priority"], hidden: ["type"] },
    });
    expect(parsed.filters?.visible).toEqual(["status", "priority"]);
    expect(parsed.filters?.hidden).toEqual(["type"]);
  });

  it("accepts filters with only one of visible/hidden", () => {
    const a = ListViewConfigSchema.parse({ filters: { visible: ["status"] } });
    const b = ListViewConfigSchema.parse({ filters: { hidden: ["type"] } });
    expect(a.filters?.visible).toEqual(["status"]);
    expect(b.filters?.hidden).toEqual(["type"]);
  });

  it("rejects empty entries in visible/hidden", () => {
    expect(() =>
      ListViewConfigSchema.parse({ filters: { visible: [""] } }),
    ).toThrow();
    expect(() =>
      ListViewConfigSchema.parse({ filters: { hidden: [""] } }),
    ).toThrow();
  });

  it("rejects unknown top-level keys (strict)", () => {
    expect(() =>
      ListViewConfigSchema.parse({ filters: {}, extra: true }),
    ).toThrow();
  });

  it("rejects unknown filter keys (strict)", () => {
    expect(() =>
      ListViewConfigSchema.parse({ filters: { invalid: true } }),
    ).toThrow();
  });

  it("rejects duplicates inside visible", () => {
    expect(() =>
      ListViewConfigSchema.parse({
        filters: { visible: ["status", "status"] },
      }),
    ).toThrow(/duplicate entry 'status' in visible/);
  });

  it("rejects duplicates inside hidden", () => {
    expect(() =>
      ListViewConfigSchema.parse({
        filters: { hidden: ["type", "type"] },
      }),
    ).toThrow(/duplicate entry 'type' in hidden/);
  });

  it("rejects a key appearing in both visible and hidden", () => {
    // "hidden wins" precedence is documented, but accepting both is
    // a typo magnet across team edits — make the user remove one so
    // intent is unambiguous.
    expect(() =>
      ListViewConfigSchema.parse({
        filters: { visible: ["status", "type"], hidden: ["type"] },
      }),
    ).toThrow(/'type' appears in both visible and hidden/);
  });
});
