import type {
  MilestoneDef,
  SprintDef,
  TaskFrontmatterPublic,
  TimelineGrouping,
  UserProfile,
  WorkflowConfig,
} from "@loctt/contracts";

import { parseDay } from "./geometry.ts";

/**
 * Row grouping for the timeline (M3.3a: TML-5 through TML-8).
 *
 * In the web client rather than core, for the reason `board/columns.ts`
 * states for itself: the CLI and MCP have no notion of a timeline band,
 * and adding one to core for the web's sole benefit is the drift
 * CLAUDE.md names. The *data* being grouped on — milestone, sprint,
 * assignee, status — is all in core already.
 *
 * ## The invariant this module exists to hold
 *
 * TML-7's last bullet: "Switching grouping does not change which tasks
 * are shown — only how they are grouped. The total row count is
 * identical across all groupings."
 *
 * That is only true if every task lands in exactly one band under every
 * grouping, which in turn is only true if each grouping has an explicit
 * band for the *absent* value — "No milestone", "Unassigned", "No
 * sprint". A grouping that quietly drops tasks with no milestone would
 * satisfy a naive reading of TML-6 and break TML-7. So the fallback
 * band is not a nicety; it is what makes the counts agree.
 */

/** One task's row in the chart. */
export interface TimelineRow {
  readonly task: TaskFrontmatterPublic;
  /** Both dates present and parseable — the only rows that get a bar. */
  readonly scheduled: boolean;
}

/** A labelled band of rows. */
export interface TimelineBand {
  /** Stable identity: React key, and the collapsed-state key. */
  readonly id: string;
  readonly label: string;
  readonly rows: readonly TimelineRow[];
}

/**
 * The full row model: bands of scheduled/unscheduled rows, plus the
 * Unscheduled lane pulled out separately.
 */
export interface RowModel {
  readonly bands: readonly TimelineBand[];
  /**
   * TML-5: tasks missing *either* date. Held apart from `bands`
   * because the lane is a distinct surface with its own count, not a
   * band that happens to contain undated tasks.
   */
  readonly unscheduled: readonly TimelineRow[];
}

/** Lookups the labelling needs. Every one is optional while loading. */
export interface RowLookups {
  readonly workflow?: WorkflowConfig | undefined;
  readonly milestones?: readonly MilestoneDef[] | undefined;
  readonly sprints?: readonly SprintDef[] | undefined;
  readonly users?: readonly UserProfile[] | undefined;
}

/** Sentinel id for the "value absent" band of each grouping. */
const NONE = "__none__";

/**
 * TML-5: a task is scheduled only when it has *both* dates. "Only
 * start" and "only due" go to the Unscheduled lane along with "neither"
 * — the case lists all four shapes and puts three of them in the lane.
 *
 * Parseability is part of the test, not just presence: a `due_date` of
 * "not a date" cannot produce a bar, and treating it as scheduled would
 * render a bar at NaN pixels.
 */
export function isScheduled(task: TaskFrontmatterPublic): boolean {
  return parseDay(task.start_date) !== undefined && parseDay(task.due_date) !== undefined;
}

/**
 * Groups tasks into bands.
 *
 * `grouping: "none"` yields a single unlabelled band (TML-8: "puts
 * every task in one flat lane").
 */
export function buildRows(
  tasks: readonly TaskFrontmatterPublic[],
  grouping: TimelineGrouping,
  lookups: RowLookups,
): RowModel {
  const scheduled: TaskFrontmatterPublic[] = [];
  const unscheduled: TimelineRow[] = [];
  for (const t of tasks) {
    if (isScheduled(t)) scheduled.push(t);
    else unscheduled.push({ task: t, scheduled: false });
  }

  const rows = scheduled.map(task => ({ task, scheduled: true }));

  if (grouping === "none") {
    return {
      bands: rows.length > 0 ? [{ id: "all", label: "All tasks", rows }] : [],
      unscheduled,
    };
  }

  const bands =
    grouping === "milestone" ? byMilestone(rows, lookups)
    : grouping === "sprint" ? bySprint(rows, lookups)
    : grouping === "assignee" ? byAssignee(rows, lookups)
    : byStatus(rows, lookups);

  return { bands, unscheduled };
}

/**
 * Buckets rows by a key function, then emits bands in the order
 * `order` gives, with the absent-value band last.
 *
 * Only non-empty bands are emitted: TML-6 says "one band per milestone
 * **that has tasks in scope**", so an empty milestone is not a band.
 */
function bucket(
  rows: readonly TimelineRow[],
  keyOf: (t: TaskFrontmatterPublic) => string,
  order: readonly { id: string; label: string }[],
  noneLabel: string,
): readonly TimelineBand[] {
  const buckets = new Map<string, TimelineRow[]>();
  for (const row of rows) {
    const k = keyOf(row.task);
    const list = buckets.get(k);
    if (list === undefined) buckets.set(k, [row]);
    else list.push(row);
  }

  const bands: TimelineBand[] = [];
  for (const entry of order) {
    const got = buckets.get(entry.id);
    if (got === undefined || got.length === 0) continue;
    bands.push({ id: entry.id, label: entry.label, rows: got });
    buckets.delete(entry.id);
  }

  // Anything `order` did not name — a task pointing at a milestone id
  // that no longer exists, a status key the config dropped. These are
  // emitted rather than discarded, because a dropped row would break
  // TML-7's "the total row count is identical across all groupings"
  // and hide tasks from the user (P7).
  for (const [id, got] of buckets) {
    if (id === NONE || got.length === 0) continue;
    bands.push({ id, label: id, rows: got });
  }

  const none = buckets.get(NONE);
  if (none !== undefined && none.length > 0) {
    bands.push({ id: NONE, label: noneLabel, rows: none });
  }
  return bands;
}

/** TML-6: display label from milestones.yaml, never the slug/id. */
function byMilestone(rows: readonly TimelineRow[], lookups: RowLookups): readonly TimelineBand[] {
  const defs = lookups.milestones ?? [];
  const order = defs.map(m => ({ id: m.id, label: m.name }));
  return bucket(rows, t => t.milestone ?? NONE, order, "No milestone");
}

/**
 * TML-7: "sprint bands use sprint labels and order sprints by start
 * date". Sorted here rather than trusting the API's order, because the
 * case names start date specifically and sprints.yaml is authored by
 * hand.
 */
function bySprint(rows: readonly TimelineRow[], lookups: RowLookups): readonly TimelineBand[] {
  const defs = [...(lookups.sprints ?? [])].sort((a, b) =>
    a.start_date === b.start_date ? a.name.localeCompare(b.name) : a.start_date < b.start_date ? -1 : 1,
  );
  const order = defs.map(s => ({ id: s.id, label: s.name }));
  return bucket(rows, t => t.sprint ?? NONE, order, "No sprint");
}

/**
 * TML-7: "assignee bands show user display names (with `(archived)` on
 * archived users), and unassigned tasks band together explicitly".
 */
function byAssignee(rows: readonly TimelineRow[], lookups: RowLookups): readonly TimelineBand[] {
  const defs = lookups.users ?? [];
  const order = defs.map(u => ({
    id: u.id,
    label: u.archived === true ? `${u.name} (archived)` : u.name,
  }));
  return bucket(rows, t => t.assignee ?? NONE, order, "Unassigned");
}

/**
 * TML-7: "status bands use status `label`s from workflow.yaml in
 * declaration order, never keys".
 *
 * No "No status" band in practice — every task carries a status — but
 * the fallback stays wired so a hand-edited task with the field
 * removed still appears somewhere rather than vanishing.
 */
function byStatus(rows: readonly TimelineRow[], lookups: RowLookups): readonly TimelineBand[] {
  const defs = lookups.workflow?.statuses ?? [];
  const order = defs.map(s => ({ id: s.key, label: s.label }));
  return bucket(rows, t => t.status ?? NONE, order, "No status");
}

/** Total rows across bands plus the lane — TML-7's identical-count check. */
export function totalRows(model: RowModel): number {
  return model.bands.reduce((n, b) => n + b.rows.length, 0) + model.unscheduled.length;
}
