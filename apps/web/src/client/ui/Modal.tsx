import { type ReactNode, type RefObject, useEffect, useRef } from "react";

import { useFocusTrap } from "./useFocusTrap.ts";

/**
 * A minimal centered modal: a dimmed backdrop over the app and a
 * focusable panel. Closes on Escape or a backdrop click.
 *
 * Focus is trapped (A11Y-14) and returned to the trigger on close
 * (A11Y-15) by `useFocusTrap` — see that module for why the focusable
 * set is recomputed per keystroke rather than captured at mount.
 *
 * `useInertBackground` is the other half of A11Y-14: its third bullet
 * requires the content behind to be *inert to assistive tech*, "not
 * merely visually dimmed — a screen reader's virtual cursor cannot
 * browse the list underneath". A focus trap alone does not deliver
 * that; a virtual cursor does not follow focus.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useInertBackground(panelRef);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-md rounded-lg border border-border-default bg-bg-surface-raised p-4 shadow-overlay"
      >
        <h2 className="mb-3 text-[1.0714rem] font-semibold text-text-primary">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Marks the app chrome `inert` while a modal is mounted.
 *
 * A11Y-14's third bullet: the content behind must be inert to
 * assistive tech, "not merely visually dimmed — a screen reader's
 * virtual cursor cannot browse the list underneath". A focus trap does
 * not deliver that on its own, because a virtual cursor does not
 * follow focus.
 *
 * ## Why the chrome and not `#root`
 *
 * The obvious implementation — `aria-hidden` on `#root` — is wrong
 * here and measurably so: these modals are **not** portalled, they
 * render inside `#root`, so hiding root hides the dialog along with
 * the page behind it. That is a worse defect than the one it fixes,
 * and it is invisible to a test that only checks the attribute landed.
 *
 * So the target is the shell chrome element, which the modal is a
 * sibling of. `inert` rather than `aria-hidden` because it removes the
 * subtree from the tab order *and* the accessibility tree in one
 * attribute, which is exactly the case's requirement.
 *
 * The counter matters: A11Y-34 stacks layers, and a naive
 * add-on-mount/remove-on-unmount would have the inner dialog's cleanup
 * un-inert the background while the outer modal is still open.
 */
let inertDepth = 0;

/**
 * The element that had focus when the outermost layer went up.
 *
 * Captured at inert time rather than by each dialog, so the recovery
 * in the cleanup below has something to restore to regardless of which component
 * owned the trigger.
 */
let lastFocusBeforeInert: HTMLElement | null = null;

/** Marks the element the shell renders its chrome into. */
export const CHROME_ATTR = "data-app-chrome";

/**
 * Elements recently focused *inside the app chrome*.
 *
 * Tracked continuously via a capturing `focusin` listener rather than
 * sampled when a dialog opens, because by the time a dialog's effects
 * run it has already moved focus into itself — so a sample taken then
 * reads the dialog's own field, not the trigger behind it.
 *
 * ## A short history, not a single reference.
 *
 * One slot is not enough, and A11Y-34 is the case that shows why: the
 * ⋯ menu closes as its item is chosen, *then* the delete dialog
 * mounts. So the newest chrome focus is a menu item that is already
 * detached by the time the dialog closes, and restoring to it silently
 * focuses nothing — `document.body` by another name.
 *
 * Walking back to the most recent element still in the document lands
 * on the menu's trigger, which is exactly A11Y-15's "nearest surviving
 * equivalent when the trigger is gone".
 *
 * Four is enough for the layer depths this app builds (trigger → menu
 * → item → dialog) with room to spare, and bounding it keeps this from
 * retaining detached DOM for the session's lifetime.
 */
const CHROME_FOCUS_HISTORY = 4;
let chromeFocusHistory: HTMLElement[] = [];
let trackerInstalled = false;

/** The most recent chrome focus that is still in the document. */
function lastSurvivingChromeFocus(): HTMLElement | null {
  for (let i = chromeFocusHistory.length - 1; i >= 0; i--) {
    const el = chromeFocusHistory[i];
    if (el !== undefined && el.isConnected) return el;
  }
  return null;
}

/**
 * Installed at **module load**, not from inside `useInertBackground`.
 *
 * This is the bug that cost three wrong fixes. Installing it in the
 * effect means the listener starts existing only once a dialog is
 * already opening — by which point the trigger's own `focusin` has
 * long since fired and been missed, so the history is empty and
 * the recovery has nothing to restore to. The listener has to be
 * running *before* the user focuses the trigger, which means module
 * scope.
 */
function installChromeFocusTracker(): void {
  if (trackerInstalled) return;
  if (typeof document === "undefined") return;
  trackerInstalled = true;
  document.addEventListener(
    "focusin",
    e => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      const chrome = document.querySelector<HTMLElement>(`[${CHROME_ATTR}]`);
      // Only elements within the chrome are candidates to return to —
      // focus inside a dialog is exactly what must not be recorded.
      if (chrome === null || !chrome.contains(target)) return;
      // Newest last. Dedupe consecutive repeats so re-focusing the
      // same control does not flush the history that holds the
      // trigger behind it.
      if (chromeFocusHistory[chromeFocusHistory.length - 1] !== target) {
        chromeFocusHistory.push(target);
        if (chromeFocusHistory.length > CHROME_FOCUS_HISTORY) {
          chromeFocusHistory = chromeFocusHistory.slice(-CHROME_FOCUS_HISTORY);
        }
      }
    },
    true,
  );
}

export function useInertBackground(panelRef?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const chrome = document.querySelector<HTMLElement>(`[${CHROME_ATTR}]`);
    if (chrome === null) return;
    // **Refuse to inert a chrome that contains this dialog.**
    //
    // Not defensive padding — a measured bug. `SaveViewDialog` (and
    // the settings dialogs) render from inside `FilterBar`, which is
    // inside `<main>`, which is inside the chrome. Marking the chrome
    // `inert` therefore disabled the dialog's own controls: its Save
    // button never became clickable and three specs (VUE-6, VUE-7,
    // XS-17) hung for 30s on a button that was `disabled` forever.
    //
    // This is the `aria-hidden`-on-`#root` mistake wearing a different
    // hat, and it is worth the guard rather than a rule about where
    // dialogs may mount: the failure is silent at the call site and
    // only shows up as an unrelated timeout.
    //
    // A dialog inside the chrome simply gets no inert background. It
    // keeps its focus trap, which is the larger half of A11Y-14; what
    // it loses is the virtual-cursor isolation, and that is recorded
    // rather than faked.
    // Focus recovery still runs for these — it is a separate concern
    // from inerting, and A11Y-34's chain (⋯ menu → delete dialog)
    // lives inside the chrome and needs it. Only the attribute is
    // skipped.
    const panel = panelRef?.current ?? null;
    const canInert = panel === null || !chrome.contains(panel);

    if (canInert) inertDepth += 1;
    if (canInert && inertDepth === 1) {
      // The element to come back to is the one *outside* the chrome's
      // dialog — i.e. inside the chrome itself.
      //
      // Reading `document.activeElement` here does not work, and the
      // reason is worth stating because it cost a wrong fix: this
      // effect runs after the dialog's own "focus the title field"
      // effect, so by now `activeElement` is an input *inside the
      // modal*, which is about to unmount. Measured — the probe read
      // `INPUT`, and restoring to it left focus on `body`.
      //
      // The chrome is inert-to-be and contains the trigger, so the
      // last element focused within it is the right target. It is
      // tracked continuously below rather than sampled here.
      chrome.setAttribute("inert", "");
    }
    // Captured whether or not the chrome was inerted: this is the
    // element to come back to, and every dialog owes A11Y-15 that.
    const restoreTarget = lastSurvivingChromeFocus();
    if (canInert) lastFocusBeforeInert = restoreTarget;

    return () => {
      if (canInert) {
        inertDepth -= 1;
        if (inertDepth !== 0) return;
        chrome.removeAttribute("inert");
      }
      // Re-apply the focus the closing dialog asked for.
      //
      // This is not defensive padding — it is a measured ordering bug.
      // React runs unmount cleanups in the order the effects were
      // registered, and a dialog's focus-restore effect is typically
      // registered *before* this one (it is declared higher in the
      // component). So the restore runs while the chrome is still
      // `inert`, and `focus()` on a control inside an inert subtree is
      // silently ignored — focus stays on `document.body`, which is
      // precisely the failure A11Y-15 names and asks to be checked by
      // pressing Tab afterwards.
      //
      // Measured: with `inert` applied and this block absent, the
      // create modal's Esc left `document.activeElement === BODY`
      // even though its restore effect had run.
      //
      // Re-running the focus here, after the attribute is gone, is
      // ordering-independent: it works whichever cleanup React
      // happens to call first. The guard is that we only touch focus
      // if it actually landed on body — if the dialog's restore
      // succeeded, or something else has since taken focus, this does
      // nothing.
      // Deferred to a microtask, not run inline.
      //
      // The ordering is the whole difficulty. React runs the unmount
      // cleanups of one component in registration order, so the
      // dialog's own focus-restore may fire *before* this one (leaving
      // focus on `body`, because the chrome was still inert when it
      // tried) or *after* it (in which case it wins and there is
      // nothing to do). Neither order is ours to control.
      //
      // Running the recovery after the current task lets every
      // cleanup finish first, so the check below sees the settled
      // result rather than an intermediate one. Measured: inline, the
      // guard read a transient non-body value and skipped the
      // recovery, and focus ended on `body` anyway.
      // Re-resolved at cleanup, not reused from open time: the element
      // recorded when the dialog opened may itself have unmounted
      // while it was open (a row deleted, a menu re-rendered), and
      // focusing a detached node lands on `body`.
      const recorded = canInert ? lastFocusBeforeInert : restoreTarget;
      const target = recorded !== null && recorded.isConnected
        ? recorded
        : lastSurvivingChromeFocus();
      queueMicrotask(() => {
        const active = document.activeElement;
        // Only step in if focus really was lost. If the dialog's own
        // restore succeeded, or the user has since focused something
        // else, this does nothing.
        if (active !== null && active !== document.body) return;
        if (target !== null && target.isConnected) target.focus();
      });
    };
  }, []);
}

installChromeFocusTracker();
