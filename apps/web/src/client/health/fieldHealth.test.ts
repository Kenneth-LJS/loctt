import { describe, expect, it } from "vitest";

import { fieldView, isDegraded, isElementOf, unrecognisedHealth, type WireHealth } from "./fieldHealth.ts";

const wh = (field: string, kind: WireHealth["kind"] = "wrong_type"): WireHealth => ({
  field, kind, rawText: `raw(${field})`, error: `bad ${field}`, repair: "set_or_remove",
});

describe("fieldView", () => {
  it("a healthy field: value present, no health", () => {
    const v = fieldView("due_date", "2026-01-01", []);
    expect(v.value).toBe("2026-01-01");
    expect(v.fieldHealth).toBeUndefined();
    expect(v.elementHealth).toEqual([]);
    expect(isDegraded(v)).toBe(false);
  });

  it("an intrinsic whole-field fault: value absent, fieldHealth present", () => {
    // due_date was lifted whole into health; frontmatter has no value.
    const v = fieldView("due_date", undefined, [wh("due_date")]);
    expect(v.value).toBeUndefined();
    expect(v.fieldHealth?.field).toBe("due_date");
    expect(v.elementHealth).toEqual([]);
    expect(isDegraded(v)).toBe(true);
  });

  it("an extrinsic element fault: value present AND element health (co-exist)", () => {
    // labels array is present and mostly valid; labels[2] is dangling.
    const v = fieldView("labels", ["a", "b", "bad"], [wh("labels[2]", "dangling")]);
    expect(v.value).toEqual(["a", "b", "bad"]); // value stays
    expect(v.fieldHealth).toBeUndefined();       // not a whole-field fault
    expect(v.elementHealth.map(h => h.field)).toEqual(["labels[2]"]);
    expect(isDegraded(v)).toBe(true);
  });

  it("collects MULTIPLE element faults on one field", () => {
    const v = fieldView("relationships", [{}, {}], [
      wh("relationships[0].target", "dangling"),
      wh("relationships[1].target", "dangling"),
    ]);
    expect(v.elementHealth).toHaveLength(2);
  });

  it("does not confuse a field with a similarly-named one (boundary)", () => {
    // `labels2` and `label` must NOT match element paths of `labels`.
    expect(isElementOf("labels2", "labels")).toBe(false);
    expect(isElementOf("label.x", "labels")).toBe(false);
    expect(isElementOf("labels[0]", "labels")).toBe(true);
    expect(isElementOf("labels.foo", "labels")).toBe(true);
    // And a field is not an element of itself.
    const v = fieldView("labels", ["a"], [wh("labels")]);
    expect(v.fieldHealth?.field).toBe("labels");
    expect(v.elementHealth).toEqual([]);
  });

  it("unrecognisedHealth returns only unrecognised-kind entries", () => {
    const health = [wh("jira_id", "unrecognised"), wh("due_date", "wrong_type")];
    expect(unrecognisedHealth(health).map(h => h.field)).toEqual(["jira_id"]);
  });
});
