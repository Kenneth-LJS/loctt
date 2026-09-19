import type { SprintDef } from "@loctt/contracts";
import { Link, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

import { useSprints } from "../api/hooks/sidebarData.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { useBurndown, useSprintsWithProgress } from "../api/hooks/useSprintDetail.ts";
import { tasksParamsFromSearch,useTasks } from "../api/hooks/useTasks.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { Dash,PriorityCell, StatusBadge, TypeBadge } from "../list/cells.tsx";
import { FilterBar } from "../list/FilterBar.tsx";
import { progressState } from "../milestones/model.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { BurndownChart } from "./BurndownChart.tsx";
import { SprintMetaHeader } from "./SprintMetaHeader.tsx";

/**
 * The sprint detail route — `/sprints/$key` (M4.7).
 *
 * `$key` is the sprint's **ULID**, per decision V3: route segments
 * carry the id because a sprint `name` is neither unique nor
 * immutable, so a name-based URL would break on rename and be
 * ambiguous between two sprints sharing a name. SPR-1's "never the
 * ULID" governs the column *header*, which shows the name — not the
 * address bar.
 *
 * Three regions, each failing independently:
 *
 *  - the metadata header (editable, writes to `sprints.yaml`),
 *  - the burndown (its own query — SPR-34 requires the rest of the
 *    page to keep rendering and stay editable when it fails),
 *  - the sprint-scoped task list, using the shared filter bar.
 */
export function SprintDetail({ sprintId }: { readonly sprintId: string }) {
  const sprints = useSprints();
  const workflow = useWorkflow();
  const info = useInfo();
  const search = useSearch({ from: "/sprints/$key" });

  const sprint: SprintDef | undefined = useMemo(
    () => (sprints.data?.items ?? []).find(s => s.id === sprintId),
    [sprints.data, sprintId],
  );

  // The sprint scope is applied *after* the URL's filters, and
  // overwrites any `sprint` param rather than merging with it. SPR-13:
  // "the sprint scope is never dropped by adding a filter" — and a
  // hand-edited `?sprint=<other>` must not silently retarget the page
  // to a sprint the header is not describing.
  const params = useMemo(
    () => ({ ...tasksParamsFromSearch(search), sprint: [sprintId] }),
    [search, sprintId],
  );
  const tasks = useTasks(params);
  const burndown = useBurndown(sprint === undefined ? undefined : sprintId);

  // F1 (K30): sprint progress from core, the same done/total core
  // computes for the CLI and MCP — the web client's consumer of
  // `/api/sprints?progress=true`, which had none. Category-based and
  // discarded-excluded, so it is a different (complementary) number
  // from the task-list total below, which counts tasks matching the
  // current filter.
  const sprintsProgress = useSprintsWithProgress();

  // The tracker's today, not the browser's — the elapsed/future split
  // must match what the CLI would report (SPR-21).
  const today = info.data?.today ?? new Date().toISOString().slice(0, 10);

  if (sprints.isLoading) {
    return (
      <div data-testid="sprint-detail" aria-busy="true" className="p-4">
        <LoadingState className="text-[0.9286rem] text-text-tertiary">Loading the sprint…</LoadingState>
      </div>
    );
  }

  // A failed *fetch* is not a missing sprint. SPR-38's not-found state
  // must be distinguishable from a load failure, so the error branch
  // comes first and offers a retry.
  if (sprints.isError) {
    return (
      <div data-testid="sprint-detail" className="p-4">
        <ErrorState
          error={sprints.error}
          onRetry={() => void sprints.refetch()}
          context="The sprint could not be loaded."
        />
      </div>
    );
  }

  // SPR-38: an unknown key gets a designed not-found with a way back,
  // not a blank shell. Distinguishable from "a sprint with no tasks",
  // which renders the full page with an empty list.
  if (sprint === undefined) {
    return (
      <div data-testid="sprint-not-found" className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-lg font-semibold text-text-primary">
            No sprint matches this link
          </h1>
          <p className="mb-1 text-[0.9286rem] text-text-secondary">
            Nothing in <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">sprints.yaml</code>{" "}
            has the id{" "}
            <code data-testid="sprint-not-found-key" className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
              {sprintId}
            </code>
            .
          </p>
          <p className="mb-4 text-[0.9286rem] text-text-tertiary">
            It may have been deleted, or the link may have a typo.
          </p>
          <Link
            to="/sprints"
            data-testid="sprint-not-found-back"
            className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[0.9286rem] font-medium text-accent-contrast no-underline hover:bg-accent-hover"
          >
            Back to sprints
          </Link>
        </div>
      </div>
    );
  }

  const items = tasks.data?.items ?? [];
  const total = tasks.data?.total ?? items.length;
  const estimationOn = workflow.data?.estimation?.enabled === true;

  // The done/total for *this* sprint, out of the progress list. The
  // readout math (zero-denominator suppression, complete-at-n/n) is
  // shared with milestones by construction, not re-implemented.
  const thisProgress = (sprintsProgress.data?.items ?? []).find(s => s.id === sprintId)?.progress;
  const readout = progressState(thisProgress);
  // K28 / P-5: task files core could not read cannot be attributed to
  // a sprint, so the done/total above is short by this many. Surfaced,
  // never a silently-shortened total.
  const progressUnreadable = sprintsProgress.data?.unreadable ?? [];

  return (
    <div data-testid="sprint-detail" data-sprint-id={sprint.id} className="flex h-full flex-col gap-4 overflow-auto p-4">
      <div>
        <Link to="/sprints" className="text-[0.8571rem] text-text-tertiary no-underline hover:underline">
          ← All sprints
        </Link>
      </div>

      <SprintMetaHeader sprint={sprint} />

      {/* F1 (K30): the sprint's done/total, from core via
          `?progress=true` — the same figure the CLI's `sprint list
          --progress` and MCP's `list_sprints` progress arg return.
          `none` (no counted tasks) shows an explicit label rather than
          a fabricated 0% (mirrors MSL-15). */}
      {readout.kind !== "unavailable" && (
        <div
          data-testid="sprint-progress"
          data-sprint-progress-done={String(readout.done)}
          data-sprint-progress-total={String(readout.total)}
          className="flex items-baseline gap-2 text-[0.8571rem] text-text-secondary"
        >
          <span className="font-medium text-text-primary">Progress</span>
          {readout.kind === "none" ? (
            <span data-testid="sprint-progress-none" className="text-text-tertiary">
              No tasks
            </span>
          ) : (
            <span data-testid="sprint-progress-count" className="tabular-nums">
              {readout.done}/{readout.total}
              {readout.percent !== undefined && (
                <span className="ml-1 text-text-tertiary">({readout.percent}%)</span>
              )}
              {readout.discarded > 0 && (
                <span className="ml-1 text-text-tertiary">
                  ({readout.discarded} discarded, excluded)
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {progressUnreadable.length > 0 && (
        <div
          role="alert"
          data-testid="sprint-progress-unreadable"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          {progressUnreadable.length} task
          {" "}{progressUnreadable.length === 1 ? "file" : "files"} could not be
          {" "}read, so the progress total is short by
          {" "}{progressUnreadable.length === 1 ? "it" : "them"}. Check the file.
        </div>
      )}

      <BurndownChart
        series={burndown.data}
        workflow={workflow.data}
        today={today}
        tasks={items}
        sprintName={sprint.name}
        error={burndown.error}
        loading={burndown.isLoading}
        onRetry={() => void burndown.refetch()}
      />

      <section aria-label="Tasks in this sprint" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[0.9286rem] font-semibold text-text-primary">Tasks</h2>
          <span data-testid="sprint-task-count" className="text-[0.8571rem] tabular-nums text-text-tertiary">
            {String(total)}
          </span>
        </div>

        {/* SPR-13: the *shared* bar, not a sprint dialect. The `sprint`
            facet is withheld because this page's scope is the sprint —
            a control that could clear it would strand the user on a
            route whose header still names one sprint while the list
            shows every task. */}
        <FilterBar from="/sprints/$key" hiddenFacets={["sprint"]} showSaveView={false} />

        {tasks.isError ? (
          <ErrorState
            error={tasks.error}
            onRetry={() => void tasks.refetch()}
            context="The tasks in this sprint could not be loaded."
          />
        ) : items.length === 0 ? (
          <p data-testid="sprint-tasks-empty" className="px-3 py-8 text-center text-[0.9286rem] text-text-tertiary">
            {hasFilters(search)
              ? "No tasks in this sprint match the current filters."
              : "No tasks are assigned to this sprint yet."}
          </p>
        ) : (
          <table data-testid="sprint-task-list" aria-busy={tasks.isLoading} className="w-full border-separate border-spacing-0 text-[0.9286rem]">
            <thead>
              <tr className="text-left text-[0.7857rem] uppercase tracking-wide text-text-tertiary">
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">Key</th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">Title</th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">Status</th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">Priority</th>
                <th className="border-b border-border-subtle py-1.5 pr-2 font-medium">Type</th>
                {/* SPR-10: with estimation disabled the estimate field
                    is absent entirely, not rendered empty. */}
                {estimationOn && (
                  <th data-testid="sprint-estimate-header" className="border-b border-border-subtle py-1.5 pr-2 font-medium">
                    Estimate
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr key={t.id} data-testid={`sprint-task-${t.key}`} data-task-key={t.key}>
                  <td className="border-b border-border-subtle py-1.5 pr-2 text-[0.8571rem]">
                    <Link to="/tasks/$key" params={{ key: t.key }} className="text-accent no-underline hover:underline">
                      {t.key}
                    </Link>
                  </td>
                  <td className="max-w-[420px] truncate border-b border-border-subtle py-1.5 pr-2">{t.title}</td>
                  <td className="border-b border-border-subtle py-1.5 pr-2">
                    <StatusBadge
                      def={workflow.data?.statuses.find(s => s.key === t.status)}
                      raw={t.status}
                    />
                  </td>
                  <td className="border-b border-border-subtle py-1.5 pr-2">
                    <PriorityCell
                      def={workflow.data?.priorities.find(p => p.key === t.priority)}
                      raw={t.priority}
                    />
                  </td>
                  <td className="border-b border-border-subtle py-1.5 pr-2">
                    <TypeBadge
                      def={workflow.data?.task_types.find(x => x.key === t.task_type)}
                      raw={t.task_type}
                    />
                  </td>
                  {estimationOn && (
                    <td data-testid={`sprint-estimate-${t.key}`} className="border-b border-border-subtle py-1.5 pr-2 tabular-nums">
                      {t.estimate === undefined || t.estimate === "" ? <Dash /> : String(t.estimate)}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Whether any filter is narrowing the list, for the empty state's wording. */
function hasFilters(search: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(search)) {
    if (k === "sort" || k === "dir" || k === "page" || k === "limit") continue;
    if (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== "") return true;
  }
  return false;
}
