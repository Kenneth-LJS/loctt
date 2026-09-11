import { Link, useNavigate } from "@tanstack/react-router";
import { type MouseEvent, useMemo, useState } from "react";

import { useCalendar } from "../api/hooks/useCalendar.ts";
import { useInfo } from "../api/hooks/useInfo.ts";
import {
  useMilestonesWithProgress,
  useOrphanedMilestoneTasks,
} from "../api/hooks/useMilestoneProgress.ts";
import { formatWorkspaceDate, NO_TARGET_DATE } from "../dates/workspaceDate.ts";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Chip } from "../ui/Chip.tsx";
import { ErrorState } from "../ui/ErrorState.tsx";
import { LoadingState } from "../ui/LoadingState.tsx";
import type { MilestoneWithProgress, Readout } from "./model.ts";
import {
  EXCLUDE_DISCARDED_QUERY,
  isOverdue,
  progressState,
  sortMilestones,
} from "./model.ts";
import { ProgressReadout } from "./ProgressReadout.tsx";

/**
 * MSL-40: the human countdown to (or past) a target date.
 *
 * Both dates are `YYYY-MM-DD` calendar days in the workspace's frame —
 * `info.today` is the tracker's day, not the browser's — so the diff is
 * a whole-day count taken from the date parts alone. Parsing at UTC noon
 * avoids the midnight-rolls-back-a-day trap `formatWorkspaceDate`
 * documents; since both operands get the same treatment the offset
 * cancels and the day delta is exact.
 *
 * Returns `undefined` for an undated milestone (MSL-40's "degrades
 * cleanly") and for an unparseable date — the date slot still renders
 * the raw/absent value, but there is no countdown to compute.
 *
 * The wording mirrors the case's own examples ("in 5 days" /
 * "3 days overdue"), with "Today" / "Tomorrow" / "Yesterday" as the
 * natural readings of 0 / +1 / -1.
 */
export function milestoneCountdown(
  target: string | undefined,
  today: string,
): string | undefined {
  if (target === undefined || target === "") return undefined;
  const t = Date.parse(`${target.slice(0, 10)}T12:00:00Z`);
  const n = Date.parse(`${today.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(t) || Number.isNaN(n)) return undefined;

  const days = Math.round((t - n) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1) return `in ${String(days)} days`;
  return `${String(-days)} days overdue`;
}

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
  const info = useInfo();
  const navigate = useNavigate();

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
        <LoadingState className="text-[13px] text-text-tertiary">Loading milestones…</LoadingState>
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
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[15px] font-semibold text-text-primary">Milestones</h1>
          {/* MSL-42 (UX-15): the discoverability copy. This *is* where
              milestone progress renders, so the subhead says so plainly
              and points at where milestones are created — closing the
              "a view the user cannot find" gap the case is written
              against. */}
          <p data-testid="milestones-subhead" className="text-[12px] text-text-tertiary">
            Progress toward every milestone. Manage them in{" "}
            <Link
              to="/settings/$section"
              params={{ section: "milestones" }}
              className="underline underline-offset-2"
            >
              Settings → Milestones
            </Link>
            .
          </p>
        </div>
        {archivedCount > 0 && (
          // MSL-25: reveals archived milestones *in the view* without
          // unarchiving them. A checkbox rather than a button so its
          // state is announced, and nothing here writes to
          // `milestones.yaml`. Migrated to the B1 `Checkbox` primitive.
          <label className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <Checkbox
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
          No milestones yet. Create one in{" "}
          <Link
            to="/settings/$section"
            params={{ section: "milestones" }}
            className="underline underline-offset-2"
          >
            Settings → Milestones
          </Link>
          {" "}and its progress will show up here.
        </p>
      ) : (
        <ul data-testid="milestones-rows" className="flex flex-col gap-2">
          {visible.map(m => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              today={today}
              timezone={calendar.data}
              onOpen={() => void navigate({ to: "/milestones/$id", params: { id: m.id } })}
              onRetry={() => void milestones.refetch()}
            />
          ))}
        </ul>
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
  today,
  timezone,
  onOpen,
  onRetry,
}: {
  readonly milestone: MilestoneWithProgress;
  readonly today: string;
  readonly timezone: Parameters<typeof formatWorkspaceDate>[1];
  readonly onOpen: () => void;
  readonly onRetry: () => void;
}) {
  const readout: Readout = progressState(milestone.progress);
  const overdue = isOverdue(milestone, readout, today);
  const dated = milestone.target_date !== undefined;
  const countdown = milestoneCountdown(milestone.target_date, today);
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
      data-overdue={overdue ? "true" : "false"}
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
          className="text-[14px] font-medium text-text-primary no-underline hover:underline"
        >
          <span data-testid="milestone-name">{milestone.name}</span>
        </Link>

        <div className="flex items-center gap-2">
          {milestone.archived === true && (
            <Chip
              variant="neutral"
              shape="pill"
              testId="milestone-archived-badge"
            >
              <span className="text-[10px] uppercase text-text-tertiary">Archived</span>
            </Chip>
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
              dash, never today's date standing in for an absent one.
              MSL-40: a dated milestone also shows a countdown (or an
              overdue duration) beside it; an undated one shows no
              countdown at all rather than a fabricated one. */}
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
          {countdown !== undefined && (
            <span
              data-testid={`milestone-${milestone.id}-countdown`}
              className={[
                "text-[11px] tabular-nums",
                overdue ? "font-semibold text-danger-fg" : "text-text-tertiary",
              ].join(" ")}
            >
              {countdown}
            </span>
          )}
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
