/**
 * The bulk action bar, shown once at least one row is selected.
 *
 * Absent from the DOM at zero selection rather than hidden with
 * opacity (BLK-2): a bar that is present but invisible is still
 * reachable by Tab and still announced, which is worse than not being
 * there.
 *
 * Actions land in a later pass — this is selection state and the bar
 * itself. Rendering action buttons that do nothing would be worse than
 * showing none, so the bar carries only Clear until they exist.
 */
export function BulkBar({
  count,
  scopeLabel,
  onClear,
}: {
  readonly count: number;
  /**
   * How the selection was made, stated next to the count (BLK-3). The
   * bar must never imply a scope wider than what is selected.
   */
  readonly scopeLabel?: string | undefined;
  readonly onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div
      // Sticky so scrolling to row 50 keeps it visible (BLK-2).
      className="sticky bottom-0 z-10 flex items-center gap-3 border-t border-border-subtle bg-bg-surface px-4 py-2.5 shadow-[0_-1px_3px_rgba(0,0,0,0.06)]"
      role="region"
      aria-label="Bulk actions"
    >
      <p aria-live="polite" className="text-[13px] font-medium text-text-primary">
        {/* Singular at one, plural above — the count is of selected
            rows, never the page size or the filter total. */}
        {count} {count === 1 ? "task" : "tasks"} selected
        {scopeLabel !== undefined && (
          <span className="ml-1 font-normal text-text-tertiary">· {scopeLabel}</span>
        )}
      </p>

      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-auto rounded-md border border-border-subtle px-2.5 py-1 text-[12px] font-medium text-text-secondary hover:bg-bg-muted"
      >
        Clear ×
      </button>
    </div>
  );
}
