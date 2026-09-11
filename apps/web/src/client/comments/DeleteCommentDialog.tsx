import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";

/**
 * Confirmation for deleting one comment (CMT-6).
 *
 * **No typed confirmation.** `DeleteTaskDialog` makes the user type
 * the task's key; this does not, and CMT-6 says so explicitly — "a
 * comment is a smaller blast radius than a task". P5 is that friction
 * is proportionate to consequence.
 *
 * **Focus starts on Cancel.** CMT-6's third bullet. `ConfirmDialog`
 * renders Cancel as the first focusable, and `Modal`'s focus trap lands
 * initial focus on the first focusable — so Cancel gets focus, never the
 * destructive control.
 *
 * **The confirmation names what is going** — a preview of the body plus
 * its timestamp (P4's "name the thing").
 *
 * K71: routed through `ConfirmDialog` (over `Modal`) for the focus trap /
 * inert background / focus restoration it previously hand-rolled its
 * overlay without.
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
  return (
    <ConfirmDialog
      title="Delete this comment?"
      testId="delete-comment-dialog"
      confirmLabel={pending ? "Deleting…" : "Delete"}
      confirmTestId="delete-comment-confirm"
      cancelTestId="delete-comment-cancel"
      confirmDisabled={pending}
      onConfirm={onConfirm}
      onCancel={onCancel}
      body={
        <>
          Posted <time dateTime={timestamp}>{timestamp}</time>. This cannot
          be undone.
        </>
      }
    >
      <blockquote
        data-testid="delete-comment-preview"
        className="mt-3 max-h-24 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border-subtle pl-3 text-[13px] text-text-secondary"
      >
        {preview}
      </blockquote>
      {error !== undefined && (
        <p role="alert" className="mt-3 text-[13px] text-danger-fg">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );
}
