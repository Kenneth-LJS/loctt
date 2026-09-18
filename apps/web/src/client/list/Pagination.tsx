/**
 * The list view's footer: how much of the filtered set is on screen,
 * and the control that loads the rest.
 *
 * The count is deliberately derived from what is *rendered* (`loaded`)
 * rather than from the page number — a failed "Load more" must not
 * advance it (LST-49), and after a filter change the label has to
 * recompute against the new total rather than keep claiming the old
 * one (LST-13).
 */
export function Pagination({
  loaded,
  total,
  hasMore,
  isLoadingMore,
  error,
  onLoadMore,
}: {
  /** Rows actually on screen. */
  readonly loaded: number;
  /** Total matching the active filters, per the server. */
  readonly total: number;
  readonly hasMore: boolean;
  readonly isLoadingMore: boolean;
  /** Set when the last "Load more" failed. */
  readonly error?: string | undefined;
  readonly onLoadMore: () => void;
}) {
  if (total === 0) return null;

  return (
    <div className="flex flex-col items-center gap-2 py-3">
      <p
        // Polite so the count reaches a screen reader after rows append
        // without interrupting what the user is reading.
        aria-live="polite"
        className="text-[0.8571rem] text-text-tertiary"
      >
        Showing 1–{loaded} of {total}
      </p>

      {error !== undefined && (
        <p role="alert" className="text-[0.8571rem] text-danger-fg">
          {error}
        </p>
      )}

      {/*
        The control stays mounted whenever more rows exist — including
        after a failure. Hiding it on error would look exactly like
        genuine exhaustion (LST-49).
      */}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="rounded-md border border-border-subtle bg-bg-surface px-3 py-1.5 text-[0.8571rem] font-medium text-text-secondary hover:bg-bg-muted disabled:opacity-50"
        >
          {isLoadingMore ? "Loading…" : error !== undefined ? "Retry" : "Load more"}
        </button>
      )}
    </div>
  );
}
