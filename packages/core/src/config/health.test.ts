import { describe, expect, it } from "vitest";
import { z } from "zod";

import { brokenEntriesToPlain, collectValidEntries } from "./health.js";

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

/**
 * K29 / DEG-24: `brokenEntriesToPlain` must drop a broken entry whose
 * `id` collides with a valid entry already being written, so a save never
 * puts two members with one `id` on disk. The four id-keyed flat configs
 * (projects/labels/sprints/milestones) pass their valid ids as
 * `excludeIds`. Without the guard the duplicate is invisible to `doctor`
 * until the broken twin is repaired, then every write is refused.
 */
describe("brokenEntriesToPlain — id-collision guard (K29)", () => {
  // Build a BrokenEntry with a known id + rawText via collectValidEntries.
  function brokenWithId(id: string) {
    const { broken } = collectValidEntries(
      [{ id, n: "bad" }], // wrong type → corrupt, but its id/rawText survive
      EntrySchema,
      "test entry",
    );
    return broken;
  }

  it("drops a broken entry whose id is already among the valid ids", () => {
    const broken = brokenWithId("dup");
    const out = brokenEntriesToPlain(broken, new Set(["dup"]));
    expect(out).toHaveLength(0);
  });

  it("keeps a broken entry whose id does NOT collide", () => {
    const broken = brokenWithId("solo");
    const out = brokenEntriesToPlain(broken, new Set(["other"]));
    expect(out).toHaveLength(1);
    expect(out[0]?.["id"]).toBe("solo");
  });

  it("without excludeIds, keeps everything (back-compat)", () => {
    const broken = brokenWithId("x");
    expect(brokenEntriesToPlain(broken)).toHaveLength(1);
  });
});
