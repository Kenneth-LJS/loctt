import type { ReactNode, RefObject } from "react";

import { cn } from "./cn.ts";
import { Modal } from "./Modal.tsx";

/**
 * A shared modal wrapper over the existing `Modal`. B2's config Edit
 * dialogs consume this so every dialog has the same body/footer shape
 * rather than each re-spelling a card, a heading, and a
 * `flex justify-end gap-2` footer (as `DeleteViewDialog` does today).
 *
 * Composed over `Modal`, not a re-implementation, so the whole
 * accessibility apparatus comes for free and unchanged:
 * - focus trap (`useFocusTrap`, A11Y-14)
 * - inert background + focus recovery (A11Y-15/34)
 * - Escape and backdrop-click close
 * - `role="dialog"` / `aria-modal` / `aria-label={title}`
 * - the responsive `p-4` + `max-w-md` panel (`w-full max-w-md`, which is
 *   already `min(…, 100vw-2rem)`-safe unlike the hardcoded `w-[26rem]`
 *   the responsive review R3 flagged).
 *
 * `Modal` owns the `<h2>` title, so `Dialog` adds only the body and a
 * standardized `DialogActions` footer region. It does NOT add a close
 * "✕" button: `Modal` has no header row to place one in without editing
 * `Modal` (out of scope — additive only), and Escape/backdrop already
 * satisfy the dismiss requirement. A close button can be added when
 * `Modal` grows a header slot in a later ticket.
 *
 * `data-testid` passes through to the body wrapper.
 */
export interface DialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** The footer action row — pass a `<DialogActions>`. */
  readonly actions?: ReactNode;
  /** Optional description under the title. */
  readonly description?: ReactNode;
  readonly testId?: string;
  /** Explicit focus-restore target when the trigger will be gone on close. */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
}

export function Dialog({
  title,
  onClose,
  children,
  actions,
  description,
  testId,
  returnFocusTo,
}: DialogProps) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      {...(returnFocusTo !== undefined ? { returnFocusTo } : {})}
    >
      <div {...(testId !== undefined ? { "data-testid": testId } : {})}>
        {description !== undefined && description !== null ? (
          <p className="mb-3 text-body text-text-secondary">{description}</p>
        ) : null}
        {children}
        {actions !== undefined && actions !== null ? actions : null}
      </div>
    </Modal>
  );
}

/**
 * The standardized right-aligned footer for a `Dialog`. Buttons go here
 * (Cancel + a primary/danger `Button`); the gap and alignment are owned
 * once so no dialog re-spells `flex justify-end gap-2`.
 */
export function DialogActions({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("mt-4 flex justify-end gap-2", className)}>
      {children}
    </div>
  );
}
