import { describe, expect, it } from "vitest";

import { BAND_HEADER_H, buildLayout, ROW_H } from "./layout.ts";
import type { RowModel, TimelineTask } from "./rows.ts";

/**
 * Vertical layout is the arithmetic the arrows anchor to, so it is
 * tested as arithmetic. The load-bearing property under windowing
 * (TML-26): `buildLayout` places *every* row and reports *every* row's
 * centre and task, even though `TimelineChart` renders only the visible
 * window. If these maps ever only covered the mounted rows, every arrow
 * whose endpoint is off-window would break — which is exactly the trap
 * `TimelineChart.test.tsx`'s off-window arrow test guards at the DOM
 * level. This file guards the math it rests on.
 */

function task(n: number): TimelineTask {
  return {
    id: `01T${String(n).padStart(23, "0")}`,
    key: `T-${String(n)}`,
    title: `Task ${String(n)}`,
    start_date: "2026-03-02",
    due_date: "2026-03-06",
  } as unknown as TimelineTask;
}

function modelOf(count: number, bands = 1): RowModel {
  const perBand = Math.ceil(count / bands);
  const built = Array.from({ length: bands }, (_b, b) => ({
    id: `band-${String(b)}`,
    label: `Band ${String(b)}`,
    rows: Array.from({ length: Math.min(perBand, count - b * perBand) }, (_r, r) => ({
      task: task(b * perBand + r),
      scheduled: true,
    })),
  })).filter(band => band.rows.length > 0);
  return { bands: built, unscheduled: [] };
}

describe("buildLayout", () => {
  it("places rows top to bottom at a constant pitch after each band header", () => {
    const layout = buildLayout(modelOf(3, 1));
    const rows = layout.bands[0]?.rows ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[0]?.y).toBe(BAND_HEADER_H);
    expect(rows[1]?.y).toBe(BAND_HEADER_H + ROW_H);
    expect(rows[2]?.y).toBe(BAND_HEADER_H + 2 * ROW_H);
  });

  // @verifies TML-26
  it("centreById answers for EVERY row, so arrows to any row anchor — the windowing trap", () => {
    // 3,000 rows, the scale case's count. Windowing will mount only a
    // screenful, but the centre map must cover all 3,000 so an arrow to
    // the 2,900th row (far off any window) still has a y to point at.
    const N = 3000;
    const layout = buildLayout(modelOf(N, 1));
    expect(layout.centreById.size).toBe(N);
    expect(layout.taskById.size).toBe(N);

    // The 2,900th row's centre is its exact placed y + half a row.
    const far = task(2899);
    const expectedY = BAND_HEADER_H + 2899 * ROW_H + ROW_H / 2;
    expect(layout.centreById.get(far.id)).toBe(expectedY);
    expect(layout.taskById.get(far.id)?.key).toBe("T-2899");
  });

  // @verifies TML-26
  it("total height covers all rows, so the scroll container sizes for the full list", () => {
    const layout = buildLayout(modelOf(3000, 1));
    // header + 3000 rows.
    expect(layout.height).toBe(BAND_HEADER_H + 3000 * ROW_H);
  });

  it("a collapsed band drops its rows from the maps but keeps the true count", () => {
    const layout = buildLayout(modelOf(4, 2), new Set(["band-0"]));
    // Band 0 collapsed: its rows are not placed, so not in the maps.
    expect(layout.bands[0]?.rows).toHaveLength(0);
    expect(layout.bands[0]?.count).toBe(2);
    // Band 1's rows are still placed and in the maps.
    expect(layout.centreById.size).toBe(2);
    expect(layout.taskById.size).toBe(2);
  });
});
