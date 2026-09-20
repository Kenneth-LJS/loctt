import type { ProjectDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import {
  useArchiveProject,
  useSetDefaultProject,
  useSetProjectPrefix,
  useUpdateProject,
} from "../api/hooks/useProjectMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The shared project editor (K100). Extracted from `ProjectsPanel`'s
 * `ProjectRow` inline edit branch so an edit from Settings and one from a
 * point of use (the sidebar's project rows) go through the *same*
 * component.
 *
 * Scope (deliberately narrow, per the K100 build brief):
 *  - **Name** — the only free field, saved on an explicit Save (PRU-6),
 *    over `useUpdateProject`. An unchanged/empty value is a no-op.
 *  - **Prefix** — kept in its own {@link PrefixEdit} confirm flow
 *    (PRU-44/PRU-45): a prefix change rewrites every task key, so it is
 *    heavyweight and must never ride the name Save. It is *not* folded
 *    into the single Save button.
 *  - **Make default** (PRU-48) and **Archive** — low-risk, non-field
 *    actions, over `useSetDefaultProject` / `useArchiveProject`.
 *
 * The **slug** is intentionally absent: it is fixed once created (links
 * depend on it), so there is nothing to edit. **Delete** stays a row-level
 * action in the panel (it needs the panel's remap picker + the
 * "at least one project" guard), and is not offered here.
 */

/**
 * PRU-44 / PRU-45: the editable project-prefix control. Moved verbatim
 * from `ProjectsPanel` into the shared dialog so the confirm flow travels
 * with point-of-use editing unchanged.
 */
function PrefixEdit({
  project,
  taskCount,
  others,
}: {
  readonly project: ProjectDef;
  readonly taskCount: number;
  readonly others: readonly ProjectDef[];
}) {
  const [draft, setDraft] = useState(project.prefix);
  const [confirming, setConfirming] = useState(false);
  const setPrefix = useSetProjectPrefix();

  const trimmed = draft.trim();
  const changed = trimmed !== project.prefix;

  // PRU-45: re-entering the project's own prefix is a no-op, not a
  // collision. Compared case-insensitively — two prefixes differing only
  // in case produce keys a human cannot tell apart.
  const exact = others.find(p => p.prefix === trimmed);
  const caseless = others.find(
    p => p.prefix.toLowerCase() === trimmed.toLowerCase(),
  );
  const clientProblem =
    trimmed.length === 0
      ? "A prefix cannot be empty."
      : exact
        ? `Prefix ${trimmed} is already used by "${exact.name}". Prefixes must be unique across the tracker.`
        : caseless
          ? `Prefix ${trimmed} differs only in case from ${caseless.prefix}, used by "${caseless.name}". Task keys from the two would be hard to tell apart.`
          : undefined;

  const serverError = setPrefix.error instanceof ApiError
    && setPrefix.error.envelope?.field === "prefix"
    ? setPrefix.error.envelope.message
    : undefined;
  const problem = clientProblem ?? serverError;

  const reset = () => {
    setConfirming(false);
    setDraft(project.prefix);
    setPrefix.reset();
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center">
        <TextField
          size="sm"
          aria-label={`Prefix of project ${project.name}`}
          data-testid={`project-prefix-${project.id}`}
          value={draft}
          onChange={e => { setDraft(e.target.value); setPrefix.reset(); }}
          invalid={problem !== undefined}
          className="w-24"
        />
        <Button
          size="sm"
          variant="ghost"
          testId={`project-prefix-save-${project.id}`}
          disabled={!changed || problem !== undefined}
          onClick={() => { setConfirming(true); }}
          className="ml-2"
        >
          Change
        </Button>
      </div>
      {problem !== undefined && changed && (
        <p
          role="alert"
          data-testid={`project-prefix-error-${project.id}`}
          className="text-[0.8571rem] text-danger-fg"
        >
          {problem}
        </p>
      )}

      {confirming && (
        <Dialog
          title={`Change ${project.name} prefix?`}
          onClose={reset}
          testId={`project-prefix-confirm-${project.id}`}
          actions={(
            <DialogActions>
              <Button
                variant="ghost"
                testId={`project-prefix-cancel-${project.id}`}
                onClick={reset}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                testId={`project-prefix-confirm-btn-${project.id}`}
                disabled={setPrefix.isPending}
                onClick={() => {
                  setPrefix.mutate(
                    { id: project.id, prefix: trimmed },
                    { onSuccess: () => { setConfirming(false); } },
                  );
                }}
              >
                {setPrefix.isPending ? "Renaming…" : `Rename ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
              </Button>
            </DialogActions>
          )}
        >
          <p className="text-[0.9286rem] text-text-secondary">
            Changing the prefix to{" "}
            <code>{trimmed}</code> renames{" "}
            {taskCount} {taskCount === 1 ? "task" : "tasks"} in this
            project. Their numbers are preserved, and their old keys will
            keep resolving.
          </p>

          {setPrefix.isError && serverError !== undefined && (
            <p role="alert" data-testid={`project-prefix-confirm-error-${project.id}`} className="mt-3 text-[0.8571rem] text-danger-fg">
              {serverError} Nothing was renamed.
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}

export function ProjectEditDialog({
  project,
  taskCount,
  others,
  isDefault,
  onClose,
}: {
  readonly project: ProjectDef;
  readonly taskCount: number;
  /** Every other project (for the PrefixEdit collision check). */
  readonly others: readonly ProjectDef[];
  readonly isDefault: boolean;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(project.name);
  const update = useUpdateProject();
  const archive = useArchiveProject();
  const setDefault = useSetDefaultProject();

  const archived = project.archived === true;
  const trimmed = name.trim();
  const nameOk = trimmed.length > 0;

  const commitName = (): void => {
    // PRU-6: the name saves on an explicit Save, never on blur. An
    // unchanged or empty value is a no-op — just close.
    if (!nameOk || trimmed === project.name) {
      onClose();
      return;
    }
    update.mutate(
      { id: project.id, name: trimmed },
      { onSuccess: onClose },
    );
  };

  return (
    <ResponsiveDialog
      title={`Edit ${project.name}`}
      onClose={onClose}
      testId={`project-edit-dialog-${project.id}`}
      actions={
        <DialogActions>
          <Button
            variant="ghost"
            testId={`project-edit-cancel-${project.id}`}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            testId={`project-name-save-${project.id}`}
            disabled={!nameOk || update.isPending}
            onClick={commitName}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Name
          <TextField
            size="sm"
            aria-label={`Name of project ${project.name}`}
            data-testid={`project-name-input-${project.id}`}
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") commitName(); }}
          />
          {update.isError && (
            <p role="alert" data-testid={`project-name-error-${project.id}`} className="text-[0.8571rem] text-danger-fg">
              {update.error instanceof ApiError ? update.error.message : "Could not save."}
            </p>
          )}
        </label>

        {/* PRU-44: the prefix, with its own confirm flow — it rewrites
            every task key, so it does not ride the name Save. */}
        <div className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          <span>
            Prefix
            <span className="ml-1 text-text-tertiary">
              — changing it renames every task in the project
            </span>
          </span>
          <PrefixEdit project={project} taskCount={taskCount} others={others} />
        </div>

        {/* PRU-48 + Archive: low-risk actions, kept out of the single
            Save so each is its own explicit act. */}
        <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
          <Button
            size="sm"
            variant="secondary"
            testId={`project-set-default-${project.id}`}
            disabled={isDefault || archived || setDefault.isPending}
            title={
              isDefault
                ? "This is already the default project."
                : archived
                  ? "An archived project cannot be the default."
                  : undefined
            }
            onClick={() => { setDefault.reset(); setDefault.mutate({ id: project.id }); }}
          >
            {isDefault ? "Default (current)" : "Make default"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            testId={`project-archive-${project.id}`}
            disabled={archive.isPending}
            onClick={() => { archive.reset(); archive.mutate({ id: project.id, archived: !archived }); }}
          >
            {archived ? "Unarchive" : "Archive"}
          </Button>
        </div>

        {setDefault.isError && (
          <Callout tone="danger" role="alert" testId={`project-set-default-error-${project.id}`}>
            <span>
              {setDefault.error instanceof ApiError ? setDefault.error.message : "Could not set the default project."}
            </span>
          </Callout>
        )}
        {archive.isError && (
          <Callout tone="danger" role="alert" testId={`project-archive-error-${project.id}`}>
            <span>
              {archive.error instanceof ApiError ? archive.error.message : "Could not change the archived state."}
            </span>
          </Callout>
        )}
      </div>
    </ResponsiveDialog>
  );
}
