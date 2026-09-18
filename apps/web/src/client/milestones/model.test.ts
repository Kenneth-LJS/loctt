import type { MilestoneDef } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { Progress } from "./model.ts";
import {
  compareMilestones,
  discardedNote,
  isOverdue,
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
});

describe("isOverdue", () => {
  const today = "2026-09-01";

  // @verifies MSL-17
  it("flags a past target date only while incomplete tasks remain", () => {
    const past = m({ id: "a", target_date: "2025-01-01" });
    const readout = progressState(p(4, 8, 2));
    expect(isOverdue(past, readout, today)).toBe(true);
    // MSL-17's last bullet: the flag is additive — it changes no
    // number. Same readout, before and after asking.
    expect(readout.done).toBe(4);
    expect(readout.total).toBe(8);
  });

  // @verifies MSL-17
  // @verifies MSL-18
  it("does not flag a fully-complete milestone whose date has passed", () => {
    // The discriminator between "driven by the date" and "driven by
    // incomplete tasks existing". An implementation keying off the
    // date alone passes the test above and fails this one.
    const past = m({ id: "a", target_date: "2025-01-01" });
    expect(isOverdue(past, progressState(p(5, 5, 0)), today)).toBe(false);
  });

  // @verifies MSL-17
  it("does not flag a future date with incomplete work", () => {
    const future = m({ id: "a", target_date: "2099-01-01" });
    expect(isOverdue(future, progressState(p(1, 8, 0)), today)).toBe(false);
  });

  // @verifies MSL-16
  it("never flags an undated milestone", () => {
    // No date means nothing has passed. Guards against a comparison
    // that treats a missing date as epoch and calls every undated
    // milestone overdue.
    expect(isOverdue(m({ id: "a" }), progressState(p(1, 8, 0)), today)).toBe(false);
  });

  // Untagged for the same reason as above.
  it("does not flag a milestone whose progress could not be computed", () => {
    // The flag asserts something about counts. With no counts it would
    // be a guess presented as a fact.
    const past = m({ id: "a", target_date: "2025-01-01" });
    expect(isOverdue(past, progressState(undefined), today)).toBe(false);
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
