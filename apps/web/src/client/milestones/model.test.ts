import type { MilestoneDef } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { Progress } from "./model.ts";
import {
  compareMilestones,
  discardedNote,
  progressState,
  sortMilestones,
} from "./model.ts";

function p(done: number, total: number, discarded = 0): Progress {
  return { done, total, discarded, fraction: total > 0 ? done / total : 0 };
}

function m(over: Partial<MilestoneDef> & { id: string }): MilestoneDef {
  return { name: `M ${over.id}`, ...over };
}

describe("progressState", () => {
  // @verifies MSL-3
  it("reports the discarded exclusion and keeps it out of the denominator", () => {
    // MSL-3's worked example verbatim: 10 tasks, 4 completed, 2
    // discarded, 4 active. Core answers `4 / 8` with `discarded: 2`
    // (measured against a live server), and the readout must carry
    // both the number and the reason.
    const r = progressState(p(4, 8, 2));

    expect(r.kind).toBe("counted");
    expect(r.done).toBe(4);
    // The denominator excludes the 2 discarded tasks — 8, not 10.
    expect(r.total).toBe(8);
    expect(r.discarded).toBe(2);
    // The rule is stated where the number is shown, and it names the
    // count. A readout that showed `4 / 8` with no explanation fails
    // MSL-3's first bullet just as an ambiguous number would.
    expect(discardedNote(r)).toBe("2 discarded tasks are excluded from the total.");
  });

  // @verifies MSL-3
  it("says nothing about discards when there are none", () => {
    // The discriminating half: with zero discarded tasks there is no
    // exclusion to explain, so a caption would be a false statement
    // about the denominator. A test that only seeded the 2-discarded
    // case could not tell a real rule from a hardcoded sentence.
    expect(discardedNote(progressState(p(4, 8, 0)))).toBeUndefined();
  });

  // @verifies MSL-15
  it("shows an explicit no-tasks state rather than NaN, 0/0 or Infinity", () => {
    // Zero denominator — the case's whole subject. Seeded as a
    // milestone with genuinely no tasks, which is the only seeding
    // that can discriminate here.
    const r = progressState(p(0, 0, 0));

    expect(r.kind).toBe("none");
    // Percent is *suppressed*, not computed: `0/0` is NaN, and the
    // case forbids `NaN`, `NaN%`, `0/0` and `Infinity` alike.
    expect(r.percent).toBeUndefined();
    // The bar renders empty rather than full.
    expect(r.fill).toBe(0);
    expect(Number.isNaN(r.fill)).toBe(false);
    expect(Number.isFinite(r.fill)).toBe(true);
    // "Nothing to do" is not "everything done".
    expect(r.complete).toBe(false);
  });

  // @verifies MSL-18
  it("reads full and complete at n / n", () => {
    const r = progressState(p(5, 5, 0));
    expect(r.done).toBe(5);
    expect(r.total).toBe(5);
    expect(r.fill).toBe(1);
    expect(r.percent).toBe(100);
    expect(r.complete).toBe(true);
  });

  // @verifies MSL-3
  // @verifies MSL-18
  it("reaches 100% when the only remaining work is discarded", () => {
    // MSL-3's stated consequence: a milestone whose remaining work has
    // all been abandoned reads `4 / 4` — done — rather than stalling
    // below 100% forever. This is the case where including discards in
    // the denominator would visibly differ.
    const r = progressState(p(4, 4, 6));
    expect(r.complete).toBe(true);
    expect(r.percent).toBe(100);
    expect(discardedNote(r)).toBe("6 discarded tasks are excluded from the total.");
  });

  // @verifies MSL-1
  it("derives the bar fill from the same numbers the readout shows", () => {
    // MSL-1: "the bar's fill proportion matches the numbers shown".
    // Fill is computed from done/total rather than read from
    // `progress.fraction`, so a server sending a stale or wrong
    // fraction cannot make the bar disagree with its own caption.
    const r = progressState({ done: 3, total: 4, discarded: 0, fraction: 0.99 });
    expect(r.fill).toBe(0.75);
    expect(r.percent).toBe(75);
  });

  // Deliberately left UNTAGGED for MSL-35: this asserts the
  // client-side half only. The case's "other milestones' rows continue
  // to render their own progress" is architecturally unreachable —
  // `withProgress` computes the whole list in one scan and fills every
  // id, so `undefined` never arrives from a successful response. See
  // the note in tests/ui/flow-milestones.spec.ts and known-gaps.
  it("distinguishes a failed computation from zero progress", () => {
    // MSL-35's core requirement. `undefined` progress is not `0 / 0`:
    // the two must be different states, or a failure is
    // indistinguishable from a genuinely empty milestone (MSL-15).
    const failed = progressState(undefined);
    const empty = progressState(p(0, 0, 0));

    expect(failed.kind).toBe("unavailable");
    expect(empty.kind).toBe("none");
    expect(failed.kind).not.toBe(empty.kind);
    // No number is offered in place of the missing one.
    expect(failed.percent).toBeUndefined();
  });

  // @verifies L4
  it("leaves activeFill undefined when the source carried no active count", () => {
    // Behaviour-preserving for milestones/sprints: a `Progress` without
    // `active` (the shape they build) yields the single fill and no
    // middle segment. Red-proof: if `progressState` defaulted a missing
    // `active` to 0 and set `activeFill: 0`, a segmented caller would
    // draw an empty active slice instead of falling back to the single
    // fill.
    const r = progressState(p(3, 4, 0));
    expect(r.activeFill).toBeUndefined();
    expect(r.fill).toBe(0.75);
  });

  // @verifies L4
  it("splits the bar into done and active segments when active is present", () => {
    // 6 total, 2 done, 3 active, 1 todo. done fills 1/3, active fills
    // 1/2, and the remainder 1/6 is the un-started track.
    const r = progressState({ done: 2, active: 3, total: 6, discarded: 0, fraction: 2 / 6 });
    expect(r.fill).toBeCloseTo(2 / 6);
    expect(r.activeFill).toBeCloseTo(3 / 6);
    // The two segments never sum past the track.
    expect((r.activeFill ?? 0) + r.fill).toBeLessThanOrEqual(1);
    // The un-started remainder.
    expect(1 - r.fill - (r.activeFill ?? 0)).toBeCloseTo(1 / 6);
  });

  // @verifies L4
  it("clamps the active segment so done + active never overflow the track", () => {
    // A hand-edited corpus can momentarily report done + active > total
    // (a child counted in two categories after a bad edit). The bar must
    // not overflow: activeFill is clamped to the space `fill` left.
    const r = progressState({ done: 4, active: 4, total: 5, discarded: 0, fraction: 4 / 5 });
    expect(r.fill).toBeCloseTo(4 / 5);
    // 4/5 done leaves only 1/5; active is clamped from 4/5 down to 1/5.
    expect(r.activeFill).toBeCloseTo(1 / 5);
    expect(r.fill + (r.activeFill ?? 0)).toBeCloseTo(1);
  });

  // @verifies L4
  it("suppresses the active segment on an empty (no-tasks) readout", () => {
    // `active` present but total 0: still "No tasks", no segment.
    const r = progressState({ done: 0, active: 0, total: 0, discarded: 0, fraction: 0 });
    expect(r.kind).toBe("none");
    expect(r.activeFill).toBeUndefined();
  });
});

describe("sortMilestones", () => {
  // @verifies MSL-1
  // @verifies MSL-16
  it("orders by target date and puts undated milestones after all dated ones", () => {
    const items = [
      m({ id: "u1" }),
      m({ id: "d2", target_date: "2026-06-01" }),
      m({ id: "u2" }),
      m({ id: "d1", target_date: "2025-01-01" }),
    ];
    expect(sortMilestones(items).map(x => x.id)).toEqual(["d1", "d2", "u1", "u2"]);
  });

  // @verifies MSL-1
  it("is stable across reloads regardless of the config file's order", () => {
    // MSL-1: "ordering is stable across reloads". The config's own
    // order is not stable — a settings-panel reorder changes it — so
    // the same set arriving in a different order must still sort the
    // same way. Ties break on the ULID, which is total and immutable.
    const a = m({ id: "01A", target_date: "2026-01-01" });
    const b = m({ id: "01B", target_date: "2026-01-01" });
    const c = m({ id: "01C" });
    const d = m({ id: "01D" });

    expect(sortMilestones([a, b, c, d]).map(x => x.id))
      .toEqual(sortMilestones([d, c, b, a]).map(x => x.id));
    expect(sortMilestones([b, d, a, c]).map(x => x.id))
      .toEqual(["01A", "01B", "01C", "01D"]);
  });

  // @verifies MSL-1
  it("does not mutate its input", () => {
    const items = [m({ id: "b", target_date: "2026-01-01" }), m({ id: "a" })];
    const before = items.map(x => x.id);
    sortMilestones(items);
    expect(items.map(x => x.id)).toEqual(before);
  });

  // @verifies MSL-16
  it("compares an undated milestone as after a dated one in both directions", () => {
    const dated = m({ id: "d", target_date: "2026-01-01" });
    const undated = m({ id: "u" });
    expect(compareMilestones(dated, undated)).toBeLessThan(0);
    expect(compareMilestones(undated, dated)).toBeGreaterThan(0);
  });
});
