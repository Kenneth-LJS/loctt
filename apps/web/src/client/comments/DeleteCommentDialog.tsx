import { useEffect, useRef } from "react";

import { Button } from "../ui/Button.tsx";

/**
 * Confirmation for deleting one comment (CMT-6).
 *
 * **No typed confirmation.** `DeleteTaskDialog` makes the user type
 * the task's key; this does not, and CMT-6 says so explicitly — "a
 * comment is a smaller blast radius than a task". P5 is that friction
 * is proportionate to consequence, so copying the task dialog here
 * would be the same violation as omitting it there, in the other
 * direction.
 *
 * **Focus starts on Cancel.** CMT-6's third bullet. A destructive
 * control focused on open is one stray Enter from firing, and the
 * dialog exists to make the delete deliberate.
 *
 * **The confirmation names what is going.** A preview of the body plus
 * its timestamp, so a user with a thread of five comments can tell
 * which one the dialog is about — P4's "name the thing".
 */
export function DeleteCommentDialog({
  preview,
  timestamp,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  readonly preview: string;
  readonly timestamp: string;
  readonly pending: boolean;
  /** Rendered in place, so a failed delete keeps the dialog. */
  readonly error: string | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-comment-title"
        data-testid="delete-comment-dialog"
        className="w-full max-w-md rounded-lg border border-border-subtle bg-bg-surface p-5 shadow-lg"
      >
        <h2
          id="delete-comment-title"
          className="mb-2 text-[15px] font-semibold text-text-primary"
        >
          Delete this comment?
        </h2>
        <p className="mb-3 text-[13px] text-text-secondary">
          Posted <time dateTime={timestamp}>{timestamp}</time>. This cannot
          be undone.
        </p>
        <blockquote
          data-testid="delete-comment-preview"
          className="mb-4 max-h-24 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border-subtle pl-3 text-[13px] text-text-secondary"
        >
          {preview}
        </blockquote>

        {error !== undefined && (
          <p role="alert" className="mb-3 text-[13px] text-danger-fg">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            ref={cancelRef}
            type="button"
            variant="secondary"
            testId="delete-comment-cancel"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            testId="delete-comment-confirm"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
