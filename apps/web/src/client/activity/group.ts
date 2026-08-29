import type { HistoryEntry } from "@loctt/contracts";

import { dayKey } from "./days.ts";

/**
 * Turning a flat, reverse-chronological entry list into what the feed
 * renders: day sections, each holding rows, where a run of consecutive
 * entries sharing a `bulk_op_id` is one row.
 *
 * ## Ordering is the server's, and stays the server's
 *
 * CMT-30 asks for entries with the same timestamp to render in a
 * deterministic order that does not reshuffle between renders or
 * across "Load more". The strongest way to get that is **not to
 * sort**: `/api/activity` returns file order reversed, file order is
 * append order, and append order is total even when two timestamps are
 * equal to the millisecond. A comparator on `timestamp` would be
 * *unstable in exactly the case the case is about* — `Array.sort` is
 * specified stable, but a sort applied to page 1 and again to
 * page 1+2 sorts different inputs, so a later page can interleave into
 * an earlier one's ties.
 *
 * So this module preserves input order everywhere and never compares
 * timestamps. That is a claim a test can break: introduce a sort and
 * the same-timestamp entries move.
 *
 * ## Only *consecutive* entries collapse
 *
 * CMT-16's third bullet. The grouping walks the list once and closes
 * the current run whenever the id changes — an unrelated entry between
 * two entries of the same bulk op leaves three rows, not two. Entries
 * with no `bulk_op_id` never join a run (the fourth bullet), which
 * needs an explicit guard rather than falling out of `===`: two
 * `undefined`s are equal.
 *
 * A run of one is a plain row, not a collapsed group of one — a
 * "1 change" disclosure over a single entry is noise, and CMT-16's
 * summary phrasing does not fit it.
 *
 * ## Runs do not cross a day boundary
 *
 * A bulk op is stamped with one timestamp per entry, in practice
 * within milliseconds, but nothing guarantees it. Runs are built
 * inside a day's own row list, so a group can never straddle two
 * headings — which would force the row to render under one day while
 * claiming entries from another.
 */

/** A run of consecutive entries sharing one `bulk_op_id`. */
export interface BulkRow {
  readonly type: "bulk";
  /** The shared operation id — stable, so it keys the row. */
  readonly bulkOpId: string;
  readonly entries: readonly HistoryEntry[];
}

export interface SingleRow {
  readonly type: "single";
  readonly entry: HistoryEntry;
  /**
   * Position in the whole loaded list. Rows carry no natural id —
   * history entries have none on disk — and index is stable for a
   * feed that only ever *appends* (pagination goes forward, never
   * re-sorts), so it keys a row without inventing identity.
   */
  readonly index: number;
}

export type ActivityRow = BulkRow | SingleRow;

export interface DaySection {
  /** `YYYY-MM-DD` in the workspace timezone. */
  readonly day: string;
  readonly rows: readonly ActivityRow[];
}

/**
 * Groups loaded entries into day sections with bulk runs collapsed.
 *
 * `entries` must already be in display order (newest first), which is
 * what the API returns. CMT-17's last bullet — "a day split across two
 * pages renders one heading, not two" — and CMT-25's second bullet —
 * "a bulk group split across a page boundary is not rendered as two
 * separate groups" — both come free from grouping the *accumulated*
 * list rather than per page. That is the reason this takes everything
 * loaded so far and not a page.
 */
export function groupActivity(
  entries: readonly HistoryEntry[],
  timezone: string,
): readonly DaySection[] {
  /**
   * Keyed by day rather than accumulated into a "current" section.
   *
   * CMT-17's last bullet — "a day split across two pages renders one
   * heading, not two" — is the obvious reason, but it is not the only
   * one: `_history.yaml` is *append* order, and `mergeHistory`
   * concatenates two timelines on a git merge, so a file that has been
   * synced can revisit a day it already left. A "close the section
   * when the day changes" walk renders that day twice, which is
   * exactly what the bullet forbids. A map cannot.
   *
   * Insertion order is preserved by `Map`, so the sections still come
   * out in the order their first entry appeared — the server's order,
   * untouched, which is what CMT-30 rests on.
   */
  const byDay = new Map<string, ActivityRow[]>();

  for (const [index, entry] of entries.entries()) {
    const day = dayKey(entry.timestamp, timezone);
    let rows = byDay.get(day);
    if (rows === undefined) {
      rows = [];
      byDay.set(day, rows);
    }

    const id = entry.bulk_op_id;
    const last = rows[rows.length - 1];
    if (
      id !== undefined
      && last !== undefined
      && last.type === "bulk"
      && last.bulkOpId === id
    ) {
      rows[rows.length - 1] = {
        type: "bulk",
        bulkOpId: id,
        entries: [...last.entries, entry],
      };
      continue;
    }
    if (
      id !== undefined
      && last !== undefined
      && last.type === "single"
      && last.entry.bulk_op_id === id
    ) {
      // The run's second entry: promote the preceding single into a
      // group rather than starting a group beside it.
      rows[rows.length - 1] = {
        type: "bulk",
        bulkOpId: id,
        entries: [last.entry, entry],
      };
      continue;
    }
    rows.push({ type: "single", entry, index });
  }

  return [...byDay].map(([day, rows]) => ({ day, rows }));
}
