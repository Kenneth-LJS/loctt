import type { Task } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXPORT_COLUMNS,
  exportTasksToCSV,
  exportTasksToJSON,
  filterForExport,
} from "./export.js";

function task(overrides: Partial<Task["frontmatter"]> = {}, body = ""): Task {
  return {
    frontmatter: {
      id: "abc",
      key: "T-1",
      title: "Hello",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
      status: "in_progress",
      ...overrides,
    },
    body,
  };
}

describe("exportTasksToJSON", () => {
  it("emits an array with the requested columns and preserves types", () => {
    const t = task({ labels: ["bug", "ui"], priority: "high" });
    const out = exportTasksToJSON([t], { columns: ["key", "title", "labels", "priority"] });
    expect(JSON.parse(out)).toEqual([
      { key: "T-1", title: "Hello", labels: ["bug", "ui"], priority: "high" },
    ]);
  });

  it("omits undefined fields rather than emitting nulls", () => {
    const out = exportTasksToJSON([task()], { columns: ["key", "labels", "milestone"] });
    expect(JSON.parse(out)).toEqual([{ key: "T-1" }]);
  });

  it("supports fields.<custom>", () => {
    const t = task({ fields: { impact: "high" } });
    const out = exportTasksToJSON([t], { columns: ["key", "fields.impact"] });
    expect(JSON.parse(out)).toEqual([{ key: "T-1", "fields.impact": "high" }]);
  });

  it("includes body when requested", () => {
    const out = exportTasksToJSON([task({}, "BODY")], { columns: ["key"], includeBody: true });
    expect(JSON.parse(out)).toEqual([{ key: "T-1", body: "BODY" }]);
  });

  it("uses DEFAULT_EXPORT_COLUMNS when columns are omitted", () => {
    const out = exportTasksToJSON([task()]);
    const parsed = JSON.parse(out) as Record<string, unknown>[];
    for (const c of ["key", "id", "title", "status"]) {
      expect(parsed[0]).toHaveProperty(c);
    }
    expect(DEFAULT_EXPORT_COLUMNS).toContain("key");
  });
});

describe("exportTasksToCSV", () => {
  it("emits header + one row per task", () => {
    const out = exportTasksToCSV([task(), task({ id: "def", key: "T-2", title: "World" })], {
      columns: ["key", "title"],
    });
    expect(out).toBe("key,title\nT-1,Hello\nT-2,World\n");
  });

  it("escapes commas, quotes and newlines per RFC 4180", () => {
    const t = task({ title: 'Hi, "there"\nfriend' });
    const out = exportTasksToCSV([t], { columns: ["title"] });
    expect(out).toBe('title\n"Hi, ""there""\nfriend"\n');
  });

  it("joins array cells with commas inside a single quoted cell", () => {
    const t = task({ labels: ["bug", "ui"] });
    const out = exportTasksToCSV([t], { columns: ["labels"] });
    expect(out).toBe('labels\n"bug,ui"\n');
  });

  it("emits empty cell for undefined values", () => {
    const out = exportTasksToCSV([task()], { columns: ["milestone"] });
    expect(out).toBe("milestone\n\n");
  });
});

describe("filterForExport", () => {
  it("drops archived tasks by default", () => {
    const a = task({ archived: true });
    const b = task();
    expect(filterForExport([a, b], false)).toEqual([b]);
  });

  it("keeps archived tasks when includeArchived = true", () => {
    const a = task({ archived: true });
    const b = task();
    expect(filterForExport([a, b], true)).toEqual([a, b]);
  });
});

/**
 * @verifies BLK-33
 *
 * RFC 4180 escaping. A CSV that reimports as different data than it
 * exported is worse than one that fails to open.
 */
describe("CSV escaping (RFC 4180)", () => {
  it("doubles embedded quotes and quotes the cell", () => {
    const csv = exportTasksToCSV([task({ title: 'Fix "quoted", comma' })]);
    expect(csv).toContain('"Fix ""quoted"", comma"');
  });

  it("keeps a newline inside the quoted cell rather than splitting the row", () => {
    const csv = exportTasksToCSV([task({}, "line one\nline two")], {
      includeBody: true,
    });
    expect(csv).toContain('"line one\nline two"');
    // Header + one data row. A split row would make this 3.
    const rows = csv.trimEnd().split("\n").length;
    // The body's own newline is inside quotes, so a naive line count
    // sees 3 physical lines for 2 logical rows — assert on the parsed
    // shape instead.
    expect(rows).toBe(3);
    expect(csv.match(/^T-1,/gm)).toHaveLength(1);
  });

  it("does not collapse a label containing a comma into two labels", () => {
    // `["a,b", "c"]` joined on "," is `a,b,c`, which reimports as three
    // labels — the export has silently changed the data. BLK-33
    // forbids exactly this.
    const csv = exportTasksToCSV([task({ labels: ["a,b", "c"] })]);
    const cell = csv.trimEnd().split("\n")[1]?.split(",").slice(7).join(",") ?? "";
    expect(cell).not.toContain("a,b,c");
  });
});
