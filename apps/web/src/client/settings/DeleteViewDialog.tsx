import type { RefObject } from "react";

import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";

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
 *
 * K71: routed through `ConfirmDialog` (over `Modal`) so it gets the
 * focus trap, inert background and focus restoration it previously
 * hand-rolled its overlay without.
 */
export function DeleteViewDialog({
  name,
  pinned,
  onCancel,
  onConfirm,
  returnFocusTo,
}: {
  readonly name: string;
  /** Whether this view is currently pinned to the sidebar. */
  readonly pinned: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /**
   * Focus-restore target when the trigger will be gone on close — the
   * sidebar opens this from a kebab menu item that unmounts on select, so
   * it passes the stable "New filter…" button. The settings panels open
   * it from a button that survives and omit it.
   */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  return (
    <ConfirmDialog
      title={`Delete “${name}”?`}
      testId="delete-view-dialog"
      {...(returnFocusTo !== undefined ? { returnFocusTo } : {})}
      body={
        <>
          The view <span className="font-medium text-text-primary">{name}</span>{" "}
          is removed from <code>queries.yaml</code>.
          Tasks are not affected.
        </>
      }
      confirmLabel="Delete view"
      confirmTestId="delete-view-confirm"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {pinned ? (
        <p
          data-testid="delete-view-pin-warning"
          className="mt-3 rounded-md border border-border-subtle bg-warn-bg px-2 py-1 text-[0.8571rem] text-warn-fg"
        >
          This view is pinned to your sidebar. The pin will be dropped.
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
