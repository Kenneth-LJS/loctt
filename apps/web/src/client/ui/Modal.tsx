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
  footer,
  bodyProps,
  returnFocusTo,
}: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /**
   * An action row pinned BELOW the scrolling body (SET-8).
   *
   * This is the whole point of the slot: the body is the part that
   * scrolls and the footer is not, so a tall dialog cannot push Save
   * off a short viewport. A caller that instead puts its buttons at the
   * end of `children` gets buttons that scroll with the content —
   * reachable, but only after scrolling.
   */
  readonly footer?: ReactNode;
  /**
   * Attributes for the element wrapping the body AND the footer —
   * `Dialog` puts its `data-testid` here, so the id still spans the
   * action buttons. Many specs do
   * `within(getByTestId(dialogId)).getByTestId("…-save")`, which a
   * testid scoped to the scroller alone would have broken.
   */
  readonly bodyProps?: Record<string, string>;
  /**
   * Explicit focus-restore target for the case A11Y-15 names: the
   * control that opened the modal will have unmounted by the time it
   * closes (e.g. a kebab menu item, or a whole row that was deleted).
   * Threaded straight into `useFocusTrap`'s own `returnFocusTo`. Omit and
   * focus returns to whatever was focused at open — correct when the
   * trigger survives.
   */
  readonly returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(
    panelRef,
    returnFocusTo !== undefined ? { returnFocusTo: returnFocusTo.current } : {},
  );

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
        // SET-8: the panel is capped and its BODY scrolls, so a tall
        // dialog (the custom-field editor with a list of enum values
        // measures ~823px) cannot push its actions below the fold on a
        // short window. Before this the panel had no `max-h` at all and
        // the overlay's `grid place-items-center` centred an
        // over-tall card, putting Save off-screen with nothing to
        // scroll — the user simply could not save.
        //
        // This is `Sheet`'s pattern, not a second one: a flex column
        // with a capped height, `min-h-0 flex-1 overflow-y-auto` on the
        // body and `shrink-0` on the chrome. `Modal` was the odd
        // primitive out — the mobile branch of `ResponsiveDialog` has
        // been getting this right via `Sheet` all along, so the
        // desktop branch was the only one that could strand its footer.
        //
        // `max-h-[calc(100dvh-2rem)]` rather than `85vh`: the overlay
        // already contributes `p-4` (2rem of vertical padding), so the
        // cap is exactly the space the panel is given. `dvh` tracks a
        // mobile browser's collapsing toolbars, where `vh` does not.
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-lg border border-border-default bg-bg-surface-raised p-4 shadow-overlay"
      >
        <h2 className="mb-3 shrink-0 text-[1.0714rem] font-semibold text-text-primary">{title}</h2>
        <div {...bodyProps} className="flex min-h-0 flex-1 flex-col">
          {/*
            The scroll region. `min-h-0` is load-bearing: a flex item
            defaults to `min-height: auto`, which refuses to shrink
            below its content — and that is precisely how an over-tall
            body grows the panel past its own `max-h` and strands the
            footer again.

            `-mx-4 px-4` so the scroller spans the panel's full width:
            `overflow-y-auto` also clips horizontally, which would slice
            the focus ring off a control at the body's edge.

            `-my-2 py-2` is the vertical half of the SAME idiom, and
            UI-11 is what its absence cost: the body's last focusable
            control sat flush on the scroller's bottom edge (measured: 0px
            clearance on Edit sprint's Goal textarea) while the global ring
            — `outline: 2px` at `outline-offset: 2px`, styles/index.css —
            needs 4px outside the border box. Top and right stayed rounded,
            left and bottom came out cut flat.

            Padding *inside* a scroller is the right lever rather than a
            gap outside it, because it is part of the scrollable box:
            `scrollHeight` includes both paddings, so the clearance is
            still there when the user has scrolled to either end. Measured
            in-browser — scrolled fully to the bottom of an overflowing
            body, the last control keeps the full padding.

            `py-2` rather than the `py-1` that would nominally suffice,
            because this app sets a 14px root font size and Tailwind's
            spacing scale is in `rem`: `py-1` is 3.5px here — UNDER the
            ring's 4px — and `py-1.5` is 5.25px, only 1.25px of headroom.
            `py-2` resolves to 7px, which clears the ring with room for
            sub-pixel rounding and survives a future tweak to the root
            size. Do not "tidy" this down a step without re-measuring in
            px; the rem→px conversion here is not the Tailwind default.

            The negative margin is what keeps this from changing the
            layout: it pulls the scroller back out by exactly what the
            padding pushed in, so the body still starts and ends where it
            did. It is absorbed by the chrome's own spacing — the `<h2>`
            above has `mb-3` and `DialogActions` below has `mt-4`, both
            comfortably more than the 7px pulled back.

            Verified against the stranded-footer bug the block above
            describes: the panel stays at its `max-h` cap, the footer stays
            inside it, and the scroller still scrolls. `min-h-0` continues
            to do that work — this pair does not touch it.
          */}
          <div className="-my-2 -mx-4 min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {children}
          </div>
          {/* Outside the scroller, so it cannot scroll out of reach. */}
          {footer !== undefined && footer !== null ? (
            <div className="shrink-0">{footer}</div>
          ) : null}
        </div>
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
