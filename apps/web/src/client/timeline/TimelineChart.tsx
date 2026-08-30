import type { TimelineZoom } from "@loctt/contracts";
import { forwardRef, useMemo, useState } from "react";

import type { DependencyEdge } from "./arrows.ts";
import { arrowPath } from "./arrows.ts";
import type { DateRange, HeaderCell } from "./geometry.ts";
import { barGeometry, dateToX,DAY_WIDTH } from "./geometry.ts";
import type { Layout } from "./layout.ts";
import { BAND_HEADER_H, buildLayout,ROW_H } from "./layout.ts";
import type { RowModel } from "./rows.ts";

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
  /** M3.3b seam: begins a resize/shift drag. */
  readonly onBarPointerDown?: (
    e: React.PointerEvent,
    taskId: string,
    edge: "start" | "end" | "body",
  ) => void;
  /** M3.3b seam: drag preview / candidate-date label. */
  readonly renderBarOverlay?: () => React.ReactNode;
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
            className="sticky top-0 z-20 flex h-6 border-b border-border-default bg-canvas-default"
            style={{ width: props.width }}
          >
            {props.cells.map(c => (
              <div
                key={c.key}
                data-testid="timeline-header-cell"
                className="shrink-0 border-r border-border-muted text-center text-[10px] leading-6 text-fg-muted"
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
                className="absolute top-0 bg-fg-default/[0.045]"
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
              aria-hidden="true"
              className="absolute top-0 z-10 w-px bg-accent-fg/70"
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
                  className="absolute left-0 z-10 flex items-center gap-2 border-b border-border-muted bg-canvas-subtle/90 px-2 text-left text-[11px] font-semibold"
                  style={{ top: band.y, height: BAND_HEADER_H, width: props.width }}
                >
                  <span aria-hidden="true">{collapsed.has(band.id) ? "▸" : "▾"}</span>
                  <span>{band.label}</span>
                  <span
                    className="font-normal text-fg-muted"
                    data-testid={`timeline-band-count-${band.id}`}
                  >
                    ({band.count})
                  </span>
                </button>

                {band.rows.map(({ row, y }) => {
                  const start = row.task.start_date as string;
                  const due = row.task.due_date as string;
                  const bar = barGeometry(props.range, start, due, props.zoom);
                  return (
                    <button
                      key={row.task.id}
                      type="button"
                      data-testid={`timeline-bar-${row.task.key}`}
                      data-task-key={row.task.key}
                      data-start={start}
                      data-due={due}
                      title={`${row.task.key} · ${row.task.title} · ${start} → ${due}`}
                      onClick={() => { props.onOpenTask(row.task.key); }}
                      onPointerDown={e => { props.onBarPointerDown?.(e, row.task.id, "body"); }}
                      className="absolute overflow-hidden rounded border border-accent-fg/40 bg-accent-fg/20 px-1 text-left text-[11px] leading-none hover:bg-accent-fg/30"
                      style={{
                        left: bar.left,
                        width: bar.width,
                        top: y + 3,
                        height: ROW_H - 6,
                      }}
                    >
                      {/* Truncated with an ellipsis when the bar is
                          narrow (TML-4's third bullet). */}
                      <span className="block truncate">{row.task.title}</span>
                      {/* Resize handles. Inert until M3.3b wires
                          `onBarPointerDown`; present now so the drag
                          layer does not have to restructure the bar. */}
                      <span
                        data-edge="start"
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-1"
                        onPointerDown={e => { props.onBarPointerDown?.(e, row.task.id, "start"); }}
                      />
                      <span
                        data-edge="end"
                        aria-hidden="true"
                        className="absolute inset-y-0 right-0 w-1"
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
            {props.edges.length > 0 && (
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
                    <path d="M0,0 L6,3 L0,6 Z" className="fill-fg-muted" />
                  </marker>
                </defs>
                {props.edges.map(edge => {
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
                      className="stroke-fg-muted"
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

/** The task behind a laid-out row, by id. */
function findTask(layout: Layout, id: string) {
  for (const band of layout.bands) {
    for (const { row } of band.rows) {
      if (row.task.id === id) return row.task;
    }
  }
  return undefined;
}
