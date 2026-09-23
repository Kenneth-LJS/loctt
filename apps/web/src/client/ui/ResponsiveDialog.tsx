import type { ReactNode, RefObject } from "react";

import { useIsNarrow } from "../shell/useIsNarrow.ts";
import { Dialog } from "./Dialog.tsx";
import { Sheet } from "./Sheet.tsx";

/**
 * The DEFAULT overlay for a modal surface that carries editable content:
 * a centered titled `Dialog` at desktop width, a bottom `Sheet` below the
 * mobile breakpoint. One primitive, one content slot — the SAME children
 * render in both modes.
 *
 * ## Why this exists
 *
 * Before this there were two overlay primitives that did not compose:
 * `Modal`/`Dialog` (a centered desktop card with a fixed `max-w`, cramped
 * on a phone) and `Sheet` (a bottom drawer, used only by the list-filter
 * facets and the advanced-query editor). Every surface had to pick one, so
 * a multi-field editor was either a cramped centered box on mobile or —
 * like "Customize sidebar" once did — a bottom drawer even on desktop,
 * where a dialog is correct. `ResponsiveDialog` is the missing primitive:
 * Dialog ≥ breakpoint, Sheet below it.
 *
 * ## Breakpoint (A273)
 *
 * 640px — the app's single mobile breakpoint, the `useIsNarrow` default
 * (Tailwind `sm`) that the list-filter Sheet and the table→card swap
 * already use, and what design-system §7 ("Below the breakpoint, use a
 * mobile-native pattern") points at. The Sidebar's own `NARROW_PX=900` is
 * a different axis (in-grid column vs. floating drawer for the shell) and
 * is deliberately NOT reused here.
 *
 * ## Presentation shell only — no forked state
 *
 * Like `Sheet`, this forks no state. Callers pass the SAME children (and
 * the SAME actions) in both modes, so an edit made in the sheet writes
 * through exactly the mutation the desktop dialog would. The two branches
 * differ only in chrome (centered card vs. bottom drawer), never in what
 * is inside them.
 *
 * ## A11y machinery is shared, not reimplemented
 *
 * Both branches route through the same apparatus: the desktop branch is
 * `Dialog` → `Modal` (focus trap A11Y-14, inert background A11Y-15/34,
 * Escape + backdrop close, `role="dialog"`/`aria-modal`/`aria-label`); the
 * mobile branch is `Sheet`, which reuses `useFocusTrap` + `useInertBackground`
 * exactly. Nothing here re-spells that machinery.
 *
 * ## Testids are stable across the switch
 *
 * `testId` lands on the body wrapper in BOTH modes (Dialog puts it on its
 * body div; the mobile branch wraps the children in a div carrying the
 * same attribute). A spec that locates a dialog by its testid finds it at
 * either width without a branch.
 *
 * ## Focus-ring clearance is inherited, not re-spelled (UI-11)
 *
 * Neither branch here owns the scroll region, so neither owns the
 * clearance the global focus ring needs (`outline: 2px` at
 * `outline-offset: 2px` — 4px outside the control's border box). Both
 * body scrollers use `overflow-y-auto`, which clips on every edge, so
 * that clearance has to exist as padding INSIDE the scroller: `Modal`
 * carries `-mx-4 px-4` + `-my-1.5 py-1.5`, `Sheet` carries `p-4`.
 *
 * This is deliberate — adding padding at this layer would double the
 * inset in both modes without fixing anything, because the clip happens
 * further in. If a ring is clipped in a `ResponsiveDialog`, the fix
 * belongs in `Modal` or `Sheet`.
 */
export interface ResponsiveDialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** The footer action row — pass a `<DialogActions>`. Rendered in both modes. */
  readonly actions?: ReactNode;
  /** Optional description under the title. */
  readonly description?: ReactNode;
  readonly testId?: string;
  /** Explicit focus-restore target when the trigger will be gone on close. */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
}

export function ResponsiveDialog({
  title,
  onClose,
  children,
  actions,
  description,
  testId,
  returnFocusTo,
}: ResponsiveDialogProps) {
  const narrow = useIsNarrow();

  if (narrow) {
    // Bottom sheet. The Sheet owns the header/close and the sticky footer;
    // `actions` slot into that footer so the SAME buttons the desktop
    // dialog renders are pinned at the bottom of the drawer.
    return (
      <Sheet
        title={title}
        onClose={onClose}
        {...(testId !== undefined ? { testId } : {})}
        {...(actions !== undefined && actions !== null ? { footer: actions } : {})}
      >
        {description !== undefined && description !== null ? (
          <p className="mb-3 text-body text-text-secondary">{description}</p>
        ) : null}
        {children}
      </Sheet>
    );
  }

  // Centered card. `Dialog` already puts `testId` on its body wrapper and
  // threads `returnFocusTo`/`description`/`actions`, so this is a straight
  // pass-through — the desktop half of the primitive is the existing Dialog.
  return (
    <Dialog
      title={title}
      onClose={onClose}
      {...(actions !== undefined && actions !== null ? { actions } : {})}
      {...(description !== undefined && description !== null ? { description } : {})}
      {...(testId !== undefined ? { testId } : {})}
      {...(returnFocusTo !== undefined ? { returnFocusTo } : {})}
    >
      {children}
    </Dialog>
  );
}
