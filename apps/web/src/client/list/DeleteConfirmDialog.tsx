import { TypedConfirmDialog } from "../ui/ConfirmDialog.tsx";

/**
 * Typed confirmation for permanent deletion (BLK-11).
 *
 * The friction is the point: archive is one click because it is
 * reversible, and delete is not. The button stays disabled until the
 * exact word is typed, initial focus is the input rather than the
 * destructive control, and the dialog names archive as the alternative
 * so the reversible path is visible at the moment of the decision.
 *
 * K71: the overlay/panel/focus handling now come from
 * `TypedConfirmDialog` (over `Modal`) — this dialog previously
 * hand-rolled its overlay and set only `inputRef.focus()`, with no focus
 * trap and no focus restoration.
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
  const required = deleteConfirmWord(count);
  const noun = count === 1 ? "task" : "tasks";

  return (
    <TypedConfirmDialog
      title={`Permanently delete ${String(count)} ${noun}?`}
      requiredWord={required}
      confirmLabel={`Delete ${String(count)} ${noun}`}
      onConfirm={onConfirm}
      onCancel={onCancel}
      typeHint={required !== DELETE_CONFIRM_WORD ? "— the count, because this is a large batch" : undefined}
      body={
        <>
          <p>
            This cannot be undone. The {noun} and all history, comments, and
            attachments will be removed from disk.
          </p>
          <p className="mt-2">
            If you only want {count === 1 ? "it" : "them"} out of the way,
            <strong className="font-medium text-text-primary"> archive </strong>
            instead — archiving is reversible.
          </p>
        </>
      }
    />
  );
}
