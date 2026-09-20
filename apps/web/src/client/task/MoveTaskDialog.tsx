import type { ProjectDef } from "@loctt/contracts";
import { useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Combobox, ComboboxButton, type ComboboxOption } from "../ui/Combobox.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";

/**
 * Move one task to another project.
 *
 * No typed confirmation: a move is reversible (move it back), so the
 * friction delete carries would be misplaced. TSK-44 is what this
 * dialog owes — Cancel and `Esc` both dismiss, and dismissing changes
 * nothing, because the request only goes out on Move.
 *
 * The current project is offered but disabled: seeing where the task
 * is now is what makes the choice meaningful, and moving a task to the
 * project it is already in is a no-op the server would accept.
 *
 * K71: routed through `Dialog` (over `Modal`) for the focus trap, inert
 * background and focus restoration it previously hand-rolled its overlay
 * without; the raw action `<button>`s are now `Button`
 * (docs/dev/design/design-review.md §B2). A211: the destination picker is the searchable `ui/Combobox`
 * (single-select) — the project list grows with the workspace — with the
 * current project offered present-but-disabled.
 */
export function MoveTaskDialog({
  taskKey,
  projects,
  currentProject,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly taskKey: string;
  readonly projects: readonly ProjectDef[];
  readonly currentProject: string | undefined;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: (projectId: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const choices = projects.filter(p => p.archived !== true);

  return (
    <Dialog
      title={`Move ${taskKey} to another project`}
      onClose={onCancel}
      testId="move-task-dialog"
      description={
        // The key changes on a move, and a user who cannot find the task
        // afterwards has effectively lost it. Say so before, not only in
        // the result.
        <>
          The task keeps its history, but takes a new key in the
          destination project. {taskKey} will keep working as a link.
        </>
      }
      actions={
        <DialogActions>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => { onConfirm(selected); }}
            disabled={selected === "" || pending}
          >
            {pending ? "Moving…" : "Move task"}
          </Button>
        </DialogActions>
      }
    >
      <div className="block text-[0.8571rem] font-medium text-text-secondary">
        Destination project
        <Combobox
          label="Destination project"
          options={choices.map((p): ComboboxOption => ({
            key: p.id,
            label: p.name,
            // The current project is offered but disabled: seeing where
            // the task is now makes the choice meaningful, and moving to
            // the same project is a no-op.
            ...(p.id === currentProject
              ? { disabled: true, suffix: "(current)" }
              : {}),
          }))}
          value={selected === "" ? undefined : selected}
          onSelect={v => { setSelected(v); }}
          disabledReason="This task is already in that project."
          listTestId="move-task-project-list"
          optionTestId={o => `move-task-project-option-${o.key}`}
          searchTestId="move-task-project-search"
          trigger={p => (
            <ComboboxButton
              {...p}
              testId="move-task-project"
              dataValue={selected}
              aria-label="Destination project"
              placeholder="Choose a project…"
              className="mt-1 w-full"
            >
              {choices.find(c => c.id === selected)?.name ?? ""}
            </ComboboxButton>
          )}
        />
      </div>

      {error !== undefined && (
        <p role="alert" className="mt-3 text-[0.9286rem] text-danger-fg">
          {error}
        </p>
      )}
    </Dialog>
  );
}
