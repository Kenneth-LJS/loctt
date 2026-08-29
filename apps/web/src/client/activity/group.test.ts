import type { HistoryEntry } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import { groupActivity } from "./group.ts";

/**
 * Grouping is where CMT-16's collapse rules and CMT-30's ordering
 * claim live, and both are the kind of behaviour a UI test proves
 * least about: a spec asserting "the bulk row appears" passes on a
 * grouping that collapses everything, and a spec asserting "the
 * entries are in this order" passes on a fixture whose order is
 * already what a bug would produce.
 *
 * So the discriminating cases are here, where the fixture can be built
 * to *require* the rule — a run broken by an unrelated entry, two runs
 * of the same id, an entry with no id between two that have none
 * either.
 *
 * ## What the ordering tests do *not* claim
 *
 * Measured, not assumed: inserting a **stable descending** sort on
 * `timestamp` leaves every test here green. That is correct rather
 * than vacuous — `Array.sort` is specified stable, the server's input
 * is already descending, so such a sort is a genuine no-op and there
 * is no defect to catch. What the two ordering tests *do* catch is a
 * sort whose tiebreak is not the input order: adding
 * `|| Math.random() - 0.5` to the comparator turns both red, every
 * run. That is the failure CMT-30 describes ("do not reshuffle
 * between renders"), and it is the one being defended.
 */

const TZ = "UTC";

function entry(over: Partial<HistoryEntry> & { timestamp: string }): HistoryEntry {
  return { kind: "field_change", ...over };
}

describe("groupActivity", () => {
  /** @verifies CMT-16 */
  it("collapses a run of consecutive entries sharing a bulk_op_id", () => {
    const sections = groupActivity(
      [
        entry({ timestamp: "2026-08-28T09:00:00.000Z", bulk_op_id: "B1" }),
        entry({ timestamp: "2026-08-28T09:00:01.000Z", bulk_op_id: "B1" }),
        entry({ timestamp: "2026-08-28T09:00:02.000Z", bulk_op_id: "B1" }),
      ],
      TZ,
    );

    expect(sections).toHaveLength(1);
    const rows = sections[0]?.rows ?? [];
    // One row, holding all three — not three rows, and not one row
    // holding one.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe("bulk");
    expect(rows[0]?.type === "bulk" ? rows[0].entries.length : 0).toBe(3);
  });

  /**
   * CMT-16's third bullet, and the one assertion that separates
   * "groups by id" from "groups by *consecutive* id".
   *
   * A grouping that keyed a map by `bulk_op_id` — the obvious wrong
   * implementation — produces **two** rows here (one bulk of two, one
   * single) and passes any test that only counts bulk rows. This
   * asserts the shape: single, bulk-of-two is wrong; the answer is
   * bulk, single, bulk.
   */
  /** @verifies CMT-16 */
  it("breaks a bulk group when an unrelated entry sits between two of its entries", () => {
    const sections = groupActivity(
      [
        entry({ timestamp: "2026-08-28T09:00:00.000Z", bulk_op_id: "B1" }),
        entry({ timestamp: "2026-08-28T09:00:01.000Z", bulk_op_id: "B1" }),
        entry({ timestamp: "2026-08-28T09:00:02.000Z", kind: "comment_added" }),
        entry({ timestamp: "2026-08-28T09:00:03.000Z", bulk_op_id: "B1" }),
        entry({ timestamp: "2026-08-28T09:00:04.000Z", bulk_op_id: "B1" }),
      ],
      TZ,
    );

    const rows = sections[0]?.rows ?? [];
    expect(rows.map(r => r.type)).toEqual(["bulk", "single", "bulk"]);
    expect(rows[0]?.type === "bulk" ? rows[0].entries.length : 0).toBe(2);
    expect(rows[2]?.type === "bulk" ? rows[2].entries.length : 0).toBe(2);
  });

  /** CMT-16's fourth bullet. Two `undefined`s are equal — hence a guard. */
  /** @verifies CMT-16 */
  it("never collapses entries that have no bulk_op_id", () => {
    const sections = groupActivity(
      [
        entry({ timestamp: "2026-08-28T09:00:00.000Z" }),
        entry({ timestamp: "2026-08-28T09:00:01.000Z" }),
        entry({ timestamp: "2026-08-28T09:00:02.000Z" }),
      ],
      TZ,
    );

    expect((sections[0]?.rows ?? []).map(r => r.type))
      .toEqual(["single", "single", "single"]);
  });

  /** @verifies CMT-16 */
  it("leaves a lone entry with a bulk_op_id as a plain row", () => {
    const sections = groupActivity(
      [
        entry({ timestamp: "2026-08-28T09:00:00.000Z", bulk_op_id: "B1" }),
        entry({ timestamp: "2026-08-28T09:00:01.000Z", bulk_op_id: "B2" }),
      ],
      TZ,
    );

    expect((sections[0]?.rows ?? []).map(r => r.type))
      .toEqual(["single", "single"]);
  });

  /**
   * CMT-30. The strongest available fixture: every timestamp
   * identical, so *any* comparator-based ordering is free to
   * reshuffle and only "do not sort" is guaranteed to hold. The
   * entries are distinguished by `field`, which is what is asserted —
   * asserting the timestamps would pass on any permutation.
   */
  /** @verifies CMT-30 */
  it("preserves input order for entries sharing a timestamp", () => {
    const ts = "2026-08-28T09:00:00.000Z";
    const input = ["a", "b", "c", "d", "e"].map(field =>
      entry({ timestamp: ts, field }));

    const rows = groupActivity(input, TZ)[0]?.rows ?? [];
    expect(
      rows.map(r => (r.type === "single" ? r.entry.field : "?")),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  /**
   * CMT-30's "does not reshuffle ... across 'Load more'".
   *
   * The feed regroups the *accumulated* list on every render, so
   * grouping page 1 and grouping page 1+2 must agree on page 1's
   * prefix. A comparator sorting the whole list is exactly what breaks
   * this: it sorts a different input the second time, and equal
   * timestamps can land anywhere within their tie.
   */
  /** @verifies CMT-30 */
  it("keeps the first page's order as a prefix once a second page loads", () => {
    const ts = "2026-08-28T09:00:00.000Z";
    const page1 = ["a", "b", "c"].map(field => entry({ timestamp: ts, field }));
    const page2 = ["d", "e", "f"].map(field => entry({ timestamp: ts, field }));

    const fields = (input: readonly HistoryEntry[]): string[] =>
      (groupActivity(input, TZ)[0]?.rows ?? [])
        .map(r => (r.type === "single" ? r.entry.field ?? "?" : "?"));

    const first = fields(page1);
    const both = fields([...page1, ...page2]);
    expect(both.slice(0, first.length)).toEqual(first);
    expect(both).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  /**
   * CMT-13's last bullet. The two instants are 20 minutes apart and
   * straddle midnight in Singapore but not in UTC, so the same input
   * yields two sections in one zone and one in the other. A test using
   * a single timezone could not tell whether the zone was used at all.
   */
  /** @verifies CMT-13 */
  it("cuts days in the workspace timezone, not UTC", () => {
    const input = [
      entry({ timestamp: "2026-08-27T15:50:00.000Z" }), // 23:50 SGT on the 27th
      entry({ timestamp: "2026-08-27T16:10:00.000Z" }), // 00:10 SGT on the 28th
    ];

    expect(groupActivity(input, "UTC").map(s => s.day)).toEqual(["2026-08-27"]);
    expect(groupActivity(input, "Asia/Singapore").map(s => s.day))
      .toEqual(["2026-08-27", "2026-08-28"]);
  });

  /**
   * CMT-17's last bullet. A day revisited later in the list — which a
   * git-merged `_history.yaml` genuinely produces, since `mergeHistory`
   * concatenates two timelines — must render under one heading.
   */
  /** @verifies CMT-17 */
  it("renders one section per day even when a day recurs later in the list", () => {
    const sections = groupActivity(
      [
        entry({ timestamp: "2026-08-28T09:00:00.000Z", field: "a" }),
        entry({ timestamp: "2026-08-27T09:00:00.000Z", field: "b" }),
        entry({ timestamp: "2026-08-28T08:00:00.000Z", field: "c" }),
      ],
      TZ,
    );

    expect(sections.map(s => s.day)).toEqual(["2026-08-28", "2026-08-27"]);
    expect(sections[0]?.rows).toHaveLength(2);
    expect(sections[1]?.rows).toHaveLength(1);
  });

  /** CMT-28's second bullet: a missing actor breaks neither rule. */
  /** @verifies CMT-28 */
  it("groups and collapses entries that have no actor", () => {
    const sections = groupActivity(
      [
        entry({ timestamp: "2026-08-28T09:00:00.000Z", bulk_op_id: "B1" }),
        entry({ timestamp: "2026-08-28T09:00:01.000Z", bulk_op_id: "B1" }),
      ],
      TZ,
    );

    expect(sections).toHaveLength(1);
    const row = sections[0]?.rows[0];
    expect(row?.type).toBe("bulk");
    expect(row?.type === "bulk" ? row.entries.every(e => e.actor === undefined) : false)
      .toBe(true);
  });
});
