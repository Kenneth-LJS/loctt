import type { WorkflowConfig } from "@loctt/contracts";

/**
 * Column derivation for the board (M3.1).
 *
 * **In core, deliberately — K8.** This file used to argue the
 * opposite: that a column is presentation and belongs in the web
 * client because "the CLI and MCP have no notion of a column". Ken's
 * K8 ruling makes that false. A column is a *group of tickets*, and
 * `board_rank` is ordered within a column, not within a status — so
 * "which column is this task in?" is a question the write path in
 * `rank/reorder.ts` has to answer before it can rank anything. Column
 * grouping is therefore part of the ordering model, which is stored on
 * disk and shared, not part of how it is drawn.
 *
 * Keeping it in the client would mean either the caller threads a peer
 * set through every surface, or core re-derives columns its own way
 * and drifts from what the board renders. Both are worse. Every
 * surface — web, CLI, MCP — now agrees on what a column is from one
 * definition.
 *
 * `sortColumn` lives here for the same reason: a column's *sequence*
 * is part of the definition of a column. If core ranked against a peer
 * set ordered differently from what the board draws, a card would not
 * land where it was dropped.
 *
 * Two shapes, per BRD-1 and BRD-2:
 *
 *  - No `workflow.boards` → one column per status, in the order
 *    `workflow.yaml` declares them (BRD-1). Not alphabetical, not by
 *    category — declaration order is the author's intent.
 *  - `workflow.boards.columns` present → those columns, in array
 *    order, each collapsing its `statuses` list (BRD-2).
 *
 * Plus two grouping columns that only appear when they have to, both
 * of which exist because P7 forbids a board that silently shows fewer
 * tasks than the tracker holds:
 *
 *  - **uncovered** (BRD-24): statuses that exist in `workflow.yaml`
 *    but appear in no configured column.
 *  - **orphan** (BRD-18): a `status` on a task that `workflow.yaml`
 *    does not define at all.
 */

/**
 * The task shape column derivation actually needs.
 *
 * Generalized rather than projected (K8): core works in
 * `TaskFrontmatter` and the web client in `TaskFrontmatterPublic`.
 * Both structurally satisfy this, so neither caller has to convert —
 * and a conversion is exactly where the two surfaces would drift.
 */
export interface ColumnTask {
  readonly id: string;
  readonly status?: string | undefined;
  readonly board_rank?: string | undefined;
  readonly created_at: string;
}

/** Where a column came from, so the UI can explain the odd ones. */
export type ColumnKind = "status" | "configured" | "uncovered" | "orphan";

export interface BoardColumn {
  /** Stable identity — React key, chip id, settings key. */
  readonly id: string;
  /** Header text. A status `label`, or the configured column `label`. */
  readonly label: string;
  /**
   * Status keys routed into this column. A card lands here when its
   * stored `status` is in this list.
   */
  readonly statuses: readonly string[];
  readonly kind: ColumnKind;
  /** Passive WIP cap (BRD-6). Absent means "no cap", never zero. */
  readonly wip?: number;
  /**
   * BRD-17: statuses this column *names* that `workflow.yaml` no
   * longer declares. The column still renders; the gap is surfaced.
   */
  readonly missingStatuses?: readonly string[];
  /**
   * BRD-19: two statuses may share a `label`, and keys are the
   * identity. Set when this column's label is ambiguous, so the
   * header can disambiguate with the key rather than showing two
   * identical headers.
   */
  readonly disambiguator?: string;
}

/**
 * Derives the board's columns from workflow config and the tasks in
 * scope.
 *
 * Tasks are an input, not just something bucketed afterwards, because
 * the orphan column (BRD-18) cannot be known from config alone — it
 * exists only if some task carries a status the config dropped.
 */
export function deriveColumns(
  workflow: WorkflowConfig | undefined,
  tasks: readonly ColumnTask[],
): readonly BoardColumn[] {
  const statuses = workflow?.statuses ?? [];
  const labelByKey = new Map(statuses.map(s => [s.key, s.label]));
  // BRD-19: a label shared by two statuses is not an identity. Count
  // labels first so the header can add the key only where it is
  // genuinely ambiguous — appending it everywhere is noise.
  const labelCounts = new Map<string, number>();
  for (const s of statuses) {
    labelCounts.set(s.label, (labelCounts.get(s.label) ?? 0) + 1);
  }

  const configured = workflow?.boards?.columns;
  const columns: BoardColumn[] = [];

  if (configured !== undefined && configured.length > 0) {
    for (const col of configured) {
      // BRD-17: a configured column may name a status that has since
      // been deleted from `statuses`. The column still renders — it
      // may hold other, valid statuses — and the gap is reported
      // rather than logged to a console nobody is reading.
      const missing = col.statuses.filter(s => !labelByKey.has(s));
      columns.push({
        id: col.key,
        label: col.label,
        statuses: col.statuses,
        kind: "configured",
        ...(col.wip !== undefined ? { wip: col.wip } : {}),
        ...(missing.length > 0 ? { missingStatuses: missing } : {}),
      });
    }
  } else {
    // BRD-1: 1:1, in declaration order.
    for (const s of statuses) {
      columns.push({
        id: s.key,
        label: s.label,
        statuses: [s.key],
        kind: "status",
        ...((labelCounts.get(s.label) ?? 0) > 1 ? { disambiguator: s.key } : {}),
      });
    }
  }

  // BRD-24: statuses the configured board does not cover. Their tasks
  // must be accounted for, not silently dropped — the board's total
  // has to agree with the list view's for the same filter.
  const covered = new Set(columns.flatMap(c => c.statuses));
  const uncovered = statuses.filter(s => !covered.has(s.key));
  if (uncovered.length > 0) {
    columns.push({
      id: UNCOVERED_COLUMN_ID,
      label: "Not on this board",
      statuses: uncovered.map(s => s.key),
      kind: "uncovered",
    });
  }

  // BRD-18: a task whose status the config no longer defines. Derived
  // from the tasks rather than the config, because that is the only
  // place the orphan key exists at all.
  const known = new Set([...covered, ...uncovered.map(s => s.key)]);
  const orphanKeys: string[] = [];
  for (const task of tasks) {
    const status = task.status;
    if (status === undefined || known.has(status)) continue;
    if (!orphanKeys.includes(status)) orphanKeys.push(status);
  }
  if (orphanKeys.length > 0) {
    columns.push({
      id: ORPHAN_COLUMN_ID,
      label: "Unknown status",
      statuses: orphanKeys,
      kind: "orphan",
    });
  }

  return columns;
}

/** Reserved ids, so a configured column cannot collide with them. */
export const UNCOVERED_COLUMN_ID = "__uncovered__";
export const ORPHAN_COLUMN_ID = "__orphan__";

/**
 * Buckets tasks into columns by their stored `status` **key**.
 *
 * Matching is on the key, never the label (BRD-1, BRD-19): the label
 * is display text and two statuses may share one.
 *
 * Every task lands in exactly one column — `deriveColumns` guarantees
 * a home for any status a task actually carries, so a task is only
 * dropped here if it has no `status` at all, which the orphan bucket
 * below catches too.
 */
export function bucketTasks<T extends ColumnTask>(
  columns: readonly BoardColumn[],
  tasks: readonly T[],
): ReadonlyMap<string, readonly T[]> {
  const columnByStatus = new Map<string, string>();
  for (const col of columns) {
    for (const status of col.statuses) columnByStatus.set(status, col.id);
  }
  const out = new Map<string, T[]>();
  for (const col of columns) out.set(col.id, []);

  for (const task of tasks) {
    const status = task.status;
    const columnId = status === undefined ? undefined : columnByStatus.get(status);
    if (columnId === undefined) continue;
    out.get(columnId)?.push(task);
  }

  for (const [id, list] of out) out.set(id, sortColumn(list));
  return out;
}

/**
 * Orders a column's cards.
 *
 * `board_rank` is a lexorank: ranked cards sort ascending by it, and
 * unranked cards fall below all ranked ones ordered by creation
 * (BRD-27's documented fallback). The tiebreak chain ends at `id`, so
 * two cards sharing a rank render in the same order on every reload
 * rather than swapping (BRD-29).
 *
 * A rank outside the lexorank alphabet is treated as unranked rather
 * than throwing (BRD-30) — it still renders, and a later drag
 * repairs it.
 */
const LEXORANK = /^[0-9a-z]+$/;

export function sortColumn<T extends ColumnTask>(
  tasks: readonly T[],
): T[] {
  const rankOf = (t: ColumnTask): string | undefined =>
    t.board_rank !== undefined && LEXORANK.test(t.board_rank) ? t.board_rank : undefined;

  return [...tasks].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra < rb ? -1 : 1;
    if (ra !== undefined && rb === undefined) return -1;
    if (ra === undefined && rb !== undefined) return 1;
    // Same rank, or both unranked: creation order, then id. Both are
    // stable across reloads, which is the whole point (BRD-29).
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}
