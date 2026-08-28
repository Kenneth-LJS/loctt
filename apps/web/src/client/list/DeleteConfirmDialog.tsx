import { useEffect, useRef, useState } from "react";

/**
 * Typed confirmation for permanent deletion (BLK-11).
 *
 * The friction is the point: archive is one click because it is
 * reversible, and delete is not. The button stays disabled until the
 * exact word is typed, initial focus is the input rather than the
 * destructive control, and the dialog names archive as the alternative
 * so the reversible path is visible at the moment of the decision.
 */
export const DELETE_CONFIRM_WORD = "DELETE";

/**
 * Above this many tasks, the confirmation asks for the count instead
 * of the word.
 *
 * BLK-30: "the confirmation string required is proportionate —
 * deleting 1,280 tasks must not require the same keystroke as
 * deleting 2." A fixed word is muscle memory by the third use, and
 * muscle memory is exactly what should not carry a user through
 * deleting a thousand tasks. Typing the number cannot be done without
 * reading it.
 *
 * Ten is chosen as the point where a selection stops being something
 * the user can see and verify at a glance. No case names a threshold;
 * this is recorded as a proposed case rather than treated as settled.
 */
export const LARGE_DELETE_THRESHOLD = 10;

/**
 * What the user must type to confirm deleting `count` tasks.
 *
 * Exported so the surface and its spec agree by construction rather
 * than by two copies of the same rule.
 */
export function deleteConfirmWord(count: number): string {
  return count > LARGE_DELETE_THRESHOLD ? String(count) : DELETE_CONFIRM_WORD;
}

export function DeleteConfirmDialog({
  count,
  onCancel,
  onConfirm,
}: {
  readonly count: number;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus the input, never the delete button — a stray Enter on an
    // autofocused destructive control is exactly what this dialog
    // exists to prevent.
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onCancel]);

  const required = deleteConfirmWord(count);
  const matches = typed === required;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-confirm-title"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-bg-surface p-5 shadow-lg"
      >
        <h2 id="delete-confirm-title" className="text-[15px] font-semibold text-text-primary">
          Permanently delete {count} {count === 1 ? "task" : "tasks"}?
        </h2>

        <p className="mt-2 text-[13px] text-text-secondary">
          This cannot be undone. The {count === 1 ? "task" : "tasks"} and all
          history, comments, and attachments will be removed from disk.
        </p>
        <p className="mt-2 text-[13px] text-text-secondary">
          If you only want {count === 1 ? "it" : "them"} out of the way,
          <strong className="font-medium text-text-primary"> archive </strong>
          instead — archiving is reversible.
        </p>

        <label className="mt-4 block text-[12px] font-medium text-text-secondary">
          Type <code className="font-mono text-text-primary">{required}</code> to confirm
          {required !== DELETE_CONFIRM_WORD ? (
            <span className="ml-1 font-normal text-text-tertiary">
              — the count, because this is a large batch
            </span>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            aria-label={`Type ${required} to confirm`}
            className="mt-1 w-full rounded-md border border-border-subtle bg-bg-canvas px-2.5 py-1.5 font-mono text-[13px] text-text-primary"
          />
        </label>

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
            disabled={!matches}
            className="rounded-md bg-danger-fg px-3 py-1.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete {count} {count === 1 ? "task" : "tasks"}
          </button>
        </div>
      </div>
    </div>
  );
}
