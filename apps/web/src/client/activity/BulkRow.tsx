import { useState } from "react";

import type { UserIndex } from "../comments/users.ts";
import { ActivityEntry, ActivityTime,Actor } from "./ActivityEntry.tsx";
import type { DescribeContext } from "./describe.ts";
import { describeEntry, KIND_ICONS, KIND_LABELS } from "./describe.ts";
import type { BulkRow as BulkRowData } from "./group.ts";

/**
 * A run of consecutive entries sharing one `bulk_op_id`, as one row
 * (CMT-16).
 *
 * ## The summary says what the operation was, not "3 changes"
 *
 * The case's first bullet asks for "Ken bulk-changed Status on this
 * task, with the shared operation noted". So the row names the actor,
 * says the change was part of a bulk operation, and names the fields
 * it touched — read off the entries, not assumed. A bulk op that
 * touched two fields says both, because a summary naming one would be
 * false about the other.
 *
 * ## Timestamp and actor survive collapsing
 *
 * The fifth bullet, explicitly. A collapsed row that hid *when* it
 * happened would break the day grouping's whole claim — the row sits
 * under a day heading and must say which time within it.
 *
 * ## Expanding is local state
 *
 * CMT-25's third bullet: expanding must not consume a page of the
 * pagination budget or reset the loaded offset. Keeping the disclosure
 * in component state means the query is never touched — there is no
 * path from this `useState` to `useActivity`.
 */
export function BulkRow({
  row,
  ctx,
  users,
  timezone,
}: {
  readonly row: BulkRowData;
  readonly ctx: DescribeContext;
  readonly users: UserIndex;
  readonly timezone: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const first = row.entries[0];
  /**
   * A `BulkRow` is only ever built from a run of two or more (see
   * `groupActivity`), so this cannot be empty in practice. The guard
   * is here rather than a non-null assertion because an assertion
   * would be a claim the type does not carry.
   */
  if (first === undefined) return <li />;

  const kinds = [...new Set(row.entries.map(e => e.kind))];
  const icon = kinds.length === 1 && kinds[0] !== undefined
    ? KIND_ICONS[kinds[0]]
    : "⧉";
  const kindLabel = kinds.length === 1 && kinds[0] !== undefined
    ? KIND_LABELS[kinds[0]]
    : "Bulk";

  return (
    <li
      data-testid="activity-bulk-row"
      data-bulk-op-id={row.bulkOpId}
      data-entry-count={String(row.entries.length)}
      className="py-2"
    >
      <div className="flex gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-bg-muted text-[11px]"
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug text-text-secondary">
            <span className="mr-1.5 rounded bg-bg-muted px-1 py-0.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
              {kindLabel}
            </span>
            <Actor entry={first} users={users} />
            {" "}
            <span data-testid="activity-bulk-summary">
              {summary(row, ctx, users)}
            </span>
            {" "}
            <ActivityTime timestamp={first.timestamp} timezone={timezone} />
          </p>

          <button
            type="button"
            data-testid="activity-bulk-toggle"
            aria-expanded={open}
            onClick={() => { setOpen(o => !o); }}
            className="mt-0.5 rounded text-[12px] text-text-tertiary underline hover:text-text-primary"
          >
            {open
              ? "Hide the individual changes"
              : `Show the ${String(row.entries.length)} individual changes`}
          </button>

          {open && (
            <ul
              data-testid="activity-bulk-entries"
              className="mt-1 list-none border-l border-border-subtle pl-3"
            >
              {row.entries.map((entry, i) => (
                <ActivityEntry
                  // Entries carry no id on disk; within one run the
                  // index is stable because a run only ever grows at
                  // its end as later pages load.
                  key={`${row.bulkOpId}:${String(i)}`}
                  entry={entry}
                  ctx={ctx}
                  users={users}
                  timezone={timezone}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * "bulk-changed Status, as part of an operation across 3 changes".
 *
 * Built from the entries rather than from a stored description,
 * because nothing stores one: `bulk_op_id` is an opaque id and the
 * only account of what the operation did is the entries themselves.
 */
function summary(
  row: BulkRowData,
  ctx: DescribeContext,
  users: UserIndex,
): string {
  const resolve = (id: string): string => users.name(id);
  const fields = [
    ...new Set(
      row.entries.map(e => {
        const d = describeEntry(e, ctx, resolve);
        // A kind with a change pair is named by its field ("Status");
        // one without — an archive, a label — by what it did.
        return d.change?.field ?? d.summary;
      }),
    ),
  ];
  // `fields` is never empty: a bulk row holds at least two entries
  // (see `groupActivity`) and `describeEntry` returns a summary for
  // every kind, so each contributes a string. No empty branch, rather
  // than a branch no input reaches.
  return `bulk-changed ${fields.join(", ")} on this task, `
    + `as part of one operation (${String(row.entries.length)} changes here)`;

}
