import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

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
import { buildQueryString, tasksParamsFromSearch, useTasksFeed } from "../api/hooks/useTasks.ts";
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
import { FilterBar } from "./FilterBar.tsx";
import { isOverdue, relativeTime, shortDate } from "./format.ts";
import { buildLookups } from "./lookups.ts";
import { Pagination } from "./Pagination.tsx";
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
        <ExportMenu total={total} queryString={buildQueryString(params)} />
      </div>
      <div className="overflow-hidden rounded-md border border-border-subtle bg-bg-surface">
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
            {tasks.isLoading ? (
              <SkeletonRows columns={columns.length + 1} />
            ) : tasks.isError && items.length === 0 ? (
              // Without this branch a failed /api/tasks fell through to
              // the empty state below and rendered "No tasks match these
              // filters." A server that is down and a tracker that is
              // empty must be visibly different screens — conflating
              // them reads as data loss (ERR-1).
              //
              // Gated on having no rows: a *Load more* that fails also
              // sets `isError`, and replacing the table there would
              // discard the 50 rows already on screen. LST-49 requires
              // those to survive, with the failure reported by the
              // pagination control instead.
              <tr>
                <td colSpan={columns.length + 1} className="p-0">
                  <ErrorState
                    error={tasks.error}
                    context="Loading tasks"
                    onRetry={() => { void tasks.refetch(); }}
                  />
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-text-tertiary">
                  No tasks match these filters.
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
                      <Cell colId={col.id} task={task} lookups={lookups} now={now} today={today} />
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
        <div className="border-t border-border-subtle px-4 py-2">
          <BulkResult result={bulkResult} action={undoControl} />
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
      <Pagination
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
      />
    </div>
  );
}

function Cell({
  colId,
  task,
  lookups,
  now,
  today,
}: {
  colId: string;
  task: import("@loctt/contracts").TaskFrontmatterPublic;
  lookups: ReturnType<typeof buildLookups>;
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
      return <span className="font-medium text-text-primary">{task.title}</span>;
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
          {shortDate(task.due_date)}
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

function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 8 }).map((_, r) => (
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
