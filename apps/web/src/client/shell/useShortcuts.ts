import { useEffect, useRef } from "react";

import { CHORD_TIMEOUT_MS, resolveShortcut, type ShortcutId } from "./shortcuts.ts";
import { isTypingTarget } from "./typingTarget.ts";

/**
 * Binds the global shortcut table to the window.
 *
 * One listener for the whole table, rather than one per key. The
 * suppression rules (A11Y-1, A11Y-7, A11Y-8) are the reason: each is a
 * property of *the shortcut system*, not of any one key, and a rule
 * implemented per-listener is a rule that gets forgotten on the next
 * key added. `n` had the typing guard and the dialog guard; `[` had
 * only the typing guard, so `[` fired while the create modal was open.
 *
 * ## The three suppression rules
 *
 * - **Typing**: `isTypingTarget` — its own module with its own test,
 *   see the comment there for why testing it through a modal proves
 *   nothing. A11Y-1: typing `n` into a title inserts `n`. A11Y-2 is
 *   the deliberate inverse — `/` inside a field inserts a literal `/`,
 *   which the same guard delivers.
 * - **A layer owns the keyboard**: A11Y-8. While any dialog is
 *   mounted, `g`+`b` must not navigate out from under it. Checked by
 *   querying for a live dialog rather than by a context flag, because
 *   dialogs are opened by a dozen different components and several
 *   render their own `role="dialog"` without going through `Modal`.
 * - **Modifiers**: a shortcut is a bare keypress. `Cmd+T` is the
 *   browser's new tab (A11Y-43's second bullet) and must reach it.
 *
 * `Esc` is deliberately absent from the table and from this handler:
 * A11Y-5 and A11Y-34 require it to close *the topmost layer*, which is
 * knowledge only the layers themselves have. Each dismissible layer
 * binds its own `Esc`; the stacking order falls out of the listeners
 * being added in mount order.
 */
export function useShortcuts(handlers: Partial<Record<ShortcutId, () => void>>): void {
  // Held in a ref so the listener is installed once. Re-installing on
  // every render would drop a chord prefix mid-chord, and would also
  // mean the `keydown` listener churns on every parent re-render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let pendingPrefix: string | null = null;
    let chordTimer: ReturnType<typeof setTimeout> | undefined;

    const clearChord = (): void => {
      pendingPrefix = null;
      if (chordTimer !== undefined) clearTimeout(chordTimer);
      chordTimer = undefined;
    };

    const onKey = (e: KeyboardEvent): void => {
      // A bare keypress only. Modifier combinations belong to the
      // browser and the OS.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      // A11Y-8: a modal or menu owns the keyboard while it is open.
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]') !== null) {
        return;
      }

      const resolution = resolveShortcut(e.key, pendingPrefix);

      if (resolution.kind === "chord-start") {
        e.preventDefault();
        pendingPrefix = resolution.prefix;
        // A11Y-3's second bullet: the chord times out. Without this a
        // `g` pressed and abandoned would eat the next `l` typed
        // minutes later.
        chordTimer = setTimeout(clearChord, CHORD_TIMEOUT_MS);
        return;
      }

      // Any resolved key ends a chord — including an unmapped second
      // key, which is A11Y-3's "not a stuck state".
      clearChord();

      if (resolution.kind === "none") return;

      const handler = handlersRef.current[resolution.id];
      if (handler === undefined) return;
      // Only prevent default once something will actually run. A key
      // with no handler registered on this route must reach the page.
      e.preventDefault();
      handler();
    };

    window.addEventListener("keydown", onKey);
    return () => {
      clearChord();
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
