import { STALENESS_WINDOW_MS } from "../api/queryClient.ts";
import { Button } from "../ui/Button.tsx";
import { Icon } from "../ui/Icon.tsx";

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
  iconOnly = false,
}: {
  readonly onRefresh: () => void;
  readonly busy: boolean;
  /**
   * Icon-only, for the toolbar's view-action cluster (Ken's review: the
   * view auto-refreshes, so manual refresh is DEMOTED to a subtle
   * icon-only control rather than a full pill floating in dead space —
   * kept for the "I just changed that in the terminal" case, XS-3, but no
   * longer competing for attention with the filters). The `aria-label`
   * still carries "Refresh" so the XS-3 locator and screen readers are
   * unaffected; the text label is what drops.
   */
  readonly iconOnly?: boolean;
}) {
  const seconds = Math.round(STALENESS_WINDOW_MS / 1000);
  return (
    // B1 migration: the hand-rolled toolbar button becomes the shared
    // Button (secondary, md — the same h-8 pill the toolbar uses). It
    // bakes in the cursor-pointer (K-16) and the hover/active/focus
    // states; `aria-busy`/`aria-label`/`title` and the spinner glyph are
    // carried across unchanged so the XS-3 locator still matches.
    <Button
      variant="secondary"
      size="md"
      onClick={onRefresh}
      disabled={busy}
      aria-busy={busy}
      aria-label="Refresh"
      className={iconOnly ? "px-2" : undefined}
      title={`Refresh now. This view also refreshes on its own at least every ${seconds} seconds, and whenever you return to the tab.`}
    >
      <Icon name="refresh" size={14} className={busy ? "animate-spin" : undefined} />
      {iconOnly ? null : busy ? "Refreshing…" : "Refresh"}
    </Button>
  );
}
