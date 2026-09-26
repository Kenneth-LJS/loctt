import { type RefObject,useEffect } from "react";

/**
 * Confines Tab to a container, and restores focus when it unmounts.
 *
 * A11Y-14 and A11Y-15 are one mechanism seen from two ends: focus must
 * not escape a modal forwards or backwards, and when the modal closes
 * it must land back on whatever opened it — never on `document.body`,
 * because from `body` the next Tab restarts at the top of the page.
 *
 * ## Why the selector is queried on every Tab
 *
 * A modal's focusable set is not fixed at mount. The create modal
 * grows a "project required" message, dialogs disable their submit
 * while saving, pickers add and remove options. A trap that captured
 * `first`/`last` once wraps to a control that has since been disabled
 * or unmounted — which lands focus on `body`, the exact failure the
 * case names. So the set is recomputed per keystroke; a Tab is a human
 * action and the query is cheap.
 *
 * ## Why `:not([disabled])` and the `tabindex` filter
 *
 * `toBeDisabled` semantics bite here too: a disabled control is not a
 * tab stop, so wrapping to one is wrapping to nowhere. Elements with
 * `tabindex="-1"` are programmatically focusable but not tab stops,
 * and must be excluded from the wrap ends for the same reason.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable]:not([contenteditable="false"])',
  "[tabindex]",
].join(",");

function tabbable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
    if (el.getAttribute("tabindex") === "-1") return false;
    if (el.hasAttribute("disabled")) return false;
    // `offsetParent` is null for `display:none` subtrees. A collapsed
    // disclosure's contents are in the DOM but are not tab stops, and
    // wrapping into one strands focus somewhere invisible.
    return el.offsetParent !== null || el === document.activeElement;
  });
}

export interface FocusTrapOptions {
  /**
   * Where focus goes on mount. Defaults to the first tab stop.
   *
   * A11Y-50 is why this is a parameter: a destructive confirmation
   * must open with focus on Cancel, "never on the destructive button —
   * a stray Enter cannot delete 40 tasks". That is a per-dialog
   * decision, so the dialog passes its own safe default in.
   */
  readonly initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Where focus returns on unmount. Defaults to whatever was focused
   * when the trap mounted, which is the right answer for a dialog
   * opened from a button that still exists.
   *
   * Passed explicitly when the trigger will be gone by then — A11Y-15
   * names the case: after a successful delete the ⋯ menu that opened
   * the dialog has unmounted with its row.
   */
  readonly returnFocusTo?: HTMLElement | null;
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  options: FocusTrapOptions = {},
): void {
  const { initialFocus, returnFocusTo } = options;

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const target = initialFocus?.current ?? tabbable(container)[0] ?? container;
    target.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") return;
      const stops = tabbable(container);
      if (stops.length === 0) {
        // Nothing to move to; keep focus on the panel rather than
        // letting Tab walk into the inert page behind.
        e.preventDefault();
        container.focus();
        return;
      }
      const first = stops[0] as HTMLElement;
      const last = stops[stops.length - 1] as HTMLElement;
      const active = document.activeElement;

      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!(active instanceof Node) || !container.contains(active)) {
        // Focus escaped — a programmatic move, or the element it was
        // on unmounted. Pull it back rather than letting the next Tab
        // continue from the page behind the overlay.
        e.preventDefault();
        first.focus();
      }
    };

    // Capture phase: a dialog's inner widgets (the option pickers)
    // also listen for keys, and the trap has to win the wrap decision
    // regardless of what stops propagation inside.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const restore = returnFocusTo !== undefined ? returnFocusTo : previouslyFocused;
      // `isConnected` is the guard that makes A11Y-15's "or its
      // nearest surviving equivalent" real: restoring to a detached
      // node silently focuses nothing, which is `document.body` by
      // another name.
      if (restore !== null && restore.isConnected) restore.focus();
    };
    // Mount/unmount only: re-running would re-steal focus mid-dialog, and
    // `returnFocusTo` is deliberately the value the trap mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only by design; any dep re-steals focus
  }, []);
}
