import type { PriorityDef } from "@loctt/contracts";

import type { ListSearch } from "../router/listSearch.ts";
import type { IconName } from "../ui/Icon.tsx";

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
 * "Mentions me" resolves to `comment_mentions = "<currentUserId>"`
 * (CMT-10 / A183) — a query field the list endpoint scans comments for,
 * gated so ordinary lists pay no comment I/O. Like the two user filters
 * above it is null while no user is active, so the row renders inert.
 */

export interface BuiltinFilter {
  readonly id: string;
  readonly label: string;
  /** Icon drawn beside the filter row (see the shared `Icon` component). */
  readonly icon: IconName;
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
  /**
   * The workspace's priorities, in config order.
   *
   * "High priority" cannot be a fixed key list: VUE-24 covers a
   * tracker with no `high` key at all, where `priority in (high,
   * critical)` matched nothing and the badge sat permanently at zero —
   * a filter that looks live and is structurally dead. Undefined while
   * the workflow config is still loading, which resolves the built-in
   * to null rather than to a wrong query.
   */
  readonly priorities?: readonly PriorityDef[] | undefined;
}

/**
 * The priorities "High priority" should match, given a workspace's own
 * set.
 *
 * Rank by `value` when the config supplies it — that is what the field
 * is for — and fall back to config order, which every LocTT config
 * lists highest-first. Either way the top two are taken, or the single
 * top one when the workspace defines fewer than three: on a two-value
 * scale "high priority" meaning "all but the lowest" is still a
 * distinction, but on a one-value scale it is not a filter at all.
 */
export function highPriorityKeys(
  priorities: readonly PriorityDef[],
): readonly string[] {
  if (priorities.length < 2) return [];
  const ranked = priorities.every(p => typeof p.value === "number")
    ? [...priorities].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    : priorities;
  return ranked.slice(0, priorities.length >= 3 ? 2 : 1).map(p => p.key);
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
    icon: "user",
    resolve: ({ currentUserId }) =>
      currentUserId === null
        ? null
        : { q: `assignee = "${currentUserId}" and ${NOT_CLOSED}` },
  },
  {
    id: "reported-by-me",
    label: "Reported by me",
    icon: "edit",
    resolve: ({ currentUserId }) =>
      currentUserId === null
        ? null
        : { q: `reporter = "${currentUserId}"` },
  },
  {
    id: "mentions-me",
    label: "Mentions me",
    icon: "atSign",
    // CMT-10 / A183: resolves to the `comment_mentions` query field, which
    // matches a task when any of its comments mention this user. Like
    // "Assigned to me", the concrete ULID is inlined rather than the DSL's
    // `currentUser()` token, so the same query text drives both the list
    // and its count badge regardless of how the request resolves the
    // current user. Null while no user is active, so the row is inert.
    resolve: ({ currentUserId }) =>
      currentUserId === null
        ? null
        : { q: `comment_mentions = "${currentUserId}"` },
  },
  {
    id: "due-this-week",
    label: "Due this week",
    icon: "calendar",
    resolve: ({ today }) => ({
      q: `due_date >= ${today} and due_date <= ${addDays(today, 7)} and ${NOT_CLOSED}`,
    }),
  },
  {
    id: "overdue",
    label: "Overdue",
    icon: "alert",
    resolve: ({ today }) => ({
      q: `due_date < ${today} and ${NOT_CLOSED}`,
    }),
  },
  {
    id: "high-priority",
    label: "High priority",
    icon: "arrowUp",
    // Resolved against the workspace's own priorities (VUE-24). A
    // workspace whose scale cannot express "high" — one priority, or
    // none — resolves to null, so the row renders inert rather than
    // showing a badge stuck at zero.
    resolve: ({ priorities }) => {
      if (priorities === undefined) return null;
      const keys = highPriorityKeys(priorities);
      if (keys.length === 0) return null;
      return { q: `priority in (${keys.join(", ")}) and ${NOT_CLOSED}` };
    },
  },
];
