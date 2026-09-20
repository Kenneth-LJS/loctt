import { Link, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import { useMilestonesWithProgress } from "../api/hooks/useMilestoneProgress.ts";
import { tasksParamsFromSearch, useTasks } from "../api/hooks/useTasks.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { formatWorkspaceDate } from "../dates/workspaceDate.ts";
import { PriorityCell, StatusBadge, TypeBadge } from "../list/cells.tsx";
import { buildLookups } from "../list/lookups.ts";
// K100: the detail header's Edit reuses the SAME dialog Settings and the
// point-of-use rows use (fields + validation + `useUpdateMilestone`), so
// an edit from the detail page cannot drift from an edit anywhere else.
// Reading a settings/ component is allowed; this file does not edit it.
import { MilestoneEditDialog } from "../settings/MilestoneEditDialog.tsx";
import { Button } from "../ui/Button.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import type { MilestoneWithProgress } from "./model.ts";
import { EXCLUDE_DISCARDED_QUERY, isOverdue, progressState } from "./model.ts";
import { ProgressReadout } from "./ProgressReadout.tsx";

/**
 * The milestone detail — `/milestones/$id` (M4.9).
 *
 * `$id` is the milestone's **ULID**, per decision V3, for the same
 * reason `/sprints/$key` carries one: `MilestoneDef` has no `key`, and
 * a `name` is neither unique nor immutable. P-4 is scoped to UI
 * *content*, so the address bar may carry the id while the page shows
 * the name.
 *
 * ## No `GET /api/milestones/:id`
 *
 * No such route exists, and this ticket does not add one: the detail
 * resolves out of the list the view already fetched. That is not a
 * workaround — it is what makes MSL-38 correct. A 404 from a detail
 * endpoint would arrive as a query *error*, and the not-found state
 * would then have to be told apart from a genuine failure by
 * inspecting an envelope. Resolving from the list means "the fetch
 * succeeded and no milestone has this id" is a plain, unambiguous
 * fact.
 *
 * ## MSL-4's count equality
 *
 * The task list is scoped by the `milestone` param **and** a DSL
 * predicate excluding discarded tasks. Without the predicate the row
 * count is the raw task count while the readout's `total` excludes
 * discarded, so MSL-3's worked example would render 10 rows under a
 * `4 / 8` heading. Measured against a live server: the two agree at 8.
 */
export function MilestoneDetail({ milestoneId }: { readonly milestoneId: string }) {
  const milestones = useMilestonesWithProgress();
  const calendar = useCalendar();
  const info = useInfo();
  const workflow = useWorkflow();
  const search = useSearch({ from: "/milestones/$id" });

  // K100: read-by-default, edit-behind-Edit — the header opens the shared
  // dialog rather than exposing inline fields. `false` is the closed
  // state; on save the dialog invalidates its own query, so the detail
  // view reflects the change without extra wiring here.
  const [editing, setEditing] = useState(false);

  const milestone: MilestoneWithProgress | undefined = useMemo(
    () => (milestones.data?.items ?? []).find(m => m.id === milestoneId),
    [milestones.data, milestoneId],
  );

  // The milestone scope is applied *after* the URL's filters and
  // overwrites any `milestone` param: a hand-edited `?milestone=<other>`
  // must not retarget the page to a milestone the header is not
  // describing.
  //
  // The discarded exclusion is appended to whatever query the URL
  // carries rather than replacing it, so a user's own query still
  // applies — and the row count still matches `total` (MSL-4).
  const params = useMemo(() => {
    const base = tasksParamsFromSearch(search);
    const userQuery = base.query;
    const query = userQuery === undefined || userQuery === ""
      ? EXCLUDE_DISCARDED_QUERY
      : `(${userQuery}) AND ${EXCLUDE_DISCARDED_QUERY}`;
    return { ...base, milestone: [milestoneId], query };
  }, [search, milestoneId]);

  const tasks = useTasks(params);
  const today = info.data?.today ?? new Date().toISOString().slice(0, 10);

  // Only the workflow-derived lookups are used: this table shows
  // status, type and priority, none of which need the project, user or
  // label indexes. Passing empty arrays keeps three list queries off a
  // page that would not render their results.
  const lookups = useMemo(
    () => buildLookups({ projects: [], users: [], labels: [], workflow: workflow.data }),
    [workflow.data],
  );

  if (milestones.isLoading) {
    return (
      <div data-testid="milestone-detail" aria-busy="true" className="p-4">
        <LoadingState className="text-[0.9286rem] text-text-tertiary">Loading the milestone…</LoadingState>
      </div>
    );
  }

  // A failed fetch is not a missing milestone. MSL-38's not-found must
  // be distinguishable from a load failure, so this branch comes first
  // and offers a retry.
  if (milestones.isError) {
    return (
      <div data-testid="milestone-detail" className="p-4">
        <ErrorState
          error={milestones.error}
          context="The milestone could not be loaded."
          onRetry={() => void milestones.refetch()}
        />
      </div>
    );
  }

  // MSL-38: an unknown id gets a designed not-found with a link back,
  // visually distinct from a milestone that exists with zero tasks
  // (MSL-15) — that one renders the full page below, header and all.
  if (milestone === undefined) {
    return (
      <div data-testid="milestone-not-found" className="grid h-full place-items-center p-8">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-lg font-semibold text-text-primary">
            No milestone matches this link
          </h1>
          <p className="mb-1 text-[0.9286rem] text-text-secondary">
            Nothing in{" "}
            <code className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]">
              milestones.yaml
            </code>{" "}
            has the id{" "}
            <code
              data-testid="milestone-not-found-id"
              className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem]"
            >
              {milestoneId}
            </code>
            .
          </p>
          <p className="mb-4 text-[0.9286rem] text-text-tertiary">
            It may have been deleted, or the link may have a typo.
          </p>
          <Link
            to="/milestones"
            data-testid="milestone-not-found-back"
            className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[0.9286rem] font-medium text-accent-contrast no-underline hover:bg-accent-hover"
          >
            Back to milestones
          </Link>
        </div>
      </div>
    );
  }

  const readout = progressState(milestone.progress);
  const overdue = isOverdue(milestone, readout, today);
  const items = tasks.data?.items ?? [];
  const total = tasks.data?.total ?? items.length;

  return (
    <div
      data-testid="milestone-detail"
      data-milestone-id={milestone.id}
      className="flex h-full flex-col gap-3 overflow-auto p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <Link
          to="/milestones"
          data-testid="milestone-detail-back"
          className="text-[0.8571rem] text-text-tertiary no-underline hover:underline"
        >
          ← All milestones
        </Link>
        {/* K100 groundwork: a deep link to the milestones view, where the
            full roster (create, archive, delete, reorder) lives — the
            detail page only edits this one milestone's name and date. */}
        <Link
          to="/milestones"
          data-testid="milestone-detail-manage"
          className="text-[0.8571rem] text-text-tertiary no-underline hover:underline"
        >
          Manage all milestones…
        </Link>
      </div>

      <header className="flex flex-col gap-2 rounded-md border border-border-subtle bg-bg-surface p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {/* MSL-1's rule holds here too: the name, never the ULID —
              which is in the address bar, where P-4 does not reach. */}
          <h1
            data-testid="milestone-detail-name"
            className="text-[1.0714rem] font-semibold text-text-primary"
          >
            {milestone.name}
          </h1>
          <div className="flex items-center gap-2">
            {milestone.archived === true && (
              // MSL-25: an archived milestone's detail route stays
              // reachable with a working task list. It is labelled so
              // the user knows why it is not in the default view.
              <span
                data-testid="milestone-detail-archived"
                className="rounded-full bg-bg-muted px-1.5 py-0.5 text-[0.7143rem] uppercase text-text-tertiary"
              >
                Archived
              </span>
            )}
            {overdue && (
              <span
                data-testid="milestone-detail-overdue"
                className="rounded-full border border-danger-fg/40 px-1.5 py-0.5 text-[0.7143rem] font-semibold uppercase text-danger-fg"
              >
                Overdue
              </span>
            )}
            {readout.complete && (
              <span
                data-testid="milestone-detail-complete"
                className="rounded-full border border-success-fg/40 px-1.5 py-0.5 text-[0.7143rem] font-semibold uppercase text-success-fg"
              >
                Completed
              </span>
            )}
            <span
              data-testid="milestone-detail-date"
              className="text-[0.8571rem] tabular-nums text-text-secondary"
            >
              {formatWorkspaceDate(milestone.target_date, calendar.data)}
            </span>
            {/* K100: an in-place Edit on the detail header, mirroring
                SprintMetaHeader's read-by-default → Edit control, but
                opening the shared MilestoneEditDialog instead of
                header-inline fields. The label names the milestone so the
                accessible name is unambiguous when several controls read
                "Edit" (P-4 / WCAG AA). */}
            <Button
              variant="secondary"
              size="sm"
              testId="milestone-detail-edit"
              aria-label={`Edit ${milestone.name}`}
              onClick={() => { setEditing(true); }}
            >
              Edit
            </Button>
          </div>
        </div>

        {/* The same component the list row renders, so MSL-3's rule is
            stated identically on both surfaces and the denominators
            cannot diverge. */}
        <ProgressReadout
          readout={readout}
          idPrefix="milestone-detail"
          milestoneName={milestone.name}
          onRetry={() => void milestones.refetch()}
        />
      </header>

      <section aria-label="Tasks in this milestone" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[0.9286rem] font-semibold text-text-primary">Tasks</h2>
          {/* MSL-4: this equals the readout's `total`, because the
              query carries the same discarded exclusion the
              denominator uses. */}
          <span
            data-testid="milestone-task-count"
            className="text-[0.8571rem] tabular-nums text-text-tertiary"
          >
            {String(total)}
          </span>
        </div>

        {tasks.isError ? (
          <ErrorState
            error={tasks.error}
            context="The task list could not be loaded."
            onRetry={() => void tasks.refetch()}
          />
        ) : tasks.isLoading ? (
          <LoadingState className="text-[0.9286rem] text-text-tertiary">Loading tasks…</LoadingState>
        ) : items.length === 0 ? (
          // MSL-15/MSL-38: a real milestone with no tasks renders the
          // whole page and says so here. Nothing like the not-found
          // screen above, which is the distinction MSL-38 asks for.
          <p
            data-testid="milestone-tasks-empty"
            className="rounded-md border border-border-subtle bg-bg-surface px-4 py-6 text-center text-[0.9286rem] text-text-tertiary"
          >
            No tasks are assigned to this milestone.
          </p>
        ) : (
          <table className="w-full border-collapse text-[0.9286rem]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-[0.7857rem] uppercase text-text-tertiary">
                <th className="py-1 pr-2 font-medium">Key</th>
                <th className="py-1 pr-2 font-medium">Title</th>
                <th className="py-1 pr-2 font-medium">Status</th>
                <th className="py-1 pr-2 font-medium">Type</th>
                <th className="py-1 font-medium">Priority</th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr
                  key={t.id}
                  data-testid="milestone-task-row"
                  className="border-b border-border-subtle/60"
                >
                  <td className="py-1.5 pr-2 text-[0.8571rem]">
                    <Link
                      to="/tasks/$key"
                      params={{ key: t.key }}
                      className="text-accent no-underline hover:underline"
                    >
                      {t.key}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-2 text-text-primary">{t.title}</td>
                  <td className="py-1.5 pr-2">
                    <StatusBadge def={lookups.status(t.status)} raw={t.status} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <TypeBadge def={lookups.taskType(t.task_type)} raw={t.task_type} />
                  </td>
                  <td className="py-1.5">
                    <PriorityCell def={lookups.priority(t.priority)} raw={t.priority} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* The same dialog MilestonesPanel and the sidebar kebab open.
          `MilestoneWithProgress extends MilestoneDef`, so the resolved
          milestone satisfies `existing` directly — no prop adaptation
          needed. On success the dialog closes and invalidates the
          milestones query, and this page re-reads the updated name/date
          from that refetched list. */}
      {editing && (
        <MilestoneEditDialog
          existing={milestone}
          onClose={() => { setEditing(false); }}
        />
      )}
    </div>
  );
}
