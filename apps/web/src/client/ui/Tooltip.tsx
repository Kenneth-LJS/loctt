import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { panelStyle, usePortalPlacement } from "./usePortalPlacement.ts";

/**
 * A hover/focus tooltip for a control whose name or hint would otherwise
 * be invisible — in practice, an icon-only `IconButton` (UI-23e).
 *
 * ## Why this exists rather than native `title`
 *
 * `title` has a browser-controlled delay of roughly a second that cannot
 * be tuned, and it never appears on keyboard focus at all. Once
 * "Save as view" became an icon-only button (K30-web / A297), the button's
 * name lived only in `aria-label` (screen readers) and `title` (a
 * one-second wait). A sighted mouse user had to hover and wait; a
 * sighted keyboard user could not see the name at all.
 *
 * ## What this is NOT for: the disabled-reason description
 *
 * `title` does two different jobs in this codebase and they must not be
 * collapsed. The other job is the accessible *description* of a disabled
 * control ("why can't I click this?") — see `Menu.tsx`'s `MenuItem` and
 * `Dropdown.tsx`'s disabled option. Those are not hover tooltips and
 * must not become one: a description has to reach a screen reader
 * whether or not a pointer is anywhere near the control. They use
 * `aria-describedby` pointing at an `sr-only` node (see `SrOnly` below),
 * which supersedes the browser's `title`-as-description fallback
 * cleanly — that fallback applies only "when no other description source
 * exists".
 *
 * `aria-label` would be the wrong attribute for that job too: the label
 * is the *name* ("Export CSV"), and moving the reason there would make a
 * disabled button announce "no tasks match these filters" INSTEAD of its
 * name, losing the name entirely.
 *
 * ## Portalled, and reusing the existing placement engine
 *
 * The bubble renders into `document.body` and is placed by the shared
 * `usePortalPlacement` hook — the same measured, viewport-clamped
 * substrate `Menu` and `Dropdown` sit on. An inline `absolute` bubble is
 * clipped by any ancestor with `overflow` (defect MENU-PORTAL, already
 * suffered here by the sidebar's scroll container), and a toolbar is
 * exactly such an ancestor. Writing a second placement engine would mean
 * two viewport clamps to keep correct; there is one.
 *
 * ## Delays
 *
 * - **150ms on pointer enter.** Long enough that sweeping the pointer
 *   across a toolbar does not strobe a bubble over every button on the
 *   way past; short enough to read as a response to pointing rather than
 *   a wait. It is well under the native ~1s this exists to replace.
 * - **0ms on focus.** Focus is deliberate — you Tabbed here — so there is
 *   no accidental-trigger to debounce, and a delay would just look
 *   broken. This is also why focus is the path that must never be
 *   throttled: it is the keyboard user's only way to see the name.
 * - **0ms while another tooltip is already showing.** Once the user has
 *   demonstrably entered "reading tooltips" mode, re-paying 150ms per
 *   button makes a toolbar feel sticky. A module-level flag (not state)
 *   tracks whether any tooltip is currently open, so moving between
 *   adjacent targets is instant. It resets when the last one closes.
 *
 * ## Touch
 *
 * Nothing. There is no hover on touch, and the two common workarounds
 * are both worse than nothing: showing on tap swallows the first tap
 * (the button stops working), and showing on long-press collides with
 * the platform's own text-selection and context gestures. The name is
 * carried by `aria-label` on the trigger, so the control is never
 * nameless to assistive tech on a phone — it is only unlabelled to a
 * sighted touch user, which is the pre-existing icon-only tradeoff that
 * K30-web accepted, not a regression this adds. Pointer events are
 * filtered on `pointerType`, so a touch that synthesises a mouse event
 * does not flash a bubble the user cannot dismiss.
 *
 * ## No double announcement
 *
 * **The rule: the bubble is `aria-hidden` and the trigger is never
 * `aria-describedby` it when the tooltip text merely repeats the
 * trigger's accessible name.**
 *
 * The usual tooltip wiring points `aria-describedby` at the bubble. That
 * is right when the tooltip adds information, and wrong here: our main
 * consumer is an icon-only button whose `aria-label` is the very same
 * string ("Save as view"). Describing it with its own name makes a
 * screen reader read "Save as view, button, Save as view".
 *
 * So the bubble is **always `aria-hidden`**, in both modes. It is a
 * rendering, for the eyes, of text assistive tech already has by another
 * route:
 *
 * - `describes={false}` (default): the name reaches a reader via the
 *   trigger's own `aria-label`. Nothing else is wired.
 * - `describes`: for a tooltip that genuinely says more than the name
 *   (e.g. a truncated chip's full summary). The text is ALSO rendered
 *   into a permanent `sr-only` node that `aria-describedby` points at.
 *   Permanent, not hover-only, because a screen-reader user never
 *   hovers — a description that exists only while a pointer rests on
 *   the control is a description they can never reach, and the
 *   `aria-describedby` would dangle the rest of the time.
 */

/**
 * Visually hidden text that is still in the accessibility tree.
 *
 * Exported because the disabled-reason migration needs exactly this: a
 * real node for `aria-describedby` to point at. `sr-only` (not
 * `display:none`) because a hidden node is pruned from the a11y tree and
 * would describe nothing — the same trap `LoadingState` documents.
 */
export function SrOnly({
  id,
  children,
}: {
  readonly id?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <span {...(id !== undefined ? { id } : {})} className="sr-only">
      {children}
    </span>
  );
}

/** Pointer-enter delay, ms. See the note above. */
export const TOOLTIP_DELAY_MS = 150;

/**
 * Whether ANY tooltip is currently visible, module-level so that moving
 * between adjacent triggers skips the enter delay. Deliberately not
 * React state: it is cross-instance, read during an event handler, and
 * must never itself cause a render.
 */
let tooltipChainOpen = false;

export interface TooltipProps {
  /** The bubble's text. A tooltip with no text renders nothing. */
  readonly label: ReactNode;
  /**
   * The trigger. Receives the ref plus the hover/focus handlers, so any
   * element that forwards a ref (e.g. `IconButton`) can be a trigger
   * without this component wrapping it in an extra box that would break
   * toolbar layout.
   */
  readonly children: ReactElement<Record<string, unknown>>;
  /** Bubble alignment relative to the trigger. Defaults to "start". */
  readonly align?: "start" | "end";
  /**
   * Opt into `aria-describedby` on the trigger. Leave false (the
   * default) whenever the tooltip repeats the trigger's accessible name
   * — see "No double announcement" above.
   */
  readonly describes?: boolean;
  readonly testId?: string;
}

export function Tooltip({
  label,
  children,
  align = "start",
  describes = false,
  testId,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleId = useId();
  const pos = usePortalPlacement(open, wrapRef, bubbleRef, align);

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const hide = useCallback((): void => {
    clearTimer();
    setOpen(prev => {
      // Only release the shared chain when we were the one holding it,
      // so a stray hide from a never-opened tooltip cannot make the next
      // hover pay the delay again mid-sweep.
      if (prev) tooltipChainOpen = false;
      return false;
    });
  }, [clearTimer]);

  const show = useCallback(
    (immediate: boolean): void => {
      clearTimer();
      // Focus is deliberate, and a sweep that is already showing a
      // tooltip has earned instant successors.
      if (immediate || tooltipChainOpen) {
        tooltipChainOpen = true;
        setOpen(true);
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        tooltipChainOpen = true;
        setOpen(true);
      }, TOOLTIP_DELAY_MS);
    },
    [clearTimer],
  );

  // Unmounting mid-delay must not fire into a dead component, and must
  // not strand the shared chain flag open (which would make every later
  // tooltip skip its delay forever).
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      if (open) tooltipChainOpen = false;
    },
    [open],
  );

  // Escape dismisses. Bound on the document rather than the trigger
  // because a tooltip shown by HOVER has no focus anywhere near it, so a
  // trigger-local `onKeyDown` would never hear the key.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); };
  }, [open, hide]);

  if (label === null || label === undefined || label === false || label === "") {
    return children;
  }

  const trigger = cloneElement(children, {
    // Only real pointers. A touch that synthesises pointer events
    // reports `pointerType: "touch"`, and there is no hover to speak of
    // on touch — see the note above.
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      show(false);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === "touch") return;
      hide();
    },
    // A click that activates the control should take the bubble with it,
    // rather than leaving it floating over whatever the click opened.
    onPointerDown: () => { hide(); },
    // `:focus-visible` semantics: show for keyboard focus, not for the
    // focus a mouse click leaves behind (that path already hid on
    // pointer-down, and re-showing would fight it).
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (e.target.matches(":focus-visible")) show(true);
    },
    onBlur: () => { hide(); },
    ...(describes ? { "aria-describedby": bubbleId } : {}),
  });

  return (
    <span ref={wrapRef} className="inline-flex">
      {trigger}
      {/* When the tooltip DESCRIBES the trigger, the description must
          exist whether or not the bubble is showing: a screen-reader
          user never hovers, and an `aria-describedby` pointing at a node
          that only exists on hover is a dangling reference the rest of
          the time. So the text lives permanently in an `sr-only` node,
          and the visible bubble below is `aria-hidden` in BOTH modes —
          which is also what keeps it from being announced twice. */}
      {describes && <SrOnly id={bubbleId}>{label}</SrOnly>}
      {open
        ? createPortal(
            <div
              ref={bubbleRef}
              // Always hidden from the a11y tree, in both modes. The
              // visible bubble is a rendering of text that assistive
              // tech already has by another route — `aria-label` in the
              // default mode, the `sr-only` description node in
              // `describes` mode. Exposing it as well would announce the
              // same string twice.
              aria-hidden="true"
              {...(testId !== undefined ? { "data-testid": testId } : {})}
              style={panelStyle(pos)}
              className={[
                // `z-[66]`: above `Menu`'s panel (`z-[65]`), because a
                // tooltip on a control inside an open menu must sit over
                // it, and under the shortcut-help dialog (`z-[70]`).
                "pointer-events-none fixed z-[66] max-w-xs rounded-md",
                "border border-border-default bg-bg-surface-raised px-2 py-1",
                "text-meta text-text-primary shadow-overlay",
                // Entrance fade. The keyframe is defined once in
                // `styles/index.css` and disabled wholesale there under
                // `prefers-reduced-motion: reduce`, which is how every
                // other animation in this app is guarded.
                "loctt-tooltip-in",
              ].join(" ")}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
