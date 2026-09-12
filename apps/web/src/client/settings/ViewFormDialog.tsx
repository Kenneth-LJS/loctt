import type { SavedQuery } from "@loctt/contracts";
import { useState } from "react";

import { useCreateView } from "../api/hooks/useCreateView.ts";
import { useEditView } from "../api/hooks/useEditView.ts";
import { AdvancedQueryEditor } from "../list/AdvancedQueryEditor.tsx";
import { Button } from "../ui/Button.tsx";
import { Callout } from "../ui/Callout.tsx";
import { Dialog, DialogActions } from "../ui/Dialog.tsx";
import { TextField } from "../ui/TextField.tsx";

/**
 * The create / rename+edit-query dialog for saved views (VUE-40,
 * VUE-41).
 *
 * One dialog serves both intents because they collect the same two
 * inputs (a name and a DSL query) through the same reused
 * `AdvancedQueryEditor` (VUE-40's "reusing the advanced query editor").
 * `existing` present ⇒ edit (`PUT /api/views/:id`, core `editView`);
 * absent ⇒ create (`POST /api/views`, core `createView`).
 *
 * A save failure keeps the dialog open with the server's message in an
 * anchored `Callout` (SET-51), so the poison-file guard (VUE-37/VUE-40's
 * "cannot poison the file") is visible rather than swallowed: the server
 * rejects a bad query with a 400 and the file is untouched.
 */
export function ViewFormDialog({
  existing,
  onClose,
}: {
  /** The view being edited; omit to create a new one. */
  readonly existing?: SavedQuery;
  readonly onClose: () => void;
}) {
  const isEdit = existing !== undefined;
  const [name, setName] = useState(existing?.name ?? "");
  const [query, setQuery] = useState(existing?.query ?? "");
  const create = useCreateView();
  const edit = useEditView();

  const pending = create.isPending || edit.isPending;
  const failure = create.error ?? edit.error;
  const nameEmpty = name.trim().length === 0;
  const queryEmpty = query.trim().length === 0;

  const submit = (): void => {
    if (nameEmpty || queryEmpty || pending) return;
    if (isEdit) {
      edit.mutate(
        { id: existing.id, body: { name: name.trim(), query: query.trim() } },
        { onSuccess: onClose },
      );
    } else {
      create.mutate(
        { name: name.trim(), query: query.trim() },
        { onSuccess: onClose },
      );
    }
  };

  return (
    <Dialog
      title={isEdit ? "Edit saved view" : "New saved view"}
      onClose={onClose}
      testId={isEdit ? "view-edit-dialog" : "view-create-dialog"}
      actions={
        <DialogActions>
          <Button variant="ghost" testId="view-form-cancel" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            testId="view-form-save"
            disabled={nameEmpty || queryEmpty || pending}
            onClick={submit}
          >
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create view"}
          </Button>
        </DialogActions>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-[0.9286rem] text-text-secondary">
          Name
          <TextField
            data-testid="view-form-name"
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              // Enter in the name field submits; the query editor is a
              // textarea and keeps its own multi-line Enter.
              if (e.key === "Enter") submit();
            }}
            placeholder="e.g. My open bugs"
          />
        </label>

        {/* VUE-40: the advanced query editor, reused rather than a
            second query box. It renders live parse errors so a bad query
            is visible before Save. */}
        <AdvancedQueryEditor value={query} onChange={setQuery} />

        {/* SET-51 / VUE-37: a save the server rejected (a query it will
            not accept, a duplicate) keeps the dialog open with the
            message anchored — the file was not written. */}
        {failure !== undefined && failure !== null && (
          <Callout tone="danger" role="alert" testId="view-form-error">
            <span>
              {failure instanceof Error ? failure.message : "The view could not be saved."}
              {" "}Your saved views on disk were not changed.
            </span>
          </Callout>
        )}
      </div>
    </Dialog>
  );
}
