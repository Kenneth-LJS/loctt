/**
 * The save indicator (TSK-15's third bullet: saved / saving / unsaved,
 * so the user is never guessing).
 *
 * ERR-27 is why this is a persistent region rather than a toast: an
 * auto-save failure has to be *as loud as* a manual one, and a
 * two-second toast that vanishes while the user is looking at the
 * keyboard tells nobody anything. It stays until the state changes.
 *
 * A polite live region for the ordinary states, so a screen reader is
 * not interrupted mid-word on every idle save; the failed state
 * upgrades to `role="alert"` because it does need to interrupt.
 */

import type { SaveState } from "./useBodyAutosave.ts";

export function SaveIndicator(
  { state, onRetry }: { readonly state: SaveState; readonly onRetry: () => void },
): React.JSX.Element {
  if (state.kind === "failed") {
    return (
      <div
        role="alert"
        data-testid="save-indicator"
        data-state="failed"
        className="flex items-center gap-2 text-[0.8571rem] text-danger-fg"
      >
        <span>{state.message}</span>
        {/* ERR-12's fourth bullet: freeing space and retrying is the
            actual fix, so the control has to be here. */}
        <button
          type="button"
          data-testid="save-retry"
          onClick={onRetry}
          className="underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const label =
    state.kind === "saving" ? "Saving…"
      : state.kind === "unsaved" ? "Unsaved changes"
        : "Saved";

  /**
   * `aria-live="polite"` rather than `role="status"`.
   *
   * The two are equivalent to a screen reader, but `role="status"` is
   * also a *landmark role* that `getByRole("status")` matches — and
   * this indicator is permanently on screen, so adding one made every
   * existing `getByRole("status")` on the task page ambiguous. It
   * broke TSK-19's "Key copied" assertion, which had been correctly
   * matching the one transient status on the page.
   *
   * An always-present indicator is not the same kind of thing as a
   * transient confirmation, and should not compete with it for the
   * role that names one.
   */
  return (
    <span
      aria-live="polite"
      aria-label={`Description: ${label}`}
      data-testid="save-indicator"
      data-state={state.kind}
      className="text-[0.8571rem] text-text-tertiary"
    >
      {label}
    </span>
  );
}
