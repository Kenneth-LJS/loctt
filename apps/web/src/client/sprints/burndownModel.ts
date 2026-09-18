import type { WorkflowConfig } from "@loctt/contracts";

/**
 * Client-side shaping for the burndown chart (M4.7).
 *
 * The *numbers* all come from the server — `GET
 * /api/sprints/:id/burndown` wraps core's `computeBurndown`, and
 * nothing here recomputes a remaining value. What lives here is the
 * part core deliberately does not answer: how the series is turned
 * into geometry, what the Y axis is *called*, and why the unit is what
 * it is.
 *
 * That last one is the reason this file exists rather than the chart
 * reading `series.unit` directly. `determineUnit` collapses two very
 * different configurations onto `"tasks"` — estimation switched off,
 * and a `custom_enum` with no `weights` — and SPR-11 requires the
 * second to be *explained* next to the chart. The wire cannot tell
 * them apart; the workflow config can.
 */

/** One sample as the server sends it. */
export interface BurndownPointDto {
  readonly date: string;
  readonly remaining: number;
  readonly incompleteTaskCount: number;
}

export interface IdealPointDto {
  readonly date: string;
  readonly remaining: number;
}

export type BurndownUnitDto =
  | "tasks" | "points" | "hours" | "days" | "custom_numeric" | "weighted_enum";

/** The `GET /api/sprints/:id/burndown` response. */
export interface BurndownSeriesDto {
  readonly sprintId: string;
  readonly start: string;
  readonly end: string;
  readonly unit: BurndownUnitDto;
  readonly unitLabel?: string;
  readonly initialTotal: number;
  readonly series: readonly BurndownPointDto[];
  readonly ideal: readonly IdealPointDto[];
}

/**
 * Why the Y axis is measuring what it is measuring.
 *
 *  - `direct` — the unit is what estimation asked for.
 *  - `estimation-disabled` — counting tasks because there are no
 *    estimates to sum. SPR-10: no estimate input belongs anywhere on
 *    the page.
 *  - `enum-without-weights` — estimation *is* on, but its values are
 *    categorical and no `weights` map was declared, so they cannot be
 *    summed. SPR-11 requires this to be stated near the chart with a
 *    pointer to `weights`, because a "Tasks" axis under
 *    `unit: custom_enum` otherwise reads as summed effort.
 */
export type UnitReason = "direct" | "estimation-disabled" | "enum-without-weights";

export interface AxisResolution {
  readonly unit: BurndownUnitDto;
  readonly label: string;
  readonly reason: UnitReason;
}

/**
 * Resolves the Y-axis label and *why* the server picked this unit.
 *
 * SPR-9 rules out a hardcoded "Story points"/"Tasks" label: the axis
 * says what `workflow.yaml#estimation` configured. SPR-12 rules out
 * showing the raw `weighted_enum` — the configured `unit_label` is the
 * user's word for it and is what belongs on the axis.
 *
 * `workflow` may be undefined while its query is in flight; the
 * server's own unit still gives a correct label, only without the
 * fallback *explanation*, which is why `reason` degrades to `direct`
 * rather than guessing.
 */
export function resolveAxis(
  series: Pick<BurndownSeriesDto, "unit" | "unitLabel">,
  workflow: WorkflowConfig | undefined,
): AxisResolution {
  const est = workflow?.estimation;
  const configuredLabel = series.unitLabel ?? est?.unit_label;

  if (series.unit === "tasks") {
    // Two very different configs land here; only the workflow can say
    // which, and the message the user needs differs for each.
    const enumWithoutWeights =
      est?.enabled === true && est.unit === "custom_enum" && est.weights === undefined;
    return {
      unit: "tasks",
      label: "Tasks remaining",
      reason: enumWithoutWeights ? "enum-without-weights" : "estimation-disabled",
    };
  }

  if (series.unit === "weighted_enum") {
    // SPR-12: never the raw enum-mode name.
    return {
      unit: series.unit,
      label: `${configuredLabel ?? "Weighted"} remaining`,
      reason: "direct",
    };
  }

  // points | hours | days | custom_numeric. `unit_label` is required
  // by the schema for custom_numeric and optional for the rest, where
  // the unit name itself is already the user's word.
  return {
    unit: series.unit,
    label: `${configuredLabel ?? series.unit} remaining`,
    reason: "direct",
  };
}

/** A point placed in the chart's viewBox coordinate space. */
export interface PlottedPoint {
  readonly date: string;
  readonly x: number;
  readonly y: number;
  readonly remaining: number;
  readonly incompleteTaskCount?: number;
}

export interface ChartGeometry {
  readonly actual: readonly PlottedPoint[];
  readonly ideal: readonly PlottedPoint[];
  /** Y-axis maximum actually used for scaling. Never 0. */
  readonly yMax: number;
  /** Indices of `actual` whose tick label should be drawn. */
  readonly labelledTicks: readonly number[];
}

/**
 * Projects the series into a fixed viewBox.
 *
 * Two degenerate cases are handled here rather than by the caller,
 * because both otherwise produce a chart that renders but lies:
 *
 *  - **A single-day sprint** (SPR-22) has `span === 0`, so the usual
 *    `i / span` is `0/0`. The point is placed mid-width so it is
 *    visible rather than pinned to a zero-width left edge.
 *  - **An all-zero series** (SPR-16, and any completed sprint) has
 *    `max === 0`, so `y = remaining / max` is `0/0`. `yMax` floors at
 *    1, which draws a flat line along the baseline instead of NaN
 *    coordinates — SVG drops a path with a NaN in it silently, which
 *    is precisely the "empty chart" SPR-34 says must never stand in
 *    for a real value.
 */
export function buildGeometry(
  series: BurndownSeriesDto,
  width: number,
  height: number,
  maxLabels = 10,
): ChartGeometry {
  const pts = series.series;
  const span = pts.length - 1;
  const observedMax = Math.max(
    0,
    ...pts.map(p => p.remaining),
    ...series.ideal.map(p => p.remaining),
  );
  // Floor at 1: a zero-height axis cannot be scaled against, and
  // dividing by it yields NaN rather than a flat line.
  const yMax = observedMax > 0 ? observedMax : 1;

  const xAt = (i: number): number =>
    span <= 0 ? width / 2 : (i / span) * width;
  const yAt = (v: number): number => height - (v / yMax) * height;

  const actual = pts.map((p, i) => ({
    date: p.date,
    x: xAt(i),
    y: yAt(p.remaining),
    remaining: p.remaining,
    incompleteTaskCount: p.incompleteTaskCount,
  }));

  const ideal = series.ideal.map((p, i) => ({
    date: p.date,
    x: xAt(i),
    y: yAt(p.remaining),
    remaining: p.remaining,
  }));

  return { actual, ideal, yMax, labelledTicks: thinTicks(pts.length, maxLabels) };
}

/**
 * Chooses which X ticks get a printed label.
 *
 * SPR-18: a ~90-day sprint must not overprint 90 dates into a smear.
 * The *data* keeps one point per day either way — this only thins the
 * labels, which is the distinction that case draws.
 *
 * The last index is always included so the window's end is readable;
 * without it a stride that does not divide evenly leaves the chart
 * looking like it stops early.
 */
export function thinTicks(count: number, maxLabels: number): readonly number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const stride = Math.ceil(count / maxLabels);
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) out.push(i);
  const last = count - 1;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/**
 * Splits the window at `today` so elapsed and not-yet-happened days
 * can be drawn differently.
 *
 * SPR-21: a sprint entirely in the future is flat at `initialTotal`,
 * and a flat line reads as "no progress was made" unless the chart
 * says those days have not happened. Returns the count of elapsed
 * samples — 0 when the whole window is ahead, `length` when it is all
 * behind.
 */
export function elapsedCount(series: readonly BurndownPointDto[], today: string): number {
  let n = 0;
  for (const p of series) {
    if (p.date <= today) n += 1;
    else break;
  }
  return n;
}

/**
 * Per-category counts for enum estimation (SPR-11).
 *
 * When values are categorical the sum is meaningless but the
 * *distribution* is exactly the aggregate a reader wants, so the
 * detail page shows how many of each preset value remain. Counted
 * from the tasks the page already has rather than from a new
 * endpoint: the set is the sprint's task list, which is on screen.
 *
 * Preset values with no tasks are kept, at 0 — a category silently
 * missing from the row is indistinguishable from one that does not
 * exist, and the zero is the informative part.
 */
export function countByEstimate(
  tasks: readonly { readonly estimate?: string | number | undefined }[],
  presetValues: readonly (string | number)[],
): readonly { readonly value: string; readonly count: number }[] {
  const counts = new Map<string, number>();
  for (const v of presetValues) counts.set(String(v), 0);
  let unset = 0;
  for (const t of tasks) {
    const raw = t.estimate;
    if (raw === undefined || raw === null || raw === "") {
      unset += 1;
      continue;
    }
    const key = String(raw);
    // An estimate outside preset_values still gets counted, under its
    // own name. Dropping it would make the row's total disagree with
    // the task count for reasons the reader cannot see.
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out = [...counts.entries()].map(([value, count]) => ({ value, count }));
  if (unset > 0) out.push({ value: "No estimate", count: unset });
  return out;
}
