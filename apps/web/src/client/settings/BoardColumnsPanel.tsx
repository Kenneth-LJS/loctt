import type { BoardColumnDef, WorkflowConfig } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useSaveWorkflowCollection } from "../api/hooks/useWorkflowMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { Icon } from "../ui/Icon.tsx";
import { IconButton } from "../ui/IconButton.tsx";
import { TextField } from "../ui/TextField.tsx";
import { reorder } from "./workflowEdits.ts";
import { WorkflowPanelFrame } from "./WorkflowPanelFrame.tsx";

/**
 * Settings → Tracker → Board columns (BRD-2, K8).
 *
 * Edits the SHARED board column definitions (`workflow.boards.columns`) —
 * the committed grouping model, part of the ordering model per K8. Per-user
 * column show/hide is a DIFFERENT setting (`board_hidden_columns`, A26) and
 * is intentionally NOT here — this panel is about what the columns ARE, not
 * which ones a given user hides.
 *
 * Two board shapes (columns.ts): with no `boards.columns`, the board is 1
 * column per status in declaration order (the implicit board). This panel
 * lets the user PROMOTE that implicit board into an explicit, editable one,
 * then add/reorder/relabel columns, route statuses into them, and set a
 * passive WIP cap.
 *
 * Validation mirrors `BoardsConfigSchema.superRefine` so the user sees the
 * problem inline before saving: column keys unique, and each status in at
 * most one column (a status in two columns makes a drag target ambiguous).
 * WIP is passive (A103) — a counter, never enforced; the copy says so.
 */

/** A column being edited. `key` is stable identity (React key + drag id). */
interface DraftColumn {
  readonly key: string;
  readonly label: string;
  readonly statuses: readonly string[];
  readonly wip?: number;
}

function toDraft(col: BoardColumnDef): DraftColumn {
  return { key: col.key, label: col.label, statuses: col.statuses, ...(col.wip !== undefined ? { wip: col.wip } : {}) };
}

/** The implicit board as explicit columns: one per status, declaration order. */
function implicitColumns(workflow: WorkflowConfig): DraftColumn[] {
  return (workflow.statuses ?? []).map(s => ({ key: s.key, label: s.label, statuses: [s.key] }));
}

interface Problems {
  /** column index → message */
  readonly columns: ReadonlyMap<number, string>;
  readonly any: boolean;
}

function validate(cols: readonly DraftColumn[]): Problems {
  const problems = new Map<number, string>();
  const seenKeys = new Set<string>();
  const seenStatus = new Map<string, number>();
  cols.forEach((col, i) => {
    if (col.label.trim() === "") problems.set(i, "A column needs a label.");
    if (col.statuses.length === 0) problems.set(i, "A column needs at least one status.");
    if (seenKeys.has(col.key)) {
      problems.set(i, `Duplicate column id “${col.key}”.`);
    }
    seenKeys.add(col.key);
    for (const s of col.statuses) {
      const prev = seenStatus.get(s);
      if (prev !== undefined && prev !== i) {
        problems.set(i, `“${s}” is already in another column.`);
      }
      seenStatus.set(s, i);
    }
  });
  return { columns: problems, any: problems.size > 0 };
}

export function BoardColumnsPanel() {
  return (
    <WorkflowPanelFrame
      title="Board columns"
    >
      {({ workflow }) => <BoardColumnsEditor workflow={workflow} />}
    </WorkflowPanelFrame>
  );
}

function BoardColumnsEditor({ workflow }: { readonly workflow: WorkflowConfig }) {
  const save = useSaveWorkflowCollection<"boards">();
  const configured = workflow.boards?.columns;
  const isExplicit = configured !== undefined && configured.length > 0;

  const [draft, setDraft] = useState<DraftColumn[] | null>(
    isExplicit ? configured.map(toDraft) : null,
  );
  // "Reset to one column per status" persists to disk on click, discarding
  // every custom column. It is recoverable (the user can rebuild), so a
  // typed-word gate would be overkill, but a one-click destructive persist
  // deserves a confirm — see decisions.md §8.
  const [confirmingReset, setConfirmingReset] = useState(false);

  const statuses = workflow.statuses ?? [];

  const envelope = save.error instanceof ApiError ? save.error.envelope : undefined;
  const saveError = save.error === null
    ? undefined
    : envelope?.message ?? (save.error as Error | null)?.message;

  // Not yet promoted: show the implicit board read-only + a promote button.
  if (draft === null) {
    return (
      <div className="grid max-w-2xl gap-3 text-[0.9286rem]" data-testid="board-columns-panel">
        {/* Kept — BoardColumnsPanel.test.tsx "shows the implicit board and a
            promote button when no columns are configured" requires this
            testid (`findByTestId("board-implicit-note")`), though it does
            not pin the exact wording; shortened rather than removed. */}
        <p className="text-text-secondary" data-testid="board-implicit-note">
          One column per status, in order:
        </p>
        <ol className="flex flex-wrap gap-2" data-testid="board-implicit-columns">
          {statuses.map(s => (
            <li key={s.key} className="rounded border border-border-default px-2 py-1 text-text-primary">
              {s.label}
            </li>
          ))}
        </ol>
        <div>
          <Button
            type="button"
            variant="secondary"
            testId="board-promote"
            onClick={() => { save.reset(); setDraft(implicitColumns(workflow)); }}
          >
            Customize columns
          </Button>
        </div>
      </div>
    );
  }

  const problems = validate(draft);
  // Statuses not covered by any column — surfaced so the user knows those
  // tasks land in a "Not on this board" column (BRD-24).
  const covered = new Set(draft.flatMap(c => c.statuses));
  const uncovered = statuses.filter(s => !covered.has(s.key));

  const patchColumn = (i: number, next: Partial<DraftColumn>): void => {
    setDraft(prev => (prev ?? []).map((c, idx) => (idx === i ? { ...c, ...next } : c)));
  };

  const toggleStatus = (i: number, statusKey: string): void => {
    setDraft(prev => (prev ?? []).map((c, idx) => {
      if (idx !== i) return c;
      const has = c.statuses.includes(statusKey);
      return { ...c, statuses: has ? c.statuses.filter(s => s !== statusKey) : [...c.statuses, statusKey] };
    }));
  };

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= draft.length) return;
    setDraft(prev => reorder(prev ?? [], from, to));
  };

  const addColumn = (): void => {
    // A unique key from the count; the user never types the key (it is
    // machinery), only the label.
    let n = draft.length + 1;
    const keys = new Set(draft.map(c => c.key));
    while (keys.has(`column-${n}`)) n += 1;
    setDraft([...draft, { key: `column-${n}`, label: `Column ${n}`, statuses: [] }]);
  };

  const removeColumn = (i: number): void => {
    setDraft(prev => (prev ?? []).filter((_, idx) => idx !== i));
  };

  const onSave = (): void => {
    if (problems.any) return;
    const columns: BoardColumnDef[] = draft.map(c => ({
      key: c.key,
      label: c.label.trim(),
      statuses: [...c.statuses],
      ...(c.wip !== undefined ? { wip: c.wip } : {}),
    }));
    save.mutate({ collection: "boards", apply: () => ({ columns }) });
  };

  const onReset = (): void => {
    // "Reset to one column per status" clears the explicit board back to the
    // implicit 1:1 layout by writing no columns (undefined boards block).
    save.mutate({ collection: "boards", apply: () => undefined });
    setDraft(null);
  };

  return (
    <div className="grid max-w-2xl gap-4 text-[0.9286rem]" data-testid="board-columns-panel">
      <ol className="grid gap-3" data-testid="board-columns-list" data-count={String(draft.length)}>
        {draft.map((col, i) => {
          const problem = problems.columns.get(i);
          return (
            <li
              key={col.key}
              // K100 deep-link anchor. The board's "Set WIP limit" menu
              // item deep-links to `/settings/board-columns#column-<key>`
              // (BoardView emits `hash={`column-${column.id}`}`, where the
              // column id is its key), so this row's anchor is
              // `column-<key>`, not `row-<id>` — see useScrollToHash.
              id={`column-${col.key}`}
              data-testid={`board-column-${col.key}`}
              className="rounded-lg border border-border-default p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <TextField
                  aria-label={`Column ${i + 1} label`}
                  data-testid={`board-column-label-${col.key}`}
                  value={col.label}
                  invalid={problem !== undefined && col.label.trim() === ""}
                  onChange={e => { patchColumn(i, { label: e.target.value }); }}
                  className="flex-1"
                />
                <IconButton
                  aria-label={`Move column ${i + 1} up`}
                  testId={`board-column-up-${col.key}`}
                  disabled={i === 0}
                  onClick={() => { move(i, i - 1); }}
                >
                  <Icon name="arrowUp" />
                </IconButton>
                <IconButton
                  aria-label={`Move column ${i + 1} down`}
                  testId={`board-column-down-${col.key}`}
                  disabled={i === draft.length - 1}
                  onClick={() => { move(i, i + 1); }}
                >
                  <Icon name="arrowDown" />
                </IconButton>
                <IconButton
                  aria-label={`Remove column ${i + 1}`}
                  testId={`board-column-remove-${col.key}`}
                  onClick={() => { removeColumn(i); }}
                >
                  <Icon name="close" />
                </IconButton>
              </div>

              <fieldset className="mb-2">
                <legend className="mb-1 text-[0.8571rem] text-text-secondary">Statuses in this column</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {statuses.map(s => (
                    <label key={s.key} className="flex items-center gap-1.5 text-[0.8571rem]">
                      <Checkbox
                        data-testid={`board-column-${col.key}-status-${s.key}`}
                        checked={col.statuses.includes(s.key)}
                        onChange={() => { toggleStatus(i, s.key); }}
                      />
                      <span>{s.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="flex items-center gap-2 text-[0.8571rem]">
                <span className="text-text-secondary">WIP cap</span>
                <TextField
                  type="number"
                  min={1}
                  aria-label={`Column ${i + 1} work-in-progress cap`}
                  data-testid={`board-column-wip-${col.key}`}
                  value={col.wip === undefined ? "" : String(col.wip)}
                  onChange={e => {
                    const v = e.target.value.trim();
                    const n = Number(v);
                    const valid = v !== "" && Number.isInteger(n) && n > 0;
                    setDraft(prev => (prev ?? []).map((c, idx) => {
                      if (idx !== i) return c;
                      if (!valid) {
                        const { wip: _drop, ...rest } = c;
                        return rest;
                      }
                      return { ...c, wip: n };
                    }));
                  }}
                  className="w-20"
                />
              </label>

              {problem !== undefined && (
                <p role="alert" data-testid={`board-column-problem-${col.key}`} className="mt-2 text-[0.7857rem] text-danger-fg">
                  {problem}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <div>
        <Button variant="secondary" size="sm" testId="board-add-column" onClick={addColumn}>
          <Icon name="plus" size={14} />
          Add column
        </Button>
      </div>

      {uncovered.length > 0 && (
        <p data-testid="board-uncovered-note" className="text-[0.7857rem] text-text-tertiary">
          Not in any column: {uncovered.map(s => s.label).join(", ")}. Tasks with
          {" "}these statuses appear in a “Not on this board” column so none are hidden.
        </p>
      )}

      {save.isError && (
        <p role="alert" data-testid="workflow-save-error" className="text-[0.8571rem] text-danger-fg">
          Your change wasn’t saved: {saveError}
        </p>
      )}
      {save.isSuccess && !save.isPending && (
        <p data-testid="board-columns-saved" className="text-[0.8571rem] text-text-tertiary">
          Saved.
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          testId="board-columns-save"
          disabled={problems.any}
          loading={save.isPending}
          aria-label="Save"
          onClick={onSave}
        >
          Save
        </Button>
        <Button
          type="button"
          variant="secondary"
          testId="board-columns-reset"
          disabled={save.isPending}
          onClick={() => { setConfirmingReset(true); }}
        >
          Reset to one column per status
        </Button>
      </div>

      {confirmingReset && (
        <ConfirmDialog
          title="Reset board columns?"
          testId="board-columns-reset-confirm"
          confirmTestId="board-columns-reset-confirm-button"
          cancelTestId="board-columns-reset-cancel"
          confirmLabel="Reset columns"
          body={
            <>
              This discards every custom column and returns the board to one
              column per status, in the order statuses are defined. It saves
              immediately. You can build your columns again afterwards.
            </>
          }
          onConfirm={() => { setConfirmingReset(false); onReset(); }}
          onCancel={() => { setConfirmingReset(false); }}
        />
      )}
    </div>
  );
}
