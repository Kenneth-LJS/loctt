import { useState } from "react";

import { Button } from "../ui/Button.tsx";
import { Combobox, ComboboxButton, type ComboboxOption } from "../ui/Combobox.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Radio } from "../ui/Radio.tsx";

/**
 * Deleting a workflow key that tasks still reference (SET-17, SET-19).
 *
 * The confirm requires an explicit choice — remap to another key, or
 * clear the field on the referencing tasks — with no default that
 * silently orphans anything. "Clear" is offered because SET-17 says it
 * is allowed; it is not the default, and picking it states what will
 * happen (the field is cleared on those tasks; they become field-less)
 * before the user commits.
 *
 * BUG-2 (decided 2026-09-06, "fix the copy"): the server clears the
 * field on this branch — the deleted key is remapped to `null`, which
 * `workflow-write.ts` treats as "clear the field entirely". Earlier
 * copy promised a dangling reference + drift marker + a failing
 * Diagnostics check; that was never the behaviour, so the copy now
 * states plainly that the field is cleared. (SET-18 — a task reaching
 * the dangling state — is a separate hand-edit-underneath path.)
 *
 * The count comes from `/api/workflow/usage`, which walks the tasks;
 * it is shown on the row *and* repeated here, which is SET-19's
 * "the count is repeated in the confirm".
 *
 * The server refuses a deletion of an in-use key with no remap
 * (`validateRemapCoversDeletions`), so a caller that bypassed this
 * dialog cannot orphan anything either — this is the explanation, not
 * the enforcement.
 */

export type RemapChoice =
  /** `null` in the remap table: clear the field, leaving it unset. */
  | { readonly kind: "clear" }
  | { readonly kind: "remap"; readonly to: string };

export function RemapDeleteDialog({
  noun,
  itemLabel,
  itemKey,
  count,
  alternatives,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  /** "status", "priority", "value" — used in the prose. */
  readonly noun: string;
  readonly itemLabel: string;
  readonly itemKey: string;
  readonly count: number;
  /** The other keys in this collection, as `{key,label}`. */
  readonly alternatives: readonly { readonly key: string; readonly label: string }[];
  readonly pending: boolean;
  readonly error?: string | undefined;
  readonly onConfirm: (choice: RemapChoice) => void;
  readonly onClose: () => void;
}) {
  /**
   * No default. SET-17: the confirm *requires* a choice.
   *
   * `null` is "nothing picked yet" and `{kind:"clear"}` is the
   * explicit clear-the-field choice — kept as the same discriminated
   * union the caller receives, so "unpicked" can never be mistaken for
   * "clear" by a stringly-typed comparison.
   */
  const [choice, setChoice] = useState<RemapChoice | null>(null);

  const inUse = count > 0;
  const blocked =
    pending ||
    (inUse && choice === null) ||
    // "Reassign" chosen but no target picked yet — nothing to remap onto,
    // so the delete stays blocked (mirrors UserDeleteDialog).
    (choice?.kind === "remap" && choice.to === "");

  return (
    <Modal title={`Delete ${noun} "${itemLabel}"`} onClose={onClose}>
      <p data-testid="remap-refcount" className="text-[0.9286rem] text-text-secondary">
        {inUse
          ? `${String(count)} task${count === 1 ? "" : "s"} currently ${count === 1 ? "uses" : "use"} `
          : `No tasks use `}
        <code className="rounded bg-bg-muted px-1 py-0.5">{itemKey}</code>
        {inUse ? "." : " — deleting it affects nothing."}
      </p>

      {inUse && (
        <fieldset className="mt-3 border-0 p-0" data-testid="remap-choice">
          <legend className="mb-1 text-[0.9286rem] text-text-secondary">
            What should happen to {count === 1 ? "that task" : `those ${String(count)} tasks`}?
          </legend>
          {/* A211/A242: the alternative-value set grows with the
              collection (statuses, priorities, enum values) — a searchable
              Combobox rather than one radio per alternative, matching how
              DeleteProjectDialog / UserDeleteDialog remap. A "reassign"
              radio gates the picker; the "clear" radio is the no-remap
              path. Per-option testids stay `remap-to-<key>` so the option
              targets are unchanged; the trigger carries `remap-to`.
              Dialog-safe: the Combobox's Escape stops propagation, so it
              does not also close the Modal. */}
          <label className="flex items-center gap-2 py-0.5 text-[0.9286rem]">
            <Radio
              name="remap-target"
              data-testid="remap-reassign"
              checked={choice?.kind === "remap"}
              onChange={() => {
                setChoice(prev =>
                  prev?.kind === "remap" ? prev : { kind: "remap", to: "" });
              }}
            />
            <span>
              Move {count === 1 ? "it" : "them"} to another {noun}
            </span>
          </label>
          {choice?.kind === "remap" && (
            <div className="ml-6 mb-1 grid gap-1">
              <Combobox
                label={`Move ${count === 1 ? "it" : "them"} to`}
                options={alternatives.map((alt): ComboboxOption => ({
                  key: alt.key,
                  label: alt.label,
                  hint: alt.key,
                }))}
                value={choice.to === "" ? undefined : choice.to}
                onSelect={v => { setChoice({ kind: "remap", to: v }); }}
                listTestId="remap-to-list"
                optionTestId={o => `remap-to-${o.key}`}
                searchTestId="remap-to-search"
                trigger={p => (
                  <ComboboxButton
                    {...p}
                    testId="remap-to"
                    dataValue={choice.to}
                    aria-label={`Move ${count === 1 ? "it" : "them"} to`}
                    placeholder={`Choose a ${noun}…`}
                    className="w-full"
                  >
                    {alternatives.find(a => a.key === choice.to)?.label ?? ""}
                  </ComboboxButton>
                )}
              />
            </div>
          )}
          <label className="mt-1 flex items-start gap-2 py-0.5 text-[0.9286rem]">
            <Radio
              name="remap-target"
              data-testid="remap-clear"
              checked={choice?.kind === "clear"}
              onChange={() => { setChoice({ kind: "clear" }); }}
            />
            <span>
              Clear the {noun} on {count === 1 ? "it" : "them"}.{" "}
              <span data-testid="remap-clear-warning" className="text-warn-fg">
                {count === 1 ? "That task" : `Those ${String(count)} tasks`} will have
                no {noun} — the field is emptied. This is permanent; the {noun}{" "}
                <code>{itemKey}</code> is not kept as a dangling
                reference.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      {error !== undefined && (
        <p role="alert" data-testid="remap-error" className="mt-3 text-[0.8571rem] text-danger-fg">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          testId="remap-confirm"
          disabled={blocked}
          onClick={() => {
            if (blocked) return;
            onConfirm(choice ?? { kind: "clear" });
          }}
        >
          {pending ? "Deleting…" : `Delete ${noun}`}
        </Button>
      </div>
    </Modal>
  );
}
