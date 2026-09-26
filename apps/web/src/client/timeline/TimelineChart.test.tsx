// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { computeRange } from "./geometry.ts";
import { buildLayout } from "./layout.ts";
import type { RowModel, TimelineTask } from "./rows.ts";
import { TimelineChart } from "./TimelineChart.tsx";

afterEach(cleanup);

/**
 * Windowing behaviour under jsdom.
 *
 * jsdom does no layout: `clientHeight`/`scrollTop` are 0 and there is
 * no `ResizeObserver`, so the chart's `viewport` stays null and it
 * renders its seed window `[0, OVERSCAN_PX]` from the origin. That is
 * enough to prove the two properties these cases turn on: only the
 * windowed subset of rows is mounted (TML-26), and an arrow whose
 * endpoint is a row *below* that window still anchors correctly because
 * the endpoint's geometry comes from the complete `layout.taskById`
 * map, not from the mounted rows (the trap).
 *
 * OVERSCAN_PX is 800 and a row is 28px, so the seed window mounts
 * roughly the first ~29 rows after the 26px band header — comfortably
 * fewer than the 3,000 the model holds.
 */

function task(n: number, over?: Partial<TimelineTask>): TimelineTask {
  return {
    id: `01T${String(n).padStart(23, "0")}`,
    key: `T-${String(n)}`,
    title: `Task ${String(n)}`,
    start_date: "2026-03-02",
    due_date: "2026-03-06",
    ...over,
  } as unknown as TimelineTask;
}

function oneBandModel(tasks: readonly TimelineTask[]): RowModel {
  return {
    bands: [
      {
        id: "b",
        label: "Band",
        rows: tasks.map(t => ({ task: t, scheduled: true })),
      },
    ],
    unscheduled: [],
  };
}

function renderChart(
  model: RowModel,
  extra?: Partial<React.ComponentProps<typeof TimelineChart>>,
) {
  const dates = model.bands.flatMap(b =>
    b.rows.flatMap(r => [r.task.start_date, r.task.due_date].filter((d): d is string => typeof d === "string")));
  const range = computeRange(dates, "2026-03-04");
  const layout = buildLayout(model);
  const width = 100000;
  return render(
    <TimelineChart
      layout={layout}
      model={model}
      range={range}
      zoom="day"
      width={width}
      calendar={undefined}
      shadingOn={false}
      today="2026-03-04"
      edges={[]}
      onOpenTask={() => {}}
      {...extra}
    />,
  );
}

describe("TimelineChart vertical windowing (TML-26)", () => {
  it("mounts only the rows in the window, not one bar per task", () => {
    const tasks = Array.from({ length: 3000 }, (_v, i) => task(i));
    const { container } = renderChart(oneBandModel(tasks));

    const bars = container.querySelectorAll('[data-testid^="timeline-bar-"]');
    // Far fewer than 3,000 — a screenful plus overscan. If windowing
    // were removed and every row rendered, this would be 3,000.
    expect(bars.length).toBeGreaterThan(0);
    expect(bars.length).toBeLessThan(200);

    // The band count is still the TRUE total, not the mounted count.
    const count = container.querySelector('[data-testid="timeline-band-count-b"]');
    expect(count?.textContent).toBe("(3000)");
  });

  it("mounts every row that fits inside the window — it does not over-window", () => {
    // A set small enough to sit entirely within the seed window
    // (OVERSCAN_PX / ROW_H ~ 28 rows) must render in full; windowing
    // must never drop rows that are actually in view. 20 < 28, so all
    // 20 mount. (The 60-row TML-30 case exercises the real-browser
    // viewport in the Playwright suite, where the window is far larger.)
    const tasks = Array.from({ length: 20 }, (_v, i) => task(i));
    const { container } = renderChart(oneBandModel(tasks));
    const bars = container.querySelectorAll('[data-testid^="timeline-bar-"]');
    expect(bars.length).toBe(20);
  });
});

describe("TimelineChart arrow anchoring under windowing (TML-26 trap)", () => {
  // @verifies TML-26
  it("an arrow whose TARGET row is off the window still anchors at the target's centre", () => {
    // 3,000 rows; an edge from row 0 (mounted) to row 2,900 (far below
    // the window, never mounted). The arrow must still draw, and its
    // path must reach the target's real centre y — which only the
    // complete `centreById`/`taskById` maps can supply.
    const tasks = Array.from({ length: 3000 }, (_v, i) => task(i));
    const model = oneBandModel(tasks);
    const from = tasks[0] as TimelineTask;
    const to = tasks[2900] as TimelineTask;

    const layout = buildLayout(model);
    const targetCentre = layout.centreById.get(to.id);
    expect(targetCentre).toBeDefined();

    const { container } = renderChart(model, {
      edges: [{ from: from.id, to: to.id }],
    });

    // The target row itself is NOT mounted — proving the arrow anchors
    // without the endpoint being rendered.
    expect(container.querySelector(`[data-testid="timeline-bar-${to.key}"]`)).toBeNull();

    // Exactly one arrow, drawn.
    const arrows = container.querySelectorAll('[data-testid="timeline-arrow"]');
    expect(arrows).toHaveLength(1);

    // Its path ends at the target's true centre y (the last `V <y> H`
    // in the orthogonal route lands on the target row).
    const d = arrows[0]?.getAttribute("d") ?? "";
    expect(d).toContain(`V ${String(targetCentre)}`);
  });
});

describe("TimelineChart arrow hover-highlight (TML-32)", () => {
  // @verifies TML-32
  it("hovering a source bar highlights its outgoing arrows; leaving clears them", () => {
    // One source (row 0) blocking 5 targets, all inside the window so
    // both endpoints render and all arrows draw.
    const tasks = Array.from({ length: 6 }, (_v, i) => task(i));
    const model = oneBandModel(tasks);
    const source = tasks[0] as TimelineTask;
    const edges = tasks.slice(1).map(t => ({ from: source.id, to: t.id }));

    const { container } = renderChart(model, { edges });

    const arrows = () => container.querySelectorAll('[data-testid="timeline-arrow"]');
    const highlighted = () =>
      container.querySelectorAll('[data-testid="timeline-arrow"][data-highlighted="true"]');

    expect(arrows()).toHaveLength(5);
    // Nothing highlighted at rest.
    expect(highlighted()).toHaveLength(0);

    const sourceBar = container.querySelector(`[data-testid="timeline-bar-${source.key}"]`);
    expect(sourceBar).not.toBeNull();

    fireEvent.pointerEnter(sourceBar as Element);
    // All 5 of the source's outgoing arrows are now highlighted.
    expect(highlighted()).toHaveLength(5);

    fireEvent.pointerLeave(sourceBar as Element);
    // Leaving clears them.
    expect(highlighted()).toHaveLength(0);
  });

  it("hovering a bar that is not a source highlights nothing", () => {
    const tasks = Array.from({ length: 3 }, (_v, i) => task(i));
    const model = oneBandModel(tasks);
    const source = tasks[0] as TimelineTask;
    const target = tasks[1] as TimelineTask;
    const { container } = renderChart(model, {
      edges: [{ from: source.id, to: target.id }],
    });
    const targetBar = container.querySelector(`[data-testid="timeline-bar-${target.key}"]`);
    fireEvent.pointerEnter(targetBar as Element);
    expect(
      container.querySelectorAll('[data-testid="timeline-arrow"][data-highlighted="true"]'),
    ).toHaveLength(0);
  });
});

describe("TimelineChart owns the viewport (redesign)", () => {
  // @verifies TML-53
  it("the scroll container carries a min-height floor so it cannot collapse to a strip", () => {
    // Red-prove: the unscheduled drawer no longer renders below an
    // unbounded lane, and the chart keeps a min-height floor. Remove
    // `min-h-[240px]` and this goes red — which is exactly the squeeze
    // (a chart shrunk to a strip while the lane ate the panel) the
    // redesign fixes.
    const tasks = Array.from({ length: 200 }, (_v, i) => task(i));
    const { container } = renderChart(oneBandModel(tasks));
    const scroll = container.querySelector('[data-testid="timeline-scroll"]');
    expect(scroll).not.toBeNull();
    expect(scroll?.className).toContain("min-h-[240px]");
    expect(scroll?.className).toContain("flex-1");
  });

  // @verifies TML-54
  it("renders the no-dated-tasks empty state inside the chart frame when noBars", () => {
    // The frame (header) still draws; the notice is centred inside it.
    const { container } = renderChart(oneBandModel([]), { noBars: true });
    expect(container.querySelector('[data-testid="timeline-header"]')).not.toBeNull();
    const notice = container.querySelector('[data-testid="timeline-no-dated-tasks"]');
    expect(notice).not.toBeNull();
    // K129 pass: "so there is nothing to chart" was trimmed as a
    // filler clause restating the state the empty notice itself shows.
    expect(notice?.textContent).toContain("has both a start date and a due date");
  });

  // @verifies TML-55
  it("draws a sticky task-name gutter cell for each laid-out row", () => {
    const tasks = Array.from({ length: 3 }, (_v, i) => task(i));
    const { container } = renderChart(oneBandModel(tasks));
    expect(container.querySelector('[data-testid="timeline-gutter"]')).not.toBeNull();
    for (const t of tasks) {
      expect(
        container.querySelector(`[data-testid="timeline-gutter-row-${t.key}"]`),
      ).not.toBeNull();
    }
  });

  // @verifies TML-55
  it("clicking a gutter row opens that task, same as the bar", () => {
    const tasks = Array.from({ length: 2 }, (_v, i) => task(i));
    const onOpenTask = vi.fn();
    const { container } = renderChart(oneBandModel(tasks), { onOpenTask });
    const row = container.querySelector(`[data-testid="timeline-gutter-row-${tasks[1]?.key}"]`);
    expect(row).not.toBeNull();
    fireEvent.click(row as Element);
    expect(onOpenTask).toHaveBeenCalledWith(tasks[1]?.key);
  });
});

describe("TimelineChart sticky headers (TML-27)", () => {
  it("the band header is position:sticky, not absolute, so it stays visible while its band scrolls", () => {
    const tasks = Array.from({ length: 5 }, (_v, i) => task(i));
    const { container } = renderChart(oneBandModel(tasks));
    const band = container.querySelector<HTMLElement>('[data-testid="timeline-band-b"]');
    expect(band).not.toBeNull();
    // Inline style, since the class is `sticky` from Tailwind but the
    // property is set explicitly for the test to read in jsdom.
    expect(band?.style.position).toBe("sticky");
  });
});
