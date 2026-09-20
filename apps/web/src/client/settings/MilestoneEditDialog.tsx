import type { MilestoneDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useCreateMilestone, useUpdateMilestone } from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The shared milestone editor (K100), now **mode-aware** (create + edit).
 *
 * Create and edit were two copy-pasted forms — an inline create form in
 * `MilestonesPanel` and this modal — with identical fields (name + target
 * date) and validation. They are one component now.
 *
 * MSL-14's date rule is the fiddly part and shared by both: a cleared date
 * on edit sends `null` so core drops the key — an empty string would fail
 * `IsoDate`, and `0`/epoch would be a real date the user never chose. On
 * create a blank date simply omits `target_date`.
 *
 * `mode: "edit"` requires `existing`; `mode: "create"` starts blank.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type MilestoneDialogProps =
  | { readonly mode: "edit"; readonly existing: MilestoneDef; readonly onClose: () => void }
  | { readonly mode: "create"; readonly onClose: () => void };

export function MilestoneEditDialog(props: MilestoneDialogProps) {
  const isEdit = props.mode === "edit";
  const update = useUpdateMilestone();
  const create = useCreateMilestone();

  const [name, setName] = useState(isEdit ? props.existing.name : "");
  const [date, setDate] = useState(isEdit ? (props.existing.target_date ?? "") : "");

  const dateOk = date === "" || ISO_DATE_RE.test(date);
  const nameOk = name.trim().length > 0;
  const pending = isEdit ? update.isPending : create.isPending;
  const blocked = !dateOk || !nameOk || pending;

  const submit = (): void => {
    if (blocked) return;
    if (isEdit) {
      update.mutate(
        {
          id: props.existing.id,
          name: name.trim(),
          // MSL-14: null clears the key entirely.
          target_date: date === "" ? null : date,
        },
        { onSuccess: props.onClose },
      );
      return;
    }
    create.mutate(
      { name: name.trim(), ...(date !== "" ? { target_date: date } : {}) },
      { onSuccess: props.onClose },
    );
  };

  const mutation = isEdit ? update : create;

  return (
    <Dialog
      title={isEdit ? "Edit milestone" : "New milestone"}
      onClose={props.onClose}
      testId={isEdit ? "milestone-edit-dialog" : "milestone-create-dialog"}
      actions={
        <DialogActions>
          <Button variant="ghost" testId="milestone-edit-cancel" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId={isEdit ? "milestone-save" : "milestone-create-submit"}
            disabled={blocked}
            onClick={submit}
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create"}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Name
          <TextField
            aria-label={isEdit ? "Milestone name" : "New milestone name"}
            data-testid={isEdit ? "milestone-name-input" : "milestone-create-name"}
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
          />
        </label>

        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Target date
          <input
            type="date"
            aria-label={isEdit ? "Target date" : "New milestone target date"}
            data-testid={isEdit ? "milestone-date-input" : "milestone-create-date"}
            value={date}
            onChange={e => { setDate(e.target.value); }}
            className="w-48 rounded border border-border-subtle bg-bg-surface px-2 py-1 text-[0.9286rem]"
          />
        </label>

        {!dateOk && (
          <p role="alert" data-testid="milestone-date-invalid" className="text-[0.8571rem] text-danger-fg">
            Target date must be an ISO date like <code>2026-03-31</code>.
          </p>
        )}

        {mutation.isError && (
          <Callout tone="danger" role="alert" testId="milestone-edit-error">
            <span>
              {mutation.error instanceof ApiError ? mutation.error.message : "Could not save."}
            </span>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
