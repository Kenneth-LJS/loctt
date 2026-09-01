import { useState } from "react";

import { Modal } from "../ui/Modal.tsx";

/**
 * Deleting a workflow key that tasks still reference (SET-17, SET-19).
 *
 * The confirm requires an explicit choice — remap to another key, or
 * leave the references dangling — with no default that silently
 * orphans anything. "Leave dangling" is offered because SET-17 says it
 * is allowed; it is not the default, and picking it states what will
 * happen (drift markers + a failing Diagnostics check) before the
 * user commits.
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
  /** `null` in the remap table: clear the value, leaving it unset. */
  | { readonly kind: "dangle" }
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
   * `null` is "nothing picked yet" and `{kind:"dangle"}` is the
   * explicit leave-them-dangling choice — kept as the same discriminated
   * union the caller receives, so "unpicked" can never be mistaken for
   * "dangle" by a stringly-typed comparison.
   */
  const [choice, setChoice] = useState<RemapChoice | null>(null);

  const inUse = count > 0;
  const blocked = pending || (inUse && choice === null);

  return (
    <Modal title={`Delete ${noun} "${itemLabel}"`} onClose={onClose}>
      <p data-testid="remap-refcount" className="text-[13px] text-text-secondary">
        {inUse
          ? `${String(count)} task${count === 1 ? "" : "s"} currently use `
          : `No tasks use `}
        <code className="rounded bg-bg-muted px-1 py-0.5 font-mono">{itemKey}</code>
        {inUse ? "." : " — deleting it affects nothing."}
      </p>

      {inUse && (
        <fieldset className="mt-3 border-0 p-0" data-testid="remap-choice">
          <legend className="mb-1 text-[13px] text-text-secondary">
            What should happen to {count === 1 ? "that task" : `those ${String(count)} tasks`}?
          </legend>
          {alternatives.map(alt => (
            <label key={alt.key} className="flex items-center gap-2 py-0.5 text-[13px]">
              <input
                type="radio"
                name="remap-target"
                data-testid={`remap-to-${alt.key}`}
                checked={choice?.kind === "remap" && choice.to === alt.key}
                onChange={() => { setChoice({ kind: "remap", to: alt.key }); }}
              />
              <span>
                Move {count === 1 ? "it" : "them"} to{" "}
                <strong className="font-medium">{alt.label}</strong>{" "}
                <code className="font-mono text-text-tertiary">{alt.key}</code>
              </span>
            </label>
          ))}
          <label className="mt-1 flex items-start gap-2 py-0.5 text-[13px]">
            <input
              type="radio"
              name="remap-target"
              data-testid="remap-dangle"
              checked={choice?.kind === "dangle"}
              onChange={() => { setChoice({ kind: "dangle" }); }}
            />
            <span>
              Leave {count === 1 ? "it" : "them"} pointing at{" "}
              <code className="font-mono">{itemKey}</code>.{" "}
              <span data-testid="remap-dangle-warning" className="text-warn-fg">
                {count === 1 ? "That task" : `Those ${String(count)} tasks`} will render
                with a drift marker and appear in Diagnostics as a failing check.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      {error !== undefined && (
        <p role="alert" data-testid="remap-error" className="mt-3 text-[12px] text-danger-fg">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="h-8 rounded-md border border-border-default px-3 text-[13px]"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="remap-confirm"
          disabled={blocked}
          onClick={() => {
            if (blocked) return;
            onConfirm(choice ?? { kind: "dangle" });
          }}
          className="h-8 rounded-md bg-danger-fg px-3 text-[13px] font-medium text-accent-contrast disabled:opacity-50"
        >
          {pending ? "Deleting…" : `Delete ${noun}`}
        </button>
      </div>
    </Modal>
  );
}
