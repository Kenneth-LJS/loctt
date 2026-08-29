import type { StatusDef } from "@loctt/contracts";
import { Link } from "@tanstack/react-router";

import { StatusBadge } from "../list/cells.tsx";
import type { RelationshipRow as Row } from "./group.ts";

/**
 * One relationship row (REL-1, REL-12, REL-24, REL-26, REL-28, REL-30).
 *
 * ## A dangling target is a row, not a gap
 *
 * REL-24. The read shape says `missing: true` and `resolvedKey: null`
 * for an edge whose target ULID has no task directory. The row renders
 * with an explicit broken treatment naming the id — the id is all
 * there is, and inventing a key for it would be worse than saying so —
 * and it keeps its remove control, because a link the user cannot
 * clean up is the one thing worse than a broken one.
 *
 * ## The remove control is present, not hover-only
 *
 * REL-12's first bullet asks for it on hover *and* on keyboard focus.
 * It is in the DOM at all times and only its opacity changes, so the
 * tab order does not shift as the pointer moves and a screen reader
 * finds it either way. Hiding it with `display: none` until hover
 * would satisfy the sentence about hover and break the one about
 * keyboard.
 *
 * ## Long titles truncate rather than push
 *
 * REL-28's third bullet. `min-w-0` plus `truncate` on the title cell
 * and `shrink-0` on the controls: without the first, a flex child's
 * `min-width: auto` is its content, so a 400-character title makes the
 * row wider than the panel and carries the remove control off the
 * right edge. `title` keeps the full string recoverable.
 */
export function RelationshipRowView({
  row,
  statusOf,
  removing,
  onRemove,
  children,
}: {
  readonly row: Row;
  readonly statusOf: (key: string | undefined) => StatusDef | undefined;
  readonly removing: boolean;
  /**
   * Undefined for a row whose edge is not this task's to remove — a
   * tree descendant, whose edge lives on *its* parent. The control is
   * then absent rather than disabled: a greyed "Remove" implies the
   * action exists here and is momentarily unavailable, which is a
   * different and false claim.
   */
  readonly onRemove: (() => void) | undefined;
  /** Slot for a group-supplied leading control, e.g. a drag handle. */
  readonly children?: React.ReactNode;
}): React.JSX.Element {
  const label = row.missing
    ? `Missing task ${row.target}`
    : `${row.resolvedKey ?? row.target} ${row.resolvedTitle ?? ""}`.trim();

  return (
    <div
      data-testid="relationship-row"
      data-target={row.target}
      data-type={row.type}
      data-missing={row.missing ? "true" : "false"}
      className="group/row flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-muted"
    >
      {children}

      {row.missing ? (
        <span
          data-testid="relationship-broken"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-danger-fg"
        >
          <span aria-hidden="true">⚠</span>
          <span className="truncate">
            Broken link — no task with id{" "}
            <code className="font-mono text-[12px]">{row.target}</code>
          </span>
        </span>
      ) : (
        <>
          {/* REL-1's fourth bullet: the row links to /tasks/$key. */}
          <Link
            to="/tasks/$key"
            params={{ key: row.resolvedKey ?? row.target }}
            title={row.resolvedTitle}
            className="flex min-w-0 flex-1 items-center gap-2 no-underline"
          >
            <span className="shrink-0 font-mono text-[12px] text-text-secondary">
              {row.resolvedKey ?? row.target}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-text-primary">
              {row.resolvedTitle}
            </span>
          </Link>
          <span className="shrink-0">
            <StatusBadge def={statusOf(row.resolvedStatus)} raw={row.resolvedStatus} />
          </span>
        </>
      )}

      {row.duplicates > 1 && (
        /* REL-26's second bullet: the duplicate is flagged, not hidden.
           The panel lists the target once — this says the file holds
           it more than once, which is drift the user can act on. */
        <span
          data-testid="relationship-duplicate"
          title={`${String(row.duplicates)} identical edges of type "${row.type}" point at this target in the task file.`}
          className="shrink-0 rounded border border-dashed border-warning-fg/60 px-1 py-0.5 text-[11px] text-warning-fg"
        >
          ×{row.duplicates} duplicate
        </span>
      )}

      {onRemove !== undefined && (
        <button
          type="button"
          data-testid="relationship-remove"
          disabled={removing}
          onClick={onRemove}
          aria-label={`Remove link to ${label}`}
          title={row.missing ? "Remove this link" : `Remove link to ${label}`}
          className="shrink-0 rounded px-1.5 py-0.5 text-[12px] text-text-tertiary opacity-0 hover:bg-bg-muted hover:text-danger-fg focus-visible:opacity-100 group-hover/row:opacity-100"
        >
          {/* REL-24's third bullet asks for the broken row to offer
              "Remove this link" in those words; an ordinary row says
              "Remove" beside a key that already names what goes. */}
          {row.missing ? "Remove this link" : "Remove"}
        </button>
      )}
    </div>
  );
}
