import { STALENESS_WINDOW_MS } from "../api/queryClient.ts";

/**
 * Manual refresh for the current view (XS-3).
 *
 * The tracker has three writers — this UI, the CLI, and the MCP
 * server — so "I just changed that in the terminal" is the ordinary
 * case, not an edge one. Automatic refresh bounds the staleness
 * window; this removes the wait when the user already knows something
 * changed.
 *
 * Deliberately a top-level button rather than a menu item: the case
 * asks for a control "reachable without opening a menu three levels
 * deep", and a refresh buried in a menu is one nobody finds.
 *
 * It never silently no-ops — while a refetch is in flight the control
 * is busy and says so, and the outcome is whatever the view then
 * renders (fresh rows, or the view's own error state).
 */
export function RefreshButton({
  onRefresh,
  busy,
}: {
  readonly onRefresh: () => void;
  readonly busy: boolean;
}) {
  const seconds = Math.round(STALENESS_WINDOW_MS / 1000);
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={busy}
      aria-busy={busy}
      aria-label="Refresh"
      title={`Refresh now. This view also refreshes on its own at least every ${seconds} seconds, and whenever you return to the tab.`}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border-default bg-bg-surface px-2.5 text-[13px] text-text-secondary hover:bg-bg-muted disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span aria-hidden="true" className={busy ? "inline-block animate-spin" : undefined}>
        ⟳
      </span>
      {busy ? "Refreshing…" : "Refresh"}
    </button>
  );
}
