/**
 * In-app navigation guard for an unsaved editor buffer (A246).
 *
 * `beforeunload` (in `useBodyAutosave`) covers tab-close and reload, but
 * it cannot see a client-side route change — TanStack Router never
 * unloads the document, it swaps the matched route and tears the old
 * one's tree down. So a `router.navigate` / `<Link>` click from the task
 * detail to another view unmounted the body editor with no `beforeunload`
 * firing; the unmount flush is the only thing that runs, and if that
 * flush *fails* the text is gone with nowhere to show the error.
 *
 * This hook closes that gap with the router's own `useBlocker`: while the
 * editor has unsaved work, an in-app navigation is intercepted, the
 * buffer is flushed, and the navigation proceeds ONLY if the flush left
 * the editor clean. If the write failed (or a conflict is open), the
 * navigation is blocked and the editor stays mounted showing its existing
 * failed / conflict UI (SaveIndicator, BodyConflictDialog) — the same
 * outcome `beforeunload` produces for a tab-close, now for in-app nav.
 *
 * This is not a "cancel": it extends K96's "every exit keeps the text" to
 * the in-app-nav exit. A clean flush lets the navigation through; only a
 * refused write holds the editor open so the text is not lost silently.
 */

import { useBlocker } from "@tanstack/react-router";

export interface UnsavedGuardOptions {
  /**
   * Whether the editor currently holds work the user would lose by
   * leaving (`useBodyAutosave`'s `hasUnsavedWork`). When false the guard
   * is disabled and navigation is never intercepted.
   */
  readonly hasUnsavedWork: boolean;
  /**
   * Attempt to persist the buffer for an in-app navigation. Resolves to
   * `true` when the editor is now safe to unmount (the write landed, or
   * there was nothing to write), and `false` when the write was refused
   * and the editor must stay mounted to show the failure. It must not
   * throw — a rejected promise is treated as "not safe" (block).
   */
  readonly onNavigateAway: () => Promise<boolean>;
}

/**
 * Blocks an in-app route change while the body editor is dirty/failed,
 * flushing first and only letting the navigation through on a clean save.
 */
export function useUnsavedGuard({ hasUnsavedWork, onNavigateAway }: UnsavedGuardOptions): void {
  useBlocker({
    // No interception at all when there is nothing to lose — a clean
    // editor navigates instantly, exactly as before this hook existed.
    disabled: !hasUnsavedWork,
    // `beforeunload` is already installed by `useBodyAutosave`; leaving
    // the router's own out avoids a second, duplicate browser prompt.
    enableBeforeUnload: false,
    shouldBlockFn: async () => {
      try {
        // Flush for the navigation. Block (return true) unless the flush
        // reports the editor is now clean and safe to unmount.
        const safe = await onNavigateAway();
        return !safe;
      } catch {
        // A thrown flush means we could not confirm the text is saved:
        // keep the editor mounted rather than risk losing it.
        return true;
      }
    },
  });
}
