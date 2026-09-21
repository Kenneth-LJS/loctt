import type { PriorityDef, StatusDef, TaskTypeDef, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  ConcurrentWorkflowEditError,
  useSaveWorkflowCollection,
} from "../api/hooks/useWorkflowMutations.ts";
import { Button } from "../ui/Button.tsx";
import { type EntryDialogResult,EntryEditDialog } from "./EntryEditDialog.tsx";
import { type RemapChoice,RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { ReorderableRows } from "./ReorderableRows.tsx";
import { RowActions } from "./RowActions.tsx";
import { renumberPriorities, reorder, setDefaultStatus } from "./workflowEdits.ts";
import {
  buildPriority,
  buildStatus,
  buildTaskType,
  collectionKeys,
  entryChangedOnDisk,
} from "./workflowForms.ts";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Statuses, Priorities and Task types (SET-3, SET-4, SET-6, SET-17,
 * SET-20, SET-21, SET-28, SET-34, SET-46, SET-47, SET-51).
 *
 * One component for three collections because the cases treat them as
 * one shape: each is an ordered list of `{key, label, …}` where the
 * order in the file is the order everywhere else in the app, deleting
 * an in-use key demands a remap, and the key itself is immutable
 * (`docs/dev/reference/invariants.md`) while the label is not.
 *
 * **The key is never editable after creation.** Stored task frontmatter
 * holds keys, not labels, so renaming a key in place would orphan every
 * task holding it with no remap to describe the move. Changing a key is
 * delete-with-remap plus create, which the panel supports as two
 * explicit steps.
 *
 * **The edit model (B2):** value edits (label, category, default) live
 * behind an **Edit** dialog — view-by-default, per open decision #3.
 * REORDER stays inline (Ken's decision — drag-reorder is not gated).
 * Creating goes through the same dialog in create mode (SET-46/47).
 */

type Collection = "statuses" | "priorities" | "task_types";
type Row = StatusDef | PriorityDef | TaskTypeDef;

const NOUN: Record<Collection, string> = {
  statuses: "status",
  priorities: "priority",
  task_types: "task type",
};

export function EnumCollectionPanel({ collection }: { readonly collection: Collection }) {
  return (
    <WorkflowPanelFrame
      title={
        collection === "statuses" ? "Statuses"
          : collection === "priorities" ? "Priorities" : "Task types"
      }
      description={
        collection === "statuses"
          ? "The states a task moves through. Order here is the board's column order and the order of every status dropdown in the app."
          : collection === "priorities"
            ? "Each priority's numeric value is recomputed from its position, so a priority sort matches this order."
            : "Task types carry no built-in behaviour — nothing special-cases any particular type."
      }
    >
      {({ workflow, usage }) => (
        <CollectionEditor
          collection={collection}
          workflow={workflow}
          counts={usage?.[collection] ?? {}}
        />
      )}
    </WorkflowPanelFrame>
  );
}

function CollectionEditor({
  collection,
  workflow,
  counts,
}: {
  readonly collection: Collection;
  readonly workflow: WorkflowConfig;
  readonly counts: Readonly<Record<string, number>>;
}) {
  const save = useSaveWorkflowCollection<Collection>();
  const [deleting, setDeleting] = useState<Row | null>(null);
  /** The row an Edit dialog is open over, or "create" for a new one. */
  const [dialog, setDialog] = useState<
    { readonly mode: "create" } | { readonly mode: "edit"; readonly row: Row } | null
  >(null);
  /**
   * SET-34: the order shown while a write is in flight. On failure it
   * is dropped, so the list snaps back to `workflow[collection]` — the
   * server's order, which is what is actually on disk. Nothing here
   * holds a "current order" that could outlive a failed save.
   */
  const [inFlight, setInFlight] = useState<readonly Row[] | null>(null);

  const stored = workflow[collection] as readonly Row[];
  const rows = inFlight ?? stored;

  /**
   * SET-28: the edit is expressed as a function of the *fresh*
   * document, not as a whole document built from the copy this panel
   * rendered. `useSaveWorkflowCollection` re-reads immediately before
   * the PUT and calls this with what it found, so a status added to
   * the file by hand while the panel sat open survives the write.
   *
   * `staleBaseline`, when set, is the row the Edit dialog opened over.
   * If the freshly-read document's version of that key differs, the
   * file was hand-edited underneath the dialog and the save is refused
   * (`ConcurrentWorkflowEditError`) rather than clobbering the hand
   * edit — SET-28's Edit-dialog path.
   */
  const commit = (
    next: readonly Row[],
    opts?: {
      remap?: Record<string, string | null>;
      staleBaseline?: Row;
      onDone?: () => void;
    },
  ): void => {
    setInFlight(next);
    const orderedKeys = next.map(r => r.key);
    const byKey = new Map(next.map(r => [r.key, r]));
    save.mutate(
      {
        collection,
        apply: fresh => {
          const freshRows = fresh[collection] as readonly Row[];
          if (
            opts?.staleBaseline !== undefined
            && entryChangedOnDisk(opts.staleBaseline, freshRows)
          ) {
            throw new ConcurrentWorkflowEditError(
              `These settings changed outside the app while this dialog was `
              + `open — the ${NOUN[collection]} "${opts.staleBaseline.key}" is not `
              + `what it was. Reload the panel, then re-apply `
              + `your change. Your edit was not saved.`,
            );
          }
          // Rows this panel edited, in the order it put them…
          const edited = orderedKeys.flatMap(k => {
            const row = byKey.get(k);
            return row === undefined ? [] : [row];
          });
          // …then anything the file gained that this panel never saw,
          // appended rather than dropped. Deletions are intentional
          // (they came from the remap dialog) so a key the panel
          // removed is not resurrected here.
          const known = new Set(
            (workflow[collection] as readonly Row[]).map(r => r.key),
          );
          const added = freshRows.filter(r => !known.has(r.key) && !byKey.has(r.key));
          const merged = [...edited, ...added] as WorkflowConfig[Collection];
          return collection === "priorities"
            ? (renumberPriorities(merged as readonly PriorityDef[]) as WorkflowConfig[Collection])
            : merged;
        },
        ...(opts?.remap !== undefined ? { remap: { [collection]: opts.remap } } : {}),
      },
      {
        // SET-34: on either outcome the optimistic copy is dropped.
        // On success the refetch brings the saved order; on failure
        // the render falls back to `stored`, which never moved.
        onSettled: () => { setInFlight(null); },
        onSuccess: () => {
          setDeleting(null);
          opts?.onDone?.();
        },
      },
    );
  };

  const onMove = (from: number, to: number): void => {
    const moved = reorder(rows, from, to);
    // SET-21: priorities carry a numeric `value` that decides sort
    // order, so a reorder that only moved array positions would leave
    // the list sorting by the old values. Recomputed from position.
    // Reorder stays inline (open decision #3) — no dialog.
    commit(
      collection === "priorities"
        ? renumberPriorities(moved as readonly PriorityDef[])
        : moved,
    );
  };

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  // A dialog is open: its own error is anchored inside it (SET-51). The
  // inline banner is for the reorder path, which has no dialog.
  const dialogError = dialog !== null && save.isError ? saveError : undefined;
  const inlineError = dialog === null && save.isError;

  const applyDialog = (result: EntryDialogResult): void => {
    if (dialog === null) return;
    if (dialog.mode === "create") {
      const built: Row =
        collection === "statuses"
          ? buildStatus({ key: result.key, label: result.label, category: result.category ?? "pending", icon: result.icon, color: result.color })
          : collection === "priorities"
            ? buildPriority({ key: result.key, label: result.label, icon: result.icon, color: result.color })
            : buildTaskType({ key: result.key, label: result.label, icon: result.icon, color: result.color });
      let next: readonly Row[] = [...rows, built];
      if (collection === "statuses" && result.makeDefault === true) {
        next = setDefaultStatus(next as readonly StatusDef[], built.key);
      }
      commit(next, { onDone: () => { setDialog(null); } });
      return;
    }
    // Edit: replace the row, carrying the un-editable fields through and
    // applying the presentational icon/colour the dialog now edits — an
    // undefined value clears the key rather than leaving the stored one.
    const target = dialog.row;
    const withPresentational = <T extends Row>(base: T): T => {
      const { icon: _icon, color: _color, ...rest } = base as T & { icon?: string; color?: string };
      return {
        ...rest,
        ...(result.icon !== undefined ? { icon: result.icon } : {}),
        ...(result.color !== undefined ? { color: result.color } : {}),
      } as T;
    };
    const nextRow: Row = withPresentational(
      collection === "statuses"
        ? { ...(target as StatusDef), label: result.label, category: result.category ?? (target as StatusDef).category }
        : { ...target, label: result.label },
    );
    let next = rows.map(r => (r.key === target.key ? nextRow : r));
    if (collection === "statuses" && result.makeDefault === true) {
      next = setDefaultStatus(next as readonly StatusDef[], target.key);
    } else if (collection === "statuses" && result.makeDefault === false && (target as StatusDef).default === true) {
      // Unticking default on the current default would leave the
      // document with none, which the schema rejects — so it is kept.
      next = next.map(r => (r.key === target.key ? { ...r, default: true } as Row : r));
    }
    commit(next, { staleBaseline: target, onDone: () => { setDialog(null); } });
  };

  return (
    <div>
      {/* SET-34: the failure names the file, says the change was not
          saved, and gives the next action — and the list is already
          back to the previous order by the time it renders. Shown only
          for the inline (reorder) path; a dialog anchors its own. */}
      {inlineError && (
        <div
          role="alert"
          data-testid="workflow-save-error"
          className="mb-3 rounded-md border border-danger-fg/40 bg-bg-muted p-3 text-[0.9286rem]"
        >
          <p className="font-medium text-danger-fg">
            Your change wasn’t saved.
          </p>
          <p className="mt-1 text-text-secondary">{saveError}</p>
          <p className="mt-1 text-text-tertiary">
            The list below is the order still on disk. Check the file&apos;s
            permissions, then try again — nothing is disabled.
          </p>
        </div>
      )}

      <div className="mb-3 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          data-testid={`${collection}-create`}
          disabled={save.isPending}
          onClick={() => { save.reset(); setDialog({ mode: "create" }); }}
        >
          + Add {NOUN[collection]}
        </Button>
      </div>

      {/* SET-20: 25 statuses scroll rather than clip. The panel owns a
          bounded height so the page chrome stays reachable. */}
      <div
        data-testid={`${collection}-list`}
        data-row-count={String(rows.length)}
        className="max-h-[60vh] overflow-y-auto pr-1"
      >
        <ReorderableRows
          items={rows}
          rowKey={r => r.key}
          rowLabel={r => r.label}
          onMove={onMove}
          enabled={!save.isPending}
          testIdPrefix={collection}
        >
          {row => (
            <RowFields
              collection={collection}
              row={row}
              count={counts[row.key] ?? 0}
              disabled={save.isPending}
              onlyRow={stored.length === 1}
              onEdit={() => { save.reset(); setDialog({ mode: "edit", row }); }}
              onDelete={() => { save.reset(); setDeleting(row); }}
            />
          )}
        </ReorderableRows>
      </div>

      {dialog !== null && (
        <EntryEditDialog
          collection={collection}
          mode={dialog.mode}
          existingKeys={collectionKeys(workflow, collection)}
          initial={dialog.mode === "edit" ? dialog.row : undefined}
          pending={save.isPending}
          error={dialogError}
          onSubmit={applyDialog}
          onClose={() => { setDialog(null); save.reset(); }}
        />
      )}

      {deleting !== null && (
        <RemapDeleteDialog
          noun={NOUN[collection]}
          itemLabel={deleting.label}
          itemKey={deleting.key}
          count={counts[deleting.key] ?? 0}
          alternatives={rows
            .filter(r => r.key !== deleting.key)
            .map(r => ({ key: r.key, label: r.label }))}
          pending={save.isPending}
          error={saveError}
          onConfirm={(choice: RemapChoice) => {
            const next = rows.filter(r => r.key !== deleting.key);
            commit(
              collection === "priorities"
                ? renumberPriorities(next as readonly PriorityDef[])
                : next,
              { remap: { [deleting.key]: choice.kind === "remap" ? choice.to : null } },
            );
          }}
          onClose={() => { setDeleting(null); save.reset(); }}
        />
      )}
    </div>
  );
}

/**
 * A view-by-default row: label, key, category/default/value read out,
 * refcount, and an **Edit** control that opens the dialog. No inline
 * inputs — the value-edit surface moved to the dialog (open decision
 * #3).
 */
function RowFields({
  collection,
  row,
  count,
  disabled,
  onlyRow,
  onEdit,
  onDelete,
}: {
  readonly collection: Collection;
  readonly row: Row;
  readonly count: number;
  readonly disabled: boolean;
  readonly onlyRow: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}) {
  const isStatus = collection === "statuses";
  const isDefault = isStatus && (row as StatusDef).default === true;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[0.9286rem]">
      <span data-testid={`${collection}-label-${row.key}`} className="w-40 font-medium">
        {row.label}
      </span>

      {/* The key, shown and never editable — see the header comment. */}
      <code
        data-testid={`${collection}-key-${row.key}`}
        className="rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem] text-text-secondary"
        title="A key is permanent: task files store it, so renaming it in place would orphan them."
      >
        {row.key}
      </code>

      {isStatus && (
        <span
          data-testid={`statuses-category-${row.key}`}
          className="rounded bg-bg-muted px-1.5 py-0.5 text-[0.8571rem] text-text-secondary"
        >
          {(row as StatusDef).category}
        </span>
      )}

      {collection === "priorities" && (
        <span
          data-testid={`priorities-value-${row.key}`}
          className="text-[0.8571rem] text-text-tertiary"
          title="Recomputed from position — lower sorts first."
        >
          value {String((row as PriorityDef).value ?? "—")}
        </span>
      )}

      {isStatus && (
        // SET-3: the default marker stays visible and says what it decides.
        <span
          data-testid={`statuses-default-${row.key}`}
          data-default-status={isDefault ? "true" : "false"}
          className="text-[0.8571rem] text-text-secondary"
        >
          {isDefault ? "default — new tasks land here" : ""}
        </span>
      )}

      <span
        data-testid={`${collection}-refcount-${row.key}`}
        className="ml-auto text-[0.8571rem] text-text-tertiary"
      >
        {String(count)} task{count === 1 ? "" : "s"}
      </span>

      <RowActions
        label={`Actions for ${NOUN[collection]} "${row.label}"`}
        actions={[
          { label: "Edit", testId: `${collection}-edit-${row.key}`, disabled, onSelect: onEdit },
          {
            label: "Delete",
            testId: `${collection}-delete-${row.key}`,
            danger: true,
            disabled: disabled || onlyRow,
            ...(onlyRow ? { title: `A tracker needs at least one ${NOUN[collection]}.` } : {}),
            onSelect: onDelete,
          },
        ]}
      />
    </div>
  );
}
