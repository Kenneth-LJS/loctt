import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { Button } from "./Button.tsx";
import { Callout } from "./Callout.tsx";
import { Dialog, DialogActions } from "./Dialog.tsx";
import { TextField } from "./TextField.tsx";

/**
 * The shared confirmation primitive (K71 / docs/dev/design/design-review.md §B1).
 *
 * Before this, seven delete/confirm dialogs each hand-rolled their own
 * `fixed inset-0 … bg-black/40` overlay and panel. Four of them
 * (`DeleteViewDialog`, `DeleteCommentDialog`, `DeleteConfirmDialog`, and
 * others) skipped the focus trap, the inert background, and focus
 * restoration entirely — a real keyboard/screen-reader regression
 * (docs/dev/design/design-review.md §A1, K71): Tab escaped the modal into the frozen page,
 * and focus was not returned to the trigger on close.
 *
 * `ConfirmDialog` is a thin wrapper over `Dialog` (hence `Modal`), so it
 * inherits the whole a11y apparatus by construction — focus trap
 * (A11Y-14), inert background, Escape + backdrop close, focus recovery
 * (A11Y-15), `role="dialog"` / `aria-modal` / `aria-label`. Every
 * confirm dialog routed through it gets that for free and identically.
 *
 * `TypedConfirmDialog` (below) adds the type-to-confirm friction for
 * irreversible actions (BLK-11), sharing the same shell.
 */
export interface ConfirmDialogProps {
  /** Dialog heading (also the accessible name). */
  readonly title: string;
  /** The explanatory body — a string, or richer nodes for emphasis. */
  readonly body: ReactNode;
  /** Confirm button label, e.g. "Delete view". */
  readonly confirmLabel: string;
  /** Confirm button tone. Defaults to "danger" (the common case). */
  readonly variant?: "danger" | "primary";
  /** Disable confirm (e.g. a typed-word not yet matched). */
  readonly confirmDisabled?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Extra content between body and actions (e.g. a pin warning). */
  readonly children?: ReactNode;
  /**
   * A failure from the confirmed action, rendered inside the dialog so a
   * rejected delete/archive is shown rather than swallowed by a confirm
   * that just closes (mirrors RemapDeleteDialog). The caller keeps the
   * dialog open on failure (close only `onSuccess`) so this message has
   * somewhere to appear.
   */
  readonly error?: ReactNode;
  readonly testId?: string;
  /** testId for the confirm button, for specs that target it. */
  readonly confirmTestId?: string;
  /** testId for the cancel button (e.g. to assert it holds focus). */
  readonly cancelTestId?: string;
  /**
   * Explicit focus-restore target for when the control that opened this
   * confirm will have unmounted by the time it closes — e.g. a kebab menu
   * item on a row that is deleted, or the sidebar's saved-filter kebab,
   * which the Menu removes on select. Falls through to `Dialog`/`Modal`
   * into `useFocusTrap`'s `returnFocusTo`.
   */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  variant = "danger",
  confirmDisabled = false,
  onConfirm,
  onCancel,
  children,
  error,
  testId,
  confirmTestId,
  cancelTestId,
  returnFocusTo,
}: ConfirmDialogProps) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      {...(testId !== undefined ? { testId } : {})}
      {...(returnFocusTo !== undefined ? { returnFocusTo } : {})}
      actions={
        <DialogActions>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            {...(cancelTestId !== undefined ? { testId: cancelTestId } : {})}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant={variant}
            onClick={onConfirm}
            disabled={confirmDisabled}
            {...(confirmTestId !== undefined ? { testId: confirmTestId } : {})}
          >
            {confirmLabel}
          </Button>
        </DialogActions>
      }
    >
      <div className="text-body text-text-secondary">{body}</div>
      {children}
      {error !== undefined && error !== null && (
        <Callout tone="danger" role="alert" testId="confirm-dialog-error" className="mt-3">
          {error}
        </Callout>
      )}
    </Dialog>
  );
}

export interface TypedConfirmDialogProps {
  readonly title: string;
  readonly body: ReactNode;
  /** The exact string the user must type to enable confirm. */
  readonly requiredWord: string;
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** Optional note after the "Type X to confirm" label. */
  readonly typeHint?: ReactNode;
  readonly testId?: string;
  readonly confirmTestId?: string;
}

/**
 * A confirm dialog gated on typing an exact word (BLK-11 / BLK-30). The
 * friction is deliberate — the button stays disabled until the word
 * matches, and initial focus is the input, never the destructive button,
 * so a stray Enter cannot confirm.
 */
export function TypedConfirmDialog({
  title,
  body,
  requiredWord,
  confirmLabel,
  onConfirm,
  onCancel,
  typeHint,
  testId,
  confirmTestId,
}: TypedConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input, not the delete button — the whole point of the
  // typed friction is defeated if Enter on an autofocused destructive
  // control confirms. (Modal's focus trap would otherwise land focus on
  // the first focusable, so we override to the input explicitly.)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const matches = typed === requiredWord;

  return (
    <ConfirmDialog
      title={title}
      body={
        <>
          {body}
          <label className="mt-4 block text-label font-medium text-text-secondary">
            Type <code className="text-text-primary">{requiredWord}</code> to confirm
            {typeHint !== undefined && typeHint !== null ? (
              <span className="ml-1 font-normal text-text-tertiary">{typeHint}</span>
            ) : null}
            <TextField
              ref={inputRef}
              type="text"
              value={typed}
              onChange={e => { setTyped(e.target.value); }}
              aria-label={`Type ${requiredWord} to confirm`}
              className="mt-1"
            />
          </label>
        </>
      }
      confirmLabel={confirmLabel}
      variant="danger"
      confirmDisabled={!matches}
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...(testId !== undefined ? { testId } : {})}
      {...(confirmTestId !== undefined ? { confirmTestId } : {})}
    />
  );
}
