import type { HistoryEntry, Task } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  assignProvisionalPrefixes,
  deriveKeyState,
  laterWins,
  mergeById,
  mergeComments,
  mergeHistory,
  mergeTask,
} from "./merge.js";

/**
 * Field-level merge rules (decisions M1–M4).
 *
 * Every test here names the data loss it prevents. These rules run on
 * the path that produced four reproduced data-loss bugs, so "it merged"
 * is not the assertion — "it merged and nothing was dropped" is.
 */

function task(overrides: Partial<Task["frontmatter"]> = {}, body = ""): Task {
  return {
    frontmatter: {
      id: "01TASK",
      key: "T-1",
      title: "Original",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      status: "backlog",
      ...overrides,
    },
    body,
  };
}

describe("laterWins", () => {
  it("takes the later updated_at", () => {
    expect(laterWins("a", "b", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")).toBe("b");
    expect(laterWins("a", "b", "2026-01-03T00:00:00Z", "2026-01-02T00:00:00Z")).toBe("a");
  });

  it("resolves a tie to local, deterministically", () => {
    // Not arbitrary: two clones running the same sync must reach the
    // same answer, or they diverge permanently.
    const t = "2026-01-01T00:00:00Z";
    expect(laterWins("a", "b", t, t)).toBe("a");
    expect(laterWins("a", "b", t, t)).toBe("a");
  });
});

describe("mergeTask", () => {
  it("takes the newer version's scalar fields", () => {
    const local = task({ title: "Local", updated_at: "2026-01-01T00:00:00.000Z" });
    const incoming = task({ title: "Incoming", updated_at: "2026-01-02T00:00:00.000Z" });

    expect(mergeTask(local, incoming).merged.frontmatter.title).toBe("Incoming");
  });

  it("keeps both sides' edits when they touched different fields", () => {
    // The case whole-record LWW lost: A set status, B set assignee,
    // neither touched the other's field. Taking the newer record whole
    // dropped A's status even though nothing contested it — the common
    // shape when two people work one task.
    const local = task({
      status: "in_progress",
      assignee: "u-ken",
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    const incoming = task({
      status: "backlog",
      assignee: "u-sara",
      updated_at: "2026-01-03T00:00:00.000Z",
    });
    const history: HistoryEntry[] = [
      { timestamp: "2026-01-02T00:00:00.000Z", kind: "field_change", field: "status",
        before: "backlog", after: "in_progress" },
      { timestamp: "2026-01-03T00:00:00.000Z", kind: "field_change", field: "assignee",
        before: "u-ken", after: "u-sara" },
    ];

    const out = mergeTask(local, incoming, history);
    expect(out.merged.frontmatter.status).toBe("in_progress");
    expect(out.merged.frontmatter.assignee).toBe("u-sara");
  });

  it("takes the later entry when both sides changed the same field", () => {
    const local = task({ status: "in_progress", updated_at: "2026-01-02T00:00:00.000Z" });
    const incoming = task({ status: "done", updated_at: "2026-01-03T00:00:00.000Z" });
    const history: HistoryEntry[] = [
      { timestamp: "2026-01-03T00:00:00.000Z", kind: "field_change", field: "status",
        before: "backlog", after: "done" },
      { timestamp: "2026-01-02T00:00:00.000Z", kind: "field_change", field: "status",
        before: "backlog", after: "in_progress" },
    ];

    // Deliberately out of order in the array: recency decides, not
    // position, or the answer depends on which clone wrote last.
    expect(mergeTask(local, incoming, history).merged.frontmatter.status).toBe("done");
  });

  it("reads `created` as evidence for a field never edited since", () => {
    // M3 makes `created` carry the whole initial frontmatter, so a field
    // set at birth and never touched is explained. Without this it looks
    // unexplained and falls back to recency — which would drop it when
    // the winning record happens not to carry the field at all.
    const local = task({ status: "backlog", updated_at: "2026-01-02T00:00:00.000Z" });
    const incoming = task({ status: "backlog", title: "Renamed", updated_at: "2026-01-03T00:00:00.000Z" });
    const history: HistoryEntry[] = [
      { timestamp: "2026-01-01T00:00:00.000Z", kind: "created",
        after: { frontmatter: { status: "backlog", title: "Original" }, body: "" } },
      { timestamp: "2026-01-03T00:00:00.000Z", kind: "field_change", field: "title",
        before: "Original", after: "Renamed" },
    ];

    const out = mergeTask(local, incoming, history);
    expect(out.merged.frontmatter.status).toBe("backlog");
    expect(out.merged.frontmatter.title).toBe("Renamed");
    expect(out.historyAdditions ?? []).toHaveLength(0);
  });

  it("falls back to whole-record LWW for a field history cannot explain", () => {
    // Hand-edits are out of scope (see decisions.md M2 scope): they
    // write no history, so the merge has no evidence and resolves by
    // recency for that field alone rather than aborting.
    const local = task({ title: "Local hand-edit", updated_at: "2026-01-02T00:00:00.000Z" });
    const incoming = task({ title: "Incoming hand-edit", updated_at: "2026-01-03T00:00:00.000Z" });

    const out = mergeTask(local, incoming, []);
    expect(out.merged.frontmatter.title).toBe("Incoming hand-edit");
  });

  it("records a merge_resolved entry naming the field it had to guess", () => {
    const local = task({ title: "Local", updated_at: "2026-01-02T00:00:00.000Z" });
    const incoming = task({ title: "Incoming", updated_at: "2026-01-03T00:00:00.000Z" });

    const out = mergeTask(local, incoming, []);
    const entry = out.historyAdditions?.find(e => e.kind === "merge_resolved");
    expect(entry).toBeDefined();
    expect(entry?.field).toBe("title");
    expect(entry?.before).toBe("Local");
    expect(entry?.after).toBe("Incoming");
  });

  it("does not record merge_resolved when history explained the field", () => {
    const local = task({ status: "in_progress", updated_at: "2026-01-02T00:00:00.000Z" });
    const incoming = task({ status: "done", updated_at: "2026-01-03T00:00:00.000Z" });
    const history: HistoryEntry[] = [
      { timestamp: "2026-01-02T00:00:00.000Z", kind: "field_change", field: "status",
        before: "backlog", after: "in_progress" },
      { timestamp: "2026-01-03T00:00:00.000Z", kind: "field_change", field: "status",
        before: "backlog", after: "done" },
    ];

    const out = mergeTask(local, incoming, history);
    expect(out.historyAdditions?.some(e => e.kind === "merge_resolved")).toBeFalsy();
  });

  it("unions relationships instead of letting one side win", () => {
    const local = task({
      updated_at: "2026-01-02T00:00:00.000Z",
      relationships: [{ type: "blocks", target: "T-2" }],
    });
    const incoming = task({
      updated_at: "2026-01-01T00:00:00.000Z",
      relationships: [{ type: "blocks", target: "T-3" }],
    });

    // Last-write-wins here would silently drop T-3: someone added that
    // edge deliberately and never edited the task again.
    const rels = mergeTask(local, incoming).merged.frontmatter.relationships ?? [];
    expect(rels.map(r => r.target).sort()).toEqual(["T-2", "T-3"]);
  });

  it("unions key_history so an old key stays resolvable", () => {
    const local = task({ key_history: ["T-1"], updated_at: "2026-01-02T00:00:00.000Z" });
    const incoming = task({ key_history: ["OLD-1"], updated_at: "2026-01-01T00:00:00.000Z" });

    // Dropping either makes a reference someone wrote down stop
    // resolving.
    const kh = mergeTask(local, incoming).merged.frontmatter.key_history ?? [];
    expect([...kh].sort()).toEqual(["OLD-1", "T-1"]);
  });

  it("preserves the losing body rather than dropping it", () => {
    const local = task({ updated_at: "2026-01-01T00:00:00.000Z" }, "Local paragraph.");
    const incoming = task({ updated_at: "2026-01-02T00:00:00.000Z" }, "Incoming paragraph.");

    const out = mergeTask(local, incoming);

    expect(out.merged.body).toBe("Incoming paragraph.");
    // M4: the body is where not noticing costs most, so the loser is
    // written beside the file rather than silently replaced.
    expect(out.displaced?.content).toBe("Local paragraph.");
    expect(out.displaced?.label).toBe("local");
  });

  it("does not displace an identical body", () => {
    const local = task({ updated_at: "2026-01-01T00:00:00.000Z" }, "Same text.");
    const incoming = task({ updated_at: "2026-01-02T00:00:00.000Z" }, "Same text.");

    // A sibling file for an unchanged body is noise the user must
    // dismiss for nothing.
    expect(mergeTask(local, incoming).displaced).toBeUndefined();
  });

  it("does not displace an empty losing body", () => {
    const local = task({ updated_at: "2026-01-01T00:00:00.000Z" }, "   ");
    const incoming = task({ updated_at: "2026-01-02T00:00:00.000Z" }, "Real content.");

    expect(mergeTask(local, incoming).displaced).toBeUndefined();
  });
});

describe("mergeHistory", () => {
  const entry = (o: Partial<HistoryEntry>): HistoryEntry => ({
    timestamp: "2026-01-01T00:00:00.000Z",
    kind: "field_change",
    ...o,
  }) as HistoryEntry;

  it("keeps entries unique to each side", () => {
    const a = [entry({ timestamp: "2026-01-01T00:00:00.000Z", field: "status" })];
    const b = [entry({ timestamp: "2026-01-02T00:00:00.000Z", field: "priority" })];

    // M2's guarantee — that a lost merge race is recoverable from
    // history — is false if the merge drops the history recording it.
    expect(mergeHistory(a, b)).toHaveLength(2);
  });

  it("collapses the same event mirrored on both sides", () => {
    const e = entry({ field: "status", actor: "u1" });
    expect(mergeHistory([e], [{ ...e }])).toHaveLength(1);
  });

  it("keeps two actors' entries at the same instant", () => {
    const a = entry({ field: "status", actor: "u1" });
    const b = entry({ field: "status", actor: "u2" });
    // Same second, different people: two events, not one.
    expect(mergeHistory([a], [b])).toHaveLength(2);
  });

  it("does not treat differing content as a different event", () => {
    const a = entry({ field: "status", actor: "u1", after: "done" });
    const b = entry({ field: "status", actor: "u1", after: "done " });
    // Re-serialization can change a value's formatting; that must not
    // duplicate the entry.
    expect(mergeHistory([a], [b])).toHaveLength(1);
  });

  it("returns one timeline in chronological order", () => {
    const a = [entry({ timestamp: "2026-01-03T00:00:00.000Z", field: "c" })];
    const b = [
      entry({ timestamp: "2026-01-01T00:00:00.000Z", field: "a" }),
      entry({ timestamp: "2026-01-02T00:00:00.000Z", field: "b" }),
    ];
    expect(mergeHistory(a, b).map(e => e.field)).toEqual(["a", "b", "c"]);
  });
});

describe("mergeComments", () => {
  const c = (o: Partial<{ id: string; body: string; deleted: boolean; created_at: string; updated_at: string }>) => ({
    id: "c1",
    body: "hello",
    created_at: "2026-01-01T00:00:00.000Z",
    ...o,
  });

  it("keeps comments unique to each side", () => {
    expect(mergeComments([c({ id: "c1" })], [c({ id: "c2" })])).toHaveLength(2);
  });

  it("lets a deletion beat a concurrent edit", () => {
    const deleted = c({ id: "c1", deleted: true, updated_at: "2026-01-01T00:00:00.000Z" });
    const edited = c({ id: "c1", body: "typo fixed", updated_at: "2026-01-09T00:00:00.000Z" });

    // Even though the edit is newer: someone removed this on purpose,
    // and a typo fix elsewhere should not resurrect it. The text is
    // still in history if the deletion was the mistake.
    expect(mergeComments([deleted], [edited])[0]?.deleted).toBe(true);
    // Order-independent — sync must converge whichever side is "local".
    expect(mergeComments([edited], [deleted])[0]?.deleted).toBe(true);
  });

  it("takes the later edit when neither side deleted", () => {
    const older = c({ id: "c1", body: "first", updated_at: "2026-01-01T00:00:00.000Z" });
    const newer = c({ id: "c1", body: "second", updated_at: "2026-01-02T00:00:00.000Z" });
    expect(mergeComments([older], [newer])[0]?.body).toBe("second");
    expect(mergeComments([newer], [older])[0]?.body).toBe("second");
  });

  it("orders the merged thread by creation", () => {
    const first = c({ id: "a", created_at: "2026-01-01T00:00:00.000Z" });
    const second = c({ id: "b", created_at: "2026-01-02T00:00:00.000Z" });
    expect(mergeComments([second], [first]).map(x => x.id)).toEqual(["a", "b"]);
  });
});

describe("mergeById", () => {
  it("keeps additions from both sides", () => {
    const local = [{ id: "p1", name: "Local" }];
    const incoming = [{ id: "p2", name: "Incoming" }];
    // Two clones each creating a project must end with both.
    expect(mergeById(local, incoming).map(p => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("takes the incoming version of a shared entry", () => {
    const local = [{ id: "p1", name: "Local name" }];
    const incoming = [{ id: "p1", name: "Incoming name" }];
    expect(mergeById(local, incoming)).toEqual([{ id: "p1", name: "Incoming name" }]);
  });
});

describe("deriveKeyState", () => {
  const st = (keys: Record<string, { prefix: string; next_number: number }>) =>
    ({ keys }) as unknown as import("@loctt/contracts").LocttState;

  it("derives the counter from the keys that exist, not by arithmetic", () => {
    const local = st({ p1: { prefix: "T-", next_number: 6 } });
    const incoming = st({ p1: { prefix: "T-", next_number: 9 } });
    const tasks = [1, 2, 3].map(n => task({ key: `T-${String(n)}`, project: "p1" }));

    // max(6, 9) = 9 would reserve numbers no task uses; summing needs a
    // base commit. Highest key in use is 3, so the next is 9 — the
    // floor, since a deleted task still consumed its number.
    const out = deriveKeyState(local, incoming, tasks);
    expect(out.keys["p1"]?.next_number).toBe(9);
  });

  it("never issues a number a task already holds", () => {
    const local = st({ p1: { prefix: "T-", next_number: 2 } });
    const incoming = st({ p1: { prefix: "T-", next_number: 2 } });
    const tasks = [1, 2, 3, 4].map(n => task({ key: `T-${String(n)}`, project: "p1" }));

    // Both counters say 2, but T-4 exists: honouring the counters would
    // reissue a key that is in use.
    expect(deriveKeyState(local, incoming, tasks).keys["p1"]?.next_number).toBe(5);
  });

  it("keeps projects that exist on only one side", () => {
    const local = st({ p1: { prefix: "T-", next_number: 2 } });
    const incoming = st({ p2: { prefix: "API-", next_number: 4 } });

    // A project created on one side must not vanish in the merge.
    const out = deriveKeyState(local, incoming, []);
    expect(Object.keys(out.keys).sort()).toEqual(["p1", "p2"]);
  });

  it("takes the incoming prefix, since a prefix change is deliberate", () => {
    const local = st({ p1: { prefix: "T-", next_number: 2 } });
    const incoming = st({ p1: { prefix: "WEB-", next_number: 2 } });
    expect(deriveKeyState(local, incoming, []).keys["p1"]?.prefix).toBe("WEB-");
  });
});

describe("assignProvisionalPrefixes", () => {
  it("leaves distinct prefixes alone", () => {
    const out = assignProvisionalPrefixes([
      { id: "a", prefix: "T-", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", prefix: "API-", created_at: "2026-01-02T00:00:00Z" },
    ]);
    expect(out.get("a")).toBe("T-");
    expect(out.get("b")).toBe("API-");
  });

  it("gives the later project a provisional prefix when two collide", () => {
    // The two-init case: both trackers minted `T-`, and prefixes must be
    // unique or keys are ambiguous.
    const out = assignProvisionalPrefixes([
      { id: "older", prefix: "T-", created_at: "2026-01-01T00:00:00Z" },
      { id: "newer", prefix: "T-", created_at: "2026-01-02T00:00:00Z" },
    ]);
    expect(out.get("older")).toBe("T-");
    expect(out.get("newer")).toBe("T2-");
  });

  it("is order-independent, so both clones agree", () => {
    const projects = [
      { id: "newer", prefix: "T-", created_at: "2026-01-02T00:00:00Z" },
      { id: "older", prefix: "T-", created_at: "2026-01-01T00:00:00Z" },
    ];
    // Same inputs in the other order must give the same answer, or the
    // two clones diverge permanently.
    const a = assignProvisionalPrefixes(projects);
    const b = assignProvisionalPrefixes([...projects].reverse());
    expect(a.get("older")).toBe(b.get("older"));
    expect(a.get("newer")).toBe(b.get("newer"));
  });

  it("skips a provisional prefix that is itself taken", () => {
    const out = assignProvisionalPrefixes([
      { id: "a", prefix: "T-", created_at: "2026-01-01T00:00:00Z" },
      { id: "b", prefix: "T2-", created_at: "2026-01-02T00:00:00Z" },
      { id: "c", prefix: "T-", created_at: "2026-01-03T00:00:00Z" },
    ]);
    // `c` cannot take T2-, which `b` already holds.
    expect(out.get("c")).toBe("T3-");
  });
});
