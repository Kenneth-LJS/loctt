import type { StatusDef } from "@loctt/contracts";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { StatusBadge } from "../list/cells.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { Menu, MenuItem } from "../ui/Menu.tsx";
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
 * ## The remove control is a persistent kebab in a fixed slot (REL-12, K-4)
 *
 * REL-12 (revised, Ken's ruling) replaces the old hover-only `✕` with a
 * persistent kebab (`⋯`) that lives in a fixed-width slot at the row's
 * trailing edge — always in the DOM, reachable by mouse and by keyboard
 * focus (it is a real `<button>`, never `opacity-0`). Because the slot
 * is always the same width whether or not the row is removable, the
 * label and status pill align across every row (K-4: the old
 * appear/disappear control made adjacent rows' pills jump).
 *
 * Opening the kebab offers **Remove** (with room for future per-link
 * actions). Choosing Remove asks for a brief confirm ("Remove this
 * link?" Remove / Cancel) — a single deliberate step, not a typed
 * confirmation and not an undo-from-toast. This is the *only* remove
 * path; there is no stray hover-`✕`.
 *
 * A row whose edge is not this task's to remove (`onRemove` undefined —
 * a tree descendant, whose edge lives on *its* parent) shows no kebab
 * at all, but still reserves the same fixed slot width so its label and
 * pill line up with the removable rows beside it. A kebab that opened
 * to an empty menu would imply an action exists here and is momentarily
 * unavailable, which is the false claim the old disabled-control note
 * warned against.
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
  const [confirming, setConfirming] = useState(false);

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
          className="flex min-w-0 flex-1 items-center gap-1.5 text-[0.9286rem] text-danger-fg"
        >
          <span aria-hidden="true">⚠</span>
          <span className="truncate">
            {missingCorrupt ? (
              <>
                Corrupt task, cannot be read. Repair its file{" "}
                <code className="text-[0.8571rem]">{row.target}</code>
              </>
            ) : (
              <>
                Broken link. No task with id{" "}
                <code className="text-[0.8571rem]">{row.target}</code>
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
            <span className="shrink-0 text-[0.8571rem] text-text-secondary">
              {row.resolvedKey ?? row.target}
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.9286rem] text-text-primary">
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
              className="flex shrink-0 items-center gap-1 rounded border border-danger-fg/50 px-1 py-0.5 text-[0.7857rem] text-danger-fg"
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
          className="shrink-0 rounded border border-dashed border-warn-fg/60 px-1 py-0.5 text-[0.7857rem] text-warn-fg"
        >
          ×{row.duplicates} duplicate
        </span>
      )}

      {onRemove === undefined ? (
        /* Not this task's edge to remove (a tree descendant). No kebab,
           but the same fixed-width slot so the removable rows' labels
           and pills stay aligned with this one (K-4). */
        <span aria-hidden="true" className="h-7 w-7 shrink-0" />
      ) : (
        <div className="shrink-0">
          <Menu
            align="end"
            aria-label={`Actions for ${label}`}
            trigger={t => (
              <IconButton
                size="sm"
                testId="relationship-kebab"
                aria-label={`Actions for ${label}`}
                aria-haspopup={t["aria-haspopup"]}
                aria-expanded={t["aria-expanded"]}
                id={t.id}
                disabled={removing}
                onClick={t.toggle}
              >
                <Icon name="more" />
              </IconButton>
            )}
          >
            {({ close }) => (
              <MenuItem
                testId="relationship-remove"
                className="text-danger-fg hover:text-danger-fg"
                onSelect={() => {
                  // Open the confirm, then close the menu — a single
                  // deliberate step stands between the click and the
                  // write (REL-12).
                  setConfirming(true);
                  close();
                }}
              >
                {/* REL-24's third bullet asks the broken row to offer
                    "Remove this link" in those words; an ordinary row
                    says "Remove" beside a key that already names what
                    goes. */}
                {row.missing ? "Remove this link" : "Remove"}
              </MenuItem>
            )}
          </Menu>

          {confirming && (
            <Dialog
              testId="relationship-remove-confirm"
              title="Remove this link?"
              description={
                row.missing
                  ? "The dangling link will be removed from this task."
                  : `The link to ${label} will be removed from both tasks.`
              }
              onClose={() => { setConfirming(false); }}
              actions={
                <DialogActions>
                  <Button
                    variant="secondary"
                    testId="relationship-remove-cancel"
                    onClick={() => { setConfirming(false); }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    testId="relationship-remove-confirm-button"
                    disabled={removing}
                    onClick={() => {
                      // The confirm closes here; the panel refetch is
                      // what makes the row disappear. Leaving it open on
                      // a rejected write would trap the user behind a
                      // dialog over an error that renders on the group.
                      setConfirming(false);
                      onRemove();
                    }}
                  >
                    Remove
                  </Button>
                </DialogActions>
              }
            >
              {null}
            </Dialog>
          )}
        </div>
      )}
    </div>
  );
}
