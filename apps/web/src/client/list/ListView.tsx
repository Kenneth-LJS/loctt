import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";

import {
  useLabels,
  useProjects,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { tasksParamsFromSearch, useTasksFeed } from "../api/hooks/useTasks.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
import { BulkBar } from "./BulkBar.tsx";
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
      <FilterBar />
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
      <BulkBar
        count={selection.count}
        scopeLabel={
          allOnPageSelected && items.length > 1
            ? `${String(items.length)} on this page selected`
            : undefined
        }
        onClear={selection.clear}
      />
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
        <Link
          to="/tasks/$key"
          params={{ key: task.key }}
          onClick={e => e.stopPropagation()}
          className="whitespace-nowrap font-mono text-text-tertiary no-underline hover:text-accent"
        >
          {task.key}
        </Link>
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
