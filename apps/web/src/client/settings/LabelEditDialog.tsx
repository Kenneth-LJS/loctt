import type { LabelDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useUpdateLabel } from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The shared label editor (K100). Extracted from `LabelsPanel`'s inline
 * edit branch so an edit made from the Settings panel and one made from a
 * point of use (the sidebar's Labels rows) go through the *same*
 * component — same fields (name + hex colour), same validation (MSL-37's
 * `HEX_RE`, empty = no colour), and the same `useUpdateLabel` mutation.
 * Per K100, in-place editing is only allowed because this one component
 * owns the write, so the two surfaces cannot drift.
 *
 * `existing` is required — this dialog only edits. Creation stays in the
 * panel's `CreateLabelForm` (it carries the MSL-34 duplicate caution,
 * which is a create-time concern).
 */

/** MSL-37: the format the editor accepts, stated to the user. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isValidColor(value: string): boolean {
  return value === "" || HEX_RE.test(value);
}

export function LabelEditDialog({
  existing,
  onClose,
}: {
  readonly existing: LabelDef;
  readonly onClose: () => void;
}) {
  const update = useUpdateLabel();
  const [name, setName] = useState(existing.name);
  const [color, setColor] = useState(existing.color ?? "");

  const colorOk = isValidColor(color);
  const nameOk = name.trim().length > 0;
  const blocked = !colorOk || !nameOk || update.isPending;

  const submit = (): void => {
    if (blocked) return;
    update.mutate(
      { id: existing.id, name: name.trim(), color: color === "" ? null : color },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog
      title="Edit label"
      onClose={onClose}
      testId="label-edit-dialog"
      actions={
        <DialogActions>
          <Button variant="ghost" testId="label-edit-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId="label-save"
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
            aria-label="Label name"
            data-testid="label-name-input"
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
          />
        </label>

        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Colour
          <TextField
            aria-label="Label colour"
            data-testid="label-color-input"
            value={color}
            placeholder="#aabbcc"
            onChange={e => { setColor(e.target.value); }}
          />
        </label>

        {/*
          MSL-37: rejected at the input, naming the expected format, with
          Save blocked — nothing partially-written reaches labels.yaml.
        */}
        {!colorOk && (
          <p role="alert" data-testid="label-color-invalid" className="text-[0.8571rem] text-danger-fg">
            Colour must be a 6-digit hex value like <code>#aabbcc</code>. Leave
            it empty for no colour.
          </p>
        )}

        {update.isError && (
          <Callout tone="danger" role="alert" testId="label-edit-error">
            <span>
              {update.error instanceof ApiError ? update.error.message : "Could not save."}
            </span>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
