import type { TimelineZoom } from "@loctt/contracts";
import { forwardRef, useMemo, useState } from "react";

import type { DependencyEdge } from "./arrows.ts";
import { arrowPath } from "./arrows.ts";
import type { DateRange, HeaderCell } from "./geometry.ts";
import { barGeometry, dateToX,DAY_WIDTH } from "./geometry.ts";
import type { Layout } from "./layout.ts";
import { BAND_HEADER_H, buildLayout,ROW_H } from "./layout.ts";
import type { DateProblem, RowModel } from "./rows.ts";
import { dateProblemNote } from "./rows.ts";

/**
 * The scrolling chart: header, bands, bars, shading, today marker and
 * arrows (M3.3a).
 *
 * ## Seams left for M3.3b
 *
 * The drag layer (TML-9..12) needs three things this component already
 * has in the right shape, and nothing here should have to change to
 * accommodate it:
 *
 *  - **`onBarPointerDown`** — an optional prop, unused today. M3.3b
 *    supplies it; the bar already carries `data-task-key` and
 *    `data-edge` on its two handles so a drag can tell which edge was
 *    grabbed without re-hit-testing.
 *  - **`xToDate`** in `geometry.ts` — the exact inverse of the
 *    placement used here, already unit-tested against it as a pair, so
 *    the snap the drag commits agrees with the pixel it drew.
 *  - **`renderBarOverlay`** — an optional render prop for the live
 *    drag preview and the candidate-date label TML-12 asks for, which
 *    must sit above the bars without the bars knowing about it.
 *
 * A click is routed through `onOpenTask` rather than an anchor so
 * M3.3b can suppress the navigation that TML-17's third bullet
 * forbids after a drag ("a click that was actually the tail of a drag
 * does not navigate") — the guard has a single place to live.
 */

/**
 * Minimum grabbable width of an edge handle, in pixels (TML-36).
 *
 * Six, not one: a 1px strip is not a hit target a pointer can
 * reliably find, and at month zoom a one-day bar is 4px wide overall.
 * The two handles may therefore overlap on a very narrow bar — the
 * start handle wins there, which is a deliberate choice over having
 * neither reachable.
 */
const EDGE_HIT_PX = 6;

export interface TimelineChartProps {
  readonly layout: Layout;
  readonly range: DateRange;
  readonly zoom: TimelineZoom;
  readonly width: number;
  readonly cells: readonly HeaderCell[];
  readonly shaded: readonly { readonly date: string; readonly reason: string }[];
  readonly today: string;
  readonly edges: readonly DependencyEdge[];
  readonly onOpenTask: (key: string) => void;
  /** M3.3b: begins a resize/shift drag. */
  readonly onBarPointerDown?: (
    e: React.PointerEvent,
    taskId: string,
    edge: "start" | "end" | "body",
  ) => void;
  /** M3.3b: drag preview / candidate-date label. */
  readonly renderBarOverlay?: () => React.ReactNode;
  /**
   * The dates a bar should be drawn at right now, overriding the
   * task's stored pair.
   *
   * This is how a drag in flight moves the bar the user is holding
   * without touching the cache (TML-37: "the bar under the cursor
   * stays under the cursor and keeps its drag geometry"), and how a
   * failed write puts it back (TML-42/43/44) — the override simply
   * stops being returned and the stored dates render again.
   */
  readonly barDatesOverride?: (taskId: string) => { readonly start: string; readonly due: string } | undefined;
  /** True while a drag is in flight, for cursor and hit-target styling. */
  readonly dragging?: boolean;
  /**
   * TML-40: a keyboard shift or resize, in whole days.
   *
   * Routed to the same `onDrop` the mouse uses, so the write has "the
   * same single-write semantics as the mouse drags (TML-9 through
   * TML-11)" — one request, and only the fields that edge touches.
   */
  readonly onBarKeyAdjust?: (taskId: string, edge: "start" | "end" | "body", days: number) => void;
  /**
   * TML-31: sources whose dependency target has no bar to point at.
   *
   * Their bars get a badge rather than losing the link silently. A
   * collapsed band adds to this set here, because the collapsed state
   * lives in this component and the parent cannot know it.
   */
  readonly offscreenFrom?: ReadonlySet<string> | undefined;
  /** Row model, so collapse can re-layout without the parent knowing. */
  readonly model?: RowModel;
}

export const TimelineChart = forwardRef<HTMLDivElement, TimelineChartProps>(
  function TimelineChart(props, ref) {
    // TML-6: bands are collapsible. Local state, not the URL: the case
    // says "the collapsed state does not change the URL's task scope",
    // and keeping it out of the URL is the simplest way to guarantee
    // that — a collapsed band is a display affordance, not a filter.
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

    const layout = useMemo(
      () => (props.model === undefined ? props.layout : buildLayout(props.model, collapsed)),
      [props.model, props.layout, collapsed],
    );

    const toggle = (id: string): void => {
      setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    };

    /**
     * Off-screen dependency sources, including those made off-screen by
     * a *collapsed band* — which the parent cannot compute, because the
     * collapsed set lives here.
     *
     * An edge whose target sits in a collapsed band is dropped for the
     * same reason a filtered-out target is: its row has no y to anchor
     * to. TML-31's last bullet ("expanding the collapsed band restores
     * the full arrow") then falls out of this set shrinking again when
     * the band reopens.
     */
    const hidden = useMemo(() => {
      const out = new Set<string>();
      if (props.model === undefined) return out;
      for (const band of props.model.bands) {
        if (!collapsed.has(band.id)) continue;
        for (const r of band.rows) out.add(r.task.id);
      }
      return out;
    }, [props.model, collapsed]);

    const visibleEdges = useMemo(
      () => props.edges.filter(e => !hidden.has(e.from) && !hidden.has(e.to)),
      [props.edges, hidden],
    );

    const offscreen = useMemo(() => {
      const out = new Set(props.offscreenFrom ?? []);
      for (const e of props.edges) {
        if (hidden.has(e.to) && !hidden.has(e.from)) out.add(e.from);
      }
      return out;
    }, [props.offscreenFrom, props.edges, hidden]);

    const px = DAY_WIDTH[props.zoom];
    const todayX = dateToX(props.range, props.today, props.zoom);

    return (
      <div
        ref={ref}
        data-testid="timeline-scroll"
        className="min-h-0 flex-1 overflow-auto rounded-md border border-border-default"
      >
        <div style={{ width: props.width, position: "relative" }}>
          {/* Header. Sticky so the dates stay visible while the bands
              scroll under them. */}
          <div
            data-testid="timeline-header"
            className="sticky top-0 z-20 flex h-6 border-b border-border-default bg-bg-canvas"
            style={{ width: props.width }}
          >
            {props.cells.map(c => (
              <div
                key={c.key}
                data-testid="timeline-header-cell"
                // The first day this cell covers. Cheap, and it is what
                // lets a caller convert a pixel offset back to a date
                // without assuming the chart's origin — which moves
                // whenever the dated range widens.
                data-date={c.key}
                className="shrink-0 border-r border-border-subtle text-center text-[10px] leading-6 text-text-secondary"
                style={{ width: c.width }}
              >
                {c.label}
              </div>
            ))}
          </div>

          <div style={{ position: "relative", height: layout.height, width: props.width }}>
            {/* TML-13: weekend/holiday shading, decorative only — bars
                render across it and no duration is adjusted. Behind
                everything, and `pointer-events: none` so it never
                intercepts a click meant for a bar. */}
            {props.shaded.map(s => (
              <div
                key={s.date}
                data-testid="timeline-nonworking"
                data-date={s.date}
                {...(s.reason !== "" ? { title: s.reason } : {})}
                aria-hidden="true"
                className="absolute top-0 bg-text-primary/[0.045]"
                style={{
                  left: dateToX(props.range, s.date, props.zoom),
                  width: px,
                  height: layout.height,
                  pointerEvents: "none",
                }}
              />
            ))}

            {/* TML-16: the today marker. */}
            <div
              data-testid="timeline-today-marker"
              // TML-24 bullets 1-2: the marker's date is exposed so a
              // test can prove it follows the *workspace* timezone.
              // Sourcing `today` from `new Date()` instead of the
              // server left all 52 timeline tests green, because the
              // marker's position was only a pixel offset.
              data-today={props.today}
              aria-hidden="true"
              className="absolute top-0 z-10 w-px bg-accent/70"
              style={{ left: todayX, height: layout.height, pointerEvents: "none" }}
            />

            {/* Bands and bars. */}
            {layout.bands.map(band => (
              <div key={band.id}>
                <button
                  type="button"
                  data-testid={`timeline-band-${band.id}`}
                  aria-expanded={!collapsed.has(band.id)}
                  onClick={() => { toggle(band.id); }}
                  className="absolute left-0 z-10 flex items-center gap-2 border-b border-border-subtle bg-bg-muted/90 px-2 text-left text-[11px] font-semibold"
                  style={{ top: band.y, height: BAND_HEADER_H, width: props.width }}
                >
                  <span aria-hidden="true">{collapsed.has(band.id) ? "▸" : "▾"}</span>
                  <span>{band.label}</span>
                  <span
                    className="font-normal text-text-secondary"
                    data-testid={`timeline-band-count-${band.id}`}
                  >
                    ({band.count})
                  </span>
                </button>

                {band.rows.map(({ row, y }) => {
                  const stored = {
                    start: row.task.start_date as string,
                    due: row.task.due_date as string,
                  };
                  const live = props.barDatesOverride?.(row.task.id) ?? stored;
                  const start = live.start;
                  const due = live.due;

                  // TML-18: a reversed pair gets an error-styled marker
                  // at its row instead of a bar. Deliberately not a bar
                  // of some clamped width — the case forbids both the
                  // backwards draw and the silent swap to 03-04 → 03-10
                  // "as if the data were fine", and any bar at all
                  // would be one of those two.
                  if (row.problem !== undefined) {
                    return (
                      <button
                        key={row.task.id}
                        type="button"
                        data-testid={`timeline-anomaly-${row.task.key}`}
                        data-task-key={row.task.key}
                        title={`${row.task.key} · ${dateProblemNote(row.problem)}`}
                        onClick={() => { props.onOpenTask(row.task.key); }}
                        className="absolute flex items-center gap-1 overflow-hidden rounded border border-danger-fg/50 bg-danger-fg/10 px-1 text-left text-[11px] leading-none text-danger-fg"
                        style={{
                          left: dateToX(props.range, anchorDate(row.problem, stored), props.zoom),
                          width: Math.max(px, 96),
                          top: y + 3,
                          height: ROW_H - 6,
                        }}
                      >
                        <span aria-hidden="true">⚠</span>
                        {/* K26: fall back to the key when title is the corrupt field. */}
                        <span className="block truncate">{row.task.title ?? row.task.key}</span>
                      </button>
                    );
                  }

                  const bar = barGeometry(props.range, start, due, props.zoom);
                  return (
                    <button
                      key={row.task.id}
                      type="button"
                      data-testid={`timeline-bar-${row.task.key}`}
                      data-task-key={row.task.key}
                      data-start={start}
                      data-due={due}
                      title={`${row.task.key} · ${row.task.title ?? row.task.key} · ${start} → ${due}`}
                      onClick={() => { props.onOpenTask(row.task.key); }}
                      onPointerDown={e => { props.onBarPointerDown?.(e, row.task.id, "body"); }}
                      /* TML-40: documented keys, announced via the
                         bar's `aria-label` which carries the live
                         dates. Left/Right shift the whole bar;
                         Shift+Left/Right resize the due edge;
                         Alt+Left/Right resize the start edge. Each
                         goes through the same drop path as a mouse
                         release, so a keyboard shift is one atomic
                         two-field write exactly as TML-11 requires of
                         the mouse. */
                      onKeyDown={e => {
                        const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                        if (dir === 0) return;
                        const edge = e.shiftKey ? "end" : e.altKey ? "start" : "body";
                        e.preventDefault();
                        props.onBarKeyAdjust?.(row.task.id, edge, dir);
                      }}
                      aria-label={`${row.task.key} ${row.task.title ?? row.task.key}, ${start} to ${due}`}
                      className="absolute overflow-hidden rounded border border-accent/40 bg-accent/20 px-1 text-left text-[11px] leading-none hover:bg-accent/30"
                      style={{
                        left: bar.left,
                        width: bar.width,
                        top: y + 3,
                        height: ROW_H - 6,
                      }}
                    >
                      {/* Truncated with an ellipsis when the bar is
                          narrow (TML-4's third bullet). K26: fall back to
                          the key when title is the corrupt field. */}
                      <span className="block truncate">{row.task.title ?? row.task.key}</span>
                      {/* TML-31: "the source bar carries an indicator
                          that it has an off-screen dependency (a stub
                          arrow or a badge), rather than the link
                          simply vanishing". */}
                      {offscreen.has(row.task.id) && (
                        <span
                          data-testid={`timeline-offscreen-dep-${row.task.key}`}
                          title="This task has a dependency on a task that is not shown"
                          className="absolute right-0 top-0 z-10 px-0.5 text-[9px] leading-none text-warn-fg"
                        >
                          &#8674;
                        </span>
                      )}
                      {/* Resize handles.
                          TML-36: "either the edge handles remain
                          grabbable (a minimum hit area is enforced), or
                          edge-resize is disabled at that scale". A
                          minimum hit area is enforced — `EDGE_HIT_PX`,
                          independent of the bar's own width, so a
                          one-day bar at month zoom (4px) still has
                          grabbable edges.

                          Measured, and the reason these are not the
                          1px strips M3.3a left: at 1px wide and with
                          no explicit z-index, `elementFromPoint` at the
                          bar's own right edge returned the BUTTON, not
                          the handle — so an end-edge drag was read as a
                          body drag and wrote BOTH dates. That is
                          exactly the payload TML-9's first bullet
                          forbids, and it is why the hit area is now
                          explicit and raised above the label. */}
                      <span
                        data-edge="start"
                        data-testid={`timeline-handle-start-${row.task.key}`}
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 z-10 cursor-ew-resize"
                        style={{ width: EDGE_HIT_PX }}
                        onPointerDown={e => { props.onBarPointerDown?.(e, row.task.id, "start"); }}
                      />
                      <span
                        data-edge="end"
                        data-testid={`timeline-handle-end-${row.task.key}`}
                        aria-hidden="true"
                        className="absolute inset-y-0 right-0 z-10 cursor-ew-resize"
                        style={{ width: EDGE_HIT_PX }}
                        onPointerDown={e => { props.onBarPointerDown?.(e, row.task.id, "end"); }}
                      />
                    </button>
                  );
                })}
              </div>
            ))}

            {/* TML-14: arrows, drawn last so they sit above the bars.
                Non-interactive: the bar underneath must stay clickable
                (TML-17). */}
            {visibleEdges.length > 0 && (
              <svg
                data-testid="timeline-arrows"
                className="absolute left-0 top-0"
                width={props.width}
                height={layout.height}
                style={{ pointerEvents: "none" }}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="tl-arrowhead"
                    markerWidth="6"
                    markerHeight="6"
                    refX="5"
                    refY="3"
                    orient="auto"
                  >
                    <path d="M0,0 L6,3 L0,6 Z" className="fill-text-secondary" />
                  </marker>
                </defs>
                {visibleEdges.map(edge => {
                  const fromY = layout.centreById.get(edge.from);
                  const toY = layout.centreById.get(edge.to);
                  if (fromY === undefined || toY === undefined) return null;
                  const fromTask = findTask(layout, edge.from);
                  const toTask = findTask(layout, edge.to);
                  if (fromTask === undefined || toTask === undefined) return null;
                  const fromBar = barGeometry(
                    props.range,
                    fromTask.start_date as string,
                    fromTask.due_date as string,
                    props.zoom,
                  );
                  const toBar = barGeometry(
                    props.range,
                    toTask.start_date as string,
                    toTask.due_date as string,
                    props.zoom,
                  );
                  return (
                    <path
                      key={`${edge.from}->${edge.to}`}
                      data-testid="timeline-arrow"
                      d={arrowPath(
                        { x: fromBar.left + fromBar.width, y: fromY },
                        { x: toBar.left, y: toY },
                      )}
                      fill="none"
                      className="stroke-text-secondary"
                      strokeWidth={1}
                      markerEnd="url(#tl-arrowhead)"
                    />
                  );
                })}
              </svg>
            )}

            {props.renderBarOverlay?.()}
          </div>
        </div>
      </div>
    );
  },
);

/**
 * Where an anomaly marker sits horizontally.
 *
 * TML-18's task has two real dates in the wrong order, and the marker
 * goes at the earlier of them — the column the user is most likely to
 * be looking at when they notice the row, and one that is definitely
 * inside the chart's range (`computeRange` saw both). For the shapes
 * that reach the chart with only one usable date, that date; and for
 * anything with none, the range start, so the marker is on screen
 * rather than clipped off the left edge at a negative offset.
 */
function anchorDate(
  problem: DateProblem,
  stored: { readonly start: string; readonly due: string },
): string {
  if (problem.kind === "reversed") return problem.due < problem.start ? problem.due : problem.start;
  if (problem.kind === "open_start") return problem.start;
  if (problem.kind === "open_due") return problem.due;
  return stored.start ?? stored.due;
}

/** The task behind a laid-out row, by id. */
function findTask(layout: Layout, id: string) {
  for (const band of layout.bands) {
    for (const { row } of band.rows) {
      if (row.task.id === id) return row.task;
    }
  }
  return undefined;
}
