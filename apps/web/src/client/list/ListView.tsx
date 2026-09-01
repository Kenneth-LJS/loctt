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
import { buildQueryString, DEFAULT_LIST_LIMIT, tasksParamsFromSearch, useTasksFeed } from "../api/hooks/useTasks.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
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
import { ExportMenu } from "./ExportMenu.tsx";
import { clearedSearch, FilterBar } from "./FilterBar.tsx";
import { isOverdue, relativeTime, shortDate } from "./format.ts";
import { buildLookups } from "./lookups.ts";
import { Pagination } from "./Pagination.tsx";
import { RefreshButton } from "./RefreshButton.tsx";
import { useSelection } from "./useSelection.ts";

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

  const columns = useMemo(
    () => resolveColumns(userSettings.data?.settings),
    [userSettings.data?.settings],
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
    // Same column → toggle direction; new column → ascending.
    const nextDir = sortField === colId && sortDir === "asc" ? "desc" : "asc";
    void navigate({
      search: prev => ({ ...prev, sort: colId, dir: nextDir, page: undefined }),
    });
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
  // VUE-21: core raises a warning when a query names a field that no
  // longer exists, and the CLI and MCP both print it. The web dropped
  // it, so a saved view filtering on a deleted custom field answered
  // 200 with zero rows — an empty result the user reads as "nothing
  // matches" rather than "this view is broken".
  const queryWarnings = pages[pages.length - 1]?.warnings ?? [];
  // Newest page's total. A filter change cannot be what makes these
  // differ — it builds a new query key, so the feed restarts with one
  // page — but a task created or deleted between page 1 and page 3
  // does, and then page 1's total is simply out of date. Not covered by
  // a spec: reproducing it needs a write landing between two paged
  // reads of the same feed, which the fixture cannot currently stage.
  const total = pages[pages.length - 1]?.total ?? 0;

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
          className="ml-2 rounded-md border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-text-secondary hover:bg-bg-muted disabled:opacity-50"
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
      setBulkResult(describeBulkResult(result, verb, id => keyById.get(id)));
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
      <div className="flex items-center justify-between gap-3">
        <FilterBar />
        <RefreshButton
          busy={tasks.isFetching}
          onRefresh={() => { void tasks.refetch(); }}
        />
        <ExportMenu total={total} queryString={buildQueryString(params)} />
      </div>
      {queryWarnings.length > 0 && (
        <div
          role="status"
          data-testid="query-warnings"
          className="rounded-md border border-warn-fg/30 bg-warn-bg px-4 py-2 text-[12px] text-warn-fg"
        >
          {queryWarnings.map(w => (
            <p key={`${w.field}:${w.message}`}>{w.message}</p>
          ))}
        </div>
      )}
      {missingView !== undefined && (
        <div
          role="status"
          className="rounded-md border border-warn-fg/30 bg-warn-bg px-4 py-2 text-[12px] text-warn-fg"
        >
          The saved view <code className="font-mono">{missingView}</code> no longer
          exists, so this is showing every task instead. It was probably deleted
          from <code className="font-mono">.loctt/config/queries.yaml</code>.{" "}
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
        <div role="alert" className="mb-2 rounded-md border border-danger-fg/30 bg-danger-fg/5 px-4 py-2 text-[12px] text-danger-fg">
          {unreadable.length} task {unreadable.length === 1 ? "file" : "files"}
          {" "}could not be read, so {unreadable.length === 1 ? "it is" : "they are"}
          {" "}missing from this list. A hand-edit is the usual cause — LocTT
          {" "}writes atomically, so a half-written file is not.
          <ul className="mt-1 space-y-0.5">
            {unreadable.map(u => (
              <li key={u.id} className="font-mono text-[11px]">
                {u.path}: {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* `overflow-x-auto`, not `hidden`: at a narrow viewport the
          table is wider than its container, and clipping it made seven
          of ten columns unreachable by any input — worse than the
          honest overflow it replaced. `overflow-y-hidden` keeps the
          rounded corners from being cut. */}
      <div className="overflow-x-auto overflow-y-hidden rounded-md border border-border-subtle bg-bg-surface">
        <table aria-busy={tasks.isLoading} className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <th className="sticky top-0 w-9 border-b border-border-subtle bg-bg-canvas px-3 py-2 dark:bg-bg-surface">
                <input
                  type="checkbox"
                  aria-label="Select all on this page"
                  checked={allOnPageSelected}
                  ref={el => {
                    // Indeterminate is not an attribute — it only
                    // exists as a DOM property. BLK-3 requires the
                    // header to be *checked*, not indeterminate, once
                    // every visible row is selected.
                    if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
                  }}
                  onChange={() => {
                    if (allOnPageSelected) selection.clear();
                    else selection.selectAll(items.map(t => t.id));
                  }}
                  className="cursor-pointer align-middle accent-accent"
                />
              </th>
              {columns.map(col => {
                const isSorted = sortField === col.id;
                return (
                  <th
                    key={col.id}
                    aria-sort={isSorted ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                    className="sticky top-0 whitespace-nowrap border-b border-border-subtle bg-bg-canvas px-3 py-2 text-left text-[12px] font-semibold text-text-secondary dark:bg-bg-surface"
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => onSort(col.id)}
                        className="inline-flex select-none items-center gap-1 text-[12px] font-semibold text-text-secondary hover:text-text-primary"
                      >
                        {col.label}
                        <span className="text-[10px] text-text-tertiary">
                          {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "▾"}
                        </span>
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
                    "cursor-pointer [&>td]:border-b [&>td]:border-border-subtle [&>td]:px-3 [&>td]:py-2.5",
                    "hover:[&>td]:bg-bg-muted last:[&>td]:border-b-0",
                    task.archived ? "opacity-50" : "",
                    // Background *and* a left border, not colour alone
                    // (BLK-1) — the checked box is the third signal.
                    selection.isSelected(task.id)
                      ? "[&>td]:bg-accent/10 [&>td:first-child]:border-l-2 [&>td:first-child]:border-l-accent"
                      : "",
                  ].join(" ")}
                >
                  <td className="align-middle">
                    <input
                      type="checkbox"
                      aria-label={`Select ${task.key}`}
                      checked={selection.isSelected(task.id)}
                      // The checkbox is the one hit area in the row that
                      // does not navigate (BLK-1). Stopping propagation
                      // on click covers the mouse; keyboard Space fires
                      // change without a row click at all.
                      onClick={e => e.stopPropagation()}
                      onChange={() => selection.toggle(task.id)}
                      className="cursor-pointer align-middle accent-accent"
                    />
                  </td>
                  {columns.map(col => (
                    <td key={col.id} className="align-middle">
                      <Cell colId={col.id} task={task} lookups={lookups} now={now} today={today} onFilterLabel={onFilterLabel} />
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
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
          className="sticky bottom-0 z-10 flex items-center gap-2 border-t border-border-subtle bg-bg-surface px-4 py-2 shadow-[0_-1px_3px_rgba(0,0,0,0.06)]"
        >
          <BulkResult result={bulkResult} action={undoControl} />
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => { setBulkResult(undefined); }}
            className="ml-auto rounded-md border border-border-subtle px-2 py-0.5 text-[12px] font-medium text-text-secondary hover:bg-bg-muted"
          >
            ✕
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
  onFilterLabel,
}: {
  colId: string;
  task: import("@loctt/contracts").TaskFrontmatterPublic;
  lookups: ReturnType<typeof buildLookups>;
  /** Clicking a label pill filters to it (MSL-6). */
  onFilterLabel: (id: string) => void;
  now: number;
  today: string;
}) {
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
            className="font-mono text-text-tertiary no-underline hover:text-accent"
          >
            {task.key}
          </Link>
          {/* BLK-10 asks for a badge, and the dimmed row it replaces was
              a lone visual signal — unreadable to a screen reader and to
              anyone the contrast drop does not reach. */}
          {task.archived === true && (
            <span className="rounded border border-border-subtle px-1 py-px text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
              Archived
            </span>
          )}
        </span>
      );
    case "project":
      return <ProjectChip def={lookups.project(task.project)} raw={task.project} />;
    case "title":
      // LST-20: an unbroken 400-char title had nothing to stop it, so
      // it widened the column and scrolled the whole table sideways.
      // Truncation is visual only — `title` puts the full string on
      // hover and the stored value is untouched.
      return (
        <span
          title={task.title}
          className="block max-w-[42ch] truncate font-medium text-text-primary"
        >
          {task.title}
        </span>
      );
    case "status":
      return <StatusBadge def={lookups.status(task.status)} raw={task.status} />;
    case "priority":
      return <PriorityCell def={lookups.priority(task.priority)} raw={task.priority} />;
    case "task_type":
      return <TypeBadge def={lookups.taskType(task.task_type)} raw={task.task_type} />;
    case "assignee":
      return <AssigneeCell user={lookups.user(task.assignee)} raw={task.assignee} />;
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
    case "updated_at":
      return (
        <span className="whitespace-nowrap font-mono text-text-tertiary">
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
        <tr key={r} aria-hidden className="[&>td]:border-b [&>td]:border-border-subtle [&>td]:px-3 [&>td]:py-2.5">
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
