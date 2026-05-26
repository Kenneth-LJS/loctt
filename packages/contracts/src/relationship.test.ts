import { describe, expect, it } from "vitest";

import {
  effectiveInverseKey,
  effectiveInverseLabel,
  isSymmetricRelationship,
  RelationshipDefSchema,
  relationshipTypeKeys,
} from "./index.js";

describe("RelationshipDefSchema — directional", () => {
  it("accepts a directional rel with inverse + inverse_label", () => {
    const parsed = RelationshipDefSchema.parse({
      key: "blocks",
      label: "Blocks",
      inverse: "is_blocked_by",
      inverse_label: "Is blocked by",
    });
    expect(parsed.key).toBe("blocks");
    expect(isSymmetricRelationship(parsed)).toBe(false);
    expect(effectiveInverseKey(parsed)).toBe("is_blocked_by");
    expect(effectiveInverseLabel(parsed)).toBe("Is blocked by");
  });

  it("accepts an explicit kind: directional", () => {
    const parsed = RelationshipDefSchema.parse({
      key: "blocks",
      label: "Blocks",
      kind: "directional",
      inverse: "is_blocked_by",
      inverse_label: "Is blocked by",
    });
    expect(parsed.kind).toBe("directional");
  });

  it("rejects a directional rel missing inverse", () => {
    expect(() => RelationshipDefSchema.parse({
      key: "blocks",
      label: "Blocks",
      inverse_label: "Is blocked by",
    })).toThrow(/requires an 'inverse'/);
  });

  it("rejects a directional rel missing inverse_label", () => {
    expect(() => RelationshipDefSchema.parse({
      key: "blocks",
      label: "Blocks",
      inverse: "is_blocked_by",
    })).toThrow(/requires an 'inverse_label'/);
  });

  it("rejects a directional rel where inverse equals key (declare symmetric instead)", () => {
    expect(() => RelationshipDefSchema.parse({
      key: "relates_to",
      label: "Relates to",
      inverse: "relates_to",
      inverse_label: "Relates to",
    })).toThrow(/declare it as symmetric/);
  });

  it("rejects explicit kind: directional with inverse equal to key", () => {
    expect(() => RelationshipDefSchema.parse({
      key: "relates_to",
      label: "Relates to",
      kind: "directional",
      inverse: "relates_to",
      inverse_label: "Relates to",
    })).toThrow(/declare it as symmetric/);
  });

  it("preserves structural + ranked on a directional rel", () => {
    const parsed = RelationshipDefSchema.parse({
      key: "parent",
      label: "Parent",
      kind: "directional",
      inverse: "child",
      inverse_label: "Child",
      structural: true,
      ranked: true,
    });
    expect(parsed.structural).toBe(true);
    expect(parsed.ranked).toBe(true);
  });
});

describe("relationshipTypeKeys", () => {
  it("returns just the key for symmetric rels", () => {
    const rel = RelationshipDefSchema.parse({
      key: "relates_to",
      label: "Relates to",
      kind: "symmetric",
    });
    expect(relationshipTypeKeys(rel)).toEqual(["relates_to"]);
  });

  it("returns key + inverse for directional rels", () => {
    const rel = RelationshipDefSchema.parse({
      key: "blocks",
      label: "Blocks",
      inverse: "is_blocked_by",
      inverse_label: "Is blocked by",
    });
    expect(relationshipTypeKeys(rel)).toEqual(["blocks", "is_blocked_by"]);
  });
});

describe("effectiveInverseKey defensive fallback", () => {
  it("falls back to key on a directional rel where inverse was not run through schema", () => {
    // Hand-construct a malformed object that bypasses superRefine. Defensive
    // guard prevents `undefined as string` from silently leaking.
    const fakeRel = { key: "x", label: "X" } as unknown as Parameters<typeof effectiveInverseKey>[0];
    expect(effectiveInverseKey(fakeRel)).toBe("x");
    expect(effectiveInverseLabel(fakeRel)).toBe("X");
  });
});

describe("RelationshipDefSchema — symmetric", () => {
  it("accepts a symmetric rel with only key + label + kind", () => {
    const parsed = RelationshipDefSchema.parse({
      key: "relates_to",
      label: "Relates to",
      kind: "symmetric",
    });
    expect(isSymmetricRelationship(parsed)).toBe(true);
    expect(effectiveInverseKey(parsed)).toBe("relates_to");
    expect(effectiveInverseLabel(parsed)).toBe("Relates to");
  });

  it("accepts a symmetric rel that redundantly sets inverse == key", () => {
    const parsed = RelationshipDefSchema.parse({
      key: "relates_to",
      label: "Relates to",
      kind: "symmetric",
      inverse: "relates_to",
      inverse_label: "Relates to",
    });
    expect(isSymmetricRelationship(parsed)).toBe(true);
  });

  it("rejects a symmetric rel with inverse different from key", () => {
    expect(() => RelationshipDefSchema.parse({
      key: "relates_to",
      label: "Relates to",
      kind: "symmetric",
      inverse: "different_key",
    })).toThrow(/must omit 'inverse' or set it to 'relates_to'/);
  });

  it("rejects a symmetric rel with inverse_label different from label", () => {
    expect(() => RelationshipDefSchema.parse({
      key: "relates_to",
      label: "Relates to",
      kind: "symmetric",
      inverse_label: "Different label",
    })).toThrow(/must omit 'inverse_label'/);
  });

  it("preserves structural and ranked flags on symmetric rels", () => {
    const parsed = RelationshipDefSchema.parse({
      key: "siblings",
      label: "Siblings",
      kind: "symmetric",
      structural: true,
      ranked: true,
    });
    expect(parsed.structural).toBe(true);
    expect(parsed.ranked).toBe(true);
  });
});
