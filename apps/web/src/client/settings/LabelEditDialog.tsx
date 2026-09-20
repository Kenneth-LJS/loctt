import type { LabelDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useCreateLabel } from "../api/hooks/useCreateLabel.ts";
import { useUpdateLabel } from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The shared label editor (K100), now **mode-aware** (create + edit).
 *
 * Create and edit used to be two copy-pasted forms — an inline
 * `CreateLabelForm` in `LabelsPanel` and this modal — with identical
 * fields (name + hex colour) and identical validation. They are one
 * component now: the same fields, the same `HEX_RE` validation
 * (MSL-37, empty = no colour), differing only where create genuinely
 * differs.
 *
 * Create-specific bits kept as a create-mode branch (not a separate
 * component): the MSL-34 duplicate-name caution — names are not unique, so
 * a duplicate is a caution shown before confirming, never an error or a
 * block, and "Create anyway" acknowledges it. Edit has no such branch (a
 * rename to a duplicate is equally fine and equally non-blocking, and the
 * edit path never carried the caution).
 *
 * `mode: "edit"` requires `existing`. `mode: "create"` takes `existing`
 * (the current labels) as the duplicate-check set.
 */

/** MSL-37: the format the editor accepts, stated to the user. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function isValidColor(value: string): boolean {
  return value === "" || HEX_RE.test(value);
}

export type LabelDialogProps =
  | {
      readonly mode: "edit";
      readonly existing: LabelDef;
      readonly onClose: () => void;
    }
  | {
      readonly mode: "create";
      /** The current labels — the MSL-34 duplicate-name check set. */
      readonly existingLabels: readonly LabelDef[];
      readonly onClose: () => void;
    };

export function LabelEditDialog(props: LabelDialogProps) {
  const isEdit = props.mode === "edit";
  const update = useUpdateLabel();
  const create = useCreateLabel();

  const [name, setName] = useState(isEdit ? props.existing.name : "");
  const [color, setColor] = useState(isEdit ? (props.existing.color ?? "") : "");
  const [acknowledgedDuplicate, setAcknowledgedDuplicate] = useState(false);

  const colorOk = isValidColor(color);
  const trimmed = name.trim();
  const nameOk = trimmed.length > 0;
  const pending = isEdit ? update.isPending : create.isPending;

  // MSL-34: a create-time duplicate is a caution, not a block.
  const duplicate = !isEdit
    && trimmed !== ""
    && props.existingLabels.some(l => l.name.toLowerCase() === trimmed.toLowerCase());
  const needsAck = duplicate && !acknowledgedDuplicate;

  const blocked = !colorOk || !nameOk || pending;

  const submit = (): void => {
    if (blocked) return;
    if (isEdit) {
      update.mutate(
        { id: props.existing.id, name: trimmed, color: color === "" ? null : color },
        { onSuccess: props.onClose },
      );
      return;
    }
    if (needsAck) { setAcknowledgedDuplicate(true); return; }
    create.mutate(
      { name: trimmed, ...(color !== "" ? { color } : {}) },
      { onSuccess: props.onClose },
    );
  };

  const mutation = isEdit ? update : create;
  const nameTestId = isEdit ? "label-name-input" : "label-create-name";
  const colorTestId = isEdit ? "label-color-input" : "label-create-color";

  return (
    <Dialog
      title={isEdit ? "Edit label" : "New label"}
      onClose={props.onClose}
      testId={isEdit ? "label-edit-dialog" : "label-create-dialog"}
      actions={
        <DialogActions>
          <Button variant="ghost" testId="label-edit-cancel" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId={isEdit ? "label-save" : "label-create-submit"}
            disabled={blocked}
            onClick={submit}
          >
            {pending
              ? "Saving…"
              : isEdit ? "Save changes" : needsAck ? "Create anyway" : "Create"}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Name
          <TextField
            aria-label={isEdit ? "Label name" : "New label name"}
            data-testid={nameTestId}
            autoFocus
            value={name}
            onChange={e => { setName(e.target.value); setAcknowledgedDuplicate(false); }}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
          />
        </label>

        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Colour
          <TextField
            aria-label={isEdit ? "Label colour" : "New label colour"}
            data-testid={colorTestId}
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
          <p
            role="alert"
            data-testid={isEdit ? "label-color-invalid" : "label-create-color-invalid"}
            className="text-[0.8571rem] text-danger-fg"
          >
            Colour must be a 6-digit hex value like <code>#aabbcc</code>. Leave
            it empty for no colour.
          </p>
        )}

        {duplicate && (
          <p
            data-testid="label-duplicate-warning"
            data-label-duplicate="warning"
            className="text-[0.8571rem] text-warn-fg"
          >
            A label with this name already exists. Label names do not have to be
            unique — you can create it anyway, and both will be shown with their
            colours to tell them apart.
          </p>
        )}

        {mutation.isError && (
          <Callout tone="danger" role="alert" testId="label-edit-error">
            <span>
              {mutation.error instanceof ApiError ? mutation.error.message : "Could not save."}
            </span>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
