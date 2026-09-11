import type { ProjectDef } from "@loctt/contracts";
import { useState } from "react";

import { Button } from "../ui/Button.tsx";
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
 * without; the raw action `<button>`s are now `Button` (design-review
 * §B2). The destination `<select>` stays raw for now — migrating it to
 * `ui/Select` is design-review §B4, a separate item.
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
      <label className="block text-[12px] font-medium text-text-secondary">
        Destination project
        <select
          value={selected}
          onChange={e => { setSelected(e.target.value); }}
          aria-label="Destination project"
          className="mt-1 w-full rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-1.5 text-[13px] text-text-primary"
        >
          <option value="">Choose a project…</option>
          {choices.map(p => (
            <option key={p.id} value={p.id} disabled={p.id === currentProject}>
              {p.name}
              {p.id === currentProject ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>

      {error !== undefined && (
        <p role="alert" className="mt-3 text-[13px] text-danger-fg">
          {error}
        </p>
      )}
    </Dialog>
  );
}
