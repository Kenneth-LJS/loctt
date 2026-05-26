import type {
  HistoryEntry,
  SprintDef,
  StatusCategory,
  Task,
  WorkflowConfig,
} from "@loctt/contracts";

import { loadSprintsConfig } from "../config/sprints.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { readHistory } from "../task/history.js";
import { loadAllTasks } from "../task/load-all.js";

/**
 * Errors thrown by the burndown reader.
 */
export class BurndownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BurndownError";
  }
}

/**
 * What's being summed on the burndown Y axis. Determined by
 * `workflow.yaml#estimation`:
 *
 *  - `tasks`: count of incomplete tasks (estimation disabled, or
 *    custom_enum without weights — categorical values can't be
 *    summed).
 *  - `points` | `hours` | `days` | `custom_numeric`: sum of numeric
 *    `estimate` values. Tasks without an `estimate` contribute 0 to
 *    the sum but still show up as 1 in `incompleteTaskCount`.
 *  - `weighted_enum`: sum of `weights[estimate]` for `custom_enum`
 *    units that have an optional weights map declared.
 */
export type BurndownUnit =
  | "tasks"
  | "points"
  | "hours"
  | "days"
  | "custom_numeric"
  | "weighted_enum";

/** One sample of the remaining series at end-of-day. */
export interface BurndownPoint {
  /** YYYY-MM-DD for the calendar day this sample represents. */
  readonly date: string;
  /** Remaining sum (Y axis). For `unit: "tasks"`, the count. */
  readonly remaining: number;
  /** Count of incomplete tasks in this sprint at end-of-day. */
  readonly incompleteTaskCount: number;
}

/**
 * One sample of the ideal straight-line. Distinct from `BurndownPoint`
 * because the ideal line is interpolated, not counted — so it can carry
 * fractional `remaining` (which is meaningful) but does NOT carry an
 * `incompleteTaskCount` (which would also have to be fractional and
 * has no real meaning).
 */
export interface IdealPoint {
  readonly date: string;
  readonly remaining: number;
}

/** The full burndown response. */
export interface BurndownSeries {
  readonly sprintId: string;
  /** Sprint window start (YYYY-MM-DD). */
  readonly start: string;
  /** Sprint window end (YYYY-MM-DD). */
  readonly end: string;
  /** Y-axis unit; see {@link BurndownUnit}. */
  readonly unit: BurndownUnit;
  /** Optional unit label declared in workflow.yaml#estimation. */
  readonly unitLabel?: string;
  /** Total at sprint start (= series[0].remaining). */
  readonly initialTotal: number;
  /**
   * One sample per day from `start` to `end`, inclusive. Length
   * always matches the window's day count (no skipped days for
   * weekends — UI handles shading separately from data).
   */
  readonly series: readonly BurndownPoint[];
  /**
   * Straight-line ideal: linear from `initialTotal` at `start` down
   * to 0 at `end`. Provided so callers don't have to recompute.
   */
  readonly ideal: readonly IdealPoint[];
}

/**
 * Returns the burndown series for `sprintId`, reconstructed from
 * task history. No daily snapshots are stored on disk — we replay
 * each task's `_history.yaml` to derive its state at each end-of-day
 * in the sprint window.
 *
 * Scope changes are shown as steps: when a task joins a sprint
 * mid-run, the remaining total bumps up on that day. When a task
 * leaves, it bumps down. Hiding scope creep defeats the chart.
 *
 * Throws `BurndownError` when the sprint id is unknown.
 */
export async function readBurndownSeries(
  locttDir: string,
  sprintId: string,
): Promise<BurndownSeries> {
  const [sprintsCfg, workflow] = await Promise.all([
    loadSprintsConfig(locttDir),
    loadWorkflowConfig(locttDir),
  ]);
  const sprint = sprintsCfg.sprints.find(s => s.id === sprintId);
  if (!sprint) {
    throw new BurndownError(`unknown sprint: ${sprintId}`);
  }
  const tasks = await loadAllTasks(locttDir);
  const historiesByTaskId = new Map<string, readonly HistoryEntry[]>();
  await Promise.all(
    tasks.map(async t => {
      historiesByTaskId.set(t.frontmatter.id, await readHistory(locttDir, t.frontmatter.id));
    }),
  );
  return computeBurndown({ sprint, tasks, historiesByTaskId, workflow });
}

interface ComputeBurndownInput {
  readonly sprint: SprintDef;
  readonly tasks: readonly Task[];
  readonly historiesByTaskId: ReadonlyMap<string, readonly HistoryEntry[]>;
  readonly workflow: WorkflowConfig;
}

/**
 * Pure burndown computation. Exposed for unit-testing without disk
 * I/O. See `readBurndownSeries` for the public entry point that
 * loads the inputs from disk.
 */
export function computeBurndown(input: ComputeBurndownInput): BurndownSeries {
  const { sprint, tasks, historiesByTaskId, workflow } = input;
  const unit = determineUnit(workflow);
  const unitLabel = workflow.estimation?.unit_label;
  const statusCategoryByKey = new Map(workflow.statuses.map(s => [s.key, s.category]));
  const weightFor = (estimateValue: unknown): number => {
    return contributionFor(estimateValue, unit, workflow);
  };

  // Per-task replay: for each day in the window, compute whether the
  // task counts as "in the sprint AND incomplete" and what its
  // contribution is.
  const days = enumerateDays(sprint.start_date, sprint.end_date);
  const series: BurndownPoint[] = days.map(date => ({
    date,
    remaining: 0,
    incompleteTaskCount: 0,
  }));

  for (const task of tasks) {
    const history = historiesByTaskId.get(task.frontmatter.id) ?? [];
    const replay = replayTaskState(task, history);
    days.forEach((day, i) => {
      const state = stateAtEndOfDay(replay, day);
      if (state === null) return;
      const cat = state.status === undefined ? undefined : statusCategoryByKey.get(state.status);
      const incomplete = cat !== "completed" && cat !== "discarded";
      if (!state.inSprint || !incomplete) return;
      const contribution = unit === "tasks" ? 1 : weightFor(state.estimate);
      const prev = series[i];
      if (!prev) return;
      series[i] = {
        date: day,
        remaining: prev.remaining + contribution,
        incompleteTaskCount: prev.incompleteTaskCount + 1,
      };
    });
  }

  const initialTotal = series[0]?.remaining ?? 0;
  const ideal = buildIdealLine(days, initialTotal);

  return {
    sprintId: sprint.id,
    start: sprint.start_date,
    end: sprint.end_date,
    unit,
    ...(unitLabel !== undefined ? { unitLabel } : {}),
    initialTotal,
    series,
    ideal,
  };
}

/** Determines the burndown unit from the workflow's estimation config. */
function determineUnit(workflow: WorkflowConfig): BurndownUnit {
  const est = workflow.estimation;
  if (!est || !est.enabled) return "tasks";
  switch (est.unit) {
    case "points":
    case "hours":
    case "days":
    case "custom_numeric":
      return est.unit;
    case "custom_enum":
      return est.weights !== undefined ? "weighted_enum" : "tasks";
  }
}

/**
 * Numeric contribution of a single task's `estimate` value to the
 * burndown total, given the chosen unit. Always non-negative.
 *
 * Silent-zero policy: an unknown enum key (workflow declares
 * `weights: { S, M }` but the task's `estimate` is `"L"`) contributes
 * 0 rather than throwing. Same for unparseable numeric strings ("abc")
 * and absent estimates. The doctor would surface a workflow-vs-task
 * mismatch separately; the burndown reader must never reject because
 * a single task is mis-configured.
 */
function contributionFor(estimate: unknown, unit: BurndownUnit, workflow: WorkflowConfig): number {
  if (unit === "tasks") return 1;
  if (unit === "weighted_enum") {
    if (typeof estimate !== "string") return 0;
    const weights = workflow.estimation?.weights;
    const w = weights?.[estimate];
    return typeof w === "number" && Number.isFinite(w) && w >= 0 ? w : 0;
  }
  // Numeric units: the on-disk `estimate` field is stringified by the
  // task contract (z.union([z.string(), z.number()]).transform), so
  // we always see a string here at runtime. Parse leniently — a
  // non-numeric string contributes 0 rather than failing the read.
  // History entries pre-date the transform on writes, so we also
  // accept raw numbers from history's before/after fields.
  if (typeof estimate === "number" && Number.isFinite(estimate) && estimate >= 0) {
    return estimate;
  }
  if (typeof estimate === "string") {
    const n = Number(estimate);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

interface TaskReplayState {
  readonly inSprint: boolean;
  readonly status: string | undefined;
  readonly estimate: unknown;
  /** ISO timestamp at which this state took effect. */
  readonly at: string;
}

/**
 * Returns the chronological sequence of replay snapshots for a task:
 * one entry per relevant history mutation (sprint change, status
 * change, estimate change) plus the initial "created" state.
 *
 * The created entry uses the task's frontmatter at creation if the
 * history captured it; otherwise it falls back to the current
 * frontmatter, which represents the latest-known state — a
 * reasonable approximation when the history was truncated. Older
 * trackers without a recorded `created` event still produce a
 * coherent series because the latest frontmatter at least pins the
 * end-state correctly.
 */
function replayTaskState(task: Task, history: readonly HistoryEntry[]): readonly TaskReplayState[] {
  const sorted = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Derive the state at task creation by walking BACK from the
  // current frontmatter, undoing each field_change. This gives us
  // the snapshot at `created_at`, which we then walk forward
  // through to materialise every change-of-state moment.
  let curStatus: typeof task.frontmatter.status = task.frontmatter.status;
  let curSprint: typeof task.frontmatter.sprint = task.frontmatter.sprint;
  let curEstimate: typeof task.frontmatter.estimate = task.frontmatter.estimate;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i];
    if (!e || e.kind !== "field_change") continue;
    if (e.field === "status") {
      curStatus = e.before as typeof curStatus;
    } else if (e.field === "sprint") {
      curSprint = e.before as typeof curSprint;
    } else if (e.field === "estimate") {
      curEstimate = e.before as typeof curEstimate;
    }
  }

  // At this point curStatus/curSprint/curEstimate represent the
  // snapshot AT task creation (`created_at`). The forward pass below
  // walks history chronologically to produce one snapshot per
  // relevant change.
  let status: string | undefined = curStatus;
  let estimate: unknown = curEstimate;
  let inSprint = curSprint !== undefined && curSprint !== null && curSprint !== "";

  const snapshots: TaskReplayState[] = [
    { inSprint, status, estimate, at: task.frontmatter.created_at },
  ];

  for (const e of sorted) {
    if (e.kind !== "field_change") continue;
    if (e.field === "status") {
      status = e.after as typeof status;
    } else if (e.field === "sprint") {
      inSprint = e.after !== undefined && e.after !== null && e.after !== "";
    } else if (e.field === "estimate") {
      estimate = e.after;
    } else {
      continue;
    }
    snapshots.push({ inSprint, status, estimate, at: e.timestamp });
  }
  // Defensive: if any history entry has a timestamp earlier than
  // `created_at` (clock skew, manual file edits, time-travelled
  // tests), the array above is out-of-order. `stateAtEndOfDay` does
  // a linear scan with an early break that assumes monotonic order,
  // so re-sort by `at` to keep the contract.
  snapshots.sort((a, b) => a.at.localeCompare(b.at));
  return snapshots;
}

/**
 * Returns the replay state in effect at end-of-day for `day`
 * (treating end-of-day as the instant `${day}T23:59:59.999Z`). The
 * replay snapshots are sorted by `at`; we pick the last one whose
 * timestamp is on-or-before end-of-day, or `null` if the task did
 * not exist yet at that moment.
 */
function stateAtEndOfDay(replay: readonly TaskReplayState[], day: string): TaskReplayState | null {
  const endOfDay = `${day}T23:59:59.999Z`;
  let result: TaskReplayState | null = null;
  for (const snap of replay) {
    if (snap.at <= endOfDay) result = snap;
    else break;
  }
  return result;
}

/**
 * Returns every day in [startDate, endDate] inclusive as YYYY-MM-DD
 * strings. Throws if `endDate < startDate`.
 */
function enumerateDays(startDate: string, endDate: string): readonly string[] {
  if (endDate < startDate) {
    throw new BurndownError(`end_date (${endDate}) is before start_date (${startDate})`);
  }
  const days: string[] = [];
  // Use UTC to avoid DST drift around midnight boundaries. Sprint
  // dates are calendar-day strings, not wall-clock timestamps.
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const dayMs = 86_400_000;
  for (let t = start; t <= end; t += dayMs) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Straight-line ideal: linear from `initialTotal` on day 0 to 0 on
 * the final day. Returned as a `BurndownPoint[]` for shape parity
 * with the actual series. `incompleteTaskCount` on the ideal line is
 * the same proportional ramp — useful only when `unit === "tasks"`.
 */
function buildIdealLine(days: readonly string[], initialTotal: number): readonly IdealPoint[] {
  if (days.length === 0) return [];
  const first = days[0];
  if (days.length === 1 && first !== undefined) {
    return [{ date: first, remaining: 0 }];
  }
  const span = days.length - 1;
  return days.map((day, i) => {
    const value = initialTotal * (1 - i / span);
    return { date: day, remaining: value };
  });
}

// Used by StatusCategory typings; silences "unused import" lint when
// only the type is needed by other files in the package.
export type { StatusCategory };
