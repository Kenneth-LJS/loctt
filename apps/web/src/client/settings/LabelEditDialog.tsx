import type { EntityColor, LabelDef } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useCreateLabel } from "../api/hooks/useCreateLabel.ts";
import { useUpdateLabel } from "../api/hooks/useDataMutations.ts";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { ColorHexAlias, ColorPicker } from "../ui/ColorPicker.tsx";
import { DialogActions } from "../ui/Dialog.tsx";
import { isValidEntityColor } from "../ui/entityColor.ts";
import { LABEL_PILL_CLASS, labelPillStyle } from "../ui/labelPillStyle.ts";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { TextField } from "../ui/TextField.tsx";
import { ThemePreview } from "../ui/ThemePreview.tsx";

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
  // K103: a label's colour is a full `EntityColor` on both read AND
  // write. The write path (`useCreateLabel`/`useUpdateLabel`, the
  // `/api/labels` handlers, and `CreateLabelInput`/`editLabel` in core)
  // was widened alongside this dialog, so a label can now store any of
  // the three shapes exactly like a workflow entity — it was the one
  // entity that could read them but not write them.
  //
  // Seeding resolves through core so an already-stored palette or
  // per-mode colour renders as its current hex in the alias field.
  const [color, setColor] = useState<EntityColor | undefined>(
    isEdit ? props.existing.color : undefined,
  );
  const [acknowledgedDuplicate, setAcknowledgedDuplicate] = useState(false);

  // Validity is the SCHEMA's judgement, never a local regex — a
  // hand-rolled copy is what silently dropped colours in
  // `dropInvalidColor` and `cells.tsx`.
  const colorOk = color === undefined || isValidEntityColor(color);
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
        { id: props.existing.id, name: trimmed, color: color ?? null },
        { onSuccess: props.onClose },
      );
      return;
    }
    if (needsAck) { setAcknowledgedDuplicate(true); return; }
    create.mutate(
      { name: trimmed, ...(color !== undefined ? { color } : {}) },
      { onSuccess: props.onClose },
    );
  };

  const mutation = isEdit ? update : create;
  const nameTestId = isEdit ? "label-name-input" : "label-create-name";
  const colorTestId = isEdit ? "label-color-input" : "label-create-color";

  return (
    <ResponsiveDialog
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
            loading={pending}
            aria-label={isEdit ? "Save changes" : needsAck ? "Create anyway" : "Create"}
            onClick={submit}
          >
            {isEdit ? "Save changes" : needsAck ? "Create anyway" : "Create"}
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

        <div className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          <span>Colour</span>
          <ColorPicker
            value={color}
            onChange={setColor}
            testId={isEdit ? "label-color-picker" : "label-create-color-picker"}
            ariaLabel={isEdit ? "Label colour" : "New label colour"}
          />
          {/* The hex alias keeps the original `-color-input` testid
              addressable, so the tests (and the e2e suite) that set a
              colour by typing still drive real behaviour. It is
              `sr-only` — the visible control is the picker. */}
          <ColorHexAlias
            value={color}
            onChange={setColor}
            testId={colorTestId}
            ariaLabel={isEdit ? "Label colour hex" : "New label colour hex"}
          />

          {/* The two-mode preview, so picking a colour does not mean
              pick → save → exit → toggle the theme → discover it does
              not read → come back and edit again (Ken, 2026-09-23).

              The specimen is the REAL pill, not a swatch: a label is
              painted with three values derived from the colour — a 13%
              background wash, a 40% border and a luma-chosen text
              colour (`labelPillStyle`) — none of which a flat swatch
              shows. A palette swatch says "blue"; it does not say that
              at 13% alpha this blue is a smudge on a dark surface.

              `render` is called once per mode with THAT mode's resolved
              hex, so neither half reads the global theme. Note this
              dialog has no icon field, so it holds no `IconColorFields`
              and renders the primitive directly. */}
          <ThemePreview
            color={color}
            testId={isEdit ? "label-color-preview" : "label-create-color-preview"}
            ariaLabel="Label colour preview"
            render={hex => (
              <span className={LABEL_PILL_CLASS} style={labelPillStyle(hex)}>
                <span className="max-w-[14ch] truncate">
                  {trimmed === "" ? "Label" : trimmed}
                </span>
              </span>
            )}
          />
        </div>

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
            Pick a palette colour, or enter a 6-digit hex value like{" "}
            <code>#aabbcc</code>. Leave it empty for no colour.
          </p>
        )}

        {duplicate && (
          <p
            data-testid="label-duplicate-warning"
            data-label-duplicate="warning"
            className="text-[0.8571rem] text-warn-fg"
          >
            A label with this name already exists. You can still create it.
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
    </ResponsiveDialog>
  );
}
