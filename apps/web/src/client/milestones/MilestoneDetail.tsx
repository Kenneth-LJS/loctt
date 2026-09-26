import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useMilestonesWithProgress } from "../api/hooks/useMilestoneProgress.ts";
import { tasksParamsFromSearch, useTasks } from "../api/hooks/useTasks.ts";
import { useWorkflow } from "../api/hooks/useWorkflow.ts";
import { formatWorkspaceDate } from "../dates/workspaceDate.ts";
import { PriorityCell, StatusBadge, TypeBadge } from "../list/cells.tsx";
import { buildLookups } from "../list/lookups.ts";
import { shouldNavigateRow } from "../list/rowNavigation.ts";
import { recordTaskOrigin } from "../router/taskOrigin.ts";
// K100: the detail header's Edit reuses the SAME dialog Settings and the
// point-of-use rows use (fields + validation + `useUpdateMilestone`), so
// an edit from the detail page cannot drift from an edit anywhere else.
// Reading a settings/ component is allowed; this file does not edit it.
import { MilestoneEditDialog } from "../settings/MilestoneEditDialog.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { Tooltip } from "../ui/Tooltip.tsx";
import type { MilestoneWithProgress } from "./model.ts";
import { EXCLUDE_DISCARDED_QUERY, progressState } from "./model.ts";
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
  const workflow = useWorkflow();
  const navigate = useNavigate();
  const search = useSearch({ from: "/milestones/$id" });
  // UI-12: this view's own full URL, so opening one of its tasks can
  // record it as the origin for that task's back affordance — same
  // mechanism ListView uses.
  const currentHref = useRouterState({ select: s => s.location.href });

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
  const items = tasks.data?.items ?? [];
  const total = tasks.data?.total ?? items.length;

  return (
    <div
      data-testid="milestone-detail"
      data-milestone-id={milestone.id}
      className="flex h-full flex-col gap-3 overflow-auto p-4"
    >
      {/* K105: the breadcrumb back to the list is navigation, not a
          settings link, so it stays. The retired "Manage all milestones…"
          text link is gone — reaching the global Settings panel (for
          roster-level actions the edit dialog does not own: reorder,
          remap-delete) now lives in the header kebab below. */}
      <Link
        to="/milestones"
        data-testid="milestone-detail-back"
        className="inline-flex items-center gap-1 self-start text-[0.8571rem] text-text-tertiary no-underline hover:underline"
      >
        <Icon name="arrowLeft" size={12} />
        All milestones
      </Link>

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
            {/* UI-17 / K105: the header used to carry TWO actions — edit
                this milestone, and a "Manage milestones" deep link to the
                global Settings panel. Ken ruled the deep link out
                ("if im on a task, i dont want to see a link to manage
                all tasks. same for milestones/sprints/labels/etc.") —
                the persistent Settings gear already reaches
                Settings → Milestones directly, so nothing is stranded.
                With only Edit left, K105's own rule for a single action
                is a plain IconButton, not a "⋯" kebab of one item. */}
            {/* UI-23e: icon-only, so its name is invisible — a tooltip,
                not `title`. No `describes`: the bubble is a shorter form
                of the `aria-label`, so describing the button with it
                would announce the same thing twice. */}
            <Tooltip label="Edit milestone" align="end">
              <IconButton
                size="sm"
                testId="milestone-detail-edit"
                aria-label={`Edit milestone ${milestone.name}`}
                onClick={() => { setEditing(true); }}
              >
                <Icon name="edit" />
              </IconButton>
            </Tooltip>
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
                  className="cursor-pointer border-b border-border-subtle/60 hover:bg-bg-row-hover"
                  // UI-12: "Whole row clickable" — the same origin this
                  // was first raised about (Ken, while looking at this
                  // exact table). Guarded the same way the main list's
                  // row is (rowNavigation.ts): a drag-selection of the
                  // title, a modifier/middle click, or a click on the
                  // key link itself (which already stops propagation)
                  // all skip this handler rather than double-navigating
                  // or fighting the browser's own new-tab gesture.
                  onClick={e => {
                    if (!shouldNavigateRow(e)) return;
                    recordTaskOrigin(currentHref);
                    void navigate({ to: "/tasks/$key", params: { key: t.key } });
                  }}
                >
                  <td className="py-1.5 pr-2 text-[0.8571rem]">
                    <Link
                      to="/tasks/$key"
                      params={{ key: t.key }}
                      // The row's own click handler already navigates;
                      // this is still a real anchor so the cell keeps
                      // native Enter/keyboard activation and
                      // modifier/middle-click open-in-new-tab, and so it
                      // is the row's one real link rather than a bare
                      // onClick masquerading as one. `stopPropagation`
                      // keeps a plain click from also firing the row's
                      // handler (which would otherwise run `navigate`
                      // twice — harmless but pointless — and would skip
                      // recording the origin only when this branch beat
                      // the row's, an implementation detail no user
                      // should be able to observe).
                      onClick={e => { e.stopPropagation(); recordTaskOrigin(currentHref); }}
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
          mode="edit"
          existing={milestone}
          onClose={() => { setEditing(false); }}
        />
      )}
    </div>
  );
}
