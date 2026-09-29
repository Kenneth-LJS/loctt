import type { RefObject } from "react";

import { ConfirmDialog } from "../ui/ConfirmDialog.tsx";
import { InlineFailureNotice } from "../ui/InlineFailureNotice.tsx";

/**
 * Confirmation for deleting a saved view (VUE-38): the confirmation
 * names the view.
 *
 * No typed-word friction here, unlike `DeleteConfirmDialog`: a saved
 * view is a query definition, not task data, and it can be recreated.
 *
 * K71: routed through `ConfirmDialog` (over `Modal`) so it gets the
 * focus trap, inert background and focus restoration it previously
 * hand-rolled its overlay without.
 *
 * A328 (B6): the delete's outcome is read here, not fired
 * fire-and-forget by the caller. `dataState`/`onRetry` let a FAILED
 * delete show an inline notice and keep the dialog open — the caller
 * (`Sidebar.tsx`'s `confirmDelete`) now runs `dismiss`, the sidebar-order
 * clean-up write, and closing the dialog only from the mutation's `onSuccess`,
 * never eagerly before it settles.
 */
export function DeleteViewDialog({
  name,
  dataState,
  onCancel,
  onConfirm,
  onRetry,
  returnFocusTo,
}: {
  readonly name: string;
  /**
   * The delete mutation's `data_state`, or `undefined` when it has not
   * failed. Drives the A328 notice; `null` is not a valid state, so
   * "failed with no known state" is the same as `"not_saved"` here — see
   * `dataStateOf`'s fallback in the caller.
   */
  readonly dataState?: "saved" | "not_saved" | "unknown" | undefined;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  /** Re-fires the delete. Present exactly when `dataState` is. */
  readonly onRetry?: (() => void) | undefined;
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
      {dataState !== undefined && (
        <InlineFailureNotice
          testId="delete-view-error"
          message={
            dataState === "unknown"
              ? "Couldn't confirm the view was deleted. Reload to check before deleting it again."
              : "The view wasn't deleted. Try again."
          }
          dataState={dataState}
          {...(onRetry !== undefined ? { onRetry } : {})}
        />
      )}
    </ConfirmDialog>
  );
}
