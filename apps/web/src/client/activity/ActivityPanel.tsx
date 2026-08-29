import type {
  CalendarConfig,
  LabelDef,
  MilestoneDef,
  ProjectDef,
  SprintDef,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";
import { useEffect, useMemo, useState } from "react";

import { ApiError } from "../api/client.ts";
import { useActivity } from "../api/hooks/useActivity.ts";
import { buildUserIndex } from "../comments/users.ts";
import { ActivityEntry } from "./ActivityEntry.tsx";
import { BulkRow } from "./BulkRow.tsx";
import { dayHeading, todayIn } from "./days.ts";
import type { DescribeContext } from "./describe.ts";
import { groupActivity } from "./group.ts";

/**
 * The task detail page's Activity section (M2.4b — CMT-13..38).
 *
 * ## Reverse-chronological, grouped by day, in the workspace timezone
 *
 * CMT-13. The server returns file order reversed, which is
 * newest-first; nothing here re-sorts, which is also what makes
 * CMT-30's stable ordering hold (see `group.ts`). Days are cut with
 * `calendar.yaml`'s timezone so the headings match what the CLI would
 * say, not what the browser's locale would.
 *
 * ## Failures are scoped to this section
 *
 * CMT-37. A corrupt `_history.yaml` gives a 400/500 naming the file
 * and the parse position; that envelope is rendered here rather than
 * paraphrased, and nothing about it reaches the comments, the meta
 * panel or the body — they are separate queries and separate
 * subtrees.
 *
 * When the server *could* read some entries and dropped a malformed
 * one, it returns 200 — the entries render, and the response's
 * `unreadable` count drives the "this list is incomplete" notice
 * (CMT-37's second bullet). That count exists because `total` alone
 * cannot carry it: a file with one broken row and a file with one
 * fewer row are the same number.
 */
export function ActivityPanel({
  taskRef,
  workflow,
  users,
  labels,
  milestones,
  sprints,
  projects,
  calendar,
}: {
  readonly taskRef: string;
  readonly workflow: WorkflowConfig | undefined;
  readonly users: readonly UserProfile[];
  readonly labels: readonly LabelDef[];
  readonly milestones: readonly MilestoneDef[];
  readonly sprints: readonly SprintDef[];
  readonly projects: readonly ProjectDef[];
  readonly calendar: CalendarConfig | undefined;
}): React.JSX.Element {
  const activity = useActivity(taskRef);
  const index = useMemo(() => buildUserIndex(users), [users]);

  /**
   * The workspace timezone, falling back to the browser's only when
   * config has not loaded. Not `"UTC"`: a feed that renders every
   * heading a day off while `calendar.yaml` is in flight is worse than
   * one that briefly matches the reader's own clock.
   */
  const timezone = calendar?.timezone
    ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  /**
   * Frozen per render pass and ticked, rather than read inside the
   * heading: "Today" must not silently become wrong because the page
   * was left open across midnight, and re-reading the clock per
   * heading could put two headings on different sides of the boundary
   * within one paint.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => { setNow(Date.now()); }, 60_000);
    return () => { clearInterval(t); };
  }, []);

  const ctx: DescribeContext = useMemo(
    () => ({ workflow, users, labels, milestones, sprints, projects }),
    [workflow, users, labels, milestones, sprints, projects],
  );

  if (activity.isPending) {
    return (
      <p aria-busy="true" className="text-[13px] text-text-tertiary">
        Loading activity…
      </p>
    );
  }

  /**
   * `isError` alone is wrong here, and measurably so.
   *
   * `useInfiniteQuery` reports `isError` for a failure on *any* page,
   * including the next one — so a failed "Load more" took this branch
   * and replaced the 50 entries already on screen with a full-panel
   * error. That is CMT-38's first bullet inverted ("the already-loaded
   * entries stay on screen"), and it is how this rendered until the
   * CMT-38 spec caught it.
   *
   * So the whole-panel error is for the case where there is nothing to
   * show: the *first* page failed. A later page failing is a smaller
   * event and gets the smaller notice further down, beside the entries
   * it did not replace.
   */
  if (activity.isError && activity.data === undefined) {
    // CMT-37's first bullet. The envelope already names the file and
    // the parse position — showing it beats replacing it with prose
    // that knows less.
    const message = activity.error instanceof ApiError
      ? activity.error.message
      : "The activity for this task could not be read.";
    return (
      <div data-testid="activity-error" className="space-y-2">
        <p role="alert" className="text-[13px] text-danger-fg">
          {message}
        </p>
        <p className="text-[13px] text-text-tertiary">
          Fix the file at the path above, then try again. Comments and
          the rest of this task are unaffected.
        </p>
        <button
          type="button"
          data-testid="activity-retry"
          onClick={() => { void activity.refetch(); }}
          className="rounded-md border border-border-subtle px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-bg-muted"
        >
          Try again
        </button>
      </div>
    );
  }

  const pages = activity.data.pages;
  const entries = pages.flatMap(p => p.entries);
  const total = pages[pages.length - 1]?.total ?? entries.length;
  const today = todayIn(timezone, now);
  const sections = groupActivity(entries, timezone);
  /**
   * CMT-37's second bullet. Rows the server could not interpret are
   * dropped from `entries` *and* from `total`, so without this the
   * feed would present a partial log as complete — which is the
   * specific thing the bullet rules out.
   */
  const unreadable = pages[pages.length - 1]?.unreadable ?? 0;

  if (entries.length === 0) {
    /**
     * CMT-19's second bullet. A task with a genuinely empty
     * `_history.yaml` **says so** rather than rendering an empty box —
     * and it is worth saying that this is unusual, because every task
     * created through LocTT has a `created` entry.
     *
     * A file whose every row is malformed is *not* this state, and
     * saying "no activity has been recorded" there would be false.
     * The incompleteness notice below carries that case.
     */
    return unreadable > 0
      ? <IncompleteNotice count={unreadable} />
      : (
          <p data-testid="activity-empty" className="text-[13px] text-text-tertiary">
            No activity has been recorded for this task. That is unusual —
            a task created through LocTT normally has at least a “created”
            entry in its history file.
          </p>
        );
  }

  return (
    <div className="space-y-3">
      {/*
        CMT-17's first bullet: the scope, stated honestly, in the unit
        pagination actually counts (CMT-25's first bullet — *entries*,
        not the collapsed rows above them).
      */}
      <p data-testid="activity-scope" className="text-[12px] text-text-tertiary">
        {entries.length === total
          ? `${String(total)} ${total === 1 ? "entry" : "entries"}`
          : `${String(entries.length)} of ${String(total)} entries`}
      </p>

      {unreadable > 0 && <IncompleteNotice count={unreadable} />}

      {sections.map(section => (
        <section key={section.day} data-testid="activity-day" data-day={section.day}>
          <h3
            data-testid="activity-day-heading"
            className="mb-1 text-[12px] font-semibold text-text-secondary"
          >
            {dayHeading(section.day, today)}
          </h3>
          <ul className="list-none p-0">
            {section.rows.map(row =>
              row.type === "bulk"
                ? (
                    <BulkRow
                      key={`bulk:${row.bulkOpId}`}
                      row={row}
                      ctx={ctx}
                      users={index}
                      timezone={timezone}
                    />
                  )
                : (
                    <ActivityEntry
                      key={`e:${String(row.index)}`}
                      entry={row.entry}
                      ctx={ctx}
                      users={index}
                      timezone={timezone}
                    />
                  ),
            )}
          </ul>
        </section>
      ))}

      {/*
        CMT-38. A failed page keeps everything above it on screen —
        the entries are still in `data`, and this notice sits beside
        them rather than replacing them. The retry re-requests the
        same offset, because `getNextPageParam` is computed from the
        loaded entries and a failure loaded none.
      */}
      {activity.isFetchNextPageError && (
        <p
          role="alert"
          data-testid="activity-load-more-error"
          className="text-[13px] text-danger-fg"
        >
          The next page of activity could not be loaded. The
          {" "}
          {String(entries.length)}
          {" "}
          entries above are still here; retrying resumes from where
          this stopped.
        </p>
      )}

      {activity.hasNextPage && (
        <button
          type="button"
          data-testid="activity-load-more"
          disabled={activity.isFetchingNextPage}
          onClick={() => { void activity.fetchNextPage(); }}
          className="rounded-md border border-border-subtle px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-bg-muted disabled:opacity-60"
        >
          {activity.isFetchingNextPage
            ? "Loading…"
            : activity.isFetchNextPageError
              ? "Retry loading more"
              : `Load more (${String(total - entries.length)} remaining)`}
        </button>
      )}
    </div>
  );
}

/**
 * "This list is incomplete" — CMT-37's second bullet.
 *
 * Says the count, so the reader knows how much is missing, and names
 * the file rather than only the symptom: the next action is to open
 * `_history.yaml` and fix the rows, which is only actionable if the
 * user is told which file.
 */
function IncompleteNotice({ count }: { readonly count: number }): React.JSX.Element {
  return (
    <p
      role="status"
      data-testid="activity-incomplete"
      className="text-[13px] text-warning-fg"
    >
      This list is incomplete: {String(count)}
      {" "}
      {count === 1 ? "entry" : "entries"} in this task’s
      {" "}
      <code className="font-mono text-[12px]">_history.yaml</code>
      {" "}
      could not be read and {count === 1 ? "is" : "are"} not shown.
    </p>
  );
}
