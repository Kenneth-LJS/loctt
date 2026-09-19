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
import { CommentsPanel } from "../comments/CommentsPanel.tsx";
import { buildUserIndex } from "../comments/users.ts";
import { cn } from "../ui/cn.ts";
import { ActivityEntry } from "./ActivityEntry.tsx";
import { BulkRow } from "./BulkRow.tsx";
import { dayHeading, todayIn } from "./days.ts";
import type { DescribeContext } from "./describe.ts";
import { groupActivity } from "./group.ts";

/**
 * The task detail page's Activity/Comments lane (M2.4 — CMT-13..39).
 *
 * ## Three tabs, one lane (K-5 / CMT-18)
 *
 * Comments and activity were two stacked sections. K-5 splits them into
 * a tabbed control — **Comments**, **Activity**, **All** — so the reader
 * chooses one axis without scrolling past the other. This component owns
 * the whole lane: the Comments tab renders `<CommentsPanel>` (the
 * existing comments endpoint, `useComments` — **no new route**, the
 * decided data-path option (a)), and only the Activity/All tabs page the
 * activity feed. The feed itself is `<ActivityFeed>` below, unchanged
 * from the pre-tab section.
 *
 * The active tab is URL-controlled (CMT-18): `TaskDetail` reads it from
 * `?tab=` and passes it in as `tab`, and every switch calls `onTabChange`
 * so the URL records it and the tab is shareable/deep-linkable. When no
 * tab is in the URL, the default is **Comments** (K-5): this panel is the
 * single comments home now that `TaskDetail` no longer renders a
 * standalone Comments `<Section>` (A163), and a task's conversation leads.
 */
export function ActivityPanel({
  taskRef,
  tab: tabProp,
  onTabChange,
  workflow,
  users,
  labels,
  milestones,
  sprints,
  projects,
  calendar,
}: {
  readonly taskRef: string;
  /** The active tab from the URL (`?tab=`); undefined → default (Comments). */
  readonly tab?: Tab;
  /** Called on a tab switch so the caller can record it in the URL. */
  readonly onTabChange?: (tab: Tab) => void;
  readonly workflow: WorkflowConfig | undefined;
  readonly users: readonly UserProfile[];
  readonly labels: readonly LabelDef[];
  readonly milestones: readonly MilestoneDef[];
  readonly sprints: readonly SprintDef[];
  readonly projects: readonly ProjectDef[];
  readonly calendar: CalendarConfig | undefined;
}): React.JSX.Element {
  // The URL is the source of truth when a tab is present; absent → Comments.
  const tab: Tab = tabProp ?? "comments";
  const setTab = (next: Tab): void => onTabChange?.(next);

  const feed = (
    <ActivityFeed
      taskRef={taskRef}
      workflow={workflow}
      users={users}
      labels={labels}
      milestones={milestones}
      sprints={sprints}
      projects={projects}
      calendar={calendar}
    />
  );

  return (
    <div className="space-y-3">
      <SectionTabs value={tab} onChange={setTab} />

      {/*
        Mount-on-activate: only the active tab's content is in the DOM, so
        exactly one comment composer exists at a time (Comments and All
        never mount their <CommentsPanel> simultaneously). A half-typed
        draft does not survive a tab switch — acceptable, and it is what
        keeps a second composer off the page. `data-testid` on the panel
        wrapper stays present regardless so a test can assert the panel
        exists and is `hidden`.
      */}
      <div
        role="tabpanel"
        id="activity-tabpanel-comments"
        aria-labelledby="activity-tab-comments"
        data-testid="activity-tabpanel-comments"
        hidden={tab !== "comments"}
      >
        {tab === "comments" && <CommentsPanel taskRef={taskRef} users={users} />}
      </div>
      <div
        role="tabpanel"
        id="activity-tabpanel-activity"
        aria-labelledby="activity-tab-activity"
        data-testid="activity-tabpanel-activity"
        hidden={tab !== "activity"}
      >
        {tab === "activity" && feed}
      </div>
      <div
        role="tabpanel"
        id="activity-tabpanel-all"
        aria-labelledby="activity-tab-all"
        data-testid="activity-tabpanel-all"
        hidden={tab !== "all"}
      >
        {/*
          "All" stacks the two lanes so a reader who wants both at once
          has them — the shape the page had before the split. Its own
          instances (not shared with the other tabs' nodes).
        */}
        {tab === "all" && (
          <div className="space-y-6">
            <section aria-label="Comments">
              <CommentsPanel taskRef={taskRef} users={users} />
            </section>
            <section aria-label="Activity">
              <ActivityFeed
                taskRef={taskRef}
                workflow={workflow}
                users={users}
                labels={labels}
                milestones={milestones}
                sprints={sprints}
                projects={projects}
                calendar={calendar}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The tab control
 * ------------------------------------------------------------------ */

type Tab = "comments" | "activity" | "all";

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: "comments", label: "Comments" },
  { id: "activity", label: "Activity" },
  { id: "all", label: "All" },
];

/**
 * A `role="tablist"` with three buttons. Left/Right arrows move between
 * tabs (WAI-ARIA tabs pattern); each button carries a **declared**
 * `data-testid` on its own `<button>` (spec §50-56 — declared, not
 * spread) so integration/e2e/vitest can select it.
 */
function SectionTabs({
  value,
  onChange,
}: {
  readonly value: Tab;
  readonly onChange: (t: Tab) => void;
}): React.JSX.Element {
  const move = (dir: 1 | -1) => {
    const i = TABS.findIndex(t => t.id === value);
    const next = TABS[(i + dir + TABS.length) % TABS.length];
    if (next !== undefined) onChange(next.id);
  };

  return (
    <div
      role="tablist"
      aria-label="Activity and comments"
      data-testid="activity-tabs"
      className="flex gap-1 border-b border-border-subtle"
    >
      {TABS.map(t => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`activity-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`activity-tabpanel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            data-testid={`activity-tab-${t.id}`}
            data-active={selected ? "true" : undefined}
            onClick={() => { onChange(t.id); }}
            onKeyDown={e => {
              if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
              if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
            }}
            className={cn(
              "cursor-pointer -mb-px border-b-2 px-3 py-1.5 text-[0.9286rem] font-medium",
              selected
                ? "border-accent text-text-primary"
                : "border-transparent text-text-tertiary hover:text-text-secondary",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The activity feed (unchanged behaviour; formerly the section body)
 * ------------------------------------------------------------------ */

/**
 * The activity feed itself (M2.4b — CMT-13..38).
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
function ActivityFeed({
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
      <p aria-busy="true" className="text-[0.9286rem] text-text-tertiary">
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
        <p role="alert" className="text-[0.9286rem] text-danger-fg">
          {message}
        </p>
        <p className="text-[0.9286rem] text-text-tertiary">
          Fix the file at the path above, then try again. Comments and
          the rest of this task are unaffected.
        </p>
        <button
          type="button"
          data-testid="activity-retry"
          onClick={() => { void activity.refetch(); }}
          className="rounded-md border border-border-subtle px-2.5 py-1.5 text-[0.9286rem] text-text-secondary hover:bg-bg-muted"
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
          <p data-testid="activity-empty" className="text-[0.9286rem] text-text-tertiary">
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
      <p data-testid="activity-scope" className="text-[0.8571rem] text-text-tertiary">
        {entries.length === total
          ? `${String(total)} ${total === 1 ? "entry" : "entries"}`
          : `${String(entries.length)} of ${String(total)} entries`}
      </p>

      {unreadable > 0 && <IncompleteNotice count={unreadable} />}

      {sections.map(section => (
        <section key={section.day} data-testid="activity-day" data-day={section.day}>
          <h3
            data-testid="activity-day-heading"
            className="mb-1 text-[0.8571rem] font-semibold text-text-secondary"
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
          className="text-[0.9286rem] text-danger-fg"
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
          className="rounded-md border border-border-subtle px-2.5 py-1.5 text-[0.9286rem] text-text-secondary hover:bg-bg-muted disabled:opacity-60"
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
      className="text-[0.9286rem] text-warn-fg"
    >
      This list is incomplete: {String(count)}
      {" "}
      {count === 1 ? "entry" : "entries"} in this task’s
      {" "}
      <code className="text-[0.8571rem]">_history.yaml</code>
      {" "}
      could not be read and {count === 1 ? "is" : "are"} not shown.
    </p>
  );
}
