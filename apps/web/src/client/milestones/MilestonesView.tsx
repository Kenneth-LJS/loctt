import { Link, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useMemo, useState } from "react";

import { useCalendar } from "../api/hooks/useCalendar.ts";
import {
  useMilestonesWithProgress,
  useOrphanedMilestoneTasks,
} from "../api/hooks/useMilestoneProgress.ts";
import { formatWorkspaceDate, NO_TARGET_DATE } from "../dates/workspaceDate.ts";
// K105: the "+ New milestone" affordance opens the SAME shared dialog the
// Settings panel and the sidebar create use (mode="create"), so a
// milestone created from this view cannot drift from one created anywhere
// else. Reading a settings/ component is allowed; this file does not edit it.
import { MilestoneEditDialog } from "../settings/MilestoneEditDialog.tsx";
import { Button } from "../ui/Button.tsx";
import { Chip } from "../ui/Chip.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { Icon } from "../ui/Icon.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import { PageHeader } from "../ui/PageHeader.tsx";
import type { MilestoneWithProgress, Readout } from "./model.ts";
import {
  EXCLUDE_DISCARDED_QUERY,
  progressState,
  sortMilestones,
} from "./model.ts";
import { ProgressReadout } from "./ProgressReadout.tsx";

/**
 * MSL-41: the at-a-glance category breakdown.
 *
 * The `Progress` payload carries `done` (completed-category), `total`
 * (everything except discarded) and `discarded`. From those three the
 * three buckets a reader cares about fall out without a second corpus
 * scan or any new core field: `done`, `remaining = total - done` (the
 * still-open work — pending + active), and `discarded`. This is a
 * *category* breakdown, which is what the case asks for — a
 * per-status-key split would need a shape core does not publish, and
 * building one here would be the second progress implementation MSL-3
 * exists to forbid.
 */
interface Breakdown {
  readonly done: number;
  readonly remaining: number;
  readonly discarded: number;
}

function breakdown(readout: Readout): Breakdown | undefined {
  // Nothing to break down for an empty milestone (MSL-15 already shows
  // "No tasks") or an unavailable computation (MSL-35 shows the error).
  if (readout.kind !== "counted") return undefined;
  return {
    done: readout.done,
    remaining: Math.max(0, readout.total - readout.done),
    discarded: readout.discarded,
  };
}

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
  const navigate = useNavigate();

  // MSL-25 / K121 #1: archived milestones are never shown here. They are
  // listed and restored in Settings → Archived only. Orphan diagnosis
  // below still runs over the WHOLE list, archived included — a task pointing at an archived milestone is resolvable
  // and therefore not an orphan.

  // K105: "+ New milestone" opens the shared create dialog in place (not
  // a form on the Settings page). `false` is the closed state; on success
  // the dialog invalidates the milestones query, so the new row appears
  // here without extra wiring.
  const [creating, setCreating] = useState(false);

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

  // No control changes scope here — archived
  // milestones are simply excluded, unconditionally.
  const visible = useMemo(
    () => sortMilestones(all.filter(m => m.archived !== true)),
    [all],
  );

  if (milestones.isLoading) {
    return (
      <div data-testid="milestones" aria-busy="true" className="p-4">
        <LoadingState className="text-[0.9286rem] text-text-tertiary">Loading milestones…</LoadingState>
      </div>
    );
  }

  // A failed *fetch* is an error with a retry, never the empty state:
  // "the server is down" and "this tracker has no milestones" must be
  // different screens (ERR-1).
  if (milestones.isError) {
    return (
      <div data-testid="milestones-load-error">
        <ErrorState
          error={milestones.error}
          context="Could not load milestones"
          onRetry={() => void milestones.refetch()}
        />
      </div>
    );
  }

  return (
    <div data-testid="milestones" className="flex h-full flex-col gap-3 overflow-auto p-4">
      <PageHeader
        title="Milestones"
        actions={
          <>
            {/* K105: create is a "+ New milestone" affordance opening the
                shared create dialog in place, mirroring the sidebar's
                "+ New project"/"+ New view". Not a deep link to a Settings
                form. */}
            <Button
              variant="secondary"
              size="sm"
              testId="milestones-new"
              onClick={() => { setCreating(true); }}
            >
              <Icon name="plus" />
              New milestone
            </Button>
          </>
        }
      />

      {/* K28 / P-5: task files that could not be read are excluded
          from every milestone's totals (they cannot be attributed to
          one), so the numbers below are short by this many. Naming the
          count keeps a shortened total from being silent — the failure
          mode K28 rules out. */}
      {unreadable.length > 0 && (
        <div
          role="alert"
          data-testid="milestones-unreadable"
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          {unreadable.length} task {unreadable.length === 1 ? "file" : "files"}
          {" "}could not be read. Totals below are short by
          {" "}{unreadable.length}.
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
          className="rounded-md border border-danger-fg/30 bg-danger-fg/5 px-3 py-2 text-[0.8571rem] text-danger-fg"
        >
          <p>
            <strong data-testid="milestones-orphan-count">
              {orphans.data.tasks.length}
            </strong>{" "}
            {orphans.data.tasks.length === 1 ? "task names" : "tasks name"} a
            milestone{" "}
            <code>milestones.yaml</code> doesn't define. Not counted
            toward any milestone below:{" "}
            {orphans.data.ids.map(id => (
              <code
                key={id}
                data-testid="milestones-orphan-id"
                className="mr-1"
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
        // K105: the empty state gives a "+ New milestone" BUTTON that
        // opens the shared create dialog in place — not a prose pointer to
        // a Settings form. Its progress shows up here once created.
        <div
          data-testid="milestones-empty"
          className="flex flex-col items-center gap-3 rounded-md border border-border-subtle bg-bg-surface px-4 py-8 text-center"
        >
          <p className="text-[0.9286rem] text-text-tertiary">
            No milestones found.
          </p>
          <Button
            variant="primary"
            size="sm"
            testId="milestones-empty-new"
            onClick={() => { setCreating(true); }}
          >
            <Icon name="plus" />
            New milestone
          </Button>
        </div>
      ) : (
        <ul data-testid="milestones-rows" className="flex flex-col gap-2">
          {visible.map(m => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              timezone={calendar.data}
              onOpen={() => void navigate({ to: "/milestones/$id", params: { id: m.id } })}
              onRetry={() => void milestones.refetch()}
            />
          ))}
        </ul>
      )}

      {/* K105: the same shared dialog Settings and the sidebar create
          open, in mode="create". On success it closes and invalidates the
          milestones query, so the new milestone appears above without any
          extra wiring here. */}
      {creating && (
        <MilestoneEditDialog
          mode="create"
          onClose={() => { setCreating(false); }}
        />
      )}
    </div>
  );
}

/**
 * Interactive descendants whose own click must NOT be hijacked by the
 * full-card handler (MSL-39). A click that originates inside any of
 * these — the name link, the Retry button, a future affordance — does
 * its own thing; only a click on the inert card body opens the
 * milestone. Selecting by role rather than by testid keeps this correct
 * as controls are added.
 */
const INTERACTIVE_WITHIN_CARD = "a, button, input, select, textarea, label, [role='button']";

function MilestoneRow({
  milestone,
  timezone,
  onOpen,
  onRetry,
}: {
  readonly milestone: MilestoneWithProgress;
  readonly timezone: Parameters<typeof formatWorkspaceDate>[1];
  readonly onOpen: () => void;
  readonly onRetry: () => void;
}) {
  const readout: Readout = progressState(milestone.progress);
  const dated = milestone.target_date !== undefined;
  const bd = breakdown(readout);

  // MSL-39: the whole card opens the milestone, but a click that landed
  // on a nested control (the name link, the Retry button) is that
  // control's, not the card's. `closest` walks up from the actual click
  // target, so a click anywhere inside the name `<Link>` is ignored here
  // and handled by the link's own navigation instead of firing twice.
  const openIfCardClick = (e: MouseEvent<HTMLElement>): void => {
    if ((e.target as Element).closest(INTERACTIVE_WITHIN_CARD) !== null) return;
    onOpen();
  };

  return (
    <li
      data-testid="milestone-row"
      data-milestone-id={milestone.id}
      data-complete={readout.complete ? "true" : "false"}
      // MSL-39: the card announces itself as a link and is keyboard-
      // operable. Enter/Space open it, mirroring a real link/button, so
      // the affordance is not mouse-only.
      role="link"
      tabIndex={0}
      aria-label={`Open ${milestone.name}`}
      onClick={openIfCardClick}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          // Space would otherwise scroll the page; Enter is a plain
          // activation. Neither should double-fire when focus is on an
          // inner control, so honour the same descendant guard.
          if ((e.target as Element).closest(INTERACTIVE_WITHIN_CARD) !== null) return;
          e.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-md border border-border-subtle bg-bg-surface p-3 transition-colors hover:border-border-default hover:bg-bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text-primary)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        {/* MSL-4 / MSL-39: the name is still a real link — keyboard
            focus, middle-click and open-in-new-tab keep working, and it
            carries the ULID (decision V3) since a `name` is neither
            unique nor immutable. The surrounding card is *also*
            clickable (MSL-39); the card handler ignores clicks that
            originate on this link, so the two never double-navigate.
            MSL-1's "never the ULID" governs what is *shown* — the name. */}
        <Link
          to="/milestones/$id"
          params={{ id: milestone.id }}
          data-testid="milestone-open"
          className="text-[1rem] font-medium text-text-primary no-underline hover:underline"
        >
          <span data-testid="milestone-name">{milestone.name}</span>
        </Link>

        <div className="flex items-center gap-2">
          {readout.complete && (
            <span
              data-testid="milestone-complete"
              className="rounded-full border border-success-fg/40 px-1.5 py-0.5 text-[0.7143rem] font-semibold uppercase text-success-fg"
            >
              Completed
            </span>
          )}

          {/* MSL-1 / MSL-16: the date per the workspace calendar, or
              an explicit "No target date". Never blank, never a bare
              dash, never today's date standing in for an absent one.
              K132: no countdown and no overdue indication beside it —
              Ken removed both. */}
          <span
            data-testid="milestone-date"
            data-dated={dated ? "true" : "false"}
            className={[
              "text-[0.8571rem] tabular-nums",
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

      {/* MSL-41: the at-a-glance category breakdown. Only for a counted
          milestone — an empty one already reads "No tasks" and an
          unavailable one shows the error, so a breakdown there would be
          noise or a lie. The discarded chip is shown only when there are
          discarded tasks, matching the discarded note's own suppression. */}
      {bd !== undefined && (
        <div
          data-testid={`milestone-${milestone.id}-breakdown`}
          className="mt-2 flex flex-wrap items-center gap-1.5"
        >
          <Chip variant="count" testId={`milestone-${milestone.id}-breakdown-done`}>
            {bd.done} done
          </Chip>
          <Chip variant="count" testId={`milestone-${milestone.id}-breakdown-remaining`}>
            {bd.remaining} remaining
          </Chip>
          {bd.discarded > 0 && (
            <Chip variant="count" testId={`milestone-${milestone.id}-breakdown-discarded`}>
              {bd.discarded} discarded
            </Chip>
          )}
        </div>
      )}
    </li>
  );
}

/** Re-exported so the detail route builds the same scoped query. */
export { EXCLUDE_DISCARDED_QUERY, NO_TARGET_DATE };
