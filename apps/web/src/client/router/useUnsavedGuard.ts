/**
 * In-app navigation guard for an editor with unsaved changes (A246,
 * reshaped by K124).
 *
 * `beforeunload` (in `useBodyAutosave`) covers tab-close and reload, but
 * it cannot see a client-side route change — TanStack Router never
 * unloads the document, it swaps the matched route and tears the old
 * one's tree down.
 *
 * This hook closes that gap with the router's own `useBlocker`: while the
 * editor has unsaved work, a navigation to another page is intercepted
 * and `onNavigateAway` decides whether it proceeds. Since K124 the
 * description editor answers by asking the user ("Discard changes?"):
 * Discard lets the navigation through, Keep editing blocks it. Before
 * K124 it answered by flushing an autosave (A246); nothing is written on
 * navigation any more.
 *
 * Only a change of PAGE is intercepted. The task page records its
 * activity tab and a scroll-to anchor in the URL, and switching the
 * Comments/Activity tab while the description is open must not prompt a
 * discard: the editor stays mounted across those navigations, so there
 * is nothing to lose.
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
   * Decide a navigation away from the page. Resolves `true` to let it
   * proceed (the user chose to discard) and `false` to block it (the
   * user kept editing). It must not throw — a rejected promise is
   * treated as "block".
   */
  readonly onNavigateAway: () => Promise<boolean>;
}

/** Blocks a page change while the editor has unsaved work, unless `onNavigateAway` allows it. */
export function useUnsavedGuard({ hasUnsavedWork, onNavigateAway }: UnsavedGuardOptions): void {
  useBlocker({
    // No interception at all when there is nothing to lose — a clean
    // editor navigates instantly, exactly as before this hook existed.
    disabled: !hasUnsavedWork,
    // `beforeunload` is already installed by `useBodyAutosave`; leaving
    // the router's own out avoids a second, duplicate browser prompt.
    enableBeforeUnload: false,
    shouldBlockFn: async ({ current, next }) => {
      // Same page, different search or hash: the editor survives it.
      if (current.pathname === next.pathname) return false;
      try {
        const proceed = await onNavigateAway();
        return !proceed;
      } catch {
        // Could not get an answer: keep the editor rather than risk
        // losing the text.
        return true;
      }
    },
  });
}
