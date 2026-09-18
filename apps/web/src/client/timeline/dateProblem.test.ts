import type { TaskFrontmatterPublic } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { WireHealth } from "../health/fieldHealth.ts";
import { buildRows, dateProblem, dateProblemNote } from "./rows.ts";

function health(over: Partial<WireHealth> & { field: string }): WireHealth {
  return {
    kind: "wrong_type",
    rawText: "true",
    error: "expected a date",
    repair: "set_or_remove",
    ...over,
  };
}

/**
 * Date-anomaly classification (TML-18, TML-19, TML-20, TML-48).
 *
 * Four cases, one question: why does this task not have an ordinary
 * two-date bar? Each forbids the same wrong answer — rendering the
 * task as though its dates were fine — so the classifier is the piece
 * that has to be right before any of the four surfaces can be.
 */

function task(over: Partial<TaskFrontmatterPublic>): TaskFrontmatterPublic {
  return {
    id: "t1",
    key: "T-1",
    title: "A task",
    status: "backlog",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as TaskFrontmatterPublic;
}

describe("dateProblem", () => {
  // @verifies TML-18
  it("TML-18: a due_date before its start_date is reported as reversed, with both values", () => {
    const p = dateProblem(task({ start_date: "2026-03-10", due_date: "2026-03-04" }));
    expect(p).toEqual({ kind: "reversed", start: "2026-03-10", due: "2026-03-04" });
    // The note names the problem in the words the case uses, and does
    // not silently present the pair in swapped order as if it were fine.
    expect(dateProblemNote(p!)).toContain("Due date is before start date");
    expect(dateProblemNote(p!)).toContain("2026-03-10");
    expect(dateProblemNote(p!)).toContain("2026-03-04");
  });

  // @verifies TML-18
  it("TML-18: an ordinary forward span has no problem at all", () => {
    expect(dateProblem(task({ start_date: "2026-03-04", due_date: "2026-03-10" }))).toBeUndefined();
    // Same day is a legitimate one-day bar (TML-4), not an anomaly.
    expect(dateProblem(task({ start_date: "2026-03-04", due_date: "2026-03-04" }))).toBeUndefined();
  });

  // @verifies TML-19
  it("TML-19: a start with no due is reported as open-ended, naming the start", () => {
    const p = dateProblem(task({ start_date: "2026-03-02" }));
    expect(p).toEqual({ kind: "open_start", start: "2026-03-02" });
    expect(dateProblemNote(p!)).toContain("2026-03-02");
  });

  // @verifies TML-20
  it("TML-20: a due with no start mirrors it", () => {
    const p = dateProblem(task({ due_date: "2026-03-06" }));
    expect(p).toEqual({ kind: "open_due", due: "2026-03-06" });
    expect(dateProblemNote(p!)).toContain("2026-03-06");
  });

  // @verifies TML-48
  it("TML-48: an unparseable start_date is reported as invalid with the value verbatim", () => {
    const p = dateProblem(task({ start_date: "next tuesday", due_date: "2026-03-06" }));
    expect(p).toEqual({ kind: "invalid", field: "start_date", value: "next tuesday" });
    // The whole point of the case: the offending text is shown as
    // typed, and no `Invalid Date` is produced anywhere near it.
    expect(dateProblemNote(p!)).toContain("next tuesday");
    expect(dateProblemNote(p!)).not.toContain("Invalid Date");
  });

  // @verifies TML-48
  it("TML-48: an invalid date is classified as invalid, not merely as missing", () => {
    // The ordering trap: "next tuesday" does not parse, so a
    // classifier that checked "missing" first would call this
    // `open_due` and lose the value the message has to name.
    const p = dateProblem(task({ start_date: "next tuesday" }));
    expect(p?.kind).toBe("invalid");
  });

  // @verifies TML-48
  it("TML-48: a date-shaped string that is not a real day is still invalid", () => {
    // 2026-02-31 passes a regex and is rolled forward by `Date.parse`
    // in some engines; it is not a calendar day and must not become a
    // bar at 03-03.
    const p = dateProblem(task({ start_date: "2026-02-31", due_date: "2026-03-06" }));
    expect(p).toEqual({ kind: "invalid", field: "start_date", value: "2026-02-31" });
  });

  // @verifies TML-5
  it("TML-5: neither date is reported as undated", () => {
    expect(dateProblem(task({}))).toEqual({ kind: "undated" });
  });

  // Phase-7B corruption sweep (S5).
  it("reports a corrupt due_date (lifted to health, absent from frontmatter) as corrupt — not undated", () => {
    // The disk value was wrong-typed, so the loader stripped it from
    // frontmatter and recorded it in health. Frontmatter alone shows
    // NOTHING, so a classifier that ignored health would call this
    // `undated` and hide the corruption behind a deliberately-undated
    // reason. The whole point of the case: the two must not conflate.
    const p = dateProblem({
      ...task({}),
      health: [health({ field: "due_date", rawText: "true" })],
    });
    expect(p).toEqual({ kind: "corrupt", field: "due_date", rawText: "true" });
    // The note names it corrupt and preserves the raw value (K27) —
    // never presenting it as a plain missing date.
    expect(dateProblemNote(p!)).toContain("corrupt");
    expect(dateProblemNote(p!)).toContain("true");
    expect(dateProblemNote(p!)).not.toContain("Invalid Date");
  });

  it("reports a corrupt start_date as corrupt, naming the field", () => {
    const p = dateProblem({
      ...task({ due_date: "2026-03-06" }),
      health: [health({ field: "start_date", rawText: "[1, 2]" })],
    });
    expect(p).toEqual({ kind: "corrupt", field: "start_date", rawText: "[1, 2]" });
  });

  it("prefers the corrupt classification over the value branches", () => {
    // A present, valid due_date does not make a task with a corrupt
    // start_date read as `open_due`: corruption is the more important
    // fact and is checked first.
    const p = dateProblem({
      ...task({ due_date: "2026-03-06" }),
      health: [health({ field: "start_date", rawText: "42" })],
    });
    expect(p?.kind).toBe("corrupt");
  });

  it("ignores health on unrelated fields — a corrupt title does not fake a date problem", () => {
    // A non-date corruption must not push a normally-dated task off the
    // chart. Only start_date / due_date health counts here.
    const p = dateProblem({
      ...task({ start_date: "2026-03-01", due_date: "2026-03-05" }),
      health: [health({ field: "title", kind: "missing_required", rawText: "" })],
    });
    expect(p).toBeUndefined();
  });
});

describe("buildRows carries the problem onto the row", () => {
  // @verifies TML-18
  it("TML-18: a reversed task keeps its charted row, flagged — it is not dropped", () => {
    const reversed = task({ id: "bad", key: "T-9", start_date: "2026-03-10", due_date: "2026-03-04" });
    const fine = task({ id: "ok", key: "T-1", start_date: "2026-03-01", due_date: "2026-03-05" });
    const model = buildRows([reversed, fine], "none", {});

    const rows = model.bands.flatMap(b => b.rows);
    // Both tasks are in the chart — "the rest of the timeline renders
    // normally", and the flagged row is "still clickable through to
    // detail", which means it must still be a row.
    expect(rows.map(r => r.task.key).sort()).toEqual(["T-1", "T-9"]);
    expect(rows.find(r => r.task.key === "T-9")?.problem?.kind).toBe("reversed");
    expect(rows.find(r => r.task.key === "T-1")?.problem).toBeUndefined();
    expect(model.unscheduled).toHaveLength(0);
  });

  // @verifies TML-19
  it("TML-19/TML-20/TML-48: partially dated tasks reach the lane with their reason", () => {
    const model = buildRows(
      [
        task({ id: "a", key: "T-1", start_date: "2026-03-02" }),
        task({ id: "b", key: "T-2", due_date: "2026-03-06" }),
        task({ id: "c", key: "T-3", start_date: "next tuesday" }),
        task({ id: "d", key: "T-4" }),
      ],
      "none",
      {},
    );
    expect(model.bands).toHaveLength(0);
    expect(model.unscheduled.map(r => [r.task.key, r.problem?.kind])).toEqual([
      ["T-1", "open_start"],
      ["T-2", "open_due"],
      ["T-3", "invalid"],
      ["T-4", "undated"],
    ]);
  });

  // Phase-7B corruption sweep (S5).
  // @verifies DEG-17
  it("routes a corrupt-dated task to the Unscheduled lane, marked corrupt and NOT dropped", () => {
    const corrupt = {
      ...task({ id: "c", key: "T-9" }),
      health: [health({ field: "due_date", rawText: "true" })],
    };
    const undated = task({ id: "u", key: "T-8" });
    const fine = task({ id: "ok", key: "T-1", start_date: "2026-03-01", due_date: "2026-03-05" });
    const model = buildRows([corrupt, undated, fine], "none", {});

    // The corrupt task is VISIBLE — present in the lane, not silently
    // dropped (corruption must never make a task vanish).
    const laneKeys = model.unscheduled.map(r => r.task.key).sort();
    expect(laneKeys).toEqual(["T-8", "T-9"]);
    // And it is DISTINCT from the deliberately-undated one: corrupt vs
    // undated, not conflated.
    const corruptRow = model.unscheduled.find(r => r.task.key === "T-9");
    const undatedRow = model.unscheduled.find(r => r.task.key === "T-8");
    expect(corruptRow?.problem?.kind).toBe("corrupt");
    expect(undatedRow?.problem?.kind).toBe("undated");
    // The fine task still charts normally — one corrupt neighbour does
    // not blank the surface (P5).
    expect(model.bands.flatMap(b => b.rows).map(r => r.task.key)).toEqual(["T-1"]);
  });

  it("still counts a corrupt-dated task under every grouping (no vanish)", () => {
    // corrupt-date routing must not break TML-7's identical-count
    // invariant: the task is unscheduled, so it is in the lane under
    // every grouping.
    const corrupt = {
      ...task({ id: "c", key: "T-9", milestone: "m1" }),
      health: [health({ field: "start_date", rawText: "{}" })],
    };
    for (const g of ["none", "milestone", "assignee", "status", "sprint"] as const) {
      const model = buildRows([corrupt], g, {});
      expect(model.unscheduled).toHaveLength(1);
      expect(model.bands).toHaveLength(0);
    }
  });
});
