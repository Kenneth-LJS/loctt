import type { MilestoneDef } from "@loctt/contracts";

/**
 * The progress shape the server attaches with `?progress=true`.
 *
 * Mirrors core's `Progress` (`packages/core/src/task/progress.ts`).
 * Core does not publish it through `@loctt/contracts`, so it is
 * restated here rather than imported across the package boundary —
 * the *numbers* still come from core, which is what MSL-3's
 * cross-surface consistency actually requires. Nothing in this file
 * computes progress; it only decides how an already-computed
 * `Progress` is presented.
 */
export interface Progress {
  /** Tasks in a `completed`-category status. */
  readonly done: number;
  /**
   * Tasks in an `active`-category status. Optional: the milestone/sprint
   * progress endpoint carries it, but a caller building a `Progress`
   * from resolved status keys (the tree-child meter) may omit it, in
   * which case the readout renders a single fill rather than segments.
   */
  readonly active?: number;
  /** Tasks counted toward the goal: everything except discarded. */
  readonly total: number;
  /** Excluded from `total`, reported so the UI can explain the number. */
  readonly discarded: number;
  /** `done / total` as 0–1, or 0 when `total` is 0. */
  readonly fraction: number;
}

/** A milestone as the list endpoint returns it with `?progress=true`. */
export interface MilestoneWithProgress extends MilestoneDef {
  readonly progress?: Progress;
}

/**
 * How a milestone's numbers should be rendered.
 *
 *  - `none` — no tasks at all. MSL-15: an explicit "No tasks", an
 *    empty bar, and **no percent**, because a percent from a zero
 *    denominator is either `NaN` or a fabricated `0%`.
 *  - `counted` — the ordinary `done / total` readout.
 *
 * A third state, a *failed* computation, is deliberately not here: it
 * is not a property of a `Progress` value but of its absence. See
 * {@link progressState}.
 */
export type ReadoutKind = "none" | "counted" | "unavailable";

export interface Readout {
  readonly kind: ReadoutKind;
  /** `done` — meaningless unless `kind` is `counted`. */
  readonly done: number;
  /** `total` — the denominator, discarded already excluded. */
  readonly total: number;
  /** Discarded tasks, excluded from `total` (MSL-3). */
  readonly discarded: number;
  /** Bar fill, 0–1. Always 0 when there is nothing to fill from. */
  readonly fill: number;
  /**
   * The `active` share of the bar, 0–1, when the source `Progress`
   * carried an `active` count. `undefined` when it did not — the single
   * milestone/sprint fill has no middle segment, and a segmented caller
   * checks for the field's presence rather than treating 0 as "none".
   *
   * `fill` (the done share) and `activeFill` are disjoint and sum to at
   * most 1; the remainder `1 - fill - activeFill` is the un-started
   * track a three-segment bar leaves empty.
   */
  readonly activeFill: number | undefined;
  /** Whole-number percent, or `undefined` when it must be suppressed. */
  readonly percent: number | undefined;
  /** True at `n / n` with `n > 0` (MSL-18). */
  readonly complete: boolean;
}

/**
 * Derives the readout from a milestone's `progress`.
 *
 * **`undefined` is not zero.** MSL-35 turns on this distinction: a
 * progress computation that failed must not render as `0 / 0`, which
 * is indistinguishable from a real empty milestone (MSL-15). The
 * server's `withProgress` currently fills a missing id with a zeroed
 * entry, so this only sees `undefined` when the whole progress read
 * failed — see `useMilestonesProgress`.
 */
export function progressState(progress: Progress | undefined): Readout {
  if (progress === undefined) {
    return {
      kind: "unavailable",
      done: 0,
      total: 0,
      discarded: 0,
      fill: 0,
      activeFill: undefined,
      percent: undefined,
      complete: false,
    };
  }

  const { done, total, discarded, active } = progress;

  // MSL-15: zero denominator. Percent is *suppressed*, not computed —
  // `done / total` here is `0 / 0` = NaN, and `NaN%` is one of the
  // literal strings the case forbids.
  if (total <= 0) {
    return {
      kind: "none",
      done: 0,
      total: 0,
      discarded,
      fill: 0,
      activeFill: undefined,
      percent: undefined,
      // An empty milestone is *not* complete. "Nothing to do" and
      // "everything done" are different states, and a full bar on an
      // empty milestone would be a lie (core says the same).
      complete: false,
    };
  }

  // The bar's fill is derived from the same two numbers the readout
  // shows, rather than from `progress.fraction`. MSL-1 requires the
  // fill proportion to match the numbers shown; reading a separate
  // field is how they drift apart when one of them is stale.
  const fill = done / total;

  // The active segment is present only when the source carried an
  // `active` count — the milestone/sprint endpoint does; a caller that
  // built `Progress` from resolved status keys without it does not, and
  // gets the single-fill bar unchanged. Clamped so a hand-edited corpus
  // where `done + active` momentarily exceeds `total` cannot overflow
  // the track.
  const activeFill = active === undefined
    ? undefined
    : Math.max(0, Math.min(active / total, 1 - fill));

  return {
    kind: "counted",
    done,
    total,
    discarded,
    fill,
    activeFill,
    percent: Math.round(fill * 100),
    complete: done >= total,
  };
}

/**
 * Sort order for the Milestones view.
 *
 * MSL-1 and MSL-16: stable across reloads, by target date, with
 * undated entries in a **defined** position — after all dated ones.
 *
 * The tie-break on `id` is what makes "stable" true rather than
 * likely: two milestones sharing a target date (or both undated) would
 * otherwise keep whatever order the config file happened to yield,
 * and `Array.prototype.sort` is only stable with respect to the input
 * order — which is the config's, and which a settings-panel reorder
 * changes. Ids are ULIDs and unique, so the order is total.
 */
export function compareMilestones(
  a: MilestoneDef,
  b: MilestoneDef,
): number {
  const ad = a.target_date;
  const bd = b.target_date;
  if (ad === undefined && bd !== undefined) return 1;
  if (ad !== undefined && bd === undefined) return -1;
  if (ad !== undefined && bd !== undefined && ad !== bd) {
    return ad < bd ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Sorts a milestone list per {@link compareMilestones}, without mutating. */
export function sortMilestones<T extends MilestoneDef>(
  items: readonly T[],
): readonly T[] {
  return [...items].sort(compareMilestones);
}

/**
 * The sentence stated wherever a milestone number is shown (MSL-3).
 *
 * MSL-3's first bullet is that the readout must not be *ambiguous*:
 * whichever rule applies, the UI says so next to the number. Returning
 * one string from one function is what makes the list, the detail and
 * any sidebar count state it identically — three hand-written captions
 * would eventually disagree, which is the case's last bullet.
 *
 * `undefined` when there is nothing to explain: with no discarded
 * tasks the denominator is simply the task count, and a caption
 * explaining an exclusion that did not happen is noise.
 */
export function discardedNote(readout: Readout): string | undefined {
  if (readout.kind === "unavailable") return undefined;
  if (readout.discarded <= 0) return undefined;
  const n = readout.discarded;
  return `${String(n)} discarded ${n === 1 ? "task is" : "tasks are"} excluded from the total.`;
}

/**
 * The scoped-task-list query that reproduces a milestone's `total`.
 *
 * MSL-4 requires the drill-in row count to equal the readout's
 * `total`. `/api/tasks?milestone=<id>` alone does **not** satisfy it:
 * the endpoint returns discarded tasks, while `progress.total`
 * excludes them, so MSL-3's own worked example (10 tasks, 2 discarded)
 * would show 10 rows under a `4 / 8` readout.
 *
 * `STRUCTURED_FILTER_FIELDS` has no category negation, so the
 * exclusion rides along as a DSL `query` instead — measured against a
 * live server: `?milestone=<id>&query=status.category != discarded`
 * returns exactly 8 for that fixture, matching `total`.
 *
 * Exported so the view and its spec build the same string. Two
 * builders drift, and a drifted one gives a plausible-looking count
 * that is quietly wrong.
 */
export const EXCLUDE_DISCARDED_QUERY = "status.category != discarded";
