import type { ListSearch } from "../router/listSearch.ts";

/**
 * Built-in saved filters shown in the sidebar's "Saved filters" group.
 *
 * Each built-in resolves to a `Partial<ListSearch>` — the URL search
 * state the list view applies when you click it. The list view (M1.2+)
 * is the single place that turns URL state into an `/api/tasks`
 * request, so built-ins only ever *describe* state; they never call
 * the API directly. The sidebar's count badge issues the same request
 * the list view would (via `useBuiltinCounts`) so the number always
 * matches what clicking through shows.
 *
 * Two built-ins ("Assigned to me", "Reported by me") depend on the
 * current user's id, and three depend on today's date. We model them
 * as pure functions of `(currentUserId, today)` rather than baking a
 * value in, so the same definition re-resolves correctly across user
 * switches and across midnight without a reload.
 *
 * The LocTT query DSL has no `@me` token and no date arithmetic, so we
 * substitute concrete values here: the user's ULID, and JS-computed
 * `today` / `today + 7d` ISO dates. "Open" (not closed) is expressed
 * workflow-agnostically as `status.category not in (completed,
 * discarded)` so it tracks whatever statuses a workspace has mapped to
 * those categories.
 *
 * "Mentions me" is intentionally left non-interactive with no count
 * until M2.4 — it needs a comment-scan endpoint that lands with the
 * comments feature. It still renders so the group matches the mockup.
 */

export interface BuiltinFilter {
  readonly id: string;
  readonly label: string;
  /** Single-glyph icon matching the mockup. */
  readonly icon: string;
  /**
   * Resolves the URL search state this filter applies, or `null` when
   * it can't be resolved yet (e.g. needs a current user that isn't
   * loaded, or is deferred like "Mentions me"). A null result renders
   * the row without a count and as non-interactive.
   */
  readonly resolve: (ctx: BuiltinContext) => Partial<ListSearch> | null;
}

export interface BuiltinContext {
  /** Current user's ULID, or null when no user is active. */
  readonly currentUserId: string | null;
  /** Today's date as YYYY-MM-DD (caller-supplied for testability). */
  readonly today: string;
}

/** `status.category not in (completed, discarded)` — i.e. still open. */
const NOT_CLOSED = "status.category not in (completed, discarded)";

/** Adds `days` to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  // Parse as UTC midnight so the +Nd math never crosses a DST seam.
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const BUILTIN_FILTERS: readonly BuiltinFilter[] = [
  {
    id: "assigned-to-me",
    label: "Assigned to me",
    icon: "\u{1F464}", // 👤
    resolve: ({ currentUserId }) =>
      currentUserId === null
        ? null
        : { q: `assignee = "${currentUserId}" and ${NOT_CLOSED}` },
  },
  {
    id: "reported-by-me",
    label: "Reported by me",
    icon: "✎", // ✎
    resolve: ({ currentUserId }) =>
      currentUserId === null
        ? null
        : { q: `reporter = "${currentUserId}"` },
  },
  {
    id: "mentions-me",
    label: "Mentions me",
    icon: "@",
    // Deferred to M2.4 (needs a comment-scan endpoint). Renders but
    // does nothing and shows no count until then.
    resolve: () => null,
  },
  {
    id: "due-this-week",
    label: "Due this week",
    icon: "\u{1F4C5}", // 📅
    resolve: ({ today }) => ({
      q: `due_date >= ${today} and due_date <= ${addDays(today, 7)} and ${NOT_CLOSED}`,
    }),
  },
  {
    id: "overdue",
    label: "Overdue",
    icon: "!",
    resolve: ({ today }) => ({
      q: `due_date < ${today} and ${NOT_CLOSED}`,
    }),
  },
  {
    id: "high-priority",
    label: "High priority",
    icon: "▲", // ▲
    resolve: () => ({
      q: `priority in (high, critical) and ${NOT_CLOSED}`,
    }),
  },
];
