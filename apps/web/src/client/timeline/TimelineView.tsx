import type { TaskFrontmatterPublic, TimelineGrouping, TimelineZoom } from "@loctt/contracts";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { ApiError } from "../api/client.ts";
import { useMilestones, useSprints, useUsers, useViews } from "../api/hooks/sidebarData.ts";
import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { tasksParamsFromSearch, useTasksFeed } from "../api/hooks/useTasks.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { ConfigErrorState } from "../board/ConfigErrorState.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { dependencyEdges } from "./arrows.ts";
import {
  computeRange,
  dateToX,
  DAY_WIDTH,
  eachDay,
  headerCells,
  nonWorkingReason,
  rangeWidth,
} from "./geometry.ts";
import {
  BAND_HEADER_H,
  buildLayout,
  ROW_H,
} from "./layout.ts";
import { buildRows, totalRows } from "./rows.ts";
import { dependencyRelationshipStatus, resolveArrows, resolveGrouping, resolveZoom } from "./settings.ts";
import { TimelineChart } from "./TimelineChart.tsx";

/**
 * The timeline / Gantt view (M3.3a — TML-1..17, rendering only).
 *
 * Drag-to-resize and drag-to-shift (TML-9..12's write half) and the
 * edge/error cases (TML-18..50) are M3.3b. The seams they need are
 * left explicit rather than implied — see `TimelineChart.tsx`.
 *
 * Like the board, this reads the *same* URL search vocabulary as the
 * list, so `/timeline?assignee=…` selects the tasks `/list?assignee=…`
 * does, plus three display params of its own (zoom, grouping, arrows)
 * which are in the URL because TML-1/3/8/15 each require the state to
 * be shareable.
 */

/** The list's page size would silently truncate the chart. See A27. */
const TIMELINE_PAGE_SIZE = 200;

export function TimelineView() {
  const search = useSearch({ from: "/timeline" });
  const navigate = useNavigate({ from: "/timeline" });

  const params = useMemo(
    () => ({ ...tasksParamsFromSearch(search), limit: TIMELINE_PAGE_SIZE }),
    [search],
  );
  const tasks = useTasksFeed(params);

  const workflow = useWorkflow();
  const calendar = useCalendar();
  const info = useInfo();
  const milestones = useMilestones();
  const sprints = useSprints();
  const users = useUsers();
  const views = useViews();

  const pages = tasks.data?.pages ?? [];
  const items = useMemo(() => pages.flatMap(p => p.items), [pages]);

  // Same reasoning as the board (A27): a chart is not a page of a
  // chart, and a truncated feed would make the band counts lie.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = tasks;
  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // TML-2: a saved view's `display` sits between the URL and the
  // workspace default. `?view=<id>` is how the list addresses one, so
  // the timeline resolves it the same way.
  const activeView = useMemo(() => {
    const id = typeof search.view === "string" ? search.view : undefined;
    if (id === undefined) return undefined;
    return (views.data?.queries ?? []).find(q => q.id === id);
  }, [search.view, views.data]);

  const settingsInput = useMemo(
    () => ({
      urlZoom: search.zoom,
      urlGrouping: search.grouping,
      urlArrows: search.arrows,
      view: activeView,
      workflow: workflow.data,
    }),
    [search.zoom, search.grouping, search.arrows, activeView, workflow.data],
  );

  const zoom = resolveZoom(settingsInput).value;
  const grouping = resolveGrouping(settingsInput).value;
  const arrowsOn = resolveArrows(settingsInput).value;

  // The workspace's today, not the browser's — TML-16 asks for the
  // marker "for the workspace timezone", and this is the same value
  // the list and board use for overdue.
  const today = info.data?.today ?? new Date().toISOString().slice(0, 10);

  const model = useMemo(
    () =>
      buildRows(items, grouping, {
        workflow: workflow.data,
        milestones: milestones.data?.items,
        sprints: sprints.data?.items,
        users: users.data?.items,
      }),
    [items, grouping, workflow.data, milestones.data, sprints.data, users.data],
  );

  const range = useMemo(() => {
    const dates: string[] = [];
    for (const t of items) {
      if (t.start_date !== undefined) dates.push(t.start_date);
      if (t.due_date !== undefined) dates.push(t.due_date);
    }
    return computeRange(dates, today);
  }, [items, today]);

  const layout = useMemo(() => buildLayout(model), [model]);

  // TML-14: only the configured relationship, and only when it
  // resolves. A dangling key yields no edges here; naming it in a
  // notice is TML-34 (M3.3b), and `dependencyRelationshipStatus`
  // already returns the name for that.
  const depStatus = dependencyRelationshipStatus(workflow.data);
  const edges = useMemo(
    () => (arrowsOn && depStatus.kind === "ok" ? dependencyEdges(items, depStatus.key) : []),
    [arrowsOn, depStatus.kind, depStatus.kind === "ok" ? depStatus.key : undefined, items],
  );

  const setParam = useCallback(
    (patch: Record<string, unknown>): void => {
      void navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }) });
    },
    [navigate],
  );

  const scroller = useRef<HTMLDivElement | null>(null);

  /**
   * TML-16: "the initial horizontal scroll puts today in view rather
   * than starting at the earliest task in the tracker".
   *
   * Runs once per zoom rather than on every render, so a user who
   * scrolls away is not yanked back on the next data refetch — which
   * would make the chart unusable while the feed pages in.
   */
  const centredFor = useRef<string | null>(null);
  const centreToday = useCallback((): void => {
    const el = scroller.current;
    if (el === null) return;
    const x = dateToX(range, today, zoom);
    el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: "auto" });
  }, [range, today, zoom]);

  useLayoutEffect(() => {
    if (scroller.current === null || items.length === 0) return;
    const stamp = `${zoom}:${range.start}:${range.end}`;
    if (centredFor.current === stamp) return;
    centredFor.current = stamp;
    centreToday();
  }, [zoom, range, items.length, centreToday]);

  const configError = configInvalidOf(workflow.error) ?? configInvalidOf(tasks.error);
  if (configError !== null) {
    return (
      <ConfigErrorState
        error={configError}
        onRetry={() => {
          void workflow.refetch();
          void tasks.refetch();
        }}
      />
    );
  }

  const loading = tasks.isLoading || workflow.isLoading;
  if (!loading && (tasks.isError || workflow.isError)) {
    return (
      <div className="p-4">
        <ErrorState
          error={tasks.error ?? workflow.error}
          context="Could not load the timeline"
          onRetry={() => {
            void tasks.refetch();
            void workflow.refetch();
          }}
        />
      </div>
    );
  }

  const width = rangeWidth(range, zoom);
  const cells = headerCells(range, zoom, calendar.data);
  // Shading is per *day* column at every zoom, but at month zoom a
  // 4px band per weekend is visual noise on a chart nobody reads
  // day-by-day. TML-13's first bullet asks for day and week only.
  const shaded =
    zoom === "month"
      ? []
      : eachDay(range)
          .map(d => ({ date: d, reason: nonWorkingReason(d, calendar.data) }))
          .filter((s): s is { date: string; reason: string } => s.reason !== undefined);

  return (
    <div className="flex h-full flex-col gap-3 p-4" data-testid="timeline">
      <Toolbar
        zoom={zoom}
        grouping={grouping}
        arrowsOn={arrowsOn}
        arrowsAvailable={depStatus.kind === "ok"}
        onZoom={z => { setParam({ zoom: z }); }}
        onGrouping={g => { setParam({ grouping: g }); }}
        onArrows={v => { setParam({ arrows: v }); }}
        onToday={() => { centreToday(); }}
      />

      {loading && (
        <div className="text-[12px] text-fg-muted" data-testid="timeline-loading">
          Loading…
        </div>
      )}

      <TimelineChart
        ref={scroller}
        layout={layout}
        model={model}
        range={range}
        zoom={zoom}
        width={width}
        cells={cells}
        shaded={shaded}
        today={today}
        edges={arrowsOn ? edges : []}
        onOpenTask={key => { void navigate({ to: "/tasks/$key", params: { key } }); }}
      />

      <UnscheduledLane
        rows={model.unscheduled}
        onOpenTask={key => { void navigate({ to: "/tasks/$key", params: { key } }); }}
      />

      <div className="text-[11px] text-fg-muted" data-testid="timeline-total">
        {totalRows(model)} {totalRows(model) === 1 ? "task" : "tasks"}
      </div>
    </div>
  );
}

/** Zoom / grouping / arrows / today controls. */
function Toolbar(props: {
  readonly zoom: TimelineZoom;
  readonly grouping: TimelineGrouping;
  readonly arrowsOn: boolean;
  readonly arrowsAvailable: boolean;
  readonly onZoom: (z: TimelineZoom) => void;
  readonly onGrouping: (g: TimelineGrouping) => void;
  readonly onArrows: (v: boolean) => void;
  readonly onToday: () => void;
}) {
  const zooms: TimelineZoom[] = ["day", "week", "month"];
  const groupings: TimelineGrouping[] = ["none", "milestone", "assignee", "status", "sprint"];
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="timeline-toolbar">
      <div className="flex items-center gap-1" role="group" aria-label="Zoom">
        {zooms.map(z => (
          <button
            key={z}
            type="button"
            data-testid={`timeline-zoom-${z}`}
            aria-pressed={props.zoom === z}
            onClick={() => { props.onZoom(z); }}
            className={`rounded border px-2 py-0.5 text-[12px] capitalize ${
              props.zoom === z
                ? "border-accent-fg bg-accent-fg/10 text-accent-fg"
                : "border-border-default text-fg-muted hover:bg-canvas-subtle"
            }`}
          >
            {z}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-1 text-[12px] text-fg-muted">
        Group by
        <select
          data-testid="timeline-grouping"
          value={props.grouping}
          onChange={e => { props.onGrouping(e.target.value as TimelineGrouping); }}
          className="rounded border border-border-default bg-canvas-default px-1 py-0.5 text-[12px] capitalize"
        >
          {groupings.map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </label>

      {/* TML-15: the toggle reflects the state even when no
          relationship is configured — "the arrows toggle reflects that
          state" — so it is disabled rather than hidden. */}
      <label className="flex items-center gap-1 text-[12px] text-fg-muted">
        <input
          type="checkbox"
          data-testid="timeline-arrows"
          checked={props.arrowsOn && props.arrowsAvailable}
          disabled={!props.arrowsAvailable}
          onChange={e => { props.onArrows(e.target.checked); }}
        />
        Dependencies
      </label>

      <button
        type="button"
        data-testid="timeline-today"
        onClick={() => { props.onToday(); }}
        className="rounded border border-border-default px-2 py-0.5 text-[12px] text-fg-muted hover:bg-canvas-subtle"
      >
        Today
      </button>
    </div>
  );
}

/**
 * TML-5: the Unscheduled lane.
 *
 * Hidden entirely when empty — the case allows either "hidden with no
 * tasks, or shown as an empty labelled lane", and forbids only the
 * unlabelled blank row. Hiding is the option that does not cost
 * vertical space on the common path.
 */
function UnscheduledLane(props: {
  readonly rows: readonly { readonly task: TaskFrontmatterPublic }[];
  readonly onOpenTask: (key: string) => void;
}) {
  if (props.rows.length === 0) return null;
  return (
    <div
      className="rounded-md border border-border-default bg-canvas-subtle"
      data-testid="timeline-unscheduled"
    >
      <div className="border-b border-border-default px-3 py-1.5 text-[12px] font-semibold">
        Unscheduled{" "}
        <span className="font-normal text-fg-muted" data-testid="timeline-unscheduled-count">
          ({props.rows.length})
        </span>
      </div>
      <ul>
        {props.rows.map(r => (
          <li key={r.task.id}>
            <button
              type="button"
              data-testid={`timeline-unscheduled-row-${r.task.key}`}
              onClick={() => { props.onOpenTask(r.task.key); }}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] hover:bg-canvas-default"
              style={{ height: ROW_H }}
            >
              <span className="font-mono text-fg-muted">{r.task.key}</span>
              <span className="truncate">{r.task.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function configInvalidOf(error: unknown): ApiError | null {
  return error instanceof ApiError && error.envelope?.code === "config_invalid"
    ? error
    : null;
}

export { BAND_HEADER_H, DAY_WIDTH };
