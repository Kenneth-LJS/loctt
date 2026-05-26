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
