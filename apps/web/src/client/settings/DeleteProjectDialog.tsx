import type { ProjectDef } from "@loctt/contracts";
import type { UseMutationResult } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import type {
  DeleteProjectResult,
  DeleteProjectVars,
} from "../api/hooks/useProjectMutations.ts";
import { Modal } from "../ui/Modal.tsx";

/**
 * PRU-17, PRU-33, PRU-34.
 *
 * The dialog names the project, repeats the reference count in words
 * the user can act on, and requires an explicit remap target when the
 * project holds tasks — there is no default that silently orphans
 * them. Cancelling issues no request at all.
 */
export function DeleteProjectDialog({
  project,
  taskCount,
  others,
  mutation,
  onClose,
}: {
  readonly project: ProjectDef;
  readonly taskCount: number;
  readonly others: readonly ProjectDef[];
  readonly mutation: UseMutationResult<DeleteProjectResult, Error, DeleteProjectVars>;
  readonly onClose: () => void;
}) {
  const [remapTo, setRemapTo] = useState("");
  const needsRemap = taskCount > 0;
  const blocked = (needsRemap && remapTo === "") || mutation.isPending;

  // PRU-34: a partial remap must report the true split rather than a
  // bare success. The server rejects the config change when the remap
  // did not complete, so the project is still present — say that.
  const envelope = mutation.error instanceof ApiError
    ? mutation.error.envelope
    : undefined;

  const result = mutation.data;

  if (result !== undefined) {
    return (
      <Modal title="Project deleted" onClose={onClose}>
        <p data-testid="project-delete-result" className="text-[13px] text-text-secondary">
          {result.remappedTaskCount > 0
            ? `Deleted "${project.name}". ${String(result.remappedTaskCount)} task${result.remappedTaskCount === 1 ? "" : "s"} moved to the project you chose; their existing keys are unchanged.`
            : `Deleted "${project.name}".`}
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-accent-contrast"
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={`Delete "${project.name}"?`} onClose={onClose}>
      <div className="grid gap-3" data-testid="project-delete-dialog">
        <p className="text-[13px] text-text-secondary">
          {needsRemap
            ? `${String(taskCount)} task${taskCount === 1 ? "" : "s"} reference this project. Choose where they should go — their existing keys will not change.`
            : `No tasks reference this project.`}
        </p>

        {needsRemap && (
          <label className="grid gap-1 text-[13px]">
            <span className="text-text-secondary">Move those tasks to</span>
            <select
              data-testid="project-delete-remap"
              value={remapTo}
              onChange={e => { setRemapTo(e.target.value); }}
              className="h-8 rounded-md border border-border-default bg-bg-surface px-2 text-[13px]"
            >
              <option value="">Choose a project…</option>
              {others.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>
        )}

        <p className="text-[12px] text-text-tertiary">
          Deleting is permanent. Archiving hides the project instead and can
          be undone.
        </p>

        {mutation.isError && (
          <div role="alert" data-testid="project-delete-error" className="text-[12px] text-danger-fg">
            <p>{envelope?.message ?? mutation.error.message}</p>
            <p className="mt-1 text-text-secondary">
              The project has not been removed.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="project-delete-cancel"
            onClick={onClose}
            className="h-8 rounded-md px-3 text-[13px] text-text-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="project-delete-confirm"
            disabled={blocked}
            onClick={() => {
              mutation.mutate({
                id: project.id,
                ...(remapTo !== "" ? { remapTo } : {}),
              });
            }}
            className="h-8 rounded-md bg-danger-fg px-3 text-[13px] font-medium text-accent-contrast disabled:opacity-50"
          >
            {mutation.isPending ? "Deleting…" : "Delete project"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
