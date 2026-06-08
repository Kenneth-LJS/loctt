import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import {
  useLabels,
  useProjects,
  useUsers,
} from "../api/hooks/sidebarData.ts";
import { tasksParamsFromSearch, useTasks } from "../api/hooks/useTasks.ts";
import { useUserSettings, useWorkflow } from "../api/hooks/useWorkflow.ts";
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
import { isOverdue, relativeTime, shortDate } from "./format.ts";
import { buildLookups } from "./lookups.ts";

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
  const tasks = useTasks(params);

  const projects = useProjects();
  const users = useUsers();
  const labels = useLabels();
  const workflow = useWorkflow();
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
  const today = new Date(now).toISOString().slice(0, 10);
  const items = tasks.data?.items ?? [];

  return (
    <div className="p-6">
      <div className="overflow-hidden rounded-md border border-border-subtle bg-bg-surface">
        <table aria-busy={tasks.isLoading} className="w-full border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
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
              <SkeletonRows columns={columns.length} />
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-text-tertiary">
                  No tasks match these filters.
                </td>
              </tr>
            ) : (
              items.map(task => (
                <tr
                  key={task.id}
                  onClick={() => void navigate({ to: "/tasks/$key", params: { key: task.key } })}
                  className={[
                    "cursor-pointer [&>td]:border-b [&>td]:border-border-subtle [&>td]:px-3 [&>td]:py-2.5",
                    "hover:[&>td]:bg-bg-muted last:[&>td]:border-b-0",
                    task.archived ? "opacity-50" : "",
                  ].join(" ")}
                >
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
