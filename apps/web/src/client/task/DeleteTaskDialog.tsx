import { useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-task-title"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-bg-surface p-5 shadow-lg"
      >
        <h2 id="delete-task-title" className="text-[15px] font-semibold text-text-primary">
          Permanently delete {taskKey}?
        </h2>

        <p className="mt-2 break-words text-[13px] text-text-secondary">
          {title}
        </p>

        <p className="mt-3 text-[13px] text-text-secondary">
          This is permanent and cannot be undone. {taskKey} and all its
          history, comments, and attachments are removed from disk.
        </p>
        {/* Names the reversible alternative at the moment of the
            decision, so archive and delete cannot be confused for one
            another (TSK-22, TSK-23). */}
        <p className="mt-2 text-[13px] text-text-secondary">
          If you only want it out of the way,
          <strong className="font-medium text-text-primary"> archive </strong>
          instead — archiving is reversible and keeps the files on disk.
        </p>

        <label className="mt-4 block text-[12px] font-medium text-text-secondary">
          Type <code className="font-mono text-text-primary">{taskKey}</code> to confirm
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={e => { setTyped(e.target.value); }}
            aria-label={`Type ${taskKey} to confirm`}
            className="mt-1 w-full rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-1.5 font-mono text-[13px] text-text-primary"
          />
        </label>

        {/* TSK-50: the failure is stated where the user acted, and the
            dialog stays open so the delete can be retried. */}
        {error !== undefined && (
          <p role="alert" className="mt-3 text-[13px] text-danger-fg">
            {taskKey} was not deleted. {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border-subtle px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches || pending}
            className="rounded-md bg-danger-fg px-3 py-1.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? "Deleting…" : `Delete ${taskKey}`}
          </button>
        </div>
      </div>
    </div>
  );
}
