import { LogoSpinner } from "./brand/LogoSpinner.tsx";

/**
 * The shared loading placeholder (docs/dev/design/design-review.md §A3).
 *
 * ~14 features re-spelled `<div className="p-8 text-[0.9286rem]
 * text-text-tertiary">Loading X…</div>` with **no** `role="status"`, so a
 * screen reader was never told the region was loading — the panel just
 * sat silent until content appeared. This bakes the live region in: the
 * message is announced when it mounts, and once (a polite `status`, not
 * an `alert` — nothing is wrong).
 *
 * `aria-busy` marks the region itself as in-progress for AT that reports
 * it.
 *
 * **Visible content is the brand spinner, not the message.** Ken's
 * objection was to *seeing* "Loading X…" text scattered through the app,
 * not to it existing for screen readers — so the message stays in the
 * DOM (still the live region's accessible text, still what gets
 * announced) but is visually hidden with `sr-only`. A spinner with no
 * accessible name announces nothing, which is exactly the silent-panel
 * bug this component was built to fix in the first place — hiding the
 * text `display:none` instead of `sr-only` would have reintroduced it.
 */
export function LoadingState({
  children,
  className,
  size = 32,
}: {
  /** The message, e.g. "Loading projects…". Announced, not shown. */
  readonly children: React.ReactNode;
  /** Extra classes on the wrapper; defaults to the padded settings-panel treatment. */
  readonly className?: string;
  /** Spinner size in px. Default suits a panel-level loading state. */
  readonly size?: number;
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      className={className ?? "flex justify-center p-8"}
    >
      <LogoSpinner size={size} />
      <span className="sr-only">{children}</span>
    </div>
  );
}
