import type { SprintDef } from "@loctt/contracts";

/**
 * The sprints overview's column model (M3.5).
 *
 * Pure, and kept out of the view for the same reason `dragModel.ts`
 * is: ordering, the unknown-sprint grouping, the date/state
 * disagreement and the collapse defaults are all decidable from plain
 * data, and asserting them through a browser is slow and easy to write
 * dishonestly.
 *
 * The board derives its columns in **core**, because `board_rank` is
 * ordered within a column and core's write path has to agree with what
 * the board draws (K8). Nothing equivalent is true here: a sprint
 * column is one `sprint` field value, core needs no notion of "which
 * sprint column is this", and `/sprints` does not rank. So this stays
 * client-side rather than adding an unused core export — the
 * `unarchiveView` pattern CLAUDE.md warns about, in the other
 * direction.
 */

/** The task shape this module needs, and no more. */
export interface SprintTask {
  readonly id: string;
  readonly key: string;
  readonly sprint?: string | undefined;
}

/** The pseudo-column holding tasks with no `sprint` at all (SPR-6). */
export const NO_SPRINT_COLUMN_ID = "__no_sprint__";

/**
 * The pseudo-column prefix for a `sprint` naming an id `sprints.yaml`
 * does not define (SPR-27).
 *
 * One column per dangling id, not one shared "unknown" bucket: SPR-27
 * requires the missing id to be *named*, and two tasks pointing at two
 * different deleted sprints are two different problems.
 */
export const UNKNOWN_SPRINT_PREFIX = "__unknown_sprint__:";

export function unknownColumnId(sprintId: string): string {
  return `${UNKNOWN_SPRINT_PREFIX}${sprintId}`;
}

/** What a column is on this view. */
export type SprintColumnKind = "sprint" | "none" | "unknown";

export interface SprintColumn {
  /** Matches `data-column-id`; the drag resolves columns by it. */
  readonly id: string;
  readonly kind: SprintColumnKind;
  /**
   * Header text.
   *
   * SPR-1: the sprint `name` exactly as `sprints.yaml` writes it —
   * never the ULID, never a slug. For the two pseudo-columns this is a
   * fixed label, and for `unknown` the dangling id appears in the
   * column's body instead, where SPR-27 wants it named.
   */
  readonly label: string;
  /** Present only for `kind: "sprint"`. */
  readonly sprint?: SprintDef;
  /** The dangling id, for `kind: "unknown"` (SPR-27). */
  readonly missingId?: string;
}

/**
 * Whether a sprint column is highlighted as active.
 *
 * SPR-2 and SPR-20 together: this keys off `state` **only**. LocTT
 * performs no automatic transitions, so a sprint whose window has
 * passed while its state still says `active` is active — the dates are
 * surfaced as a hint (see `windowDisagrees`), never as a correction.
 */
export function isActive(sprint: SprintDef): boolean {
  return sprint.state === "active";
}

/**
 * True when the sprint's date window disagrees with its state.
 *
 * SPR-20's second bullet: an `active` sprint whose `end_date` has
 * passed, or (symmetrically) one whose window has not started yet, is
 * an informational hint. Not an error, and nothing rewrites `state`.
 *
 * `today` is the workspace's date from `/api/info`, not the browser's,
 * so this view and the list agree on what "passed" means.
 */
export function windowDisagrees(sprint: SprintDef, today: string): boolean {
  if (sprint.state !== "active") return false;
  return sprint.end_date < today || sprint.start_date > today;
}

/**
 * Whether a column starts expanded (SPR-2), before any persisted
 * per-user override is applied (SPR-3).
 *
 * The two pseudo-columns default open: a task with no sprint, or one
 * pointing at a deleted sprint, is something the user needs to see —
 * collapsing it by default hides exactly the problem SPR-6 and SPR-27
 * exist to surface.
 */
export function defaultExpanded(column: SprintColumn): boolean {
  return column.kind !== "sprint" || isActive(column.sprint as SprintDef);
}

/**
 * The columns, in render order.
 *
 * SPR-1: one column per non-archived sprint, ordered by `start_date`
 * ascending. Ties are broken by the order `sprints.yaml` lists them —
 * a *stable* sort over the config's own array, so a reload cannot
 * shuffle two sprints that share a start date. `Array.prototype.sort`
 * is specified stable, so comparing on `start_date` alone suffices;
 * the id is deliberately NOT a tiebreaker, since a ULID tiebreak would
 * reorder by creation time, which is not what the file says.
 *
 * SPR-19: two sprints whose windows overlap are two ordinary columns.
 * Nothing here treats overlap as exceptional, because the schema
 * permits it.
 *
 * SPR-24: two sprints may share a `name`. They are still two columns
 * keyed on `id`, and the header carries the date window, which is the
 * discriminator the case asks for.
 *
 * The `none` column is appended and the `unknown` columns after it, so
 * the real sprints keep the left of the view and a dangling reference
 * does not push them off screen.
 */
export function deriveSprintColumns(
  sprints: readonly SprintDef[],
  tasks: readonly SprintTask[],
  options: { readonly showArchived?: boolean } = {},
): readonly SprintColumn[] {
  // SPR-1: archived sprints are omitted unless explicitly asked for.
  const visible = options.showArchived === true
    ? [...sprints]
    : sprints.filter(s => s.archived !== true);

  visible.sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));

  const columns: SprintColumn[] = visible.map(s => ({
    id: s.id,
    kind: "sprint" as const,
    label: s.name,
    sprint: s,
  }));

  columns.push({ id: NO_SPRINT_COLUMN_ID, kind: "none", label: "No sprint" });

  // SPR-27: a task pointing at an id no sprint defines must not vanish
  // from every sprint surface. Derived from the tasks, so the column
  // exists only when something actually dangles.
  //
  // Archived sprints count as "known" even when hidden: a task in an
  // archived sprint is filed, not dangling, and showing it as a
  // missing reference would name a sprint that is right there in the
  // file.
  const known = new Set(sprints.map(s => s.id));
  const dangling: string[] = [];
  for (const t of tasks) {
    const id = t.sprint;
    if (id === undefined || id === "") continue;
    if (known.has(id)) continue;
    if (!dangling.includes(id)) dangling.push(id);
  }
  dangling.sort();
  for (const id of dangling) {
    columns.push({
      id: unknownColumnId(id),
      kind: "unknown",
      label: "Unknown sprint",
      missingId: id,
    });
  }

  return columns;
}

/**
 * Tasks per column.
 *
 * SPR-19's second bullet turns on this being a *partition*: a task
 * lands in exactly one column, the one its `sprint` field names, and
 * overlapping date windows have nothing to do with it. A task is never
 * duplicated into two columns, because membership is the stored field
 * and not a date comparison.
 */
export function bucketBySprint<T extends SprintTask>(
  columns: readonly SprintColumn[],
  tasks: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const out = new Map<string, T[]>();
  for (const c of columns) out.set(c.id, []);

  for (const t of tasks) {
    const id = t.sprint;
    if (id === undefined || id === "") {
      out.get(NO_SPRINT_COLUMN_ID)?.push(t);
      continue;
    }
    if (out.has(id)) {
      out.get(id)?.push(t);
      continue;
    }
    // A dangling reference has its own column (SPR-27). A task in an
    // *archived* sprint while "show archived" is off has neither —
    // and must not be swept into "unknown", which would name a sprint
    // that is present in the file and merely hidden. It is out of
    // scope for this rendering, which is what hiding archived means.
    const unknown = unknownColumnId(id);
    out.get(unknown)?.push(t);
  }
  return out;
}
