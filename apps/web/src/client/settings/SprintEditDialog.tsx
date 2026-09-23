import type { SprintDef, SprintState } from "@loctt/contracts";
import { useState } from "react";

import { ApiError } from "../api/client.ts";
import { useCreateSprint } from "../api/hooks/useDataMutations.ts";
import { useUpdateSprintMeta } from "../api/hooks/useSprintDetail.ts";
import { attributeSprintError } from "../sprints/SprintMetaHeader.tsx";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { SelectCombobox } from "../ui/Combobox.tsx";
import { DialogActions } from "../ui/Dialog.tsx";
import { Field } from "../ui/Field.tsx";
import { ResponsiveDialog } from "../ui/ResponsiveDialog.tsx";
import { TextArea } from "../ui/TextArea.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The shared sprint editor (K100/K105), **mode-aware** (create + edit).
 *
 * Before this, create was an inline form in `SprintsPanel` and edit lived
 * only on the sprint detail route (`SprintMetaHeader`). The Settings panel
 * had create but no edit; the detail route had edit but not from the list.
 * This is the single self-contained dialog both the Settings panel and
 * (later) the sidebar render, so the sprint create/edit form cannot fork.
 *
 * It owns its own mutations, validation and error-anchoring:
 *  - **create** → `useCreateSprint` (POST /api/sprints). A263 goal-on-create
 *    is a direct field on the create body, omitted when blank.
 *  - **edit** → `useUpdateSprintMeta` (PUT /api/sprints/:id), the same
 *    combined-patch hook the detail header uses (A147): only changed fields
 *    are sent, and a cleared goal is sent as `null` so core drops the key
 *    rather than storing an empty goal.
 *
 * The window rule (`end_date` before `start_date`) is enforced by core and
 * attributed back to the End field via `attributeSprintError`, the same
 * message-based attribution `SprintMetaHeader` uses (the server over-labels
 * every sprint error as `end_date`, so its `field` alone cannot be trusted).
 *
 * `mode: "edit"` requires `existing`; `mode: "create"` starts blank.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const STATES = ["active", "completed", "future"] as const;
const STATE_LABEL: Record<SprintState, string> = {
  active: "Active",
  completed: "Completed",
  future: "Future",
};

export type SprintDialogProps =
  | { readonly mode: "edit"; readonly existing: SprintDef; readonly onClose: () => void }
  | { readonly mode: "create"; readonly onClose: () => void };

export function SprintEditDialog(props: SprintDialogProps) {
  const isEdit = props.mode === "edit";
  const create = useCreateSprint();
  const update = useUpdateSprintMeta();

  const [name, setName] = useState(isEdit ? props.existing.name : "");
  const [start, setStart] = useState(isEdit ? props.existing.start_date : "");
  const [end, setEnd] = useState(isEdit ? props.existing.end_date : "");
  const [state, setState] = useState<SprintState>(isEdit ? props.existing.state : "active");
  const [goal, setGoal] = useState(isEdit ? (props.existing.goal ?? "") : "");

  const nameOk = name.trim().length > 0;
  const startOk = ISO_DATE_RE.test(start);
  const endOk = ISO_DATE_RE.test(end);
  // Client-side window guard so an obviously-inverted window is caught
  // before the round-trip; core is still the authority and re-checks it.
  const windowOk = !startOk || !endOk || end >= start;
  const pending = isEdit ? update.isPending : create.isPending;
  const blocked = !nameOk || !startOk || !endOk || !windowOk || pending;

  const submit = (): void => {
    if (blocked) return;
    if (isEdit) {
      // Combined patch of only the changed fields (A147), diffed against the
      // record the dialog opened on. A cleared goal is sent as `null` so
      // core drops the key; an untouched field is never sent.
      const patch: Record<string, unknown> = {};
      const trimmedName = name.trim();
      if (trimmedName !== props.existing.name) patch.name = trimmedName;
      if (start !== props.existing.start_date) patch.start_date = start;
      if (end !== props.existing.end_date) patch.end_date = end;
      if (state !== props.existing.state) patch.state = state;
      const trimmedGoal = goal.trim();
      const existingGoal = props.existing.goal ?? "";
      if (trimmedGoal !== existingGoal) patch.goal = trimmedGoal === "" ? null : trimmedGoal;

      if (Object.keys(patch).length === 0) {
        // Nothing changed — Save is a no-op close, no write.
        props.onClose();
        return;
      }
      update.mutate(
        { id: props.existing.id, patch },
        { onSuccess: props.onClose },
      );
      return;
    }
    create.mutate(
      {
        name: name.trim(),
        start_date: start,
        end_date: end,
        state,
        // A263: goal is optional free text; omit it when blank so the
        // stored sprint has no empty goal key.
        ...(goal.trim().length > 0 ? { goal: goal.trim() } : {}),
      },
      { onSuccess: props.onClose },
    );
  };

  const mutation = isEdit ? update : create;
  // The server over-labels every sprint error as `end_date`; attribute it
  // from the message so a window-rule failure lands on the End field and
  // anything else shows only in the generic Callout.
  const errorField = mutation.isError && mutation.error instanceof ApiError
    ? attributeSprintError(mutation.error.message)
    : null;
  const errorMessage = mutation.error instanceof ApiError
    ? mutation.error.message
    : "Could not save the sprint.";

  const tid = (field: string): string => (isEdit ? `sprint-edit-${field}` : `sprint-create-${field}`);

  return (
    <ResponsiveDialog
      title={isEdit ? "Edit sprint" : "New sprint"}
      onClose={props.onClose}
      testId={isEdit ? "sprint-edit-dialog" : "sprint-create-dialog"}
      actions={
        <DialogActions>
          <Button variant="ghost" testId="sprint-edit-cancel" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId={isEdit ? "sprint-save" : "sprint-create-submit"}
            disabled={blocked}
            loading={pending}
            aria-label={isEdit ? "Save" : "Create sprint"}
            onClick={submit}
          >
            {isEdit ? "Save" : "Create sprint"}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <TextField
            aria-label={isEdit ? "Sprint name" : "New sprint name"}
            data-testid="sprint-create-name"
            autoFocus
            value={name}
            placeholder="Sprint 12"
            onChange={e => { setName(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
          />
        </Field>

        <div className="flex flex-wrap gap-3">
          <Field label="Start">
            <TextField
              aria-label={isEdit ? "Start date" : "New sprint start date"}
              data-testid="sprint-create-start"
              type="date"
              invalid={start !== "" && !startOk}
              value={start}
              onChange={e => { setStart(e.target.value); }}
            />
          </Field>
          <Field label="End">
            <TextField
              aria-label={isEdit ? "End date" : "New sprint end date"}
              data-testid="sprint-create-end"
              type="date"
              invalid={(end !== "" && !endOk) || !windowOk}
              value={end}
              onChange={e => { setEnd(e.target.value); }}
            />
          </Field>
          <Field label="State">
            <SelectCombobox
              aria-label={isEdit ? "Sprint state" : "New sprint state"}
              testId="sprint-create-state"
              value={state}
              onChange={v => { setState(v as SprintState); }}
              options={STATES.map(s => ({ value: s, label: STATE_LABEL[s] }))}
            />
          </Field>
        </div>

        {!windowOk && (
          <p role="alert" data-testid={tid("window-invalid")} className="text-[0.8571rem] text-danger-fg">
            End date must not be before the start date.
          </p>
        )}

        <Field
          label="Goal"
          hint="Optional — what this sprint is for"
        >
          <TextArea
            aria-label={isEdit ? "Sprint goal" : "New sprint goal"}
            data-testid="sprint-create-goal"
            value={goal}
            rows={2}
            placeholder="What this sprint is for (optional)"
            onChange={e => { setGoal(e.target.value); }}
          />
        </Field>

        {mutation.isError && (
          <Callout
            tone="danger"
            role="alert"
            testId={errorField === "end_date" ? "sprint-edit-error-end_date" : "sprint-edit-error"}
          >
            <span>{errorMessage}</span>
          </Callout>
        )}
      </div>
    </ResponsiveDialog>
  );
}
