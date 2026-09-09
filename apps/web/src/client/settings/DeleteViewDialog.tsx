import { useEffect } from "react";

import { Button } from "../ui/Button.tsx";

/**
 * Confirmation for deleting a saved view (VUE-38).
 *
 * The case asks for two specific things in the copy, and they are not
 * the same thing:
 *
 *  - **the view is named** — "the confirmation names the view";
 *  - **the consequence for pins is stated** — "states that pinned
 *    sidebar references will be dropped".
 *
 * The second only makes sense when the view actually *is* pinned, so
 * `pinned` gates it. Telling a user their pins will be dropped when
 * they have none is noise that trains them to stop reading (P4).
 *
 * No typed-word friction here, unlike `DeleteConfirmDialog`: a saved
 * view is a query definition, not task data, and it can be recreated.
 * The friction in BLK-11 is calibrated to irreversible data loss.
 */
export function DeleteViewDialog({
  name,
  pinned,
  onCancel,
  onConfirm,
}: {
  readonly name: string;
  /** Whether this view is currently pinned to the sidebar. */
  readonly pinned: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delete saved view ${name}`}
      data-testid="delete-view-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border-subtle bg-bg-surface p-5">
        <h2 className="mb-2 text-[15px] font-semibold text-text-primary">
          Delete &ldquo;{name}&rdquo;?
        </h2>
        <p className="mb-2 text-[13px] text-text-secondary">
          The view is removed from{" "}
          <code className="font-mono">queries.yaml</code>. Tasks are not
          affected.
        </p>
        {pinned ? (
          <p
            data-testid="delete-view-pin-warning"
            className="mb-3 rounded-md border border-border-subtle bg-warn-bg px-2 py-1 text-[12px] text-warn-fg"
          >
            This view is pinned to your sidebar. The pin will be dropped.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            testId="delete-view-confirm"
            onClick={onConfirm}
          >
            Delete view
          </Button>
        </div>
      </div>
    </div>
  );
}
