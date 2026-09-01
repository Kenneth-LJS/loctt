import type { WorkflowConfig } from "@loctt/contracts";
import { describe, expect, it } from "vitest";

import type { BurndownSeriesDto } from "./burndownModel.ts";
import {
  buildGeometry,
  countByEstimate,
  elapsedCount,
  resolveAxis,
  thinTicks,
} from "./burndownModel.ts";

/** A minimal workflow with just the estimation block under test. */
function wf(estimation: WorkflowConfig["estimation"]): WorkflowConfig {
  return { estimation } as unknown as WorkflowConfig;
}

function series(over: Partial<BurndownSeriesDto> = {}): BurndownSeriesDto {
  return {
    sprintId: "S",
    start: "2026-01-01",
    end: "2026-01-03",
    unit: "points",
    initialTotal: 6,
    series: [
      { date: "2026-01-01", remaining: 6, incompleteTaskCount: 2 },
      { date: "2026-01-02", remaining: 4, incompleteTaskCount: 1 },
      { date: "2026-01-03", remaining: 0, incompleteTaskCount: 0 },
    ],
    ideal: [
      { date: "2026-01-01", remaining: 6 },
      { date: "2026-01-02", remaining: 3 },
      { date: "2026-01-03", remaining: 0 },
    ],
    ...over,
  };
}

describe("resolveAxis", () => {
  it("labels numeric units with the configured unit_label, not the unit key", () => {
    const axis = resolveAxis(
      { unit: "points", unitLabel: "pts" },
      wf({ enabled: true, unit: "points", unit_label: "pts" }),
    );
    expect(axis.label).toContain("pts");
    expect(axis.label).not.toContain("points");
    expect(axis.reason).toBe("direct");
  });

  it("labels weighted_enum with unit_label rather than the raw mode name", () => {
    const axis = resolveAxis(
      { unit: "weighted_enum", unitLabel: "size" },
      wf({ enabled: true, unit: "custom_enum", unit_label: "size", preset_values: ["S"], weights: { S: 1 } }),
    );
    expect(axis.label).toContain("size");
    expect(axis.label).not.toContain("weighted_enum");
  });

  it("separates estimation-disabled from enum-without-weights, which the wire cannot", () => {
    // Both arrive as unit: "tasks" — only the workflow distinguishes them.
    const disabled = resolveAxis({ unit: "tasks" }, wf({ enabled: false, unit: "points" }));
    expect(disabled.reason).toBe("estimation-disabled");

    const enumNoWeights = resolveAxis(
      { unit: "tasks" },
      wf({ enabled: true, unit: "custom_enum", unit_label: "size", preset_values: ["S", "M"] }),
    );
    expect(enumNoWeights.reason).toBe("enum-without-weights");
    expect(enumNoWeights.label).toMatch(/task/i);
  });

  it("degrades to `direct` rather than guessing when the workflow has not loaded", () => {
    expect(resolveAxis({ unit: "tasks" }, undefined).reason).toBe("estimation-disabled");
    expect(resolveAxis({ unit: "points" }, undefined).label).toContain("points");
  });
});

describe("buildGeometry", () => {
  it("scales y against the observed max and keeps x monotonic", () => {
    const geo = buildGeometry(series(), 300, 100);
    expect(geo.yMax).toBe(6);
    expect(geo.actual[0]?.y).toBeCloseTo(0);    // remaining 6 = top
    expect(geo.actual[2]?.y).toBeCloseTo(100);  // remaining 0 = baseline
    expect(geo.actual[0]?.x).toBe(0);
    expect(geo.actual[2]?.x).toBe(300);
  });

  it("floors yMax at 1 so an all-zero series is a flat line, not NaN", () => {
    const flat = series({
      initialTotal: 0,
      series: [
        { date: "2026-01-01", remaining: 0, incompleteTaskCount: 0 },
        { date: "2026-01-02", remaining: 0, incompleteTaskCount: 0 },
      ],
      ideal: [
        { date: "2026-01-01", remaining: 0 },
        { date: "2026-01-02", remaining: 0 },
      ],
    });
    const geo = buildGeometry(flat, 300, 100);
    expect(geo.yMax).toBe(1);
    for (const p of geo.actual) {
      expect(Number.isNaN(p.y)).toBe(false);
      expect(p.y).toBe(100);
    }
  });

  it("places a single-day sprint mid-width rather than at a zero-width edge", () => {
    const oneDay = series({
      start: "2026-01-01",
      end: "2026-01-01",
      series: [{ date: "2026-01-01", remaining: 3, incompleteTaskCount: 1 }],
      ideal: [{ date: "2026-01-01", remaining: 0 }],
    });
    const geo = buildGeometry(oneDay, 300, 100);
    expect(geo.actual).toHaveLength(1);
    expect(geo.actual[0]?.x).toBe(150);
    expect(Number.isNaN(geo.actual[0]?.x ?? NaN)).toBe(false);
  });
});

describe("thinTicks", () => {
  it("labels every point when they fit", () => {
    expect(thinTicks(5, 10)).toEqual([0, 1, 2, 3, 4]);
  });

  it("thins a long window and always keeps the last day", () => {
    const ticks = thinTicks(90, 10);
    expect(ticks.length).toBeLessThanOrEqual(12);
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(89);
  });

  it("returns nothing for an empty series", () => {
    expect(thinTicks(0, 10)).toEqual([]);
  });
});

describe("elapsedCount", () => {
  it("counts days up to and including today", () => {
    expect(elapsedCount(series().series, "2026-01-02")).toBe(2);
  });

  it("is 0 for a wholly-future window and the full length for a past one", () => {
    expect(elapsedCount(series().series, "2025-12-31")).toBe(0);
    expect(elapsedCount(series().series, "2026-06-01")).toBe(3);
  });
});

describe("countByEstimate", () => {
  it("keeps preset categories with no tasks at 0 rather than omitting them", () => {
    const rows = countByEstimate([{ estimate: "XS" }, { estimate: "M" }], ["XS", "S", "M", "L"]);
    expect(rows).toEqual([
      { value: "XS", count: 1 },
      { value: "S", count: 0 },
      { value: "M", count: 1 },
      { value: "L", count: 0 },
    ]);
  });

  it("counts unestimated tasks separately so the row total matches the task count", () => {
    const rows = countByEstimate([{ estimate: "XS" }, {}, { estimate: undefined }], ["XS"]);
    expect(rows).toContainEqual({ value: "No estimate", count: 2 });
  });

  it("keeps an estimate outside preset_values under its own name", () => {
    const rows = countByEstimate([{ estimate: "XXL" }], ["XS"]);
    expect(rows).toContainEqual({ value: "XXL", count: 1 });
  });
});
