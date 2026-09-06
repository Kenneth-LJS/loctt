import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import {
  useMilestonesWithProgress,
  useOrphanedMilestoneTasks,
} from "../api/hooks/useMilestoneProgress.ts";
import { formatWorkspaceDate, NO_TARGET_DATE } from "../dates/workspaceDate.ts";
import { ErrorState } from "../ui/ErrorState.tsx";
import type { MilestoneWithProgress, Readout } from "./model.ts";
import {
  EXCLUDE_DISCARDED_QUERY,
  isOverdue,
  progressState,
  sortMilestones,
} from "./model.ts";
import { ProgressReadout } from "./ProgressReadout.tsx";

/**
 * The Milestones view — `/milestones` (M4.9).
 *
 * **Distinct from Settings → Milestones (M4.3)**, which is CRUD
 * management. This is a progress surface: it does not create, rename,
 * archive or delete anything.
 *
 * Every number rendered here comes from core via `?progress=true`.
 * Nothing on this page counts tasks itself — MSL-3's cross-surface
 * consistency is a property of there being one implementation, and a
 * second one here would be the drift the case is written against.
 */
export function MilestonesView() {
  const milestones = useMilestonesWithProgress();
  const calendar = useCalendar();
  const info = useInfo();

  // MSL-25: archived milestones are excluded from the default view and
  // revealed by an affordance that does **not** unarchive them —
  // this is a local view toggle, not a write.
  const [showArchived, setShowArchived] = useState(false);

  const all: readonly MilestoneWithProgress[] = useMemo(
    () => milestones.data?.items ?? [],
    [milestones.data],
  );

  // MSL-24: the orphan diagnosis. Runs against the *whole* list,
  // archived included — a task pointing at an archived milestone is
  // resolvable and therefore not an orphan.
  const orphans = useOrphanedMilestoneTasks(
    milestones.data === undefined ? undefined : all,
  );

  // K28 / P-5: task files core could not read. They cannot be
  // attributed to any milestone (their `milestone` field is what failed
  // to parse), so the totals below count only the readable corpus and
  // are short by this many. Surfacing the count — rather than showing a
  // silently-shortened done/total — is exactly what K28 requires; the
  // sibling Sprints view surfaces the same via /api/tasks.
  const unreadable = milestones.data?.unreadable ?? [];

  const archivedCount = all.filter(m => m.archived === true).length;

  const visible = useMemo(
    () => sortMilestones(all.filter(m => showArchived || m.archived !== true)),
    [all, showArchived],
  );

  // The tracker's date, not the browser's: two users in different
  // zones must not disagree about which milestones are overdue, and
  // the CLI has no browser to ask.
  const today = info.data?.today ?? new Date().toISOString().slice(0, 10);

  if (milestones.isLoading) {
    return (
      <div data-testid="milestones" aria-busy="true" className="p-4">
        <p className="text-[13px] text-text-tertiary">Loading milestones…</p>
      </div>
    );
  }

  // A failed *fetch* is an error with a retry, never the empty state:
  // "the server is down" and "this tracker has no milestones" must be
  // different screens (ERR-1).
  if (milestones.isError) {
    return (
      <div data-testid="milestones-load-error" className="p-4">
        <ErrorState
          error={milestones.error}
          context="Could not load milestones"
          onRetry={() => void milestones.refetch()}
        />
      </div>
    );
  }

  return (
    <div data-testid="milestones" className="flex h-full flex-col gap-4 overflow-auto p-4">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-[15px] font-semibold text-text-primary">Milestones</h1>
        {archivedCount > 0 && (
          // MSL-25: reveals archived milestones *in the view* without
          // unarchiving them. A checkbox rather than a button so its
          // state is announced, and nothing here writes to
          // `milestones.yaml`.
          <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <input
              type="checkbox"
              data-testid="milestones-show-archived"
              checked={showArchived}
              onChange={e => { setShowArchived(e.target.checked); }}
            />
            Show archived ({archivedCount})
          </label>
        )}
      </header>

      {/* K28 / P-5: task files that could not be read are excluded
          from every milestone's totals (they cannot be attributed to
          one), so the numbers below are short by this many. Naming the
          count keeps a shortened total from being silent — the failure
          mode K28 rules out. */}
      {unreadable.length > 0 && (
        <div
          role="alert"
          data-testid="milestones-unreadable"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg"
        >
          {unreadable.length} task {unreadable.length === 1 ? "file" : "files"}
          {" "}could not be read, so the totals below are short by
          {" "}{unreadable.length === 1 ? "it" : "them"}. Check the file.
        </div>
      )}

      {/* MSL-24: tasks pointing at an id `milestones.yaml` does not
          define. They are absent from every milestone's counts — core
          drops them — so without this they vanish silently, which is
          the case's named failure mode. The dangling id is named so
          the user can find it on disk. */}
      {orphans.data !== undefined && orphans.data.tasks.length > 0 && (
        <div
          role="alert"
          data-testid="milestones-orphans"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[12px] text-danger-fg"
        >
          <p>
            <strong data-testid="milestones-orphan-count">
              {orphans.data.tasks.length}
            </strong>{" "}
            {orphans.data.tasks.length === 1 ? "task names" : "tasks name"} a
            milestone that{" "}
            <code className="font-mono">milestones.yaml</code> does not define,
            so {orphans.data.tasks.length === 1 ? "it is" : "they are"} counted
            toward no milestone below:{" "}
            {orphans.data.ids.map(id => (
              <code
                key={id}
                data-testid="milestones-orphan-id"
                className="mr-1 font-mono"
              >
                {id}
              </code>
            ))}
          </p>
          <p className="mt-1 text-text-secondary">
            {orphans.data.tasks.map(t => t.key).join(", ")}
          </p>
        </div>
      )}

      {visible.length === 0 ? (
        <p
          data-testid="milestones-empty"
          className="rounded-md border border-border-subtle bg-bg-surface px-4 py-6 text-center text-[13px] text-text-tertiary"
        >
          No milestones yet.{" "}
          <Link
            to="/settings/$section"
            params={{ section: "milestones" }}
            className="underline underline-offset-2"
          >
            Settings → Milestones
          </Link>
        </p>
      ) : (
        <ul data-testid="milestones-rows" className="flex flex-col gap-2">
          {visible.map(m => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              today={today}
              timezone={calendar.data}
              onRetry={() => void milestones.refetch()}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function MilestoneRow({
  milestone,
  today,
  timezone,
  onRetry,
}: {
  readonly milestone: MilestoneWithProgress;
  readonly today: string;
  readonly timezone: Parameters<typeof formatWorkspaceDate>[1];
  readonly onRetry: () => void;
}) {
  const readout: Readout = progressState(milestone.progress);
  const overdue = isOverdue(milestone, readout, today);
  const dated = milestone.target_date !== undefined;

  return (
    <li
      data-testid="milestone-row"
      data-milestone-id={milestone.id}
      data-overdue={overdue ? "true" : "false"}
      data-complete={readout.complete ? "true" : "false"}
      className="rounded-md border border-border-subtle bg-bg-surface p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* MSL-4: clicking the row opens the milestone's task list.
            The link carries the ULID (decision V3) — a `name` is
            neither unique nor immutable, so a name-based URL would
            break on rename. MSL-1's "never the ULID" governs what is
            *shown*, which is the name below. */}
        <Link
          to="/milestones/$id"
          params={{ id: milestone.id }}
          data-testid="milestone-open"
          className="text-[14px] font-medium text-text-primary no-underline hover:underline"
        >
          <span data-testid="milestone-name">{milestone.name}</span>
        </Link>

        <div className="flex items-center gap-2">
          {milestone.archived === true && (
            <span
              data-testid="milestone-archived-badge"
              className="rounded-full bg-bg-muted px-1.5 py-0.5 text-[10px] uppercase text-text-tertiary"
            >
              Archived
            </span>
          )}

          {/* MSL-17: the overdue indication does not rely on colour
              alone — it is a word. MSL-18: a 100% milestone with a
              past date reads completed, and `isOverdue` returns false
              for it, so the two are mutually exclusive by
              construction rather than by ordering here. */}
          {overdue && (
            <span
              data-testid="milestone-overdue"
              className="rounded-full border border-danger-fg/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger-fg"
            >
              Overdue
            </span>
          )}
          {readout.complete && (
            <span
              data-testid="milestone-complete"
              className="rounded-full border border-success-fg/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-success-fg"
            >
              Completed
            </span>
          )}

          {/* MSL-1 / MSL-16: the date per the workspace calendar, or
              an explicit "No target date". Never blank, never a bare
              dash, never today's date standing in for an absent one. */}
          <span
            data-testid="milestone-date"
            data-dated={dated ? "true" : "false"}
            className={[
              "text-[12px] tabular-nums",
              dated ? "text-text-secondary" : "text-text-tertiary italic",
            ].join(" ")}
          >
            {formatWorkspaceDate(milestone.target_date, timezone)}
          </span>
        </div>
      </div>

      <div className="mt-2">
        <ProgressReadout
          readout={readout}
          // Namespaced by id: every row renders one of these, and a
          // bare shared prefix would make every progress locator
          // resolve to N elements under strict mode.
          idPrefix={`milestone-${milestone.id}`}
          milestoneName={milestone.name}
          onRetry={onRetry}
        />
      </div>
    </li>
  );
}

/** Re-exported so the detail route builds the same scoped query. */
export { EXCLUDE_DISCARDED_QUERY, NO_TARGET_DATE };
