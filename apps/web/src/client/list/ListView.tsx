import { isSortableTaskField } from "@loctt/contracts";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  useLabels,
  useMilestones,
  useProjects,
  useSprints,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import {
  describeBulkResult,
  useBulkArchive,
  useBulkDelete,
  useBulkMove,
  useBulkSet,
} from "../api/hooks/useBulk.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import type { TaskListRow } from "../api/hooks/useTasks.ts";
import { buildQueryString, DEFAULT_LIST_LIMIT, tasksParamsFromSearch, useTasksFeed } from "../api/hooks/useTasks.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import { fieldView } from "../health/fieldHealth.ts";
import { useIsNarrow } from "../shell/useIsNarrow.ts";
import type { EstimationShape } from "../task/estimation.ts";
import { estimationShape } from "../task/estimation.ts";
import { useAnnouncer } from "../ui/Announcer.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { BulkBar, BulkResult } from "./BulkBar.tsx";
import {
  AssigneeCell,
  Dash,
  LabelsCell,
  PriorityCell,
  ProjectChip,
  StatusBadge,
  TypeBadge,
} from "./cells.tsx";
import { resolveColumns } from "./columns.ts";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog.tsx";
import { clearedSearch, FilterBar } from "./FilterBar.tsx";
import { isOverdue, relativeTime, shortDate } from "./format.ts";
import { buildLookups } from "./lookups.ts";
import { Pagination } from "./Pagination.tsx";
import { useSelection } from "./useSelection.ts";

/**
 * Per-column default sort direction for a *first* click (LST-54 / UX-2).
 *
 * A column absent here defaults to ascending — the most-useful first
 * read for dates (earliest due), text (A→Z) and timestamps (oldest
 * first). Priority is the exception: the server sorts it by the
 * workflow's numeric `value` (critical=4 … low=1), so ascending would
 * surface Low first and bury Critical — the opposite of what "sort by
 * priority" means. It defaults to descending so the first click lands
 * Critical-first, following the workflow's documented order rather than
 * an alphabetical accident.
 */
const DEFAULT_SORT_DIR: Record<string, "asc" | "desc"> = {
  priority: "desc",
};

/**
 * The list view's table (M1.2). Reads URL search state for sort +
 * pagination, fetches the matching task page, and renders the
 * configured columns. Column headers sort (single-column, direction
 * toggles); rows navigate to the task detail (a stub until M2). The
 * filter bar and pagination/bulk/export land in M1.3 / M1.4.
 */
export function ListView() {
  const search = useSearch({ from: "/list" });
  const navigate = useNavigate({ from: "/list" });
  // Below `sm`, render the stacked-card layout instead of the table
  // (UX eval #3). Conditional render, not CSS toggle, so the task list is
  // never in the DOM twice.
  const isNarrow = useIsNarrow();

  const params = tasksParamsFromSearch(search);
  const tasks = useTasksFeed(params);

  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  // Only the bulk bar's pickers need these (BLK-7, BLK-8); the table
  // cells resolve milestone and sprint through their own columns.
  const milestones = useMilestones();
  const sprints = useSprints();
  const workflow = useWorkflow();
  const info = useInfo();
  const userSettings = useUserSettings();

  const { announce } = useAnnouncer();

  // PRU-3: the project column is shown/hidden by how many projects the
  // URL scopes to — one project hides it (constant), all-projects shows
  // it (so same-titled rows in different projects stay distinguishable).
  // Derived here, never written back to `list_columns`.
  const activeProjectCount = search.project?.length ?? 0;
  // SET-9: the Estimate column exists only when estimation is enabled,
  // and its cells render with the unit suffix (numeric) or the enum
  // value as-is — the same shape the create modal and task detail use.
  const estimation = estimationShape(workflow.data);
  const estimationEnabled = estimation !== null;
  const columns = useMemo(
    () => resolveColumns(
      userSettings.data?.settings,
      { activeProjectCount },
      estimationEnabled,
    ),
    [userSettings.data?.settings, activeProjectCount, estimationEnabled],
  );

  const lookups = useMemo(
    () =>
      buildLookups({
        projects: projects.data?.items ?? [],
        users: users.data?.items ?? [],
        labels: labels.data?.items ?? [],
        workflow: workflow.data,
      }),
    [projects.data, users.data, labels.data, workflow.data],
  );

  const sortField = search.sort;
  const sortDir = search.dir ?? "asc";

  // LST-29: a sort key the *server* cannot honour is dropped from the
  // URL
  // rather than left sitting there as though it applied. The rows
  // already come back in the default order — the server drops it too —
  // so leaving it in the address bar makes a copied URL claim a sort
  // that was never in effect (M1 gate, F6).
  //
  // `isSortableTaskField` is the *server's* predicate, shared through
  // contracts. A first cut used the client's own nine-column list and
  // stripped sorts the server honours — `created_at`, `reporter`,
  // `fields.<key>` — so a saved URL silently lost its ordering. Two
  // copies of this rule drifted the moment they existed.
  //
  // `replace`, not push: this is a correction to a URL the user pasted,
  // not a navigation they made, and Back should return to wherever they
  // came from rather than to the broken URL.
  useEffect(() => {
    if (sortField === undefined || isSortableTaskField(sortField)) return;
    void navigate({
      search: prev => ({ ...prev, sort: undefined, dir: undefined }),
      replace: true,
    });
  }, [sortField, navigate]);

  const onSort = (colId: string): void => {
    // Same column → toggle direction; a *first* click on a new column
    // sorts in that column's most-useful default direction (LST-54 /
    // UX-2). For priority, ascending-by-`value` puts Low first and
    // Critical last — the opposite of what a user reaching for "sort by
    // priority" wants — so priority defaults to descending (Critical
    // first), following the workflow's documented value order
    // (critical=4 > … > low). Every other column keeps ascending
    // (earliest due date, A→Z title, oldest update), which is the
    // most-useful first read there.
    const defaultDir = DEFAULT_SORT_DIR[colId] ?? "asc";
    const nextDir =
      sortField === colId
        ? sortDir === "asc"
          ? "desc"
          : "asc"
        : defaultDir;
    void navigate({
      search: prev => ({ ...prev, sort: colId, dir: nextDir, page: undefined }),
    });
    // A11Y-27's second bullet: activating a header announces the new
    // sort. `aria-sort` alone does not — it is state a reader exposes
    // when the user navigates *to* the header, not something spoken
    // when the sort changes under a user who is elsewhere on the page.
    const label = columns.find(c => c.id === colId)?.label ?? colId;
    announce(`Sorted by ${label}, ${nextDir === "asc" ? "ascending" : "descending"}`);
  };

  const now = Date.now();
  // Workspace timezone, from the server — not the browser's clock, so
  // the overdue highlight agrees with the "Overdue" sidebar filter and
  // with the same query run through the CLI. Falls back to the UTC
  // date only while `/api/info` is still in flight.
  const today = info.data?.today ?? new Date(now).toISOString().slice(0, 10);

  // Flatten the accumulated pages. Rows 51–100 append to 1–50 rather
  // than replacing them (LST-13); a page that lost a race to a filter
  // change resolved into a different query key and is not here.
  const items = useMemo(
    () => (tasks.data?.pages ?? []).flatMap(p => p.items),
    [tasks.data],
  );
  const pages = tasks.data?.pages ?? [];
  /**
   * Task files that would not parse (ERR-9).
   *
   * Named with their path and the YAML error, because "2 of 3" is
   * unreconcilable against a directory holding 3. Atomic writes rule
   * out a torn write, so a hand-edit is the honest attribution
   * (XS-51).
   */
  const unreadable = pages[pages.length - 1]?.unreadable ?? [];
  // XS-28: the URL named a saved view that is no longer in
  // `queries.yaml`. The server fell back to the unfiltered list; this
  // is what makes that visible rather than a silent widening.
  const missingView = pages[pages.length - 1]?.missing_view;
  // VUE-22: the URL named a saved view that is present in queries.yaml
  // but whose query no longer parses. The server returns the parse error
  // and its position rather than 500-ing or silently widening; this
  // renders that as a deliberate error state (not an empty result) and
  // offers to open the advanced editor pre-populated with the broken
  // query so it can be repaired in place.
  const brokenView = pages[pages.length - 1]?.broken_view;
  // VUE-21: core raises a warning when a query names a field that no
  // longer exists, and the CLI and MCP both print it. The web dropped
  // it, so a saved view filtering on a deleted custom field answered
  // 200 with zero rows — an empty result the user reads as "nothing
  // matches" rather than "this view is broken".
  const queryWarnings = pages[pages.length - 1]?.warnings ?? [];
  // ERR-10 / LST-51 (A-PRESCAN-2): a hand-broken `workflow.yaml` entry
  // (a status with no `category`, a bad colour) does not throw — the
  // tolerant loader degrades it into `workflow.broken` and the list still
  // renders. But a silent degrade reads as "this status simply isn't
  // configured": the filter dropdowns come up short with no explanation.
  // So surface the fault at the point of use, the way the settings panel
  // does (SET-33/K32) — name the file and each offending entry, and point
  // at the fix. This is a non-blocking banner above the list, not a
  // takeover: the healthy rest of the config still drives the view.
  const workflowBroken = workflow.data?.broken;
  const brokenWorkflowEntries = workflowBroken === undefined
    ? []
    : (["statuses", "priorities", "task_types", "relationships", "custom_fields"] as const)
      .flatMap(sub =>
        (workflowBroken[sub] ?? []).map(e => ({ sub, index: e.index, error: e.error })));
  // Newest page's total. A filter change cannot be what makes these
  // differ — it builds a new query key, so the feed restarts with one
  // page — but a task created or deleted between page 1 and page 3
  // does, and then page 1's total is simply out of date. Not covered by
  // a spec: reproducing it needs a write landing between two paged
  // reads of the same feed, which the fixture cannot currently stage.
  const total = pages[pages.length - 1]?.total ?? 0;

  /**
   * Announce the result count when it settles (A11Y-25).
   *
   * The case is specific about *when*: "the announcement fires once
   * for the settled result, not once per intermediate loading state".
   * So this is gated on `!isFetching` — an in-flight query has a stale
   * or placeholder total, and announcing it would read out the
   * previous filter's count before the new one arrives.
   *
   * The ref makes it fire on *change*. Without it every re-render with
   * the same total re-announces, which is A11Y-24's "not duplicated
   * (once per event, not once per re-render)" — and a query key is not
   * enough on its own, because React Query re-renders on window focus.
   *
   * The first settled render is skipped: arriving on the list is not a
   * count *change*, and the reader is already announcing the page.
   */
  const announcedTotal = useRef<number | null>(null);
  useEffect(() => {
    if (tasks.isFetching || tasks.isError) return;
    if (!tasks.isSuccess) return;
    const previous = announcedTotal.current;
    announcedTotal.current = total;
    if (previous === null || previous === total) return;
    // A11Y-25's third bullet: zero is announced explicitly, so it is
    // distinguishable from an unresponsive UI.
    announce(total === 0 ? "No tasks match these filters" : `${String(total)} tasks`);
  }, [total, tasks.isFetching, tasks.isError, tasks.isSuccess, announce]);

  // A11Y-17: focus survives an async re-render of the table. When a
  // refetch replaces the row nodes (a filter change, a background poll,
  // a bulk mutation invalidating the feed), React unmounts the row that
  // held focus and the browser drops focus to `document.body` — the next
  // Tab then restarts at the top of the page. We remember which task's
  // row-anchor (its key link, `data-task-key`) had focus, and after the
  // rows re-render restore focus to the equivalent row when focus was
  // lost to body. If that task is no longer in the list (it stopped
  // matching the filter), we do NOT yank focus somewhere arbitrary —
  // leaving it is the "deliberate location" the case's escape hatch
  // allows, and stealing it would be worse.
  const tableRef = useRef<HTMLTableElement | null>(null);
  const focusedTaskKey = useRef<string | null>(null);
  useEffect(() => {
    const table = tableRef.current;
    if (table === null) return;

    // Remember which task-row anchor holds focus. Focus elsewhere in the
    // table (select-all, a sort header) is not a row to restore, so we
    // keep the last remembered row rather than clearing it.
    const onFocusIn = (e: FocusEvent): void => {
      const anchor = (e.target as HTMLElement).closest<HTMLElement>("[data-task-key]");
      if (anchor) focusedTaskKey.current = anchor.dataset["taskKey"] ?? null;
    };
    table.addEventListener("focusin", onFocusIn);

    // A refetch unmounts the focused row's node and the browser drops
    // focus to `document.body`, regardless of whether React Query handed
    // back a new `data` reference — so key the restore on the DOM
    // changing, not on `items`. When the table's rows mutate and focus
    // has fallen to body, re-focus the equivalent row's anchor if it is
    // still present. If the task no longer matches the filter, leave
    // focus where it is (the case's "deliberate location" escape hatch);
    // never yank it to an arbitrary row.
    const observer = new MutationObserver(() => {
      const key = focusedTaskKey.current;
      if (key === null) return;
      if (document.activeElement !== null && document.activeElement !== document.body) return;
      const anchor = table.querySelector<HTMLElement>(
        `[data-task-key="${CSS.escape(key)}"]`,
      );
      if (anchor) anchor.focus();
    });
    observer.observe(table, { childList: true, subtree: true });

    return () => {
      table.removeEventListener("focusin", onFocusIn);
      observer.disconnect();
    };
  }, []);

  // The result-set identity, for BLK-18. Everything the server reads
  // except how far we have paged — loading page 2 must not clear a
  // selection, but changing a filter must.
  const resultSetKey = useMemo(() => {
    const { page: _page, ...rest } = params;
    return JSON.stringify(rest);
  }, [params]);
  const selection = useSelection(resultSetKey);

  const allOnPageSelected =
    items.length > 0 && items.every(t => selection.isSelected(t.id));
  const someOnPageSelected = items.some(t => selection.isSelected(t.id));

  const bulkSet = useBulkSet();
  const bulkArchive = useBulkArchive();
  const bulkDelete = useBulkDelete();
  const bulkMove = useBulkMove();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [bulkResult, setBulkResult] = useState<
    { message: string; failures: readonly string[] } | undefined
  >(undefined);

  /**
   * The tasks the last archive touched, so it can be undone (BLK-10).
   *
   * In memory only (V11): it dies on reload and on the next bulk
   * action. Archive is reversible by other routes — "Show archived",
   * then unarchive — so this is a convenience over the action just
   * taken, not a recovery mechanism, and there is no expiry to
   * configure.
   */
  const [undoableArchive, setUndoableArchive] = useState<readonly string[]>([]);

  const busy = bulkSet.isPending || bulkArchive.isPending || bulkDelete.isPending
    || bulkMove.isPending;
  /**
   * A failed fetch that is a failed *Load more* rather than a failed
   * query.
   *
   * LST-49 requires the 50 rows already on screen to survive a failed
   * Load more, with the pagination control reporting it. `items.length
   * === 0` was standing in for that, and it is not the same predicate:
   * a failed *filter change* also has rows on screen, and there they
   * answer a question the user is no longer asking. The gate found the
   * worst form of it — kill the server, apply a filter, and the table
   * shows 15 stale rows under two chips claiming a filter that never
   * ran, footer included: "Showing 1–15 of 15" when the true answer is
   * 0. That fails ERR-1, ERR-2 and ERR-6.
   *
   * The distinction is which page failed. A Load more failure has
   * successfully loaded pages behind it; a filter failure has none for
   * *this* query.
   */
  /**
   * A failed *Load more*, as distinct from a failed query.
   *
   * LST-49 keeps the 50 already-loaded rows when a Load more fails;
   * ERR-2 forbids keeping the previous filter's rows under a new
   * filter's chips. Three home-grown predicates tried to express that
   * difference and each was wrong:
   *
   * - `items.length === 0` also matched a failed filter.
   * - `pages.length > 0` was the same test rewritten — `items` is
   *   derived from `pages` — so the error branch became unreachable.
   * - `!isPlaceholderData && items.length > 0` was correct but was
   *   still reasoning about which fetch failed from second-hand
   *   evidence.
   *
   * The library answers the question directly. Use its answer.
   */
  const loadMoreFailed = tasks.isFetchNextPageError;

  /**
   * "The query failed and there is nothing trustworthy to show" — held
   * *through* the ERR-2 recovery poll's in-flight window.
   *
   * The poll (`refetchInterval` in queryClient.ts) refetches an errored
   * query every 5s. TanStack's `fetch` action resets a query that has
   * no data to `{ status: "pending", error: null }` (query-core
   * `fetchState()`), so `isError` goes false for the ~1–2s the attempt
   * plus its one retry are in flight. Keyed on `isError` alone, the
   * error panel unmounted every cycle — which also reset ErrorState's
   * local "Show details" toggle, making the detail unreachable (ERR-6).
   *
   * Two observations bridge the window:
   * - `errorUpdateCount > 0` while `isFetching`: the only way a fetch
   *   is in flight on a query that has already errored and still has
   *   no real data is the recovery poll (or a manual Retry — same
   *   screen either way).
   *
   *   `errorUpdateCount` **never resets** — unlike `failureCount`, a
   *   success does not clear it — so on its own it would put the panel
   *   up for any slow fetch after the query had ever failed once. The
   *   `!hasRealData` conjunct is what makes it safe: once real data
   *   for this key has arrived, this branch cannot fire at all.
   * - "no real data": `data` is undefined, or is `keepPreviousData`'s
   *   placeholder from another query key. The placeholder case is the
   *   ERR-2 screen — a failed filter change re-showing the previous
   *   filter's rows mid-poll is exactly what that case forbids.
   *
   * LST-49 needs no separate gate here: a failed Load more has real
   * pages for *this* key, so `hasRealData` is true and the rows stay,
   * with the pagination control reporting the failure.
   */
  const hasRealData = tasks.data !== undefined && !tasks.isPlaceholderData;
  const queryFailed =
    !hasRealData
    && (tasks.isError || (tasks.isFetching && tasks.errorUpdateCount > 0));
  /**
   * The last query-level error, latched across the poll window —
   * `tasks.error` is null while an attempt is in flight (see above),
   * and swapping the panel's content mid-read is the same flicker one
   * level down. Only read while `queryFailed` holds.
   */
  const lastQueryError = useRef<unknown>(null);
  if (tasks.isError && !loadMoreFailed) lastQueryError.current = tasks.error;

  /**
   * Whether any filter is narrowing the list.
   *
   * Distinguishes LST-8's "your filter matched nothing" from the
   * fresh-tracker state in flow-onboarding.md — which invites the user
   * to create a first task, not to clear filters they never set.
   */
  const hasFilters = Object.entries(search).some(
    ([k, v]) => v !== undefined && k !== "sort" && k !== "dir" && k !== "page",
  );

  /**
   * Adds a label to the filter (MSL-6, MSL-7).
   *
   * Additive: clicking a second label narrows further rather than
   * replacing the first, and each arrives as its own removable chip so
   * the user can see why rows matched.
   */
  const onFilterLabel = (id: string): void => {
    void navigate({
      search: prev => {
        const current = Array.isArray(prev.labels) ? prev.labels : [];
        return current.includes(id)
          ? prev
          : { ...prev, labels: [...current, id], page: undefined };
      },
    });
  };

  const refs = [...selection.selected];

  // The selection holds task ids; a failure has to name the key
  // (BLK-22). Built from the loaded page, which is where every
  // selectable row came from.
  const keyById = useMemo(
    () => new Map(items.map(t => [t.id, t.key])),
    [items],
  );

  /**
   * BLK-10: undo lives in the success message, where the user is
   * already reading the outcome — not as a separate step they have to
   * go and find. Rendered in whichever place that message appears, so
   * it does not depend on whether the action cleared the selection.
   */
  const undoControl = undoableArchive.length > 0
    ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const refsToRestore = undoableArchive;
            void runBulk(
              () => bulkArchive.mutateAsync({ refs: refsToRestore, archive: false }),
              "restored",
              true,
            );
          }}
          className="ml-2 rounded-md border border-border-subtle px-2 py-0.5 text-[0.8571rem] font-medium text-text-secondary hover:bg-bg-muted disabled:opacity-50"
        >
          Undo
        </button>
      )
    : undefined;

  const runBulk = async (
    run: () => Promise<import("@loctt/contracts").BulkResponse>,
    verb: string,
    clearSelection: boolean,
  ): Promise<readonly string[]> => {
    // Clear the previous outcome first: leaving "5 tasks updated" on
    // screen while the next action runs would misreport what just
    // happened.
    setBulkResult(undefined);
    // A new action supersedes the previous undo: offering it after
    // something else has run would restore tasks the user has since
    // acted on.
    setUndoableArchive([]);
    try {
      const result = await run();
      const described = describeBulkResult(result, verb, id => keyById.get(id));
      setBulkResult(described);
      // A11Y-51: push the outcome through the persistent announcer, not
      // only into the conditionally-mounted `role="status"` span. A live
      // region that mounts *with* its text already present is not reliably
      // spoken, and the case is explicit that the real numbers must be
      // announced ("37 archived, 3 failed"), never a bare "Done", and not
      // truncated. Announce the message plus each failure so the count and
      // the affected tasks are both spoken; the on-screen result keeps the
      // failures individually focusable (below).
      const hasFailures = described.failures.length > 0;
      const failureText = hasFailures
        ? ` Failures: ${described.failures.join("; ")}.`
        : "";
      // A partial failure interrupts (assertive): the user has to know
      // some tasks did not change before acting further. A clean batch is
      // polite. `aria-atomic` on the region means the whole string is read
      // even when it names every failure (A11Y-51 / A11Y-24).
      announce(`${described.message}.${failureText}`, hasFailures ? "assertive" : "polite");
      if (clearSelection) selection.clear();
      // The ids that actually changed, not a yes/no. An Undo built from
      // the refs *sent* would un-archive a task the batch failed on —
      // one the user may have archived deliberately earlier.
      return result.succeeded;
    } catch (err) {
      const envelope = err instanceof ApiError ? err.envelope : undefined;
      if (envelope?.data_state === "unknown") {
        // BLK-41: the request left and nothing came back, so LocTT
        // cannot say whether it landed. Claiming either way is the
        // failure — "nothing was archived" is a lie if half of them
        // were. P4's rare exception: state all three things, and offer
        // a reload rather than a retry, because retrying a write that
        // may have succeeded is how one archive becomes two.
        setBulkResult({
          message:
            `LocTT sent ${String(refs.length)} `
            + `${refs.length === 1 ? "task" : "tasks"} to be ${verb} and the `
            + `server did not respond. Some may have been ${verb}. Reload to `
            + `see the current state, then retry the rest.`,
          failures: [],
        });
        return [];
      }
      // The batch never ran (BLK-39): distinct from a partial failure,
      // and the selection survives so the user can retry it.
      setBulkResult({
        message: `Nothing was ${verb} — the operation could not run.`,
        failures: [(err as Error).message],
      });
      return [];
    }
  };

  // Restore the page count from the URL, then keep the URL in step as
  // the user loads more, so the view is reproducible in a new tab
  // (LST-17). Guarded on the count actually changing: writing the same
  // value would loop through navigate → render → effect.
  const loadedPages = pages.length;
  const restoreTo = search.page ?? 1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = tasks;
  useEffect(() => {
    // Destructured above rather than depending on `tasks`: the query
    // object is a fresh reference every render, so depending on it
    // would re-run this on every render including its own.
    if (
      loadedPages > 0 &&
      loadedPages < restoreTo &&
      hasNextPage &&
      !isFetchingNextPage
    ) {
      void fetchNextPage();
    }
  }, [loadedPages, restoreTo, hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    if (loadedPages === 0) return;
    const urlPage = search.page ?? 1;
    if (loadedPages > urlPage) {
      void navigate({
        search: prev => ({ ...prev, page: loadedPages }),
        replace: true,
      });
    }
  }, [loadedPages, search.page, navigate]);

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* FilterBar owns the whole toolbar row now — the filters (left) AND
          the view-action cluster (Refresh/Export/Save, top-right). Refresh
          + Export used to be rendered here as siblings in a `justify-between`
          flex, which vertically centred them in the bar's dead space and
          made them jump as the chip row appeared/disappeared (Ken's "refresh
          in the middle of nowhere"). They are passed in as props so the bar
          controls their layout without re-deriving the tasks feed. */}
      <FilterBar
        onRefresh={() => { void tasks.refetch(); }}
        refreshBusy={tasks.isFetching}
        exportTotal={total}
        exportQueryString={buildQueryString(params)}
      />
      {queryWarnings.length > 0 && (
        <div
          role="status"
          data-testid="query-warnings"
          className="rounded-md border border-warn-fg/30 bg-warn-bg px-4 py-2 text-[0.8571rem] text-warn-fg"
        >
          {queryWarnings.map(w => (
            <p key={`${w.field}:${w.message}`}>{w.message}</p>
          ))}
        </div>
      )}
      {brokenWorkflowEntries.length > 0 && (
        <div
          role="alert"
          data-testid="workflow-config-broken"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-4 py-2 text-[0.8571rem] text-danger-fg"
        >
          <p className="font-medium">
            <code>.loctt/config/workflow.yaml</code> has an
            entry that does not parse, so some statuses or fields may be missing
            from the filters below.
          </p>
          <p className="mt-1">
            Fix the file (or run <code className="font-mono">loctt doctor</code>),
            then refresh. The rest of the list loaded normally.
          </p>
          <ul className="mt-1 list-none space-y-0.5 p-0" data-testid="workflow-config-broken-list">
            {brokenWorkflowEntries.map(e => (
              <li
                key={`${e.sub}-${String(e.index)}`}
                data-testid={`workflow-config-broken-${e.sub}-${String(e.index)}`}
                className="text-[0.7857rem] text-text-secondary"
              >
                {/* `statuses[0].` then the Zod message, which itself
                    begins with the field ("category must be one of …").
                    Joined with a dot so the path reads `statuses[0].category`
                    — the field with enough path to find it (ERR-10 bullet 2)
                    and the expected values Zod carries (bullet 3). */}
                <code className="rounded bg-bg-surface px-1 py-0.5">
                  {e.sub}[{e.index}].
                </code>{e.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      {brokenView !== undefined && (
        <div
          role="alert"
          data-testid="broken-view"
          data-broken-view-position={brokenView.position ?? ""}
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-4 py-2 text-[0.8571rem] text-danger-fg"
        >
          <p className="font-medium">
            The saved view <code>{brokenView.name}</code> could
            not be run: its query no longer parses.
          </p>
          <p className="mt-1">
            {brokenView.error}
            {brokenView.position !== undefined
              ? <> (at position <span data-testid="broken-view-position">{brokenView.position}</span>)</>
              : null}
          </p>
          <p className="mt-1 text-[0.7857rem] text-text-secondary">{brokenView.query}</p>
          <button
            type="button"
            data-testid="broken-view-fix"
            onClick={() => {
              void navigate({
                search: prev => ({
                  ...prev,
                  view: undefined,
                  q: brokenView.query,
                  edit: true,
                }),
              });
            }}
            className="mt-1 underline hover:text-text-primary"
          >
            Fix this view in the editor
          </button>
        </div>
      )}
      {missingView !== undefined && (
        <div
          role="status"
          className="rounded-md border border-warn-fg/30 bg-warn-bg px-4 py-2 text-[0.8571rem] text-warn-fg"
        >
          The saved view <code>{missingView}</code> no longer
          exists, so this is showing every task instead. It was probably deleted
          from <code>.loctt/config/queries.yaml</code>.{" "}
          <button
            type="button"
            onClick={() => { void navigate({ search: prev => ({ ...prev, view: undefined }) }); }}
            className="underline hover:text-text-primary"
          >
            Drop it from the URL
          </button>
        </div>
      )}
      {unreadable.length > 0 && (
        <div role="alert" className="mb-2 rounded-md border border-danger-fg/30 bg-danger-fg/5 px-4 py-2 text-[0.8571rem] text-danger-fg">
          {unreadable.length} task {unreadable.length === 1 ? "file" : "files"}
          {" "}could not be read, so {unreadable.length === 1 ? "it is" : "they are"}
          {" "}missing from this list. A hand-edit is the usual cause — LocTT
          {" "}writes atomically, so a half-written file is not.
          <ul className="mt-1 space-y-0.5">
            {unreadable.map(u => (
              <li key={u.id} className="text-[0.7857rem]">
                {u.path}: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* The table is the desktop/tablet layout (>= sm). Below sm it is
          replaced by a stacked-card list (rendered conditionally below) —
          a 10-column table on a 375px phone was unusable (Title clipped,
          most columns off-screen behind a horizontal scroll). UX eval #3.
          Rendered only when NOT narrow so the two layouts never coexist in
          the DOM. `overflow-x-auto` still lets a tablet scroll a wide
          column set; `overflow-y-hidden` keeps the rounded corners. */}
      {!isNarrow && (
      <div className="overflow-x-auto overflow-y-hidden rounded-md border border-border-subtle bg-bg-surface">
        {/* A11Y-26: the table has an accessible name describing what
            it lists, so a screen reader's table navigation announces
            what it entered rather than "table". */}
        <table
          ref={tableRef}
          aria-label="Tasks"
          aria-busy={tasks.isLoading}
          className="w-full border-separate border-spacing-0 text-[0.9286rem]"
        >
          <thead>
            <tr>
              <th scope="col" className="sticky top-0 w-9 border-b border-border-default bg-bg-canvas px-3 py-2 dark:bg-bg-surface">
                <Checkbox
                  aria-label="Select all on this page"
                  checked={allOnPageSelected}
                  // BLK-3 requires the header to be *checked*, not
                  // indeterminate, once every visible row is selected;
                  // the primitive owns the DOM-property plumbing.
                  indeterminate={someOnPageSelected && !allOnPageSelected}
                  onChange={() => {
                    if (allOnPageSelected) selection.clear();
                    else selection.selectAll(items.map(t => t.id));
                  }}
                  className="align-middle"
                />
              </th>
              {columns.map(col => {
                const isSorted = sortField === col.id;
                return (
                  <th
                    key={col.id}
                    // A11Y-26: `scope` is what associates a header
                    // with its column, so cell-to-cell navigation
                    // announces the column name. A bare `<th>` in a
                    // table with a row-header column is ambiguous —
                    // the browser has to guess the axis, and readers
                    // disagree about the guess.
                    scope="col"
                    aria-sort={isSorted ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                    className="sticky top-0 whitespace-nowrap border-b border-border-default bg-bg-canvas px-3 py-2 text-left text-[0.8571rem] font-semibold text-text-secondary dark:bg-bg-surface"
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.id)}
                        className="inline-flex select-none items-center gap-1 text-[0.8571rem] font-semibold text-text-secondary hover:text-text-primary"
                      >
                        {col.label}
                        {/* LST-54: the direction must be legible. When
                            this column is the active sort, the arrow is
                            in the stronger secondary text colour and
                            points up (asc) / down (desc); an unsorted
                            column shows a faint neutral caret hint. */}
                        <Icon
                          name={
                            isSorted && sortDir === "asc"
                              ? "chevronUp"
                              : "chevronDown"
                          }
                          size={12}
                          className={
                            isSorted ? "text-text-secondary" : "text-text-tertiary"
                          }
                        />
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {queryFailed ? (
              // Without this branch a failed /api/tasks fell through to
              // the empty state below and rendered "No tasks match these
              // filters." A server that is down and a tracker that is
              // empty must be visibly different screens — conflating
              // them reads as data loss (ERR-1).
              //
              // First, ahead of the skeleton: the recovery poll flips
              // the query back to pending every 5s, and `isLoading` is
              // true for that window. Checked in the other order the
              // panel unmounts each cycle — see `queryFailed` above.
              //
              // A failed *Load more* never lands here: it has real
              // pages, so the rows stay and the pagination control
              // reports the failure (LST-49).
              <tr>
                <td colSpan={columns.length + 1} className="p-0">
                  <ErrorState
                    error={lastQueryError.current}
                    // Past tense. ERR-30 wants "what was attempted",
                    // and "Loading tasks" satisfies that — but it is
                    // the first line of a failure notice, so it read
                    // as a progress claim, and a screen reader
                    // announced "Loading tasks" at the moment loading
                    // had permanently stopped. Graded minor by the M1
                    // round-6 gate (F5) because no case is
                    // contradicted; the past tense answers ERR-30
                    // identically without describing the present
                    // wrongly.
                    context="Could not load tasks"
                    onRetry={() => { void tasks.refetch(); }}
                  />
                </td>
              </tr>
            ) : tasks.isLoading ? (
              // As many rows as a page will hold (ONB-12): eight
              // skeletons under a fifty-row page made the pane jump
              // when data landed, which is the growth the case rules
              // out. Capped so a huge page size does not paint
              // hundreds of placeholder rows.
              <SkeletonRows
                columns={columns.length + 1}
                rows={Math.min(params.limit ?? DEFAULT_LIST_LIMIT, 25)}
              />
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-text-tertiary">
                  {/* Two different empty states, deliberately.
                      ONB-8: a tracker with no tasks is not a filter
                      that matched nothing, and telling a new user to
                      "clear filters" they never set is nonsense.
                      LST-8: when a filter *is* active the message names
                      that and offers the way out from where the eye
                      is — the chip row's "Clear all" is above the
                      table, which on a long page is not where the user
                      is looking when the rows fail to appear. */}
                  {hasFilters ? (
                    <>
                      No tasks match these filters.{" "}
                      <button
                        type="button"
                        onClick={() => void navigate({ search: clearedSearch })}
                        className="underline underline-offset-2 hover:text-text-primary"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      No tasks yet. Create one to get started.
                    </>
                  )}
                </td>
              </tr>
            ) : (
              items.map(task => (
                <tr
                  key={task.id}
                  onClick={() => void navigate({ to: "/tasks/$key", params: { key: task.key } })}
                  aria-selected={selection.isSelected(task.id)}
                  className={[
                    // The key column is a `<th scope="row">`, not a `<td>`,
                    // so a `[&>td]` hover selector never reached it — the
                    // ID/Project cells stayed un-highlighted on hover
                    // (K-15, Ken's report). Hover every direct cell child
                    // (`>*`, covering the row-header th and the tds) with a
                    // dedicated SUBTLE row-hover token (`bg-bg-row-hover`)
                    // that is distinct from the `bg-bg-muted` the chips
                    // paint themselves — so on hover the whole row lifts,
                    // the ID/label cells included, and each chip stays
                    // legible instead of dissolving into the hover.
                    //
                    // The border-bottom + cell padding must ALSO target the
                    // row-header `<th>` (the key column). A `[&>td]`-only rule
                    // left that one cell with no bottom border, so the row
                    // divider had a visible break across the key column — it
                    // read as a gap in the line, not a continuous rule
                    // (Ken's report). Cover both `td` and `th`.
                    "cursor-pointer [&>td]:border-b [&>th]:border-b [&>td]:border-border-default [&>th]:border-border-default",
                    "[&>td]:px-3 [&>td]:py-2.5 [&>th]:px-3 [&>th]:py-2.5",
                    "hover:[&>*]:bg-bg-row-hover last:[&>td]:border-b-0 last:[&>th]:border-b-0",
                    task.archived ? "opacity-50" : "",
                    // The 2px selected-marker border is ALWAYS present on the
                    // first cell — transparent when unselected — so toggling
                    // selection only changes its COLOUR, never adds width.
                    // Adding the border on select shifted every row a few px
                    // sideways (Ken's report); reserving the space fixes it.
                    "[&>td:first-child]:border-l-2 [&>td:first-child]:border-l-transparent",
                    // Background *and* the left border, not colour alone
                    // (BLK-1) — the checked box is the third signal.
                    selection.isSelected(task.id)
                      ? "[&>td]:bg-accent/10 [&>th]:bg-accent/10 [&>td:first-child]:!border-l-accent"
                      : "",
                  ].join(" ")}
                >
                  <td className="align-middle">
                    <Checkbox
                      aria-label={`Select ${task.key}`}
                      checked={selection.isSelected(task.id)}
                      // The checkbox is the one hit area in the row that
                      // does not navigate (BLK-1). Stopping propagation
                      // on click covers the mouse; keyboard Space fires
                      // change without a row click at all.
                      onClick={e => e.stopPropagation()}
                      onChange={() => selection.toggle(task.id)}
                      className="align-middle"
                    />
                  </td>
                  {columns.map(col => {
                    const cell = (
                      <Cell colId={col.id} task={task} lookups={lookups} now={now} today={today} estimation={estimation} onFilterLabel={onFilterLabel} />
                    );
                    // A11Y-26's second bullet: the key column is the
                    // row header, so navigating rows announces *which
                    // task* the row is rather than reading a bare
                    // cell value with no subject.
                    return col.id === "key" ? (
                      <th key={col.id} scope="row" data-col={col.id} className="text-left align-middle font-normal">
                        {cell}
                      </th>
                    ) : (
                      <td key={col.id} data-col={col.id} className="align-middle">
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* Mobile (< sm): a stacked card per task instead of the table.
          Reuses the same `items`, `Cell` renderers and `selection` so the
          data, sorting and multi-select all match the table exactly — only
          the layout differs. UX eval #3 (responsive). Rendered ONLY below
          `sm` (conditional, not CSS-hidden) so the task list is never in
          the DOM twice — one accessible source, and no duplicate text for
          a screen reader or a test's `getByText`. */}
      {isNarrow && (
      <ul className="flex flex-col gap-2 sm:hidden" data-testid="task-cards">
        {items.length === 0 ? (
          <li className="rounded-md border border-border-subtle bg-bg-surface px-3 py-8 text-center text-text-tertiary">
            {hasFilters ? "No tasks match these filters." : "No tasks yet. Create one to get started."}
          </li>
        ) : (
          items.map(task => (
            <li
              key={task.id}
              data-testid={`task-card-${task.key}`}
              aria-selected={selection.isSelected(task.id)}
              onClick={() => void navigate({ to: "/tasks/$key", params: { key: task.key } })}
              className={[
                "cursor-pointer rounded-md border bg-bg-surface p-3",
                selection.isSelected(task.id) ? "border-accent bg-accent/5" : "border-border-subtle",
                task.archived ? "opacity-50" : "",
              ].join(" ")}
            >
              <div className="flex items-start gap-2">
                <Checkbox
                  aria-label={`Select ${task.key}`}
                  checked={selection.isSelected(task.id)}
                  onClick={e => e.stopPropagation()}
                  onChange={() => selection.toggle(task.id)}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[0.7857rem] text-text-tertiary">
                    <Cell colId="key" task={task} lookups={lookups} now={now} today={today} estimation={estimation} onFilterLabel={onFilterLabel} />
                    <Cell colId="project" task={task} lookups={lookups} now={now} today={today} estimation={estimation} onFilterLabel={onFilterLabel} />
                  </div>
                  <div className="mt-0.5 font-medium text-text-primary">
                    <Cell colId="title" task={task} lookups={lookups} now={now} today={today} estimation={estimation} onFilterLabel={onFilterLabel} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8571rem]">
                    <Cell colId="status" task={task} lookups={lookups} now={now} today={today} estimation={estimation} onFilterLabel={onFilterLabel} />
                    <Cell colId="priority" task={task} lookups={lookups} now={now} today={today} estimation={estimation} onFilterLabel={onFilterLabel} />
                    <Cell colId="assignee" task={task} lookups={lookups} now={now} today={today} estimation={estimation} onFilterLabel={onFilterLabel} />
                    <Cell colId="due_date" task={task} lookups={lookups} now={now} today={today} estimation={estimation} onFilterLabel={onFilterLabel} />
                  </div>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>
      )}
      {/* The outcome outlives the bar. A move clears the selection
          (BLK-18), which unmounts BulkBar — and with it the only place
          the result was shown, taking the new keys BLK-9 requires be
          named. Archive had the same latent hole. */}
      {selection.count === 0 && bulkResult !== undefined && (
        // Sticky, like the bar it replaces. It renders after the table,
        // so on a full page it sat ~770px below the fold — and BLK-10's
        // Undo is the *only* safety net for archive, which deliberately
        // has no confirmation dialog. An undo the user has to scroll to
        // find is not an undo.
        <div
          className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border-divider bg-bg-surface px-4 py-2 shadow-[0_-1px_3px_rgba(0,0,0,0.06)]"
        >
          <BulkResult result={bulkResult} action={undoControl} />
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => { setBulkResult(undefined); }}
            className="ml-auto rounded-md border border-border-subtle px-2 py-0.5 text-[0.8571rem] font-medium text-text-secondary hover:bg-bg-muted"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <BulkBar
        count={selection.count}
        scopeLabel={
          allOnPageSelected && items.length > 1
            ? `${String(items.length)} on this page selected`
            : undefined
        }
        workflow={workflow.data}
        users={users.data?.items}
        milestones={milestones.data?.items}
        sprints={sprints.data?.items}
        projects={projects.data?.items}
        busy={busy}
        result={bulkResult}
        resultAction={undoControl}
        onClear={selection.clear}
        onSetField={(field, value) => {
          void runBulk(
            () => bulkSet.mutateAsync({ refs, field, value }),
            "updated",
            false,
          );
        }}
        onMove={projectId => {
          // Clears, like archive does. A move rekeys every task and can
          // remove them from a project-scoped filter, so keeping the
          // selection leaves the bar counting rows the user can no
          // longer see — the exact state BLK-18 forbids.
          void runBulk(
            () => bulkMove.mutateAsync({ refs, project: projectId }),
            "moved",
            true,
          );
        }}
        onArchive={() => {
          void runBulk(
            () => bulkArchive.mutateAsync({ refs, archive: true }),
            "archived",
            true,
          ).then(succeeded => { setUndoableArchive(succeeded); });
        }}
        onDeleteRequested={() => { setConfirmingDelete(true); }}
      />
      {confirmingDelete && (
        <DeleteConfirmDialog
          count={selection.count}
          onCancel={() => { setConfirmingDelete(false); }}
          onConfirm={() => {
            setConfirmingDelete(false);
            void runBulk(
              () => bulkDelete.mutateAsync({ refs }),
              "deleted",
              true,
            );
          }}
        />
      )}
      {/* Gated with the same predicate as the table: mid-poll the
          placeholder briefly repopulates `pages`, and a footer reading
          "Showing 1–14 of 14" under a filter that never ran is the
          ERR-2 screen in miniature. */}
      {queryFailed ? undefined : <Pagination
        loaded={items.length}
        total={total}
        hasMore={tasks.hasNextPage}
        isLoadingMore={tasks.isFetchingNextPage}
        error={
          tasks.isFetchNextPageError
            ? "Could not load more tasks."
            : undefined
        }
        onLoadMore={() => void tasks.fetchNextPage()}
      />}
    </div>
  );
}

function Cell({
  colId,
  task,
  lookups,
  now,
  today,
  estimation,
  onFilterLabel,
}: {
  colId: string;
  task: TaskListRow;
  lookups: ReturnType<typeof buildLookups>;
  /** SET-9: the estimate control's shape, or null when estimation is off. */
  estimation: EstimationShape | null;
  /** Clicking a label pill filters to it (MSL-6). */
  onFilterLabel: (id: string) => void;
  now: number;
  today: string;
}) {
  // Per-field view-model (A137 / A137.1): merges the row's value with any
  // matching `health` finding. `fieldHealth` is a whole-field fault (the
  // value was lifted into `health`); when it is present a cell shows the
  // raw + ⚠ marker rather than a blank. When absent, cells render exactly
  // as before — so a clean row (and the board, which passes no health) is
  // unchanged. `column → frontmatter field` is 1:1 except `task_type`,
  // whose column id already matches the field name.
  const health = task.health;
  switch (colId) {
    case "key":
      // A real Link makes the row reachable by keyboard and supports
      // middle-click / open-in-new-tab. The whole row is also clickable
      // (mouse convenience) via the <tr> onClick.
      return (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <Link
            to="/tasks/$key"
            params={{ key: task.key }}
            onClick={e => e.stopPropagation()}
            // A11Y-17: the per-row focus anchor. When a refetch re-renders
            // the table (a filter change, a background poll), the
            // restoration effect re-focuses the same task's link by this
            // attribute, so focus stays on the equivalent row rather than
            // being dropped to document.body.
            data-task-key={task.key}
            className="text-text-tertiary no-underline hover:text-accent"
          >
            {task.key}
          </Link>
          {/* BLK-10 asks for a badge, and the dimmed row it replaces was
              a lone visual signal — unreadable to a screen reader and to
              anyone the contrast drop does not reach. */}
          {task.archived === true && (
            <span className="rounded border border-border-subtle px-1 py-px text-[0.7143rem] font-medium uppercase tracking-wide text-text-tertiary">
              Archived
            </span>
          )}
        </span>
      );
    case "project":
      return <ProjectChip def={lookups.project(task.project)} raw={task.project} />;
    case "title": {
      // K26: `title` is field-local. A corrupt/absent title still loads
      // the task (its identity is `id`/`key`), so the cell must not go
      // blank — a blank title cell hides the task, the exact failure this
      // sweep removes. Fall back to the key, and when the title was
      // corrupt (lifted into `health`) mark it so the fault is visible.
      const titleView = fieldView<string>("title", task.title, health);
      const titleHealth = titleView.fieldHealth;
      const shown = task.title ?? task.key;
      // LST-20: an unbroken 400-char title had nothing to stop it, so
      // it widened the column and scrolled the whole table sideways.
      // Truncation is visual only — `title` puts the full string on
      // hover and the stored value is untouched.
      return (
        <span
          title={titleHealth?.error ?? task.title ?? task.key}
          className={[
            "flex max-w-[42ch] items-center gap-1 truncate font-medium",
            task.title === undefined ? "italic text-text-tertiary" : "text-text-primary",
          ].join(" ")}
        >
          <span className="truncate">{shown}</span>
          {titleHealth !== undefined && (
            <span aria-hidden="true" title={titleHealth.error} className="shrink-0 text-danger-fg">⚠</span>
          )}
        </span>
      );
    }
    case "status":
      return <StatusBadge def={lookups.status(task.status)} raw={task.status} health={fieldView("status", task.status, health).fieldHealth} />;
    case "priority":
      return <PriorityCell def={lookups.priority(task.priority)} raw={task.priority} health={fieldView("priority", task.priority, health).fieldHealth} />;
    case "task_type":
      return <TypeBadge def={lookups.taskType(task.task_type)} raw={task.task_type} health={fieldView("task_type", task.task_type, health).fieldHealth} />;
    case "assignee":
      return <AssigneeCell user={lookups.user(task.assignee)} raw={task.assignee} health={fieldView("assignee", task.assignee, health).fieldHealth} />;
    case "reporter":
      // Same cell as assignee — a user reference resolves, degrades and
      // disambiguates identically whichever role names it (PRU-25).
      return <AssigneeCell user={lookups.user(task.reporter)} raw={task.reporter} health={fieldView("reporter", task.reporter, health).fieldHealth} />;
    case "labels":
      return (
        <LabelsCell
          labels={(task.labels ?? []).map(id => lookups.label(id) ?? { id })}
          onFilter={onFilterLabel}
        />
      );
    case "due_date":
      return task.due_date === undefined ? (
        <Dash />
      ) : (
        <span
          className={[
            "whitespace-nowrap",
            isOverdue(task.due_date, today) ? "font-medium text-danger-fg" : "text-text-secondary",
          ].join(" ")}
        >
          {shortDate(task.due_date, today)}
        </span>
      );
    case "estimate":
      // SET-9: numeric modes show the value with the unit suffix ("5
      // points"); enum mode shows the categorical value as-is. A task
      // with no estimate — or a column left over from when estimation
      // was enabled — degrades to a dash. `estimation` is null only when
      // the column should not exist at all (resolveColumns drops it),
      // so a null here is defensive, not an expected state.
      return task.estimate === undefined || task.estimate === "" || estimation === null ? (
        <Dash />
      ) : (
        <span className="whitespace-nowrap text-text-secondary">
          {estimation.kind === "numeric"
            ? `${task.estimate} ${estimation.suffix}`
            : task.estimate}
        </span>
      );
    case "updated_at":
      // K26: `updated_at` is field-local — a corrupt/absent timestamp
      // still loads the task, so the cell degrades to a dash rather than
      // rendering "Invalid Date".
      return task.updated_at === undefined ? (
        <Dash />
      ) : (
        <span className="whitespace-nowrap text-text-tertiary">
          {relativeTime(task.updated_at, now)}
        </span>
      );
    default:
      return <Dash />;
  }
}

function SkeletonRows({ columns, rows }: { columns: number; rows: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} aria-hidden className="[&>td]:border-b [&>td]:border-border-default [&>td]:px-3 [&>td]:py-2.5">
          {Array.from({ length: columns }).map((__, c) => (
            <td key={c}>
              <span className="block h-3.5 w-full max-w-[120px] animate-pulse rounded bg-bg-muted" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
