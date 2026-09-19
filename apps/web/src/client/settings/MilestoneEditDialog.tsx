import type { MilestoneDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useUpdateMilestone } from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The shared milestone editor (K100). Extracted from `MilestonesPanel`'s
 * inline edit branch so an edit from Settings and one from a point of use
 * (the sidebar's Milestones rows, the `/milestones` view rows) go through
 * the *same* component — same fields (name + target date), same
 * validation (`ISO_DATE_RE`), and the same MSL-14 null-clears-the-date
 * rule, over the same `useUpdateMilestone` mutation.
 *
 * `existing` is required — this dialog only edits; creation stays in the
 * panel's create form.
 *
 * MSL-14's date rule is the fiddly part: a cleared date sends `null` so
 * core drops the key entirely — an empty string would fail `IsoDate`, and
 * `0`/epoch would be a real date the user never chose.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function MilestoneEditDialog({
  existing,
  onClose,
}: {
  readonly existing: MilestoneDef;
  readonly onClose: () => void;
}) {
  const update = useUpdateMilestone();
  const [name, setName] = useState(existing.name);
  const [date, setDate] = useState(existing.target_date ?? "");

  const dateOk = date === "" || ISO_DATE_RE.test(date);
  const nameOk = name.trim().length > 0;
  const blocked = !dateOk || !nameOk || update.isPending;

  const submit = (): void => {
    if (blocked) return;
    update.mutate(
      {
        id: existing.id,
        name: name.trim(),
        // MSL-14: null clears the key entirely. "" would be rejected by
        // IsoDate, and any epoch default would be a real date the user
        // never chose.
        target_date: date === "" ? null : date,
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      title="Edit milestone"
      onClose={onClose}
      testId="milestone-edit-dialog"
      actions={
        <DialogActions>
          <Button variant="ghost" testId="milestone-edit-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId="milestone-save"
            disabled={blocked}
            onClick={submit}
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Name
          <TextField
            aria-label="Milestone name"
            data-testid="milestone-name-input"
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
            aria-label="Target date"
            data-testid="milestone-date-input"
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

        {update.isError && (
          <Callout tone="danger" role="alert" testId="milestone-edit-error">
            <span>
              {update.error instanceof ApiError ? update.error.message : "Could not save."}
            </span>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
