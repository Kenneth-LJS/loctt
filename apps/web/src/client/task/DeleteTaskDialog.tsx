import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/Button.tsx";
import { useInertBackground } from "../ui/Modal.tsx";
import { TextField } from "../ui/TextField.tsx";
import { useFocusTrap } from "../ui/useFocusTrap.ts";

/**
 * Typed confirmation for deleting one task (TSK-22).
 *
 * The word typed is **the task's key**, not the fixed `DELETE` the
 * bulk dialog asks for. That is deliberate and the case is explicit
 * about it: "the confirm button stays disabled until the exact key is
 * typed". A constant is muscle memory by the second use; a key cannot
 * be typed without reading which task is about to go.
 *
 * The comparison is exact — `===` against the key, with no trimming,
 * no case folding. TSK-22 names wrong case and a trailing space as
 * near-misses that must *not* enable the button, so normalising the
 * input here would defeat the check the case asks for.
 *
 * Initial focus is the input. A destructive control that is focused on
 * open can be fired by a stray Enter, which is the whole failure this
 * dialog exists to prevent.
 */
export function DeleteTaskDialog({
  taskKey,
  title,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly taskKey: string;
  readonly title: string;
  readonly pending: boolean;
  /** Rendered in place, so a failed delete keeps the dialog (TSK-50). */
  readonly error: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // A11Y-14 / A11Y-15 / A11Y-34: Tab is confined to the dialog, and
  // focus returns to whatever opened it when it closes.
  //
  // This dialog previously focused its input on open and did nothing
  // on close, so dismissing it left focus on `document.body` — the
  // next Tab restarted at the top of the page. Measured via A11Y-34,
  // which opens this from the detail page's ⋯ menu and Tabs after
  // closing.
  //
  // `initialFocus` is the typed-confirmation input, which A11Y-50
  // permits explicitly as the safe landing spot for a destructive
  // dialog — never the destructive button.
  useFocusTrap(panelRef, { initialFocus: inputRef });
  useInertBackground(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onCancel]);

  const matches = typed === taskKey;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-task-title"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-bg-surface p-5 shadow-lg"
      >
        <h2 id="delete-task-title" className="text-[1.0714rem] font-semibold text-text-primary">
          Permanently delete {taskKey}?
        </h2>

        <p className="mt-2 break-words text-[0.9286rem] text-text-secondary">
          {title}
        </p>

        <p className="mt-3 text-[0.9286rem] text-text-secondary">
          This is permanent and cannot be undone. {taskKey} and all its
          history, comments, and attachments are removed from disk.
        </p>
        {/* Names the reversible alternative at the moment of the
            decision, so archive and delete cannot be confused for one
            another (TSK-22, TSK-23). */}
        <p className="mt-2 text-[0.9286rem] text-text-secondary">
          If you only want it out of the way,
          <strong className="font-medium text-text-primary"> archive </strong>
          instead — archiving is reversible and keeps the files on disk.
        </p>

        <label className="mt-4 block text-[0.8571rem] font-medium text-text-secondary">
          Type <code className="text-text-primary">{taskKey}</code> to confirm
          <TextField
            ref={inputRef}
            type="text"
            value={typed}
            onChange={e => { setTyped(e.target.value); }}
            aria-label={`Type ${taskKey} to confirm`}
            className="mt-1"
          />
        </label>

        {/* TSK-50: the failure is stated where the user acted, and the
            dialog stays open so the delete can be retried. */}
        {error !== undefined && (
          <p role="alert" className="mt-3 text-[0.9286rem] text-danger-fg">
            {taskKey} was not deleted. {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onConfirm}
            disabled={!matches || pending}
          >
            {pending ? "Deleting…" : `Delete ${taskKey}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
