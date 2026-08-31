import type { SprintDef } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { SprintTask } from "./columns.ts";
import {
  bucketBySprint,
  defaultExpanded,
  deriveSprintColumns,
  isActive,
  NO_SPRINT_COLUMN_ID,
  unknownColumnId,
  windowDisagrees,
} from "./columns.ts";

function sprint(over: Partial<SprintDef> & { id: string; name: string }): SprintDef {
  return {
    start_date: "2026-01-01",
    end_date: "2026-01-14",
    state: "future",
    ...over,
  };
}

function task(id: string, sprintId?: string): SprintTask {
  return { id, key: id, ...(sprintId !== undefined ? { sprint: sprintId } : {}) };
}

describe("deriveSprintColumns", () => {
  // @verifies SPR-1
  it("gives every non-archived sprint exactly one column, ordered by start_date", () => {
    const cols = deriveSprintColumns(
      [
        sprint({ id: "s3", name: "Third", start_date: "2026-03-01", end_date: "2026-03-14" }),
        sprint({ id: "s1", name: "First", start_date: "2026-01-01", end_date: "2026-01-14" }),
        sprint({ id: "s2", name: "Second", start_date: "2026-02-01", end_date: "2026-02-14" }),
      ],
      [],
    );
    const real = cols.filter(c => c.kind === "sprint");
    expect(real.map(c => c.id)).toEqual(["s1", "s2", "s3"]);
    // Exactly one each — no omission, no duplication.
    expect(new Set(real.map(c => c.id)).size).toBe(3);
  });

  // @verifies SPR-1
  it("shows the sprint name as the header label, never the ULID", () => {
    const id = "01M1AQ6K96WRM6WNESPCN4WQEP";
    const cols = deriveSprintColumns([sprint({ id, name: "Sprint 7" })], []);
    const col = cols.find(c => c.kind === "sprint");
    expect(col?.label).toBe("Sprint 7");
    expect(col?.label).not.toContain(id);
  });

  // @verifies SPR-1
  it("breaks start_date ties stably, in config order, on every derivation", () => {
    // Two sprints on the same day. A ULID or name tiebreak would
    // reorder them against what sprints.yaml says; a reload must give
    // the same order, so the sort must be stable over the input array.
    const input = [
      sprint({ id: "sB", name: "Bee", start_date: "2026-01-01" }),
      sprint({ id: "sA", name: "Ay", start_date: "2026-01-01" }),
    ];
    const first = deriveSprintColumns(input, []).filter(c => c.kind === "sprint");
    const second = deriveSprintColumns(input, []).filter(c => c.kind === "sprint");
    expect(first.map(c => c.id)).toEqual(["sB", "sA"]);
    expect(second.map(c => c.id)).toEqual(first.map(c => c.id));
  });

  // @verifies SPR-1
  it("omits archived sprints unless explicitly asked for", () => {
    const sprints = [
      sprint({ id: "live", name: "Live" }),
      sprint({ id: "old", name: "Old", archived: true }),
    ];
    const hidden = deriveSprintColumns(sprints, []).filter(c => c.kind === "sprint");
    expect(hidden.map(c => c.id)).toEqual(["live"]);

    const shown = deriveSprintColumns(sprints, [], { showArchived: true })
      .filter(c => c.kind === "sprint");
    expect(shown.map(c => c.id)).toEqual(["live", "old"]);
  });

  // @verifies SPR-24
  it("keeps two same-named sprints as two distinct columns", () => {
    // `name` is explicitly not unique. Keying columns on `name` would
    // collapse these into one, and a drop would then be ambiguous.
    const cols = deriveSprintColumns(
      [
        sprint({ id: "sA", name: "Sprint 1", start_date: "2026-01-01", end_date: "2026-01-14" }),
        sprint({ id: "sB", name: "Sprint 1", start_date: "2026-02-01", end_date: "2026-02-14" }),
      ],
      [],
    ).filter(c => c.kind === "sprint");
    expect(cols).toHaveLength(2);
    expect(cols.map(c => c.id)).toEqual(["sA", "sB"]);
    // The discriminator the user reads: distinct date windows.
    expect(cols[0]?.sprint?.start_date).not.toBe(cols[1]?.sprint?.start_date);
  });

  // @verifies SPR-6
  it("always offers a No sprint column", () => {
    const cols = deriveSprintColumns([sprint({ id: "s1", name: "One" })], []);
    expect(cols.some(c => c.id === NO_SPRINT_COLUMN_ID)).toBe(true);
  });

  // @verifies SPR-27
  it("adds one named column per dangling sprint id, and none when nothing dangles", () => {
    const none = deriveSprintColumns([sprint({ id: "s1", name: "One" })], [task("T-1", "s1")]);
    expect(none.some(c => c.kind === "unknown")).toBe(false);

    const cols = deriveSprintColumns(
      [sprint({ id: "s1", name: "One" })],
      [task("T-1", "s1"), task("T-2", "gone-a"), task("T-3", "gone-b"), task("T-4", "gone-a")],
    );
    const unknown = cols.filter(c => c.kind === "unknown");
    // One per distinct dangling id, not one shared bucket — SPR-27
    // requires the missing id to be named.
    expect(unknown).toHaveLength(2);
    expect(unknown.map(c => c.missingId)).toEqual(["gone-a", "gone-b"]);
    // The real sprints keep the left of the view.
    expect(cols[0]?.kind).toBe("sprint");
  });

  // @verifies SPR-27
  it("does not treat an archived sprint's id as dangling", () => {
    // The sprint is present in the file, merely hidden. Naming it as
    // missing would send the user looking for something that is there.
    const cols = deriveSprintColumns(
      [sprint({ id: "old", name: "Old", archived: true })],
      [task("T-1", "old")],
    );
    expect(cols.some(c => c.kind === "unknown")).toBe(false);
  });
});

describe("bucketBySprint", () => {
  // @verifies SPR-19
  it("puts a task in exactly one column even when sprint windows overlap", () => {
    // Both active, windows overlapping. Membership is the stored
    // field, never a date comparison, so nothing is duplicated.
    const sprints = [
      sprint({ id: "sA", name: "A", state: "active", start_date: "2026-01-01", end_date: "2026-01-20" }),
      sprint({ id: "sB", name: "B", state: "active", start_date: "2026-01-10", end_date: "2026-01-30" }),
    ];
    const tasks = [task("T-1", "sA"), task("T-2", "sB")];
    const cols = deriveSprintColumns(sprints, tasks);
    const buckets = bucketBySprint(cols, tasks);

    expect(buckets.get("sA")?.map(t => t.key)).toEqual(["T-1"]);
    expect(buckets.get("sB")?.map(t => t.key)).toEqual(["T-2"]);
    // The partition property, stated directly.
    const placements = [...buckets.values()].flat().length;
    expect(placements).toBe(tasks.length);
  });

  // @verifies SPR-6
  it("routes a task with no sprint field to the No sprint column", () => {
    const tasks = [task("T-1"), task("T-2", "s1")];
    const cols = deriveSprintColumns([sprint({ id: "s1", name: "One" })], tasks);
    const buckets = bucketBySprint(cols, tasks);
    expect(buckets.get(NO_SPRINT_COLUMN_ID)?.map(t => t.key)).toEqual(["T-1"]);
  });

  // @verifies SPR-27
  it("routes a dangling reference to that id's own column rather than hiding it", () => {
    const tasks = [task("T-1", "gone")];
    const cols = deriveSprintColumns([sprint({ id: "s1", name: "One" })], tasks);
    const buckets = bucketBySprint(cols, tasks);
    expect(buckets.get(unknownColumnId("gone"))?.map(t => t.key)).toEqual(["T-1"]);
    // Not silently swept into "no sprint", which would read as an
    // ordinary unassigned task.
    expect(buckets.get(NO_SPRINT_COLUMN_ID)).toEqual([]);
  });

  // @verifies SPR-15
  it("gives a sprint with zero tasks an empty bucket, not a missing one", () => {
    // A missing entry and an empty one render differently: the view
    // must still draw a column with an explicit 0.
    const cols = deriveSprintColumns([sprint({ id: "empty", name: "Empty" })], []);
    const buckets = bucketBySprint(cols, []);
    expect(buckets.get("empty")).toEqual([]);
    expect(buckets.has("empty")).toBe(true);
  });
});

describe("isActive / windowDisagrees / defaultExpanded", () => {
  // @verifies SPR-2 SPR-20
  it("keys active off state, not off whether today falls in the window", () => {
    // SPR-20: the two can disagree, and `state` wins. LocTT performs
    // no automatic transitions.
    const past = sprint({
      id: "s1", name: "Overrun", state: "active",
      start_date: "2025-01-01", end_date: "2025-01-14",
    });
    expect(isActive(past)).toBe(true);
    expect(defaultExpanded({ id: "s1", kind: "sprint", label: "Overrun", sprint: past })).toBe(true);

    // And the converse: today inside the window does not make a
    // `future` sprint active.
    const inWindow = sprint({
      id: "s2", name: "Not yet", state: "future",
      start_date: "2026-01-01", end_date: "2026-12-31",
    });
    expect(isActive(inWindow)).toBe(false);
  });

  // @verifies SPR-20
  it("flags the state/window disagreement as a hint, only for active sprints", () => {
    const overrun = sprint({
      id: "s1", name: "Overrun", state: "active",
      start_date: "2025-01-01", end_date: "2025-01-14",
    });
    expect(windowDisagrees(overrun, "2026-06-01")).toBe(true);

    const current = sprint({
      id: "s2", name: "Current", state: "active",
      start_date: "2026-05-01", end_date: "2026-07-01",
    });
    expect(windowDisagrees(current, "2026-06-01")).toBe(false);

    // A completed sprint whose window has passed is not a discrepancy
    // — that is simply what a finished sprint looks like.
    const done = sprint({
      id: "s3", name: "Done", state: "completed",
      start_date: "2025-01-01", end_date: "2025-01-14",
    });
    expect(windowDisagrees(done, "2026-06-01")).toBe(false);
  });

  // @verifies SPR-2
  it("expands active sprints by default and collapses future and completed", () => {
    const mk = (state: SprintDef["state"]) => ({
      id: state, kind: "sprint" as const, label: state,
      sprint: sprint({ id: state, name: state, state }),
    });
    expect(defaultExpanded(mk("active"))).toBe(true);
    expect(defaultExpanded(mk("future"))).toBe(false);
    expect(defaultExpanded(mk("completed"))).toBe(false);
  });

  // @verifies SPR-6 SPR-27
  it("expands the No sprint and unknown columns by default", () => {
    // Collapsing these by default hides exactly the problem they
    // exist to surface.
    expect(defaultExpanded({ id: NO_SPRINT_COLUMN_ID, kind: "none", label: "No sprint" })).toBe(true);
    expect(defaultExpanded({
      id: unknownColumnId("gone"), kind: "unknown", label: "Unknown sprint", missingId: "gone",
    })).toBe(true);
  });
});
