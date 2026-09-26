import { readFile } from "node:fs/promises";

import type { Task, WorkflowConfig } from "@loctt/contracts";

import { getTaskFilePath } from "../paths/index.js";
import { splitTaskFile } from "./frontmatter.js";
import { loadAllTasksDetailed, type UnreadableTask } from "./load-all.js";

/**
 * Progress toward a milestone or sprint.
 *
 * `done / total`, where `total` deliberately **excludes discarded
 * tasks**. A milestone whose remaining work has all been abandoned
 * reads `4 / 4` — complete — rather than stalling below 100% forever
 * because of work nobody intends to do.
 *
 * `discarded` is reported separately so a surface can say so. Silently
 * shrinking a denominator is as confusing as leaving dead work in it;
 * the number needs the explanation next to it.
 */
export interface Progress {
  /** Tasks in a `completed`-category status. */
  readonly done: number;
  /**
   * Tasks in an `active`-category status.
   *
   * Reported so a surface can draw a three-segment bar — done / active /
   * the rest — rather than only done-vs-not. Category-based, never a
   * status key: a tracker may have several `active`-category statuses and
   * may rename them freely, so any rule written against a literal key
   * would count the wrong thing.
   *
   * Like {@link done}, `active` is a subset of {@link total} and never
   * includes discarded tasks. The un-started remainder a bar's third
   * segment fills is `total - done - active` (all non-negative, since
   * each of the three category buckets is disjoint).
   */
  readonly active: number;
  /** Tasks counted toward the goal: everything except discarded. */
  readonly total: number;
  /** Excluded from `total`, reported so the UI can explain the number. */
  readonly discarded: number;
  /**
   * `done / total` as 0–1, or 0 when `total` is 0.
   *
   * A milestone with no tasks is 0%, not 100%: "nothing to do" and
   * "everything done" are different states, and rendering an empty
   * milestone as a full bar would be a lie.
   */
  readonly fraction: number;
}

/**
 * Tallies category buckets from a sequence of status keys.
 *
 * The shared core of {@link computeProgress}: a status key resolves to
 * its category via the config, and `done`/`active`/`discarded` count the
 * `completed`/`active`/`discarded` buckets. A key that is missing or
 * unknown to the config counts toward `total` but toward none of the
 * three named buckets — unrecognised is neither finished, in flight, nor
 * abandoned.
 *
 * Exposed so a surface holding already-resolved status keys (a task
 * detail's child edges, say) computes the same numbers the same way,
 * rather than re-deriving the category rule per surface. `discarded` is
 * returned rather than folded away so the caller applies the same
 * exclusion — `total = count - discarded` — that {@link computeProgress}
 * does.
 */
export function tallyStatusCategories(
  statuses: Iterable<string | undefined>,
  workflow: WorkflowConfig,
): { readonly done: number; readonly active: number; readonly discarded: number; readonly count: number } {
  const category = new Map(workflow.statuses.map(s => [s.key, s.category]));
  let done = 0;
  let active = 0;
  let discarded = 0;
  let count = 0;

  for (const status of statuses) {
    count += 1;
    const cat = status === undefined ? undefined : category.get(status);
    if (cat === "discarded") discarded += 1;
    else if (cat === "completed") done += 1;
    else if (cat === "active") active += 1;
  }

  return { done, active, discarded, count };
}

/** Assembles a {@link Progress} from a category tally. */
function progressFromTally(
  tally: { readonly done: number; readonly active: number; readonly discarded: number; readonly count: number },
): Progress {
  const total = tally.count - tally.discarded;
  return {
    done: tally.done,
    active: tally.active,
    total,
    discarded: tally.discarded,
    fraction: total > 0 ? tally.done / total : 0,
  };
}

/**
 * Progress over a set of already-resolved status keys.
 *
 * The same computation as {@link computeProgress}, for a caller that has
 * status keys rather than `Task` objects in hand — a task detail's tree
 * children, resolved from their edges. Keeps the exclusion rule and the
 * category mapping in one place across all three surfaces.
 */
export function computeProgressFromStatuses(
  statuses: Iterable<string | undefined>,
  workflow: WorkflowConfig,
): Progress {
  return progressFromTally(tallyStatusCategories(statuses, workflow));
}

/**
 * Computes progress from a set of tasks.
 *
 * **Categories, never status keys.** A tracker may have several
 * `completed`-category statuses, may rename `done` to anything, and may
 * delete the key `done` entirely — so any rule written against
 * `status = done` is testing the wrong thing.
 *
 * A task whose status is missing or unknown to the config counts toward
 * `total` but not `done`: unrecognised is not finished.
 */
export function computeProgress(
  tasks: readonly Task[],
  workflow: WorkflowConfig,
): Progress {
  return computeProgressFromStatuses(
    tasks.map(t => t.frontmatter.status),
    workflow,
  );
}

export interface MilestoneProgressOptions {
  /**
   * Include archived tasks. Excluded by default, matching
   * `countTasksByReference` — the two numbers appear side by side in
   * Settings and must not disagree about what they counted.
   */
  readonly includeArchived?: boolean;
}

/**
 * K28 (aggregate half) — progress for every id, *plus* the tasks that
 * could not be read at all.
 *
 * A **field-local** corrupt task is a `Task` and is already counted:
 * a degraded `status` counts toward `total` but not `done`
 * (unrecognised is not finished, per {@link computeProgress}); a
 * degraded `milestone`/`sprint` field simply does not match any id and
 * falls out of every group, which is correct — we cannot attribute it.
 *
 * An **object-fatal** unreadable task is a different matter: it never
 * becomes a `Task`, so it silently vanishes from the corpus scan and
 * every milestone total is short by however many of its members are
 * unreadable — a wrong number with nothing to explain it (P-5). We
 * cannot say which milestone an unreadable file belonged to (its
 * `milestone` field is exactly what we could not read), so the honest
 * report is tracker-level: the counts are of the readable corpus, and
 * `unreadable` names the files a surface must surface alongside them.
 *
 * This mirrors the {@link loadAllTasks}/`loadAllTasksDetailed` split:
 * {@link milestoneProgress} keeps its plain-map shape for the callers
 * that do not report; this variant is for the ones that do.
 */
/**
 * One milestone's progress could not be computed (MSL-35).
 *
 * A per-milestone failure marker: a task attributed to *this* milestone
 * is unreadable, or computing this one group's numbers threw. It stands
 * in place of a `Progress` for the affected milestone **only** — every
 * other id in the same report keeps its real numbers.
 *
 * This is the shape MSL-35's last bullet needs and the old single-scan
 * design could not produce: because the scan bucketed once and computed
 * once, a single failure took down every milestone's numbers together.
 * A milestone that lands here renders the "progress unavailable" error
 * in place of `done / total`, distinct from `0 / 0` (a real empty
 * milestone) and distinct from a whole-list fetch failure.
 */
export interface ProgressUnavailable {
  readonly unavailable: true;
  /** Why — the parse error verbatim, or the computation failure. */
  readonly reason: string;
}

/** Per-milestone: either the real numbers, or a per-row failure marker. */
export type MilestoneProgressResult = Progress | ProgressUnavailable;

/**
 * Narrows a {@link MilestoneProgressResult} to its failure arm. A caller
 * threads the same test through every surface rather than re-deriving
 * "is this the error shape?" from the presence of a field.
 */
export function isProgressUnavailable(
  result: MilestoneProgressResult | undefined,
): result is ProgressUnavailable {
  return result !== undefined && "unavailable" in result && result.unavailable === true;
}

export interface ProgressReport {
  /**
   * Per milestone id: either a computed {@link Progress}, or a
   * {@link ProgressUnavailable} marker when *that* milestone's numbers
   * could not be computed (MSL-35). One milestone's failure never
   * removes another's real numbers.
   */
  readonly progress: Record<string, MilestoneProgressResult>;
  /**
   * Task files that exist but could not be read *and could not be
   * attributed to any one milestone* — reported at the tracker level,
   * not skipped.
   *
   * An unreadable task **is** attributed when its stored `milestone`
   * (or `sprint`) reference can be recovered from the raw file by a
   * lenient scan, in which case that milestone is marked
   * {@link ProgressUnavailable} and the task does *not* appear here.
   * Only the genuinely un-attributable ones remain — a task with a
   * YAML-syntax error deep enough that even the reference line cannot be
   * read, or one that names no milestone at all. See
   * {@link referenceProgressDetailed}.
   */
  readonly unreadable: readonly UnreadableTask[];
}

/** {@link milestoneProgress} with the unreadable tasks reported alongside. */
export async function milestoneProgressDetailed(
  locttDir: string,
  ids: readonly string[],
  workflow: WorkflowConfig,
  options?: MilestoneProgressOptions,
): Promise<ProgressReport> {
  return referenceProgressDetailed(locttDir, "milestone", ids, workflow, options);
}

/** {@link sprintProgress} with the unreadable tasks reported alongside. */
export async function sprintProgressDetailed(
  locttDir: string,
  ids: readonly string[],
  workflow: WorkflowConfig,
  options?: MilestoneProgressOptions,
): Promise<ProgressReport> {
  return referenceProgressDetailed(locttDir, "sprint", ids, workflow, options);
}

/**
 * Progress for each id in `ids`, keyed by id.
 *
 * One corpus scan for the whole list rather than one per milestone:
 * the Milestones view renders every milestone at once, so the
 * per-entity form would be N scans of the same files.
 *
 * Ids with no tasks appear with a zeroed entry rather than being
 * omitted, so a caller can render every milestone without checking for
 * absence.
 */
export async function milestoneProgress(
  locttDir: string,
  ids: readonly string[],
  workflow: WorkflowConfig,
  options?: MilestoneProgressOptions,
): Promise<Record<string, MilestoneProgressResult>> {
  return referenceProgress(locttDir, "milestone", ids, workflow, options);
}

/** Sprint equivalent of {@link milestoneProgress}. */
export async function sprintProgress(
  locttDir: string,
  ids: readonly string[],
  workflow: WorkflowConfig,
  options?: MilestoneProgressOptions,
): Promise<Record<string, MilestoneProgressResult>> {
  return referenceProgress(locttDir, "sprint", ids, workflow, options);
}

async function referenceProgress(
  locttDir: string,
  field: "milestone" | "sprint",
  ids: readonly string[],
  workflow: WorkflowConfig,
  options?: MilestoneProgressOptions,
): Promise<Record<string, MilestoneProgressResult>> {
  return (await referenceProgressDetailed(locttDir, field, ids, workflow, options)).progress;
}

/**
 * Best-effort recovery of an unreadable task's `milestone`/`sprint`
 * reference (MSL-35).
 *
 * An object-fatal task never becomes a `Task`, so its parsed reference
 * is unavailable — but the *bytes* are still on disk. When the file's
 * frontmatter block can be split out and it carries a `milestone:` (or
 * `sprint:`) line naming one of the milestones we are reporting, the
 * unreadable task can be **attributed** to that milestone, which then
 * fails per-row rather than the count silently dropping the member.
 *
 * Deliberately narrow: a single lenient top-level `<field>: <value>`
 * line, unquoted or quoted, no anchors/aliases/flow — enough to catch
 * the common corruptions (a broken date, a bad `status`, a stray tab)
 * that leave the reference line intact, without re-implementing a YAML
 * parser here. When the line cannot be recovered the task stays in the
 * tracker-level `unreadable` list, exactly as before.
 */
function recoverReference(
  raw: string,
  field: "milestone" | "sprint",
  knownIds: ReadonlySet<string>,
): string | undefined {
  let rawYaml: string;
  try {
    rawYaml = splitTaskFile(raw).rawYaml;
  } catch {
    // The frontmatter delimiters themselves are gone — nothing to scan.
    return undefined;
  }
  // A top-level `field: value` line: no leading indentation (nested keys
  // are a different object), the value trimmed of quotes and trailing
  // comment. `m` so `^`/`$` match per line.
  const re = new RegExp(`^${field}:[ \\t]*(.+?)[ \\t]*$`, "m");
  const match = re.exec(rawYaml);
  const value = match?.[1];
  if (value === undefined) return undefined;
  const unquoted = value.replace(/^["']/, "").replace(/["']$/, "").trim();
  return knownIds.has(unquoted) ? unquoted : undefined;
}

async function referenceProgressDetailed(
  locttDir: string,
  field: "milestone" | "sprint",
  ids: readonly string[],
  workflow: WorkflowConfig,
  options?: MilestoneProgressOptions,
): Promise<ProgressReport> {
  const { tasks: all, unreadable } = await loadAllTasksDetailed(locttDir);
  const tasks = options?.includeArchived === true
    ? all
    : all.filter(t => t.frontmatter.archived !== true);

  const knownIds = new Set(ids);
  const byId = new Map<string, Task[]>();
  for (const id of ids) byId.set(id, []);
  for (const t of tasks) {
    const ref = t.frontmatter[field];
    if (typeof ref !== "string") continue;
    byId.get(ref)?.push(t);
  }

  // MSL-35: attribute each unreadable task to a milestone when its
  // reference line can be recovered from the raw file. An attributed
  // milestone fails per-row (its numbers are unavailable) instead of the
  // member vanishing from an otherwise-plausible total; the rest of the
  // milestones are untouched. What cannot be attributed stays reported
  // at the tracker level, as before — the documented sensible default
  // for a task that genuinely names no recoverable milestone (P-5).
  const attributedFailures = new Map<string, string>();
  const orphanedUnreadable: UnreadableTask[] = [];
  for (const u of unreadable) {
    let recovered: string | undefined;
    try {
      const raw = await readFile(getTaskFilePath(locttDir, u.id), "utf-8");
      recovered = recoverReference(raw, field, knownIds);
    } catch {
      recovered = undefined;
    }
    if (recovered !== undefined) {
      // First failure attributed to a milestone names the reason; a
      // later one does not overwrite it — one message is enough to
      // explain why the row cannot be computed. The per-row reason is
      // the only place this file is named (it is kept out of the
      // tracker-level list), and `u.reason` no longer carries the path
      // (A348), so the path is prefixed here — once (A350).
      if (!attributedFailures.has(recovered)) {
        attributedFailures.set(recovered, `${u.path}: ${u.reason}`);
      }
    } else {
      orphanedUnreadable.push(u);
    }
  }

  const progress: Record<string, MilestoneProgressResult> = {};
  for (const [id, group] of byId) {
    // An attributed unreadable member makes this one milestone's numbers
    // unavailable: we cannot honestly say `done / total` when a member
    // could not be read, and we now know which milestone it belonged to.
    const attributed = attributedFailures.get(id);
    if (attributed !== undefined) {
      progress[id] = { unavailable: true, reason: attributed };
      continue;
    }
    // The per-milestone computation is isolated: a failure computing one
    // group's numbers (a future per-group fault) marks that row
    // unavailable rather than throwing out of the whole scan — MSL-35's
    // "one milestone's error in place of its numbers, the others intact".
    try {
      progress[id] = computeProgress(group, workflow);
    } catch (err) {
      progress[id] = {
        unavailable: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return { progress, unreadable: orphanedUnreadable };
}
