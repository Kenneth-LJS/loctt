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
 * ## Corrupt is not missing (S4 / corruption sweep)
 *
 * A target can be *corrupt* rather than gone, and the two must not read
 * alike. Three treatments, driven by `missing` × `targetCorrupt`:
 *
 *   - `missing:false`, `targetCorrupt:true` — the tolerant read loaded
 *     the target but it carries health findings (e.g. a wrong-typed
 *     title). The row STILL links (the task opens and can be repaired)
 *     and keeps its key/title, but wears a ⚠ "corrupt" affordance so it
 *     is not mistaken for an ordinary untitled-but-fine row.
 *   - `missing:true`, `targetCorrupt:true` — on disk but object-fatally
 *     unreadable (bad id/key, YAML syntax error). Reads as corrupt, NOT
 *     as the deleted "no task with id" it used to show, so the user
 *     knows there is a file to repair rather than a link to drop.
 *   - `missing:true`, `targetCorrupt:false` — the genuine dangling link.
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
    ? row.targetCorrupt
      ? `Corrupt task ${row.target}`
      : `Missing task ${row.target}`
    : `${row.resolvedKey ?? row.target} ${row.resolvedTitle ?? ""}`.trim();

  // A missing-and-corrupt target is on disk but object-fatally
  // unreadable: corrupt, not deleted. It has no resolvable key/title (the
  // read never produced a Task), so like the dangling case the id is all
  // there is — but the treatment says "corrupt", not "no task with id".
  const missingCorrupt = row.missing && row.targetCorrupt;

  return (
    <div
      data-testid="relationship-row"
      data-target={row.target}
      data-type={row.type}
      data-missing={row.missing ? "true" : "false"}
      data-corrupt={row.targetCorrupt ? "true" : "false"}
      className="group/row flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-muted"
    >
      {children}

      {row.missing ? (
        <span
          data-testid={missingCorrupt ? "relationship-corrupt" : "relationship-broken"}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-danger-fg"
        >
          <span aria-hidden="true">⚠</span>
          <span className="truncate">
            {missingCorrupt ? (
              <>
                Corrupt task — cannot be read; repair its file{" "}
                <code className="font-mono text-[12px]">{row.target}</code>
              </>
            ) : (
              <>
                Broken link — no task with id{" "}
                <code className="font-mono text-[12px]">{row.target}</code>
              </>
            )}
          </span>
        </span>
      ) : (
        <>
          {/* REL-1's fourth bullet: the row links to /tasks/$key. A
              corrupt-but-resolved target still links — the task opens and
              can be repaired — it just carries the marker below. */}
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
          {row.targetCorrupt && (
            /* S4: the target resolved but carries health findings. Mark
               it so a corrupt task is not mistaken for a healthy,
               untitled one. The row keeps its link and key/title. */
            <span
              data-testid="relationship-corrupt"
              title="This linked task has a corrupt field. Open it to see and repair the problem."
              className="flex shrink-0 items-center gap-1 rounded border border-danger-fg/50 px-1 py-0.5 text-[11px] text-danger-fg"
            >
              <span aria-hidden="true">⚠</span>
              <span>corrupt</span>
            </span>
          )}
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
          className="shrink-0 rounded border border-dashed border-warn-fg/60 px-1 py-0.5 text-[11px] text-warn-fg"
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
