/**
 * UI-12. Tracks the route a task/milestone detail page was opened FROM,
 * so its back affordance can return there exactly (path + search
 * params) rather than to a hardcoded destination.
 *
 * ## Why a plain in-memory variable, not router location `state` or
 * `sessionStorage`
 *
 * Ken's ruling is specific: *"fall back to the route i came from. if
 * cold load then no back button"* — a cold load is a direct link, a
 * refresh, or a shared URL, and in every one of those cases there must
 * be NO origin, not a stale or guessed one.
 *
 * TanStack Router's `navigate({ state })` writes through to
 * `history.pushState`, and the browser preserves `history.state` across
 * a same-document reload — so reading it back on init would make a
 * refresh remember the last origin, which is exactly the case this must
 * NOT satisfy. `sessionStorage` has the identical problem: it survives
 * a refresh by design.
 *
 * A module-level variable has neither issue. It lives only in this JS
 * module's memory: an in-app navigation (clicking a row, browser
 * Back/Forward within the same session) keeps the module loaded, so the
 * value survives — but a hard reload re-evaluates the module from
 * scratch, so the value is gone, which is what "no origin after a
 * refresh" requires by construction rather than by a check.
 */

/** Full path + search of the route a detail page was opened from. */
let lastOrigin: string | undefined;

/**
 * Records the route being left, right before navigating into a detail
 * page. `href` is the router's own `location.href` (pathname + search),
 * so it already carries whatever filters/page/sort the origin route had
 * applied.
 */
export function recordTaskOrigin(href: string): void {
  lastOrigin = href;
}

/** The route a detail page was opened from, ready to render and navigate to. */
export interface TaskOrigin {
  /** Full path + search (e.g. `/list?status=in_progress&page=2`). */
  readonly href: string;
  /** The pathname alone, for matching against {@link ORIGIN_LABELS}. */
  readonly pathname: string;
  /** The `?…` query string, or `""` — split out so a caller can hand the
   *  pathname to `<Link to>` (which resolves `to` as a path template,
   *  not a full href) and the query string to `<a href>`/`router.navigate`
   *  separately. */
  readonly search: string;
  /** A short label for the back link's text ("Back to list", …). */
  readonly label: string;
}

/**
 * User-facing names for the routes a task/milestone can be reached
 * from, keyed by pathname. Deliberately small and literal rather than a
 * generic "the previous page" — Ken's ask was for the label to "reflect
 * the actual origin where you can derive one sensibly", and a handful of
 * known routes is what that is: List, Board, Timeline, Sprints,
 * Milestones. A milestone or sprint's own detail page is not named
 * individually (there is no per-entity name to reach for without an
 * extra fetch this affordance does not need) and falls back to
 * `undefined`.
 */
const ORIGIN_LABELS: Record<string, string> = {
  "/list": "Back to list",
  "/board": "Back to board",
  "/timeline": "Back to timeline",
  "/sprints": "Back to sprints",
  "/milestones": "Back to milestones",
};

function labelFor(pathname: string): string {
  return ORIGIN_LABELS[pathname] ?? "Back";
}

/**
 * Reads and clears the recorded origin.
 *
 * Consumed once, by the detail page that mounts right after
 * `recordTaskOrigin` ran — so a second, unrelated mount (e.g. opening a
 * different task later without going through a row click, however that
 * might happen) does not inherit a stale value.
 */
export function takeTaskOrigin(): TaskOrigin | undefined {
  const href = lastOrigin;
  lastOrigin = undefined;
  if (href === undefined) return undefined;
  const qIndex = href.indexOf("?");
  const pathname = qIndex === -1 ? href : href.slice(0, qIndex);
  const search = qIndex === -1 ? "" : href.slice(qIndex);
  return { href, pathname, search, label: labelFor(pathname) };
}

/**
 * Test-only reset, so specs don't leak an origin from one test into the
 * next through this module's shared state.
 */
export function resetTaskOriginForTest(): void {
  lastOrigin = undefined;
}
