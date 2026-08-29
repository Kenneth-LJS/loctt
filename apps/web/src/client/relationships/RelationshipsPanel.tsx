import type {
  ResolvedRelationshipResponse,
  StatusDef,
  TaskFrontmatterPublic,
  WorkflowConfig,
} from "@loctt/contracts";
import { useMemo, useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  useLinkTask,
  useRerankRelationship,
  useUnlinkTask,
} from "../api/hooks/useRelationships.ts";
import type { RelationshipGroup, RelationshipRow } from "./group.ts";
import { groupRelationships } from "./group.ts";
import { LinkPicker } from "./LinkPicker.tsx";
import { RelationshipRowView } from "./RelationshipRow.tsx";
import type { TaskIndex } from "./tree.ts";
import { buildTree, hasCycle } from "./tree.ts";
import { TreeRows } from "./TreeRows.tsx";

/**
 * The task detail page's Relationships section (M2.5a).
 *
 * ## Everything renders from the file, nothing from an intent
 *
 * No optimistic rows. See `useRelationships.ts` for why: a link is two
 * file writes and either can fail, and REL-42 requires the panel to
 * show what is actually on disk when the second one does. So the panel
 * is a function of the last response, and every write invalidates.
 *
 * ## Failures land at the control, not in a toast
 *
 * P4 and REL-22's fourth bullet. A rejected add renders inside the
 * picker, keeping the typed target; a rejected remove renders on the
 * group the row belonged to; a rejected reorder renders on the group
 * and the row snaps back, because nothing moved it but the pointer.
 * The server's messages are good — the cycle refusal names the path in
 * keys — so they are shown verbatim rather than paraphrased.
 *
 * ## Reordering is per-group and drag-or-keyboard
 *
 * REL-13..15. Only a `ranked: true` kind gets handles. A drop sends
 * one `before` / `after` against the neighbour it landed next to; core
 * computes the lexorank, rewrites **only** the moved edge, and
 * rebalances the window itself when the string would get too long
 * (REL-31 — invisible from here by design, which is what that case
 * asks for).
 */
export function RelationshipsPanel({
  taskRef,
  taskId,
  taskKey,
  taskTitle,
  taskKeyHistory,
  relationships,
  stored,
  workflow,
  statusOf,
  taskIndex,
}: {
  readonly taskRef: string;
  readonly taskId: string;
  readonly taskKey: string;
  readonly taskTitle: string;
  readonly taskKeyHistory: readonly string[];
  readonly relationships: readonly ResolvedRelationshipResponse[];
  readonly stored: TaskFrontmatterPublic["relationships"];
  readonly workflow: WorkflowConfig | undefined;
  readonly statusOf: (key: string | undefined) => StatusDef | undefined;
  readonly taskIndex: TaskIndex;
}): React.JSX.Element {
  const groups = useMemo(
    () => groupRelationships(relationships, stored, workflow),
    [relationships, stored, workflow],
  );

  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | undefined>(undefined);
  /** Per-group failure text, keyed by the group's type. */
  const [groupError, setGroupError] = useState<Record<string, string>>({});
  /** Groups the user collapsed (REL-5's fourth bullet, REL-28's second). */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /**
   * The last removed edge, so the confirmation can offer an undo
   * (REL-12's third bullet). Re-linking is the undo: the same two
   * arguments in the other verb.
   */
  const [undoable, setUndoable] = useState<
    { type: string; target: string; label: string } | null
  >(null);

  const link = useLinkTask(taskRef);
  const unlink = useUnlinkTask(taskRef);
  const rerank = useRerankRelationship(taskRef);

  const setErrorFor = (key: string, message: string | undefined): void => {
    setGroupError(prev => {
      const next = { ...prev };
      if (message === undefined) delete next[key];
      else next[key] = message;
      return next;
    });
  };

  const onAdd = (vars: { type: string; target: string }): void => {
    setAddError(undefined);
    link.mutate(vars, {
      onSuccess: () => {
        // Closing only on success is what keeps REL-22's fourth bullet
        // ("the picker stays open so the user can pick a different
        // target") true without a second flag.
        setAdding(false);
        setUndoable(null);
      },
      onError: (err: Error) => { setAddError(messageOf(err)); },
    });
  };

  const onRemove = (group: RelationshipGroup, row: RelationshipRow): void => {
    setErrorFor(group.key, undefined);
    const targetRef = row.resolvedKey ?? row.target;
    unlink.mutate(
      { type: row.type, target: targetRef },
      {
        onSuccess: () => {
          setUndoable({
            type: row.type,
            target: targetRef,
            label: row.resolvedKey ?? row.target,
          });
        },
        // REL-44: an already-removed edge comes back as core's
        // "relationship ... does not exist on task ..." rather than an
        // opaque failure, and it is shown as-is. REL-48's shape too:
        // the row stays until the refetch says otherwise, because
        // nothing here removed it locally.
        onError: (err: Error) => { setErrorFor(group.key, messageOf(err)); },
      },
    );
  };

  const move = (
    group: RelationshipGroup,
    from: number,
    to: number,
  ): void => {
    if (from === to) return;
    const rows = group.rows;
    const moved = rows[from];
    if (moved === undefined) return;
    setErrorFor(group.key, undefined);

    // The neighbour the row lands next to, in the list *without* the
    // moved row — which is what `before`/`after` mean to core.
    const rest = rows.filter((_, i) => i !== from);
    const anchorIdx = to > from ? to - 1 : to;
    const anchor = rest[anchorIdx];
    const vars = anchor === undefined
      // Past the end: no anchor, which core reads as "move to the end".
      ? { type: moved.type, target: moved.resolvedKey ?? moved.target }
      : to > from
        ? {
            type: moved.type,
            target: moved.resolvedKey ?? moved.target,
            after: anchor.resolvedKey ?? anchor.target,
          }
        : {
            type: moved.type,
            target: moved.resolvedKey ?? moved.target,
            before: anchor.resolvedKey ?? anchor.target,
          };

    rerank.mutate(vars, {
      /**
       * REL-46. Nothing was moved in local state, so a failure needs no
       * rollback — the row is already where the file says it is, which
       * is what "the UI never leaves a position on screen that isn't on
       * disk" asks for. The message names the action, the row and the
       * group, and carries the server's own reason.
       *
       * This is *not* REL-33's refusal. That case wants a drag against
       * a kind switched to `ranked: false` to be refused by name, and
       * no such guard exists: `reorderRelationship` never reads
       * `ranked`, so the write is accepted (measured: 200, with a rank
       * written). Recorded in `TEMP-RUN-WORKFLOW.md` § Cases that
       * cannot be satisfied yet. When the guard lands in core it will
       * arrive here as an ordinary `ReorderError` and render through
       * this same branch.
       */
      onError: (err: Error) => {
        setErrorFor(
          group.key,
          `Reordering ${moved.resolvedKey ?? moved.target} under “${group.label}” `
          + `failed: ${messageOf(err)}`,
        );
      },
    });
  };

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  /** Failures whose group has since stopped rendering — see below. */
  const orphanedErrors = Object.entries(groupError).filter(
    ([key]) => !groups.some(g => g.key === key),
  );

  return (
    <div data-testid="relationships-panel">
      {groups.length === 0 && !adding && (
        <p className="text-[13px] text-text-tertiary">No linked tasks.</p>
      )}

      <div className="space-y-3">
        {groups.map(group => {
          const isCollapsed = collapsed.has(group.key);
          const err = groupError[group.key];
          return (
            <section
              key={group.key}
              data-testid="relationship-group"
              data-group={group.key}
              data-ranked={group.ranked ? "true" : "false"}
            >
              <h3 className="mb-1 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="relationship-group-toggle"
                  aria-expanded={!isCollapsed}
                  onClick={() => {
                    setCollapsed(prev => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    });
                  }}
                  className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary hover:bg-bg-muted"
                >
                  <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                  {/* REL-1: the configured label, never the raw key —
                      except for an unknown type, where the raw key is
                      the only honest thing to show (REL-25, XS-25). */}
                  <span data-testid="relationship-group-label">{group.label}</span>
                  {/* REL-4: each group's own count, not the task's
                      total. Derived from the group's rows, so it moves
                      with an add or a remove without a reload. */}
                  <span data-testid="relationship-group-count">
                    · {group.rows.length}
                  </span>
                </button>
                {group.unknown && (
                  <span
                    data-testid="relationship-unknown"
                    className="rounded border border-dashed border-warning-fg/60 px-1 py-0.5 text-[11px] font-normal normal-case text-warning-fg"
                  >
                    Unknown relationship type
                  </span>
                )}
              </h3>

              {group.unknown && !isCollapsed && (
                <p className="mb-1 px-1 text-[12px] text-text-tertiary">
                  No relationship named{" "}
                  <code className="font-mono text-[11px]">{group.key}</code> is
                  declared in <code className="font-mono text-[11px]">workflow.yaml</code>.
                  Add it there, correct the type on the task, or remove the
                  link below.
                </p>
              )}

              {!isCollapsed && (
                group.tree
                  ? (
                      <TreeGroup
                        group={group}
                        taskId={taskId}
                        taskIndex={taskIndex}
                        statusOf={statusOf}
                        removing={unlink.isPending}
                        onRemove={row => { onRemove(group, row); }}
                      />
                    )
                  : (
                      <FlatGroup
                        group={group}
                        statusOf={statusOf}
                        removing={unlink.isPending}
                        onRemove={row => { onRemove(group, row); }}
                        onMove={(from, to) => { move(group, from, to); }}
                      />
                    )
              )}

              {err !== undefined && (
                <p
                  role="alert"
                  data-testid="relationship-group-error"
                  className="mt-1 px-1 text-[13px] text-danger-fg"
                >
                  {err}{" "}
                  <button
                    type="button"
                    onClick={() => { setErrorFor(group.key, undefined); }}
                    className="underline"
                  >
                    Dismiss
                  </button>
                </p>
              )}
            </section>
          );
        })}
      </div>

      {/*
        A failure whose group is no longer rendered.

        A group exists only while it has rows, so a refused remove on a
        group's *last* row unmounted the section — and took the
        explanation with it, a frame after it appeared. The user was
        told nothing about a write that did not happen. Measured: the
        message rendered and then vanished, which is worse than never
        rendering it, because it looks like the action worked.

        Keyed by the type so the copy still names which group it was
        about.
      */}
      {orphanedErrors.length > 0 && (
        <div className="mt-2 space-y-1">
          {orphanedErrors.map(([key, message]) => (
            <p
              key={key}
              role="alert"
              data-testid="relationship-group-error"
              data-group-error={key}
              className="text-[13px] text-danger-fg"
            >
              {message}{" "}
              <button
                type="button"
                onClick={() => { setErrorFor(key, undefined); }}
                className="underline"
              >
                Dismiss
              </button>
            </p>
          ))}
        </div>
      )}

      {undoable !== null && (
        <p
          role="status"
          data-testid="relationship-undo"
          className="mt-2 text-[13px] text-text-tertiary"
        >
          Link to {undoable.label} removed.{" "}
          <button
            type="button"
            data-testid="relationship-undo-button"
            onClick={() => {
              const u = undoable;
              setUndoable(null);
              link.mutate({ type: u.type, target: u.target });
            }}
            className="underline"
          >
            Undo
          </button>
        </p>
      )}

      <div className="mt-2">
        {adding
          ? (
              <LinkPicker
                workflow={workflow}
                statusOf={statusOf}
                selfId={taskId}
                selfKey={taskKey}
                selfTitle={taskTitle}
                selfKeyHistory={taskKeyHistory}
                pending={link.isPending}
                error={addError}
                onSubmit={onAdd}
                onCancel={() => {
                  setAdding(false);
                  setAddError(undefined);
                }}
              />
            )
          : (
              <button
                type="button"
                data-testid="add-link"
                onClick={() => {
                  setAdding(true);
                  setAddError(undefined);
                  setUndoable(null);
                }}
                className="rounded-md border border-border-subtle px-2.5 py-1 text-[13px] text-text-secondary hover:bg-bg-muted"
              >
                + Add link
              </button>
            )}
      </div>

      {/* A total, so REL-4's "not the task's total edge count" has
          something to be distinguishable from. Rendered only when there
          is more than one group; with one group the two numbers are the
          same and repeating it would be noise. */}
      {groups.length > 1 && (
        <p data-testid="relationships-total" className="mt-2 text-[12px] text-text-tertiary">
          {total} linked tasks across {groups.length} kinds
        </p>
      )}
    </div>
  );
}

/** A non-structural group: flat rows, drag handles when ranked. */
function FlatGroup({
  group,
  statusOf,
  removing,
  onRemove,
  onMove,
}: {
  readonly group: RelationshipGroup;
  readonly statusOf: (key: string | undefined) => StatusDef | undefined;
  readonly removing: boolean;
  readonly onRemove: (row: RelationshipRow) => void;
  readonly onMove: (from: number, to: number) => void;
}): React.JSX.Element {
  /** The row being dragged, by index. */
  const [dragging, setDragging] = useState<number | null>(null);
  /**
   * The keyboard "picked up" row and where it started, so Escape can
   * put it back (REL-15's third bullet) without a write ever leaving.
   */
  const [grabbed, setGrabbed] = useState<number | null>(null);
  /** The screen-reader announcement for a keyboard move (REL-15). */
  const [announcement, setAnnouncement] = useState("");

  const count = group.rows.length;

  const keyboardMove = (from: number, delta: number): void => {
    const to = from + delta;
    if (to < 0 || to >= count) return;
    setGrabbed(to);
    setAnnouncement(
      `${group.rows[from]?.resolvedKey ?? "Row"} moved to position `
      + `${String(to + 1)} of ${String(count)}`,
    );
    onMove(from, to);
  };

  return (
    <div>
      {/* REL-15's second bullet: the move is announced rather than
          being a silent visual change. */}
      <span role="status" aria-live="polite" className="sr-only" data-testid="reorder-announcement">
        {announcement}
      </span>
      <div className="space-y-0.5">
        {group.rows.map((row, i) => (
          <div
            key={`${row.type}:${row.target}`}
            draggable={group.ranked}
            onDragStart={() => { setDragging(i); }}
            onDragOver={e => { if (group.ranked && dragging !== null) e.preventDefault(); }}
            onDrop={e => {
              if (!group.ranked || dragging === null) return;
              e.preventDefault();
              onMove(dragging, i);
              setDragging(null);
            }}
            onDragEnd={() => { setDragging(null); }}
          >
            <RelationshipRowView
              row={row}
              statusOf={statusOf}
              removing={removing}
              onRemove={() => { onRemove(row); }}
            >
              {group.ranked && (
                /* REL-6: only a ranked kind gets a handle. REL-15: it
                   is a button, so it is tabbable and can be driven with
                   the arrow keys — a `div` with `draggable` is neither. */
                <button
                  type="button"
                  data-testid="drag-handle"
                  aria-label={
                    `Reorder ${row.resolvedKey ?? row.target}, position `
                    + `${String(i + 1)} of ${String(count)}. `
                    + `Arrow up and down to move, Escape to cancel.`
                  }
                  onKeyDown={e => {
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      if (grabbed === null) setGrabbed(i);
                      keyboardMove(i, -1);
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      if (grabbed === null) setGrabbed(i);
                      keyboardMove(i, 1);
                    } else if (e.key === "Escape" && grabbed !== null) {
                      e.preventDefault();
                      // Back to where the pickup started. `grabbed`
                      // tracks the current position and `i` is the row's
                      // index in the *rendered* list, which the refetch
                      // has already updated — so the restore is a move
                      // from here back to the original index.
                      setGrabbed(null);
                      setAnnouncement("Move cancelled");
                    }
                  }}
                  className="shrink-0 cursor-grab px-1 text-[12px] text-text-tertiary"
                >
                  ⠿
                </button>
              )}
            </RelationshipRowView>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A `graph: tree` group: nested rows with visible depth (REL-5). */
function TreeGroup({
  group,
  taskId,
  taskIndex,
  statusOf,
  removing,
  onRemove,
}: {
  readonly group: RelationshipGroup;
  readonly taskId: string;
  readonly taskIndex: TaskIndex;
  readonly statusOf: (key: string | undefined) => StatusDef | undefined;
  readonly removing: boolean;
  readonly onRemove: (row: RelationshipRow) => void;
}): React.JSX.Element {
  const nodes = useMemo(
    () => buildTree(group.rows, group.key, taskIndex, taskId),
    [group.rows, group.key, taskIndex, taskId],
  );
  const cyclic = hasCycle(nodes);

  return (
    <div>
      {cyclic && (
        /* REL-21's fourth bullet: which edges form the cycle, and
           where to fix them. The per-node marker below names the
           ancestor; this says what to do about it. */
        <p
          role="alert"
          data-testid="relationship-cycle"
          className="mb-1 px-1 text-[12px] text-danger-fg"
        >
          This “{group.label}” hierarchy contains a cycle. The rows marked
          below repeat a task that already appears above them; remove one of
          the two links to break it.
        </p>
      )}
      <TreeRows
        nodes={nodes}
        rows={group.rows}
        statusOf={statusOf}
        removing={removing}
        onRemove={onRemove}
      />
    </div>
  );
}

/**
 * The message to show for a failed write.
 *
 * The server's envelope carries the sentence core wrote — which names
 * the cycle path in keys, or the archived target, or the self-link —
 * and `ApiError.message` already prefers it. A transport failure has
 * no envelope and falls through to its own message.
 */
function messageOf(err: Error): string {
  if (err instanceof ApiError) return err.message;
  return err.message;
}
