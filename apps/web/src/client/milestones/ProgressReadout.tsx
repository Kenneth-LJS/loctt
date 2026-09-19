import type { Readout } from "./model.ts";
import { discardedNote } from "./model.ts";

/**
 * The bar + `done / total` readout, and the sentence explaining the
 * denominator.
 *
 * **One component, used by both the list row and the detail header.**
 * MSL-3's last bullet is that the same milestone never shows two
 * different denominators on two surfaces, and its first is that the
 * rule is stated *where the number is shown*. Two hand-written
 * readouts satisfy both on the day they are written and drift after;
 * this makes them the same rendering by construction.
 *
 * Nothing here computes progress. The numbers arrive from core via
 * `?progress=true` and are shaped by `progressState`, so the exclusion
 * rule is applied once, in core, rather than re-implemented per
 * surface.
 */
export function ProgressReadout({
  readout,
  idPrefix,
  onRetry,
  milestoneName,
  label = "Milestone progress",
  segmented = false,
}: {
  readonly readout: Readout;
  /** Test-id namespace, so list rows and the detail don't collide. */
  readonly idPrefix: string;
  /** Retry for the MSL-35 error affordance. */
  readonly onRetry?: (() => void) | undefined;
  /** Named in the error affordance (MSL-35). */
  readonly milestoneName: string;
  /**
   * The bar's accessible name. Defaults to "Milestone progress" so the
   * existing milestone and sprint callers are unchanged; a tree-child
   * caller passes "Child progress" so a screen reader does not announce
   * the wrong noun (known-gaps: the label used to be hard-coded).
   */
  readonly label?: string;
  /**
   * Render a three-segment fill — done (success) / active (accent) /
   * un-started (track) — instead of the single done-vs-not fill. Opt-in
   * so the milestone/sprint bars are behaviour-preserving; the middle
   * segment only appears when the `Readout` also carries an
   * `activeFill`, so passing this without an `active` count still yields
   * the single fill.
   */
  readonly segmented?: boolean;
}) {
  // MSL-35: a failed computation is not zero progress. This renders in
  // *place of* the numbers — never `0 / 0`, which MSL-15 uses for a
  // real empty milestone and which would make the two states
  // indistinguishable.
  if (readout.kind === "unavailable") {
    return (
      <div
        role="alert"
        data-testid={`${idPrefix}-progress-error`}
        className="flex items-center gap-2 text-[0.8571rem] text-danger-fg"
      >
        <span data-testid={`${idPrefix}-progress-error-text`}>
          Progress for <strong>{milestoneName}</strong> could not be computed.
        </span>
        {onRetry !== undefined && (
          <button
            type="button"
            data-testid={`${idPrefix}-progress-retry`}
            onClick={onRetry}
            className="shrink-0 rounded border border-danger-fg/40 px-2 py-0.5 hover:bg-danger-fg/10"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  const note = discardedNote(readout);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div
          data-testid={`${idPrefix}-bar`}
          // The bar is a meter, not decoration: the numbers must be
          // available to a screen reader without reading the fill
          // width off a style attribute.
          role="meter"
          aria-valuemin={0}
          aria-valuemax={readout.total}
          aria-valuenow={readout.done}
          aria-label={label}
          data-fill={readout.fill.toFixed(4)}
          {...(readout.activeFill !== undefined
            ? { "data-active-fill": readout.activeFill.toFixed(4) }
            : {})}
          className="relative flex h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-bg-muted"
        >
          {segmented && readout.activeFill !== undefined ? (
            // Three segments laid side by side: done (success), then
            // active (accent), then the track shows through as the
            // un-started remainder. Widths come from `progressState`,
            // which clamps them so they never sum past 100%.
            <>
              <div
                data-testid={`${idPrefix}-bar-fill`}
                className="h-full bg-success-fg transition-[width]"
                style={{ width: `${String(readout.fill * 100)}%` }}
              />
              <div
                data-testid={`${idPrefix}-bar-active`}
                className="h-full bg-accent transition-[width]"
                style={{ width: `${String(readout.activeFill * 100)}%` }}
              />
            </>
          ) : (
            <div
              data-testid={`${idPrefix}-bar-fill`}
              className={[
                "h-full rounded-full transition-[width]",
                readout.complete ? "bg-success-fg" : "bg-accent",
              ].join(" ")}
              // MSL-1: the fill proportion matches the numbers shown.
              // Derived from `done / total` in `progressState`, not from
              // a separate `fraction` field that could be stale.
              style={{ width: `${String(readout.fill * 100)}%` }}
            />
          )}
        </div>

        {readout.kind === "none" ? (
          // MSL-15: an explicit "No tasks" — never `0/0`, `NaN`,
          // `NaN%`, `Infinity`, or a blank. Percent is absent, not
          // zero: there is no denominator to compute one from.
          <span
            data-testid={`${idPrefix}-readout`}
            className="shrink-0 text-[0.8571rem] text-text-tertiary"
          >
            No tasks
          </span>
        ) : (
          <span
            data-testid={`${idPrefix}-readout`}
            className="shrink-0 text-[0.8571rem] tabular-nums text-text-secondary"
          >
            {readout.done} / {readout.total}
            <span className="ml-1 text-text-tertiary">
              ({readout.percent}%)
            </span>
          </span>
        )}
      </div>

      {/* MSL-3: the rule, stated where the number is shown. Rendered
          from `discardedNote` so the list and the detail say the same
          sentence rather than two similar ones. */}
      {note !== undefined && (
        <p
          data-testid={`${idPrefix}-discarded-note`}
          className="text-[0.7857rem] text-text-tertiary"
        >
          {note}
        </p>
      )}
    </div>
  );
}
