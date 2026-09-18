import type { TaskFrontmatterPublic, WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  bucketTasks,
  deriveColumns,
  ORPHAN_COLUMN_ID,
  sortColumn,
  UNCOVERED_COLUMN_ID,
} from "./columns.js";

/**
 * Column derivation is the board's whole data model, so it is tested
 * as a pure function rather than through the DOM: every one of these
 * assertions is about *which column a card belongs to*, and routing a
 * card by its stored key rather than its label is the invariant the
 * browser cannot show more clearly than this can.
 */

function workflow(partial: Partial<WorkflowConfig>): WorkflowConfig {
  return {
    key: { prefix: "T" },
    statuses: [],
    priorities: [],
    task_types: [],
    relationships: [],
    ...partial,
  } as WorkflowConfig;
}

function status(key: string, label: string, category = "pending") {
  return { key, label, category } as WorkflowConfig["statuses"][number];
}

let seq = 0;
function task(partial: Partial<TaskFrontmatterPublic> = {}): TaskFrontmatterPublic {
  seq += 1;
  return {
    id: `01ID${String(seq).padStart(22, "0")}`,
    key: `T-${String(seq)}`,
    title: `Task ${String(seq)}`,
    created_at: `2026-01-${String(seq % 28 + 1).padStart(2, "0")}T00:00:00.000Z`,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as TaskFrontmatterPublic;
}

describe("deriveColumns", () => {
  // @verifies BRD-1
  it("makes one column per status, in declaration order, labelled with the label", () => {
    const cfg = workflow({
      statuses: [
        status("not_started", "Not started"),
        status("in_progress", "In progress", "active"),
        status("wont_do", "Won't do", "discarded"),
      ],
    });

    const columns = deriveColumns(cfg, []);

    // Declaration order — not alphabetical (which would put
    // "In progress" first) and not by category.
    expect(columns.map(c => c.label)).toEqual([
      "Not started",
      "In progress",
      "Won't do",
    ]);
    // Headers show the label; the stored key never appears as a header.
    expect(columns.map(c => c.id)).toEqual([
      "not_started",
      "in_progress",
      "wont_do",
    ]);
    expect(columns.every(c => c.kind === "status")).toBe(true);
  });

  // @verifies BRD-2
  it("uses boards.columns when configured, collapsing several statuses into one", () => {
    const cfg = workflow({
      statuses: [
        status("not_started", "Not started"),
        status("in_progress", "In progress", "active"),
        status("in_review", "In review", "active"),
        status("blocked", "Blocked", "active"),
        status("done", "Done", "completed"),
      ],
      boards: {
        columns: [
          { key: "todo", label: "To do", statuses: ["not_started"] },
          { key: "doing", label: "In flight", statuses: ["in_progress", "in_review", "blocked"] },
          { key: "shipped", label: "Shipped", statuses: ["done"] },
        ],
      },
    });

    const columns = deriveColumns(cfg, []);

    // Three columns, not five.
    expect(columns).toHaveLength(3);
    // The column's own label, not any status label.
    expect(columns[1]?.label).toBe("In flight");
    expect(columns[1]?.statuses).toEqual(["in_progress", "in_review", "blocked"]);
    // Array order, independent of status declaration order.
    expect(columns.map(c => c.id)).toEqual(["todo", "doing", "shipped"]);
  });

  // @verifies BRD-2
  it("routes tasks with different statuses into the same collapsed column", () => {
    const cfg = workflow({
      statuses: [
        status("in_progress", "In progress", "active"),
        status("blocked", "Blocked", "active"),
      ],
      boards: {
        columns: [
          { key: "doing", label: "In flight", statuses: ["in_progress", "blocked"] },
        ],
      },
    });
    const blocked = task({ status: "blocked" });
    const progressing = task({ status: "in_progress" });

    const columns = deriveColumns(cfg, [blocked, progressing]);
    const buckets = bucketTasks(columns, [blocked, progressing]);

    expect(buckets.get("doing")?.map(t => t.key)).toEqual([
      blocked.key,
      progressing.key,
    ]);
  });

  // @verifies BRD-24
  it("gives statuses no configured column covers a home, rather than dropping them", () => {
    const cfg = workflow({
      statuses: [
        status("in_progress", "In progress", "active"),
        status("wont_do", "Won't do", "discarded"),
      ],
      boards: {
        columns: [{ key: "doing", label: "In flight", statuses: ["in_progress"] }],
      },
    });
    const dropped = task({ status: "wont_do" });

    const columns = deriveColumns(cfg, [dropped]);
    const buckets = bucketTasks(columns, [dropped]);

    // Silent omission is the failure this case names: the board's
    // total has to agree with the list's for the same filter.
    const catchAll = columns.find(c => c.id === UNCOVERED_COLUMN_ID);
    expect(catchAll?.statuses).toEqual(["wont_do"]);
    expect(buckets.get(UNCOVERED_COLUMN_ID)).toHaveLength(1);
  });

  // @verifies BRD-18
  it("surfaces a task whose status the workflow no longer defines, naming the key", () => {
    const cfg = workflow({ statuses: [status("in_progress", "In progress", "active")] });
    const orphan = task({ status: "blocked" });
    const normal = task({ status: "in_progress" });

    const columns = deriveColumns(cfg, [orphan, normal]);
    const buckets = bucketTasks(columns, [orphan, normal]);

    const orphanColumn = columns.find(c => c.id === ORPHAN_COLUMN_ID);
    // Names the orphan key verbatim, so the user can find it.
    expect(orphanColumn?.statuses).toEqual(["blocked"]);
    // Not vanished: a board showing fewer tasks than exist with no
    // explanation is the P7 violation the case is written against.
    expect(buckets.get(ORPHAN_COLUMN_ID)?.map(t => t.key)).toEqual([orphan.key]);
  });

  // @verifies BRD-18
  it("does not create an orphan column when every status resolves", () => {
    const cfg = workflow({ statuses: [status("in_progress", "In progress", "active")] });

    const columns = deriveColumns(cfg, [task({ status: "in_progress" })]);

    expect(columns.find(c => c.id === ORPHAN_COLUMN_ID)).toBeUndefined();
  });

  // @verifies BRD-17
  it("still renders a configured column naming a deleted status, and reports the gap", () => {
    const cfg = workflow({
      // `in_review` has been deleted from `statuses`…
      statuses: [status("in_progress", "In progress", "active")],
      boards: {
        // …but the column still references it.
        columns: [
          { key: "doing", label: "In flight", statuses: ["in_progress", "in_review"] },
        ],
      },
    });

    const columns = deriveColumns(cfg, []);

    // The column still renders — it holds other, valid statuses.
    expect(columns).toHaveLength(1);
    // And the stale reference is surfaced, naming the missing key,
    // rather than only reaching a console.
    expect(columns[0]?.missingStatuses).toEqual(["in_review"]);
  });

  // @verifies BRD-17
  it("reports no drift for a column whose statuses all exist", () => {
    const cfg = workflow({
      statuses: [status("in_progress", "In progress", "active")],
      boards: {
        columns: [{ key: "doing", label: "In flight", statuses: ["in_progress"] }],
      },
    });

    expect(deriveColumns(cfg, [])[0]?.missingStatuses).toBeUndefined();
  });

  // @verifies BRD-19
  it("keeps two statuses that share a label as two columns, disambiguated by key", () => {
    const cfg = workflow({
      statuses: [
        status("review_a", "Review", "active"),
        status("review_b", "Review", "active"),
      ],
    });
    const inA = task({ status: "review_a" });
    const inB = task({ status: "review_b" });

    const columns = deriveColumns(cfg, [inA, inB]);
    const buckets = bucketTasks(columns, [inA, inB]);

    // Keys are the identity, so two columns — not one label match.
    expect(columns).toHaveLength(2);
    // The user can tell which is which.
    expect(columns.map(c => c.disambiguator)).toEqual(["review_a", "review_b"]);
    // Cards route by stored key, not by the first label match: this is
    // the assertion that fails if routing ever keys on the label.
    expect(buckets.get("review_a")?.map(t => t.key)).toEqual([inA.key]);
    expect(buckets.get("review_b")?.map(t => t.key)).toEqual([inB.key]);
  });

  // @verifies BRD-19
  it("does not add a disambiguator when labels are already unique", () => {
    const cfg = workflow({
      statuses: [status("a", "Alpha"), status("b", "Beta")],
    });

    expect(deriveColumns(cfg, []).map(c => c.disambiguator)).toEqual([
      undefined,
      undefined,
    ]);
  });

  // @verifies BRD-6
  it("carries a column's wip cap through, and leaves it absent when unset", () => {
    const cfg = workflow({
      statuses: [status("in_progress", "In progress", "active"), status("done", "Done", "completed")],
      boards: {
        columns: [
          { key: "doing", label: "In flight", statuses: ["in_progress"], wip: 3 },
          { key: "shipped", label: "Shipped", statuses: ["done"] },
        ],
      },
    });

    const columns = deriveColumns(cfg, []);

    expect(columns[0]?.wip).toBe(3);
    // Absent, not zero — a column with no cap must never render an
    // over-cap state, and `0` would make every column over it.
    expect(columns[1]?.wip).toBeUndefined();
  });

  // @verifies BRD-16
  it("makes exactly one column for a workflow declaring one status", () => {
    const cfg = workflow({ statuses: [status("only", "Only")] });

    expect(deriveColumns(cfg, [])).toHaveLength(1);
  });

  // @verifies BRD-15
  it("makes twenty columns for twenty statuses", () => {
    const cfg = workflow({
      statuses: Array.from({ length: 20 }, (_, i) => status(`s${String(i)}`, `Status ${String(i)}`)),
    });

    expect(deriveColumns(cfg, [])).toHaveLength(20);
  });
});

describe("bucketTasks", () => {
  // @verifies BRD-1
  it("puts every task in exactly one column, matched on its stored key", () => {
    const cfg = workflow({
      statuses: [status("a", "Alpha"), status("b", "Beta")],
    });
    const tasks = [task({ status: "a" }), task({ status: "b" }), task({ status: "a" })];

    const buckets = bucketTasks(deriveColumns(cfg, tasks), tasks);

    const placements = [...buckets.values()].flat().map(t => t.key);
    expect(placements).toHaveLength(3);
    expect(new Set(placements).size).toBe(3);
    expect(buckets.get("a")).toHaveLength(2);
    expect(buckets.get("b")).toHaveLength(1);
  });
});

describe("sortColumn", () => {
  // @verifies BRD-29
  it("orders two cards sharing a rank deterministically, not randomly", () => {
    const a = task({ board_rank: "u", created_at: "2026-01-01T00:00:00.000Z" });
    const b = task({ board_rank: "u", created_at: "2026-01-02T00:00:00.000Z" });

    // Both input orders must produce the same output order, which is
    // what "two reloads produce the same order" means.
    expect(sortColumn([a, b]).map(t => t.key)).toEqual([a.key, b.key]);
    expect(sortColumn([b, a]).map(t => t.key)).toEqual([a.key, b.key]);
  });

  // @verifies BRD-27
  it("sorts unranked cards below ranked ones, by creation", () => {
    const ranked = task({ board_rank: "z", created_at: "2026-01-09T00:00:00.000Z" });
    const older = task({ created_at: "2026-01-01T00:00:00.000Z" });
    const newer = task({ created_at: "2026-01-05T00:00:00.000Z" });

    const sorted = sortColumn([newer, older, ranked]);

    // The ranked card leads even though its rank is high and its
    // creation late — rank beats creation, and unranked falls below.
    expect(sorted.map(t => t.key)).toEqual([ranked.key, older.key, newer.key]);
  });

  // @verifies BRD-30
  it("tolerates a board_rank outside the lexorank alphabet", () => {
    const invalid = task({ board_rank: "ABC!" });
    const valid = task({ board_rank: "u" });

    const sorted = sortColumn([invalid, valid]);

    // Still rendered, not dropped from the column…
    expect(sorted).toHaveLength(2);
    // …and treated as unranked, so it sorts to one deterministic end
    // rather than throwing or comparing as uppercase-before-lowercase.
    expect(sorted.map(t => t.key)).toEqual([valid.key, invalid.key]);
  });

  // @verifies BRD-27
  it("orders ranked cards by rank ascending", () => {
    const c = task({ board_rank: "c" });
    const a = task({ board_rank: "a" });
    const b = task({ board_rank: "b" });

    expect(sortColumn([c, a, b]).map(t => t.key)).toEqual([a.key, b.key, c.key]);
  });
});
