import type { TimelineGrouping, TimelineZoom } from "@loctt/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useMilestones, useSprints, useUsers, useViews } from "../api/hooks/sidebarData.ts";
import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { useTaskDates } from "../api/hooks/useTaskDates.ts";
import { tasksParamsFromSearch, useTasksFeed } from "../api/hooks/useTasks.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { ConfigErrorState } from "../board/ConfigErrorState.tsx";
import { buildGroupingCatalog, type GroupEntry } from "../grouping/catalog.ts";
import { GroupByPicker } from "../grouping/GroupByPicker.tsx";
import { FilterBar } from "../list/FilterBar.tsx";
import { useIsNarrow } from "../shell/useIsNarrow.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
import { ToolbarButton } from "../ui/ToolbarButton.tsx";
import { dependencyGraph } from "./arrows.ts";
import {
  computeRange,
  dateToX,
  DAY_WIDTH,
  fillRange,
  rangeWidth,
} from "./geometry.ts";
import {
  BAND_HEADER_H,
  buildLayout,
} from "./layout.ts";
import { buildRows, totalRows } from "./rows.ts";
import { dependencyRelationshipStatus, resolveArrows, resolveGrouping, resolveZoom } from "./settings.ts";
import { GUTTER_W, GUTTER_W_NARROW, TimelineChart } from "./TimelineChart.tsx";
import { UnscheduledDrawer } from "./UnscheduledDrawer.tsx";
import type { BarDropRequest } from "./useBarDrag.ts";
import { applyDelta, useBarDrag } from "./useBarDrag.ts";

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

  // The group-by catalog is derived from the live workflow: eight
  // builtins plus every single-value enum custom field. It drives both
  // the picker's options and `resolveGrouping`'s validation, so a saved
  // view (or URL) naming a now-deleted custom field is rejected here
  // rather than reaching `buildRows` and drawing a single mislabelled
  // band.
  const groupingCatalog = useMemo(
    () => buildGroupingCatalog(workflow.data),
    [workflow.data],
  );

  const zoom = resolveZoom(settingsInput).value;
  const groupingResolved = resolveGrouping(settingsInput, groupingCatalog);
  const grouping = groupingResolved.value;
  const arrowsOn = resolveArrows(settingsInput).value;

  // Below sm the toolbar collapses (zoom + group + Today inline;
  // Dependencies into a "More" menu) and the sticky gutter narrows.
  const isNarrow = useIsNarrow();
  const gutterW = isNarrow ? GUTTER_W_NARROW : GUTTER_W;

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

  /**
   * The width of the chart panel, measured so the range can be widened to
   * fill it (see `range` below). Starts at 0 (unmeasured) — `fillRange` is
   * then a no-op — and is updated by a ResizeObserver on the outer
   * container. Measuring the outer container rather than the scroll body
   * avoids a feedback loop: the body's own width is what we are about to
   * set from this value.
   */
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(0);
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (el === null) return;
    const read = (): void => { setPanelWidth(el.clientWidth); };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  const range = useMemo(() => {
    const dates: string[] = [];
    for (const t of items) {
      if (t.start_date !== undefined) dates.push(t.start_date);
      if (t.due_date !== undefined) dates.push(t.due_date);
    }
    const dataRange = computeRange(dates, today);
    // Fill the panel: a short dated span otherwise draws a chart a few
    // hundred px wide that floats in an empty panel (and disappears at a
    // phone width). The measured value is the outer container's client
    // width; the chart body sits inside the container's `p-4` padding
    // (16px each side) and its own 1px border each side, so subtract that
    // to target the drawable inner width. `fillRange` only ever *widens*,
    // so a span already wider than the panel scrolls as before.
    return fillRange(dataRange, zoom, Math.max(0, panelWidth - 34));
  }, [items, today, zoom, panelWidth]);

  const layout = useMemo(() => buildLayout(model), [model]);

  // TML-14: only the configured relationship, and only when it
  // resolves. A dangling key yields no edges here; naming it in a
  // notice is TML-34 (M3.3b), and `dependencyRelationshipStatus`
  // already returns the name for that.
  const depStatus = dependencyRelationshipStatus(workflow.data);
  const depKey = depStatus.kind === "ok" ? depStatus.key : undefined;

  /**
   * The tasks that actually have a bar — the only valid arrow
   * endpoints (TML-31).
   *
   * Filtered-out tasks are absent from `items` already; this removes
   * the ones that are *present* but undrawable: unscheduled rows, and
   * rows carrying a date anomaly, which render a marker rather than a
   * bar. Collapsed bands are handled inside `TimelineChart`, which
   * owns the collapsed set.
   */
  const drawableIds = useMemo(
    () => new Set(model.bands.flatMap(b => b.rows.filter(r => r.problem === undefined).map(r => r.task.id))),
    [model],
  );

  const graph = useMemo(
    () =>
      arrowsOn && depKey !== undefined
        ? dependencyGraph(items, depKey, drawableIds)
        : { edges: [], offscreenFrom: new Set<string>() },
    [arrowsOn, depKey, items, drawableIds],
  );
  const edges = graph.edges;

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
    // The chart body is offset right by the gutter, so today's pixel is
    // `dateToX + gutterW` in the scroll container's coordinates.
    const x = dateToX(range, today, zoom) + gutterW;
    el.scrollTo({ left: Math.max(0, x - el.clientWidth / 2), behavior: "auto" });
  }, [range, today, zoom, gutterW]);

  useLayoutEffect(() => {
    if (scroller.current === null || items.length === 0) return;
    const stamp = `${zoom}:${range.start}:${range.end}`;
    if (centredFor.current === stamp) return;
    centredFor.current = stamp;
    centreToday();

    /**
     * TML-16 fallback: if centring on today leaves no bar in view — the
     * dated tasks are all far from today — scroll to just before the
     * earliest bar instead, so the initial paint shows the work rather
     * than an empty stretch of calendar. Runs after `centreToday` and
     * only when nothing intersects the visible window.
     */
    const el = scroller.current;
    if (el === null) return;
    let minBarLeft = Number.POSITIVE_INFINITY;
    for (const t of items) {
      if (typeof t.start_date === "string" && typeof t.due_date === "string") {
        const left = dateToX(range, t.start_date, zoom) + gutterW;
        if (left < minBarLeft) minBarLeft = left;
      }
    }
    if (!Number.isFinite(minBarLeft)) return;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    let anyVisible = false;
    for (const t of items) {
      if (typeof t.start_date === "string" && typeof t.due_date === "string") {
        const left = dateToX(range, t.start_date, zoom) + gutterW;
        const right = dateToX(range, t.due_date, zoom) + gutterW + DAY_WIDTH[zoom];
        if (right >= viewLeft && left <= viewRight) { anyVisible = true; break; }
      }
    }
    if (!anyVisible) {
      el.scrollTo({ left: Math.max(0, minBarLeft - 48), behavior: "auto" });
    }
  }, [zoom, range, items, items.length, centreToday, gutterW]);

  /**
   * The drag layer (TML-9 through TML-12, TML-36 through TML-39).
   *
   * `datesById` is rebuilt whenever the feed changes, but the drag hook
   * reads it only at *press* and snapshots the pair it found. That is
   * TML-37: a poll landing mid-drag replaces this map, and the bar the
   * user is holding keeps the geometry it was grabbed with, then writes
   * "the dates the user saw at release".
   */
  const datesById = useMemo(() => {
    const m = new Map<string, { start: string; due: string }>();
    for (const t of items) {
      if (typeof t.start_date === "string" && typeof t.due_date === "string") {
        m.set(t.id, { start: t.start_date, due: t.due_date });
      }
    }
    return m;
  }, [items]);

  const keyById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of items) m.set(t.id, t.key);
    return m;
  }, [items]);

  const setDates = useTaskDates();

  /**
   * The failed drop the user is being told about, or null.
   *
   * Holds the attempted values as well as the task, because TML-42
   * requires the message to show "the value that was attempted" and
   * TML-43 requires it to say that *both* dates are unchanged. A toast
   * carrying only "failed" satisfies neither.
   */
  const [dropError, setDropError] = useState<{
    readonly key: string;
    readonly edge: BarDropRequest["edge"];
    readonly attempted: string;
    readonly message: string;
    readonly gone: boolean;
  } | null>(null);
  const lastDrop = useRef<BarDropRequest | null>(null);

  const runDrop = useCallback(
    (req: BarDropRequest): void => {
      lastDrop.current = req;
      setDropError(null);
      setDates.mutate(
        {
          ref: req.key,
          ...(req.start_date !== undefined ? { start_date: req.start_date } : {}),
          ...(req.due_date !== undefined ? { due_date: req.due_date } : {}),
        },
        {
          onError: (err: unknown) => {
            const envelope = err instanceof ApiError ? err.envelope : undefined;
            // TML-49: a task deleted from another surface fails
            // *specifically* — the message says it no longer exists,
            // rather than the generic "not saved". The 404 is the
            // signal; `onSettled`'s refetch is what removes the row.
            const gone = err instanceof ApiError && err.status === 404;
            setDropError({
              key: req.key,
              edge: req.edge,
              attempted:
                req.start_date !== undefined && req.due_date !== undefined
                  ? `${req.start_date} → ${req.due_date}`
                  : (req.start_date ?? req.due_date ?? ""),
              message:
                gone
                  ? "It no longer exists — it was deleted somewhere else."
                  : envelope?.message
                    ?? (err instanceof Error ? err.message : "The server could not be reached."),
              gone,
            });
          },
        },
      );
    },
    [setDates],
  );

  const { drag, onBarPointerDown, consumeDragTail } = useBarDrag({
    range,
    zoom,
    datesById,
    keyById,
    onDrop: runDrop,
  });

  /**
   * The dates a bar renders at *right now*.
   *
   * Only the bar being dragged is overridden, and only while the
   * pointer is down. Nothing is overridden after release: the write is
   * either accepted, in which case the refetch supplies the new dates,
   * or it failed, in which case the stored dates are the truth and the
   * bar must show them (TML-42, TML-43, TML-44 — "never rendered as a
   * settled new position while the server holds the old one").
   */
  const barDatesOverride = useCallback(
    (taskId: string) =>
      drag !== null && drag.taskId === taskId
        ? { start: drag.start, due: drag.due }
        : undefined,
    [drag],
  );

  /**
   * TML-40: a keyboard adjustment, routed through the very same
   * `runDrop` a mouse release uses.
   *
   * Sharing the path is the point, not a convenience: the case asks for
   * "the same single-write semantics as the mouse drags (TML-9 through
   * TML-11)", and a second write path would be a second place for the
   * payload shape to drift. `applyDelta` supplies the clamps too, so a
   * held arrow key cannot walk a bar to a negative duration any more
   * than a drag can.
   */
  const onBarKeyAdjust = useCallback(
    (taskId: string, edge: "start" | "end" | "body", days: number): void => {
      const dates = datesById.get(taskId);
      const key = keyById.get(taskId);
      if (dates === undefined || key === undefined) return;
      const next = applyDelta(edge, dates.start, dates.due, days);
      if (next.start === dates.start && next.due === dates.due) return;
      runDrop({
        taskId,
        key,
        edge,
        originStart: dates.start,
        originDue: dates.due,
        ...(edge !== "end" ? { start_date: next.start } : {}),
        ...(edge !== "start" ? { due_date: next.due } : {}),
      });
    },
    [datesById, keyById, runDrop],
  );

  const openTask = useCallback(
    (key: string): void => {
      // TML-17: "a click that was actually the tail of a drag does not
      // navigate."
      if (consumeDragTail()) return;
      void navigate({ to: "/tasks/$key", params: { key } });
    },
    [consumeDragTail, navigate],
  );

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

  /**
   * Whether the first page of data is still in flight.
   *
   * `isLoading` alone is not enough here and was measured rendering a
   * full empty chart while the request was still held open:
   * `useTasksFeed` sets `placeholderData: keepPreviousData`, which
   * suppresses the loading flag. `isPending` is the state that
   * survives that — no data has ever resolved for this query key —
   * which is exactly TML-41's "the user does not briefly see a fully
   * drawn empty timeline that then repopulates".
   */
  const loading = tasks.isPending || tasks.isLoading || workflow.isLoading;
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

  /**
   * TML-46: `calendar.yaml` did not load — `working_days: [9]` fails
   * the schema and `/api/calendar` answers `config_invalid`.
   *
   * This is deliberately *not* the whole-view `ConfigErrorState` the
   * workflow's own failure gets. The case is explicit that "the
   * timeline still renders bars and dates" and that "shading is
   * skipped rather than applied wrongly" — a blocking error state
   * would fail its first bullet. `calendar.data` is undefined in this
   * state, and `nonWorkingReason` already answers `undefined` for
   * every day when it is, so the unshaded grid falls out; what was
   * missing is saying so.
   */
  const calendarError = calendar.isError ? calendar.error : null;

  // Shading is per *day* column at day and week zoom only — at month
  // zoom a 4px band per weekend is visual noise on a chart nobody reads
  // day-by-day (TML-13's first bullet). The chart itself derives the
  // shaded columns from the visible window (TML-21), so it takes the
  // calendar and a `shadingOn` flag rather than a pre-built array.

  // TML-47: task files that exist and could not be parsed. The rows
  // that *did* load are already in `items`; this is what makes the
  // count honest about the ones that did not.
  const unreadable = pages[pages.length - 1]?.unreadable ?? [];

  /**
   * TML-41: an explicit empty state, and a skeleton rather than a
   * fully-drawn empty chart while loading.
   *
   * Three distinguishable states, because the case asks for three
   * different messages: still loading, a filter that matched nothing,
   * and a tracker whose tasks simply have no dates (which is *not*
   * empty — the Unscheduled lane is populated and the chart area's
   * emptiness needs explaining).
   */
  const noRows = !loading && totalRows(model) === 0;
  const noBars = !loading && !noRows && layout.bands.length === 0;
  const activeFilters = describeFilters(search);

  return (
    <div ref={panelRef} className="flex h-full flex-col gap-3 p-4" data-testid="timeline">
      {/* The shared list filter bar, so `/timeline` filters the same way
          `/list` does (assignee, milestone, status, saved views, …). The
          `from` route type is widened by the list-owning agent; this
          mount passes only the props the timeline needs (no export
          cluster). */}
      <FilterBar
        from="/timeline"
        showSaveView
        onRefresh={() => { void tasks.refetch(); }}
        refreshBusy={tasks.isFetching}
      />

      <Toolbar
        zoom={zoom}
        grouping={grouping}
        groupingCatalog={groupingCatalog}
        arrowsOn={arrowsOn}
        arrowsAvailable={depStatus.kind === "ok"}
        isNarrow={isNarrow}
        onZoom={z => { setParam({ zoom: z }); }}
        onGrouping={g => { setParam({ grouping: g }); }}
        onArrows={v => { setParam({ arrows: v }); }}
        onToday={() => { centreToday(); }}
      />

      {/* A `grouping` value — from a saved view or the URL — that names a
          custom field which is no longer a single-value enum (deleted, or
          changed to multi/non-enum). `resolveGrouping` deferred past it to
          the next layer (finally `none`); this names what was dropped, in
          the pattern of the dependency-config notice above. */}
      {groupingResolved.dangling !== undefined && (
        <div
          role="alert"
          data-testid="timeline-grouping-config-error"
          className="rounded-md border border-warn-fg/40 bg-warn-bg/5 px-3 py-2 text-[0.8571rem] text-text-primary"
        >
          Group by{" "}
          <code data-testid="timeline-grouping-dangling-key">{groupingResolved.dangling}</code>
          {" "}is no longer a single-value enum field — showing{" "}
          {grouping === "none" ? "flat" : "the next available grouping"}.
        </div>
      )}

      {/* TML-34: a `dependency_relationship` naming a key that
          `relationships` does not define. Core no longer deletes the
          dangling line (A31), so the typo survives to be reported —
          and this is the report. "Not a silent no-op and not a crash":
          no arrows are drawn, and the missing key is named. */}
      {depStatus.kind === "missing" && (
        <div
          role="alert"
          data-testid="timeline-dependency-config-error"
          className="rounded-md border border-warn-fg/40 bg-warn-bg/5 px-3 py-2 text-[0.8571rem] text-text-primary"
        >
          <strong>workflow.yaml</strong>: <code>timeline.dependency_relationship</code>
          {" "}names <code data-testid="timeline-dependency-missing-key">{depStatus.key}</code>,
          {" "}which is not defined in <code>relationships</code>. No dependency
          {" "}arrows can be drawn until that key is corrected.{" "}
          <Link
            to="/settings/$section"
            params={{ section: "timeline" }}
            hash="field-dependency_relationship"
            data-testid="timeline-dependency-config-settings-link"
            className="underline hover:opacity-80"
          >
            Open Timeline settings
          </Link>
        </div>
      )}

      {/* TML-46. */}
      {calendarError !== null && (
        <div
          role="alert"
          data-testid="timeline-calendar-error"
          className="rounded-md border border-warn-fg/40 bg-warn-bg/5 px-3 py-2 text-[0.8571rem] text-text-primary"
        >
          <strong>calendar.yaml</strong> could not be read, so weekend and holiday
          {" "}shading is switched off and the today-marker is placed in{" "}
          <strong>UTC</strong>. Fix the file to restore them.{" "}
          <span data-testid="timeline-calendar-error-detail">
            {calendarError instanceof ApiError
              ? calendarError.envelope?.message ?? calendarError.message
              : String(calendarError)}
          </span>{" "}
          <Link
            to="/settings/$section"
            params={{ section: "calendar" }}
            hash="field-timezone"
            data-testid="timeline-calendar-error-settings-link"
            className="underline hover:opacity-80"
          >
            Open Calendar settings
          </Link>
        </div>
      )}

      {/* TML-42, TML-43, TML-44, TML-45, TML-49: a drop that did not
          land. The bar is already back where it started — nothing
          optimistic was written, and `useTaskDates` refetches on
          settle — so this states what was attempted and offers the
          retry. */}
      {dropError !== null && (
        <div
          role="alert"
          data-testid="timeline-drag-error"
          className="flex items-center gap-3 rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          <span className="min-w-0 flex-1">
            <strong>{dropError.key}</strong>{" "}
            {dropError.edge === "body"
              ? "was not moved — neither the start date nor the due date was changed."
              : dropError.edge === "end"
                ? "was not resized — the due date was not changed."
                : "was not resized — the start date was not changed."}
            {dropError.attempted !== "" && (
              <>
                {" "}Attempted:{" "}
                <code data-testid="timeline-drag-error-attempted">{dropError.attempted}</code>.
              </>
            )}
            {" "}{dropError.message}
          </span>
          {!dropError.gone && (
            <button
              type="button"
              data-testid="timeline-drag-retry"
              onClick={() => {
                const req = lastDrop.current;
                if (req !== null) runDrop(req);
              }}
              className="shrink-0 rounded border border-danger-fg/40 px-2 py-0.5 hover:bg-danger-fg/10"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            data-testid="timeline-drag-dismiss"
            onClick={() => { setDropError(null); }}
            className="shrink-0 rounded border border-danger-fg/40 px-2 py-0.5 hover:bg-danger-fg/10"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* TML-47: one corrupt task.md does not blank the timeline. */}
      {unreadable.length > 0 && (
        <div
          role="alert"
          data-testid="timeline-unreadable"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          {unreadable.length} task {unreadable.length === 1 ? "file" : "files"}
          {" "}could not be read, so {unreadable.length === 1 ? "it is" : "they are"}
          {" "}missing from this timeline and from the counts below. Check the file.
          <ul className="mt-1 space-y-0.5">
            {unreadable.map(u => (
              <li key={u.id} className="text-[0.7857rem]">
                {u.path}: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* TML-41: a skeleton grid, not a drawn-then-repopulated chart.
          The chart is not rendered at all while loading, so the user
          never sees a complete empty timeline that fills in. */}
      {loading ? (
        <div
          className="min-h-0 flex-1 animate-pulse rounded-md border border-border-default bg-bg-muted"
          data-testid="timeline-skeleton"
          aria-busy="true"
          aria-label="Loading the timeline"
        />
      ) : noRows ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 rounded-md border border-border-default text-[0.8571rem] text-text-secondary"
          data-testid="timeline-empty"
        >
          <span>No tasks match this view.</span>
          <span data-testid="timeline-empty-filters">
            {activeFilters === null
              ? "There are no tasks in this tracker yet."
              : `Active filter: ${activeFilters}`}
          </span>
        </div>
      ) : (
        <>
          {/* TML-41's third bullet — every task lacks dates — is now the
              chart's own centred empty state (`noBars`), drawn inside the
              frame rather than as a banner that squeezes the chart. */}
          <TimelineChart
            ref={scroller}
            layout={layout}
            model={model}
            range={range}
            zoom={zoom}
            width={width}
            calendar={calendar.data}
            shadingOn={zoom !== "month"}
            today={today}
            isNarrow={isNarrow}
            noBars={noBars}
            edges={arrowsOn ? edges : []}
            offscreenFrom={arrowsOn ? graph.offscreenFrom : undefined}
            onOpenTask={openTask}
            onBarPointerDown={onBarPointerDown}
            onBarKeyAdjust={onBarKeyAdjust}
            barDatesOverride={barDatesOverride}
            dragging={drag !== null}
            renderBarOverlay={() =>
              drag === null ? null : (
                /* TML-12's second bullet: "the tooltip/label shows the
                   candidate date live during the drag so the user can
                   aim" — at month zoom a day is 4px, and without this
                   the user is guessing. The values shown are the exact
                   ones the release will send, because both come from
                   the same `applyDelta` result. */
                <div
                  data-testid="timeline-drag-label"
                  data-start={drag.start}
                  data-due={drag.due}
                  className="pointer-events-none fixed z-50 rounded border border-border-default bg-bg-canvas px-1.5 py-0.5 text-[0.7857rem] shadow"
                  style={{ left: drag.x + 12, top: drag.y + 12 }}
                >
                  {drag.edge === "start"
                    ? drag.start
                    : drag.edge === "end"
                      ? drag.due
                      : `${drag.start} → ${drag.due}`}
                </div>
              )
            }
          />
        </>
      )}

      <UnscheduledDrawer
        rows={model.unscheduled}
        onOpenTask={openTask}
        isNarrow={isNarrow}
        // TML-41: when there are no dated tasks, open the drawer once so
        // the tasks the tracker *does* have are visible without a click.
        initiallyExpanded={noBars}
      />

      <div className="text-[0.7857rem] text-text-secondary" data-testid="timeline-total">
        {totalRows(model)} {totalRows(model) === 1 ? "task" : "tasks"}
        {unreadable.length > 0 && (
          <span data-testid="timeline-total-unreadable">
            {" "}({unreadable.length} unreadable, not counted)
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * The active filters, as a phrase the empty state can name (TML-41:
 * "an explicit empty state **naming the active filter**").
 *
 * Reads the shared list vocabulary, so the phrase says the same thing
 * the list's own empty state would about the same URL.
 */
function describeFilters(search: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const key of ["q", "status", "assignee", "milestone", "sprint", "priority", "task_type", "label", "project"]) {
    const v = search[key];
    if (typeof v === "string" && v.length > 0) parts.push(`${key} = ${v}`);
    else if (Array.isArray(v) && v.length > 0) parts.push(`${key} = ${v.join(", ")}`);
  }
  return parts.length === 0 ? null : parts.join("; ");
}

/** Zoom / grouping / arrows / today controls. */
function Toolbar(props: {
  readonly zoom: TimelineZoom;
  readonly grouping: TimelineGrouping;
  readonly groupingCatalog: readonly GroupEntry[];
  readonly arrowsOn: boolean;
  readonly arrowsAvailable: boolean;
  readonly isNarrow: boolean;
  readonly onZoom: (z: TimelineZoom) => void;
  readonly onGrouping: (g: TimelineGrouping) => void;
  readonly onArrows: (v: boolean) => void;
  readonly onToday: () => void;
}) {
  const zooms: TimelineZoom[] = ["day", "week", "month"];

  // TML-15: the toggle reflects the state even when no relationship is
  // configured, so it is disabled rather than hidden. On desktop it is an
  // inline checkbox; on a phone it moves into the "More" menu so the
  // toolbar's primary controls (zoom, group, Today) stay on one row.
  const dependenciesToggle = (
    <label className="flex items-center gap-1 text-[0.8571rem] text-text-secondary">
      <Checkbox
        data-testid="timeline-arrows"
        checked={props.arrowsOn && props.arrowsAvailable}
        disabled={!props.arrowsAvailable}
        onChange={e => { props.onArrows(e.target.checked); }}
      />
      Dependencies
    </label>
  );

  return (
    <div className="flex flex-wrap items-center gap-4" data-testid="timeline-toolbar">
      <div className="flex items-center gap-1" role="group" aria-label="Zoom">
        {zooms.map(z => (
          <ToolbarButton
            key={z}
            type="button"
            testId={`timeline-zoom-${z}`}
            aria-pressed={props.zoom === z}
            active={props.zoom === z}
            className="capitalize"
            onClick={() => { props.onZoom(z); }}
          >
            {z}
          </ToolbarButton>
        ))}
      </div>

      <label className="flex items-center gap-1 text-[0.8571rem] text-text-secondary">
        Group by
        <GroupByPicker
          catalog={props.groupingCatalog}
          value={props.grouping}
          onChange={props.onGrouping}
          testIdBase="timeline-grouping"
          aria-label="Group by"
        />
      </label>

      {!props.isNarrow && dependenciesToggle}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        testId="timeline-today"
        onClick={() => { props.onToday(); }}
      >
        Today
      </Button>

      {props.isNarrow && (
        <Menu
          aria-label="More timeline options"
          align="end"
          trigger={({ toggle, ...aria }) => (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              testId="timeline-more"
              onClick={toggle}
              {...aria}
            >
              More
            </Button>
          )}
        >
          {() => (
            <MenuItem>
              {dependenciesToggle}
            </MenuItem>
          )}
        </Menu>
      )}
    </div>
  );
}

function configInvalidOf(error: unknown): ApiError | null {
  return error instanceof ApiError && error.envelope?.code === "config_invalid"
    ? error
    : null;
}

export { BAND_HEADER_H, DAY_WIDTH };
