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
 * it. The visual treatment matches the spelling it replaces so nothing
 * shifts.
 */
export function LoadingState({
  children,
  className,
}: {
  /** The message, e.g. "Loading projects…". */
  readonly children: React.ReactNode;
  /** Extra classes; defaults to the padded settings-panel treatment. */
  readonly className?: string;
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      className={className ?? "p-8 text-[0.9286rem] text-text-tertiary"}
    >
      {children}
    </div>
  );
}
