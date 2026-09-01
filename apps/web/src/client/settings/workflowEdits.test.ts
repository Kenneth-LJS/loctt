import type { CustomFieldDef, EstimationConfig, PriorityDef, RelationshipDef, StatusDef } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  duplicateHolidayIndices,
  enumSortBasis,
  invalidHolidayIndices,
  isValidIsoDate,
  renumberPriorities,
  reorder,
  setDefaultStatus,
  setRelationshipSymmetric,
  validateEstimation,
} from "./workflowEdits.ts";

/**
 * These are the rules that decide what the panels **send**. Asserting
 * them here rather than only through the browser is deliberate: a UI
 * test that reads the file on disk can pass while the client posted
 * the wrong value, if a layer in between repaired it. The server does
 * normalise (`applyWorkflowEdit` re-validates the whole document), so
 * the request itself needs its own guard.
 */

const prio = (key: string, value?: number): PriorityDef =>
  value === undefined ? { key, label: key } : { key, label: key, value };

describe("reorder", () => {
  it("moves an item to the target index", () => {
    expect(reorder(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(reorder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("returns the list unchanged when the source index is out of range", () => {
    expect(reorder(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
});

describe("renumberPriorities (SET-6, SET-21)", () => {
  it("recomputes value from position so a priority sort matches the order", () => {
    // SET-21: Critical moved from last to first must sort first, and
    // that only happens if `value` moved with it. A reorder that only
    // shuffled array positions is the bug.
    const stored = [prio("low", 10), prio("med", 20), prio("critical", 30)];
    const moved = reorder(stored, 2, 0);
    const next = renumberPriorities(moved);

    expect(next.map(p => p.key)).toEqual(["critical", "low", "med"]);
    expect(next[0]?.value).toBeLessThan(next[1]?.value ?? Infinity);
    expect(next[1]?.value).toBeLessThan(next[2]?.value ?? Infinity);
  });

  it("renumbers every priority, not only the ones that moved", () => {
    // A partial renumber is how two priorities end up sharing a value,
    // which makes the sort non-deterministic rather than merely wrong.
    const next = renumberPriorities([prio("a", 99), prio("b", 99), prio("c")]);
    const values = next.map(p => p.value);
    expect(new Set(values).size).toBe(3);
    expect(values.every(v => typeof v === "number")).toBe(true);
  });

  it("leaves gaps between values so a later hand-insert needs no renumber", () => {
    const next = renumberPriorities([prio("a"), prio("b")]);
    expect((next[1]?.value ?? 0) - (next[0]?.value ?? 0)).toBeGreaterThan(1);
  });
});

describe("setRelationshipSymmetric (SET-5, CW-15)", () => {
  const directional: RelationshipDef = {
    key: "blocks",
    label: "Blocks",
    kind: "directional",
    inverse: "blocked_by",
    inverse_label: "Blocked by",
  };

  it("ticking writes kind and DROPS the inverse fields", () => {
    const next = setRelationshipSymmetric(directional, true);

    expect(next.kind).toBe("symmetric");
    // The schema rejects a symmetric relationship whose `inverse`
    // differs from its `key`, so leaving `blocked_by` in place would
    // make the document unsavable — a save the panel would report as
    // a server error the user cannot act on.
    expect("inverse" in next).toBe(false);
    expect("inverse_label" in next).toBe(false);
  });

  it("never writes a `symmetric` boolean — the schema has no such field", () => {
    const next = setRelationshipSymmetric(directional, true) as Record<string, unknown>;
    expect("symmetric" in next).toBe(false);
  });

  it("unticking restores the previous inverse values, not blanks", () => {
    const symmetric = setRelationshipSymmetric(directional, true);
    const back = setRelationshipSymmetric(symmetric, false, {
      inverse: "blocked_by",
      inverse_label: "Blocked by",
    });

    expect(back.kind).toBe("directional");
    expect(back.inverse).toBe("blocked_by");
    expect(back.inverse_label).toBe("Blocked by");
  });
});

describe("validateEstimation (SET-9, SET-35)", () => {
  it("blocks custom_enum with no preset values, on the preset-values field", () => {
    const cfg: EstimationConfig = { enabled: true, unit: "custom_enum", unit_label: "size" };
    const problems = validateEstimation(cfg);

    // SET-35: attached to the field, and it names both requirements.
    expect(problems.preset_values).toBeDefined();
    expect(problems.preset_values).toMatch(/preset values/i);
    expect(problems.preset_values).toMatch(/unit label/i);
  });

  it("requires unit_label for any custom_* mode", () => {
    expect(validateEstimation({ enabled: true, unit: "custom_numeric" }).unit_label)
      .toBeDefined();
    expect(validateEstimation({ enabled: true, unit: "custom_enum", preset_values: ["S"] }).unit_label)
      .toBeDefined();
  });

  it("clears the error when the mode goes back to a numeric one", () => {
    // SET-35's last bullet: switching back to a numeric mode clears it.
    expect(validateEstimation({ enabled: true, unit: "points" })).toEqual({});
    expect(validateEstimation({ enabled: true, unit: "hours" })).toEqual({});
  });

  it("accepts a complete custom_enum config", () => {
    expect(validateEstimation({
      enabled: true,
      unit: "custom_enum",
      unit_label: "size",
      preset_values: ["XS", "S"],
    })).toEqual({});
  });
});

describe("holiday validation (SET-36, SET-23)", () => {
  it("rejects a date that parses as a string but is not a real date", () => {
    // The literal value SET-36 names. A regex-only check passes it.
    expect(isValidIsoDate("2026-13-45")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-05-01")).toBe(true);
  });

  it("marks only the offending row, keeping the valid ones (SET-36)", () => {
    const holidays = [
      { date: "2026-01-01" }, { date: "2026-05-01" }, { date: "2026-13-45" },
    ];
    // Returns the bad INDEX, not "the good rows" — a function that
    // returned the survivors is the shape of the 12-of-13 bug.
    expect(invalidHolidayIndices(holidays)).toEqual([2]);
    expect(holidays).toHaveLength(3);
  });

  it("marks every occurrence of a duplicate date rather than deduplicating", () => {
    // SET-23: duplicates are SHOWN as duplicates. Both rows carry the
    // marker, so the user can see which pair to reconcile.
    expect(duplicateHolidayIndices([
      { date: "2026-01-01" }, { date: "2026-05-01" }, { date: "2026-01-01" },
    ])).toEqual([0, 2]);
  });
});

describe("setDefaultStatus (SET-3)", () => {
  const statuses: StatusDef[] = [
    { key: "todo", label: "To do", category: "pending", default: true },
    { key: "doing", label: "Doing", category: "active" },
  ];

  it("moves the marker, clearing it from the previous holder in one edit", () => {
    // WorkflowConfigSchema rejects zero or two defaults, so an edit
    // that only set the new one would produce an unsavable document.
    const next = setDefaultStatus(statuses, "doing");
    expect(next.filter(s => s.default === true).map(s => s.key)).toEqual(["doing"]);
    expect("default" in (next[0] as object)).toBe(false);
  });
});

describe("enumSortBasis (SET-8)", () => {
  const field = (values: { key: string; label: string; value?: number }[]): CustomFieldDef => ({
    key: "size", label: "Size", type: "enum", multi: false, searchable: false, values,
  });

  it("reports weight sorting when any value carries one", () => {
    expect(enumSortBasis(field([
      { key: "xs", label: "XS", value: 1 }, { key: "s", label: "S" },
    ]))).toBe("weight");
  });

  it("falls back to declared order when every weight is cleared", () => {
    // SET-8's last bullet — the panel says which fallback applies, so
    // the basis has to be a value it can read, not an inference.
    expect(enumSortBasis(field([
      { key: "xs", label: "XS" }, { key: "s", label: "S" },
    ]))).toBe("declared");
  });
});
