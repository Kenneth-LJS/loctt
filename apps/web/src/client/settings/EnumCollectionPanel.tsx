import type { PriorityDef, StatusDef, TaskTypeDef, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useSaveWorkflowCollection } from "../api/hooks/useWorkflowMutations.ts";
import { type RemapChoice,RemapDeleteDialog } from "./RemapDeleteDialog.tsx";
import { ReorderableRows } from "./ReorderableRows.tsx";
import { renumberPriorities, reorder, setDefaultStatus } from "./workflowEdits.ts";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Statuses, Priorities and Task types (SET-3, SET-4, SET-6, SET-17,
 * SET-20, SET-21, SET-28, SET-34).
 *
 * One component for three collections because the cases treat them as
 * one shape: each is an ordered list of `{key, label, …}` where the
 * order in the file is the order everywhere else in the app, deleting
 * an in-use key demands a remap, and the key itself is immutable
 * (`docs/dev/invariants.md`) while the label is not.
 *
 * **The key is never editable.** Stored task frontmatter holds keys,
 * not labels, so renaming a key in place would orphan every task
 * holding it with no remap to describe the move. Changing a key is
 * delete-with-remap plus create, which the panel supports as two
 * explicit steps.
 */

type Collection = "statuses" | "priorities" | "task_types";
type Row = StatusDef | PriorityDef | TaskTypeDef;

const NOUN: Record<Collection, string> = {
  statuses: "status",
  priorities: "priority",
  task_types: "task type",
};

const CATEGORIES = ["pending", "active", "completed", "discarded"] as const;

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
   * The edit is described by key rather than by index for the same
   * reason: positions in the panel's copy mean nothing in a document
   * that gained or lost a row underneath it.
   */
  const commit = (next: readonly Row[], remap?: Record<string, string | null>): void => {
    setInFlight(next);
    const orderedKeys = next.map(r => r.key);
    const byKey = new Map(next.map(r => [r.key, r]));
    save.mutate(
      {
        collection,
        apply: fresh => {
          const freshRows = fresh[collection] as readonly Row[];
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
        ...(remap !== undefined ? { remap: { [collection]: remap } } : {}),
      },
      {
        // SET-34: on either outcome the optimistic copy is dropped.
        // On success the refetch brings the saved order; on failure
        // the render falls back to `stored`, which never moved.
        onSettled: () => { setInFlight(null); },
        onSuccess: () => { setDeleting(null); },
      },
    );
  };

  const onMove = (from: number, to: number): void => {
    const moved = reorder(rows, from, to);
    // SET-21: priorities carry a numeric `value` that decides sort
    // order, so a reorder that only moved array positions would leave
    // the list sorting by the old values. Recomputed from position.
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

  return (
    <div>
      {/* SET-34: the failure names the file, says the change was not
          saved, and gives the next action — and the list is already
          back to the previous order by the time it renders. */}
      {save.isError && (
        <div
          role="alert"
          data-testid="workflow-save-error"
          className="mb-3 rounded-md border border-danger-fg/40 bg-bg-muted p-3 text-[13px]"
        >
          <p className="font-medium text-danger-fg">
            The change was not saved to .loctt/config/workflow.yaml.
          </p>
          <p className="mt-1 text-text-secondary">{saveError}</p>
          <p className="mt-1 text-text-tertiary">
            The list below is the order still on disk. Check the file&apos;s
            permissions, then try again — nothing is disabled.
          </p>
        </div>
      )}

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
              workflow={workflow}
              count={counts[row.key] ?? 0}
              disabled={save.isPending}
              onChange={next => {
                commit(rows.map(r => (r.key === row.key ? next : r)));
              }}
              onSetDefault={() => {
                commit(setDefaultStatus(rows as readonly StatusDef[], row.key));
              }}
              onDelete={() => { setDeleting(row); }}
            />
          )}
        </ReorderableRows>
      </div>

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
              { [deleting.key]: choice.kind === "remap" ? choice.to : null },
            );
          }}
          onClose={() => { setDeleting(null); save.reset(); }}
        />
      )}
    </div>
  );
}

function RowFields({
  collection,
  row,
  workflow,
  count,
  disabled,
  onChange,
  onSetDefault,
  onDelete,
}: {
  readonly collection: Collection;
  readonly row: Row;
  readonly workflow: WorkflowConfig;
  readonly count: number;
  readonly disabled: boolean;
  readonly onChange: (next: Row) => void;
  readonly onSetDefault: () => void;
  readonly onDelete: () => void;
}) {
  const [label, setLabel] = useState(row.label);
  const isStatus = collection === "statuses";
  const isDefault = isStatus && (row as StatusDef).default === true;
  const onlyRow = (workflow[collection] as readonly Row[]).length === 1;

  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <input
        data-testid={`${collection}-label-${row.key}`}
        value={label}
        disabled={disabled}
        onChange={e => { setLabel(e.target.value); }}
        onBlur={() => {
          const trimmed = label.trim();
          if (trimmed.length === 0) { setLabel(row.label); return; }
          if (trimmed !== row.label) onChange({ ...row, label: trimmed });
        }}
        className="h-7 w-40 rounded-md border border-border-default bg-bg-surface px-2 text-[13px]"
        aria-label={`Label for ${row.key}`}
      />

      {/* The key, shown and never editable — see the header comment. */}
      <code
        data-testid={`${collection}-key-${row.key}`}
        className="rounded bg-bg-muted px-1 py-0.5 font-mono text-[12px] text-text-secondary"
        title="A key is permanent: task files store it, so renaming it in place would orphan them."
      >
        {row.key}
      </code>

      {isStatus && (
        <select
          data-testid={`statuses-category-${row.key}`}
          value={(row as StatusDef).category}
          disabled={disabled}
          onChange={e => {
            onChange({
              ...row,
              category: e.target.value as StatusDef["category"],
            } as StatusDef);
          }}
          aria-label={`Category for ${row.key}`}
          className="h-7 rounded-md border border-border-default bg-bg-surface px-1 text-[12px]"
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      )}

      {collection === "priorities" && (
        <span
          data-testid={`priorities-value-${row.key}`}
          className="font-mono text-[12px] text-text-tertiary"
          title="Recomputed from position — lower sorts first."
        >
          value {String((row as PriorityDef).value ?? "—")}
        </span>
      )}

      {isStatus && (
        <label className="flex items-center gap-1 text-[12px] text-text-secondary">
          <input
            type="radio"
            name="default-status"
            data-testid={`statuses-default-${row.key}`}
            checked={isDefault}
            disabled={disabled}
            onChange={onSetDefault}
          />
          {/* SET-3: the marker is visible and says what it decides. */}
          <span data-default-status={isDefault ? "true" : "false"}>
            default{isDefault ? " — new tasks land here" : ""}
          </span>
        </label>
      )}

      <span
        data-testid={`${collection}-refcount-${row.key}`}
        className="ml-auto text-[12px] text-text-tertiary"
      >
        {String(count)} task{count === 1 ? "" : "s"}
      </span>

      <button
        type="button"
        data-testid={`${collection}-delete-${row.key}`}
        disabled={disabled || onlyRow}
        onClick={onDelete}
        title={onlyRow ? `A tracker needs at least one ${NOUN[collection]}.` : undefined}
        className="h-7 rounded-md border border-border-default px-2 text-[12px] text-danger-fg disabled:opacity-40"
      >
        Delete
      </button>
    </div>
  );
}
