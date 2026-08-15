import type { Task, WorkflowConfig } from "@loctt/contracts";

import { loadAllTasks } from "./load-all.js";

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
  const category = new Map(workflow.statuses.map(s => [s.key, s.category]));
  let done = 0;
  let discarded = 0;

  for (const t of tasks) {
    const status = t.frontmatter.status;
    const cat = status === undefined ? undefined : category.get(status);
    if (cat === "discarded") discarded += 1;
    else if (cat === "completed") done += 1;
  }

  const total = tasks.length - discarded;
  return {
    done,
    total,
    discarded,
    fraction: total > 0 ? done / total : 0,
  };
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
): Promise<Record<string, Progress>> {
  return referenceProgress(locttDir, "milestone", ids, workflow, options);
}

/** Sprint equivalent of {@link milestoneProgress}. */
export async function sprintProgress(
  locttDir: string,
  ids: readonly string[],
  workflow: WorkflowConfig,
  options?: MilestoneProgressOptions,
): Promise<Record<string, Progress>> {
  return referenceProgress(locttDir, "sprint", ids, workflow, options);
}

async function referenceProgress(
  locttDir: string,
  field: "milestone" | "sprint",
  ids: readonly string[],
  workflow: WorkflowConfig,
  options?: MilestoneProgressOptions,
): Promise<Record<string, Progress>> {
  const all = await loadAllTasks(locttDir);
  const tasks = options?.includeArchived === true
    ? all
    : all.filter(t => t.frontmatter.archived !== true);

  const byId = new Map<string, Task[]>();
  for (const id of ids) byId.set(id, []);
  for (const t of tasks) {
    const ref = t.frontmatter[field];
    if (typeof ref !== "string") continue;
    byId.get(ref)?.push(t);
  }

  const out: Record<string, Progress> = {};
  for (const [id, group] of byId) {
    out[id] = computeProgress(group, workflow);
  }
  return out;
}
