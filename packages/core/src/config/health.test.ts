import { describe, expect, it } from "vitest";
import { z } from "zod";

import { collectValidEntries } from "./health.js";

/**
 * Phase-7B foundation: the generalized per-entry tolerant collect that
 * every list-config loader routes corruption through.
 */

const EntrySchema = z.object({
  id: z.string().min(1),
  n: z.number(),
}).strict();

describe("collectValidEntries", () => {
  it("collects valid entries and sets corrupt ones aside as BrokenEntry", () => {
    const { valid, broken } = collectValidEntries(
      [
        { id: "a", n: 1 },
        { id: "b", n: "not-a-number" }, // wrong type
        { id: "c", n: 3 },
      ],
      EntrySchema,
      "test entry",
    );
    // The healthy entries loaded...
    expect(valid.map(v => v.id)).toEqual(["a", "c"]);
    // ...and the corrupt one is set aside, named by id and index.
    expect(broken).toHaveLength(1);
    expect(broken[0]?.id).toBe("b");
    expect(broken[0]?.index).toBe(1);
    expect(broken[0]?.error).toMatch(/number/i);
    expect(broken[0]?.rawText).toContain("not-a-number");
  });

  it("names a corrupt entry by index even when its id is unreadable", () => {
    const { valid, broken } = collectValidEntries(
      [{ n: 1 }], // id missing entirely
      EntrySchema,
      "test entry",
    );
    expect(valid).toHaveLength(0);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.id).toBeUndefined();
    expect(broken[0]?.index).toBe(0);
  });

  it("an all-valid list produces no broken entries", () => {
    const { valid, broken } = collectValidEntries(
      [{ id: "a", n: 1 }, { id: "b", n: 2 }],
      EntrySchema,
      "test entry",
    );
    expect(valid).toHaveLength(2);
    expect(broken).toHaveLength(0);
  });
});
