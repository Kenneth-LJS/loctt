import type { PriorityDef, StatusDef, TaskTypeDef } from "@loctt/contracts";
import { useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { Select } from "../ui/Select.tsx";
import { TextField } from "../ui/TextField.tsx";
import {
  type EntryProblems,
  hasNoProblems,
  keyFromLabel,
  validateNewEntry,
} from "./workflowForms.ts";

/**
 * The Create / Edit dialog for a status, priority or task-type
 * (SET-46, SET-47, and the SET-28/SET-51 edit-model for these three
 * collections).
 *
 * View-by-default: value edits that used to auto-save inline on blur now
 * live behind this dialog, per open decision #3 — reorder stays inline,
 * value edits do not. The dialog collects the fields, validates the key
 * for uniqueness before the `PUT`, and on a failed save **stays open**
 * with the error anchored in a `Callout` (SET-51). Cancel discards.
 *
 * `mode` decides what is editable: on create the key is a `TextField`;
 * on edit it is shown as read-only `code` (a key is permanent —
 * `EnumCollectionPanel`'s header comment), and only the label / category
 * / default change.
 */

type Collection = "statuses" | "priorities" | "task_types";
type Row = StatusDef | PriorityDef | TaskTypeDef;

const CATEGORIES = ["pending", "active", "completed", "discarded"] as const;

const NOUN: Record<Collection, string> = {
  statuses: "status",
  priorities: "priority",
  task_types: "task type",
};

export interface EntryDialogResult {
  readonly key: string;
  readonly label: string;
  readonly category?: StatusDef["category"];
  readonly makeDefault?: boolean;
}

export function EntryEditDialog({
  collection,
  mode,
  existingKeys,
  initial,
  pending,
  error,
  onSubmit,
  onClose,
}: {
  readonly collection: Collection;
  readonly mode: "create" | "edit";
  /** Keys already in the collection — the collision set (create only). */
  readonly existingKeys: readonly string[];
  readonly initial?: Row | undefined;
  readonly pending: boolean;
  /** A save error to anchor in the dialog (SET-51). */
  readonly error?: string | undefined;
  readonly onSubmit: (result: EntryDialogResult) => void;
  readonly onClose: () => void;
}) {
  const isStatus = collection === "statuses";
  const noun = NOUN[collection];

  const [label, setLabel] = useState(initial?.label ?? "");
  const [key, setKey] = useState(initial?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(mode === "edit");
  const [category, setCategory] = useState<StatusDef["category"]>(
    (initial as StatusDef | undefined)?.category ?? "pending",
  );
  const [makeDefault, setMakeDefault] = useState(
    (initial as StatusDef | undefined)?.default === true,
  );

  // On create, the key tracks the label until the user edits the key
  // directly — the same derive-then-detach behaviour project slugs use.
  const effectiveKey = mode === "create" && !keyTouched ? keyFromLabel(label) : key;

  const problems: EntryProblems =
    mode === "create"
      ? validateNewEntry({ key: effectiveKey, label }, existingKeys)
      : (label.trim().length === 0 ? { label: "A label is required." } : {});

  const canSubmit = hasNoProblems(problems) && !pending;

  const submit = (): void => {
    if (!canSubmit) return;
    onSubmit({
      key: effectiveKey.trim(),
      label: label.trim(),
      ...(isStatus ? { category } : {}),
      ...(isStatus ? { makeDefault } : {}),
    });
  };

  return (
    <Dialog
      title={mode === "create" ? `New ${noun}` : `Edit ${noun}`}
      onClose={onClose}
      testId={`${collection}-entry-dialog`}
      actions={
        <DialogActions>
          <Button variant="ghost" onClick={onClose} testId={`${collection}-entry-cancel`}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!canSubmit}
            onClick={submit}
            testId={`${collection}-entry-save`}
          >
            {pending ? "Saving…" : mode === "create" ? `Add ${noun}` : "Save"}
          </Button>
        </DialogActions>
      }
    >
      <div className="space-y-3 text-[0.9286rem]">
        <label className="block">
          <span className="mb-1 block text-text-secondary">Label</span>
          <TextField
            size="sm"
            data-testid={`${collection}-entry-label`}
            value={label}
            invalid={problems.label !== undefined}
            onChange={e => { setLabel(e.target.value); }}
            aria-label={`Label for the new ${noun}`}
          />
          {problems.label !== undefined && (
            <span data-testid={`${collection}-entry-label-error`} className="mt-1 block text-[0.8571rem] text-danger-fg">
              {problems.label}
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-text-secondary">Key</span>
          {mode === "create" ? (
            <>
              <TextField
                size="sm"
                data-testid={`${collection}-entry-key`}
                value={effectiveKey}
                invalid={problems.key !== undefined}
                onChange={e => { setKeyTouched(true); setKey(e.target.value); }}
                aria-label={`Key for the new ${noun}`}
              />
              <span className="mt-1 block text-[0.8571rem] text-text-tertiary">
                A key is permanent — task files store it, so it cannot be
                renamed later.
              </span>
              {problems.key !== undefined && (
                <span data-testid={`${collection}-entry-key-error`} className="mt-1 block text-[0.8571rem] text-danger-fg">
                  {problems.key}
                </span>
              )}
            </>
          ) : (
            <code
              data-testid={`${collection}-entry-key-readonly`}
              className="inline-block rounded bg-bg-muted px-1 py-0.5 text-[0.8571rem] text-text-secondary"
              title="A key is permanent: task files store it, so renaming it in place would orphan them."
            >
              {initial?.key}
            </code>
          )}
        </label>

        {isStatus && (
          <label className="block">
            <span className="mb-1 block text-text-secondary">Category</span>
            <Select
              size="sm"
              data-testid={`${collection}-entry-category`}
              value={category}
              onChange={e => { setCategory(e.target.value as StatusDef["category"]); }}
              aria-label={`Category for the ${noun}`}
            >
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </Select>
          </label>
        )}

        {isStatus && (
          <label className="flex items-center gap-2 text-text-secondary">
            <Checkbox
              data-testid={`${collection}-entry-default`}
              checked={makeDefault}
              onChange={e => { setMakeDefault(e.target.checked); }}
            />
            Make this the default status — new tasks land here.
          </label>
        )}

        {/* SET-51: a failed save is anchored here, not thrown as a toast,
            and the dialog stays open with the edit un-committed. */}
        {error !== undefined && (
          <Callout tone="danger" role="alert" testId={`${collection}-entry-error`}>
            {error}
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
