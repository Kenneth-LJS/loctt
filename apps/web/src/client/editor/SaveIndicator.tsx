/**
 * The save indicator (TSK-15's third bullet: the user is never
 * guessing). Four states, and since K124 each means exactly this:
 *
 * - **Unsaved changes** — the editor holds text that is not on disk.
 *   It stays that way until Save; nothing saves it automatically.
 * - **Saving…** — a Save is in flight.
 * - **Saved** — the editor matches what is on disk.
 * - **failed** — a Save was refused; the message says the text was not
 *   saved, with Retry.
 *
 * ERR-27 is why this is a persistent region rather than a toast: a
 * failure that vanishes while the user is looking at the keyboard
 * tells nobody anything. It stays until the state changes.
 *
 * A polite live region for the ordinary states; the failed state
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

  const kind = state.kind;
  const label = ORDINARY_LABELS[kind];

  /**
   * `aria-live="polite"` rather than `role="status"`.
   *
   * The two are equivalent to a screen reader, but `role="status"` is
   * also a *landmark role* that `getByRole("status")` matches — and
   * this indicator is permanently on screen, so adding one would make
   * every `getByRole("status")` on the task page ambiguous with the
   * transient confirmations that page shows.
   *
   * An always-present indicator is not the same kind of thing as a
   * transient confirmation, and should not compete with it for the
   * role that names one.
   */
  return (
    <span
      aria-label={`Description: ${label}`}
      data-testid="save-indicator"
      data-state={state.kind}
      // ## Why the width is reserved (TSK-18)
      //
      // This indicator sits in the toolbar row's trailing slot, to the
      // RIGHT of the `flex-1` toolbar whose own mode toggle is pushed
      // right with `ml-auto`. So the indicator's width decides where the
      // mode toggle is drawn: every character it gains or loses slides
      // the toggle sideways by that much.
      //
      // That made the Rich→Markdown toggle a DEAD BUTTON after typing.
      // Pressing it blurred the rich surface, which (before K124) flushed
      // the pending edit, so between mousedown and mouseup the label went
      // "Unsaved changes" → "Saving…"/"Saved" — measured at 52px
      // narrower — and the button slid 52px right, out from under the
      // cursor. The browser then fired no `click` at all (mouseup landed
      // on a different element), so `onModeChange` never ran: first
      // click dead, second click fine. A pure layout defect that looked
      // like an event-ordering bug.
      //
      // The three ordinary labels are therefore all laid out in one grid
      // cell, with the inactive ones `invisible` — rendered, so they
      // take space. The box is as wide as the LONGEST label at whatever
      // the font actually renders — measured by the browser, not by a px
      // constant that a font or copy change would silently invalidate —
      // so no ordinary state change moves the toolbar by a single pixel.
      //
      // The `failed` state is deliberately NOT in this grid: it returns
      // above with a message plus a Retry button, and it is a state the
      // user reads and acts on rather than one that lands mid-click.
      className="grid grid-cols-1 grid-rows-1 text-[0.8571rem] text-text-tertiary"
    >
      {/* The announced text. A live region announces a CONTENT change,
          not an attribute change, so the polite region has to be the one
          node whose text actually differs per state — the sizer stack
          below never changes its text and would announce nothing. */}
      <span aria-live="polite" className="sr-only">{label}</span>
      {ORDINARY_KINDS.map(k => (
        <span
          key={k}
          // Hidden from assistive tech: the wrapper's `aria-label` names
          // the control and the live region above speaks the state, so
          // exposing three stacked copies would read all of them.
          aria-hidden="true"
          className={
            "col-start-1 row-start-1 whitespace-nowrap "
            + (k === kind ? "" : "invisible")
          }
        >
          {ORDINARY_LABELS[k]}
        </span>
      ))}
    </span>
  );
}

/** The non-failed states, in the order they are stacked for sizing. */
const ORDINARY_KINDS = ["saved", "saving", "unsaved"] as const;

const ORDINARY_LABELS: Record<(typeof ORDINARY_KINDS)[number], string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
};
