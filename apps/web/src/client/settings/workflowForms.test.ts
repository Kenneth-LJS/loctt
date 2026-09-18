import type { CustomFieldDef } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  buildCustomField,
  buildRelationship,
  buildStatus,
  entryChangedOnDisk,
  keyFromLabel,
  validateNewCustomField,
  validateNewEntry,
  validateNewRelationship,
} from "./workflowForms.ts";

/**
 * The pure create/edit-form rules behind the B2 workflow dialogs. Tested
 * without a browser because these decide what the panel PUTs — a UI test
 * asserting the request can pass while the rule is wrong if the rule is
 * not itself pinned.
 */

describe("keyFromLabel", () => {
  it("lowercases and underscores a label", () => {
    expect(keyFromLabel("In Review")).toBe("in_review");
  });
  it("prefixes a label that would start with a digit", () => {
    // A key must start with a letter; a bare "2024" is not a valid key.
    expect(keyFromLabel("2024 Q1")).toBe("k_2024_q1");
  });
});

describe("validateNewEntry (SET-46/47)", () => {
  it("rejects a duplicate key before the PUT, naming the collision", () => {
    const problems = validateNewEntry({ key: "todo", label: "To do" }, ["todo", "done"]);
    // SET-46: "Creating a duplicate key is rejected before PUT with a
    // message naming the collision."
    expect(problems.key).toBeDefined();
    expect(problems.key).toContain("todo");
    expect(problems.key).toMatch(/already in use|unique/i);
  });

  it("accepts a fresh, well-formed key", () => {
    expect(validateNewEntry({ key: "blocked", label: "Blocked" }, ["todo"])).toEqual({});
  });

  it("rejects a malformed key and a missing label", () => {
    const problems = validateNewEntry({ key: "Bad Key!", label: "" }, []);
    expect(problems.key).toBeDefined();
    expect(problems.label).toBeDefined();
  });
});

describe("buildStatus (SET-46)", () => {
  it("carries key + label + category, trimmed, and no default unless asked", () => {
    const s = buildStatus({ key: " qa ", label: " QA ", category: "active" });
    expect(s).toEqual({ key: "qa", label: "QA", category: "active" });
    expect("default" in s).toBe(false);
  });
});

describe("validateNewRelationship (SET-48)", () => {
  it("requires an inverse for a directional relationship", () => {
    const problems = validateNewRelationship(
      { key: "blocks", label: "Blocks", symmetric: false, inverse: "", inverse_label: "", graph: "none", ranked: false },
      [],
    );
    // The schema's superRefine rejects a directional rel with no inverse;
    // the dialog blocks it before the PUT.
    expect(problems.inverse).toBeDefined();
    expect(problems.inverse_label).toBeDefined();
  });

  it("does not require an inverse for a symmetric relationship", () => {
    const problems = validateNewRelationship(
      { key: "relates", label: "Relates to", symmetric: true, inverse: "", inverse_label: "", graph: "none", ranked: false },
      [],
    );
    expect(problems.inverse).toBeUndefined();
    expect(problems.inverse_label).toBeUndefined();
  });
});

describe("buildRelationship (SET-48)", () => {
  it("drops inverse fields and writes kind:symmetric when symmetric", () => {
    const r = buildRelationship(
      { key: "relates", label: "Relates to", symmetric: true, inverse: "x", inverse_label: "y", graph: "none", ranked: false },
    );
    expect(r.kind).toBe("symmetric");
    expect("inverse" in r).toBe(false);
    expect("inverse_label" in r).toBe(false);
  });

  it("keeps the inverse pair when directional", () => {
    const r = buildRelationship(
      { key: "blocks", label: "Blocks", symmetric: false, inverse: "blocked_by", inverse_label: "Blocked by", graph: "acyclic", ranked: true },
    );
    expect(r.kind).toBe("directional");
    expect(r.inverse).toBe("blocked_by");
    expect(r.inverse_label).toBe("Blocked by");
    expect(r.graph).toBe("acyclic");
    expect(r.ranked).toBe(true);
  });
});

describe("validateNewCustomField (SET-49)", () => {
  it("requires at least one value for an enum field", () => {
    const problems = validateNewCustomField(
      { key: "size", label: "Size", type: "enum", multi: false, searchable: false, values: [] },
      [],
    );
    expect(problems.values).toBeDefined();
  });

  it("rejects a duplicate value key", () => {
    const problems = validateNewCustomField(
      {
        key: "size", label: "Size", type: "enum", multi: false, searchable: false,
        values: [{ key: "s", label: "Small" }, { key: "s", label: "Small again" }],
      },
      [],
    );
    expect(problems.values).toMatch(/duplicate/i);
  });

  it("accepts a well-formed enum field", () => {
    const problems = validateNewCustomField(
      {
        key: "size", label: "Size", type: "enum", multi: true, searchable: true,
        values: [{ key: "s", label: "Small" }, { key: "l", label: "Large" }],
      },
      [],
    );
    expect(problems).toEqual({});
  });
});

describe("buildCustomField (SET-49)", () => {
  it("omits values for a non-enum type", () => {
    const f = buildCustomField(
      { key: "points", label: "Points", type: "number", multi: false, searchable: true, values: [] },
    );
    expect("values" in f).toBe(false);
    expect(f.type).toBe("number");
  });
});

describe("entryChangedOnDisk (SET-28)", () => {
  const base: CustomFieldDef = { key: "points", label: "Points", type: "number", multi: false, searchable: false };

  it("is false when the fresh document still holds the identical entry", () => {
    expect(entryChangedOnDisk(base, [{ ...base }])).toBe(false);
  });

  it("is true when the entry was hand-edited underneath", () => {
    // SET-28: a save must be refused when the file changed under an open
    // Edit dialog — this is the detector that refuses it.
    expect(entryChangedOnDisk(base, [{ ...base, label: "Story points" }])).toBe(true);
  });

  it("is true when the entry vanished from the file", () => {
    expect(entryChangedOnDisk(base, [])).toBe(true);
  });
});
