/**
 * Shared pagination for the config-list commands (labels, milestones,
 * sprints, users, projects) — K90.
 *
 * K90 makes name search a core capability on all three surfaces and
 * requires the CLI/MCP list commands to page (a page at a time, ≤1000)
 * so everything beyond the first window is reachable — no unbounded
 * single response. The web server paginates these same five config
 * lists with `DEFAULT_PAGE_LIMIT = 100` / `MAX_PAGE_LIMIT = 1000`
 * (`apps/web/src/server/server.ts`); the CLI mirrors those numbers so
 * the three surfaces page the identical lists identically.
 *
 * Order of operations, matching the web handlers exactly: the caller
 * applies the archived filter, then the name filter (`filterByName` /
 * `filterProjects` from core), and finally hands the result here to
 * page. Filter before paging so you page through the *matches*.
 */

import type { BrokenEntry } from "@loctt/contracts";

import { getArg, getNonNegativeIntArg } from "./args.js";
import { UsageError } from "./errors.js";

/** Default page size when `--limit` is omitted. Matches the web server. */
export const CONFIG_LIST_DEFAULT_LIMIT = 100;
/** Hard cap on `--limit`. Matches the web server's `MAX_PAGE_LIMIT`. */
export const CONFIG_LIST_MAX_LIMIT = 1000;

/** The name-filter query, `--filter <q>` (undefined when absent). */
export function getFilterArg(args: string[]): string | undefined {
  return getArg(args, "--filter");
}

/**
 * Reads `--limit`/`--offset` for a config list. `--limit` defaults to
 * {@link CONFIG_LIST_DEFAULT_LIMIT} and may not exceed
 * {@link CONFIG_LIST_MAX_LIMIT} — over the cap is a usage error rather
 * than a silent clamp, so the user knows they did not get everything.
 * `--offset` defaults to 0. Both must be non-negative integers.
 */
export function getConfigPagination(args: string[]): { limit: number; offset: number } {
  const limitArg = getNonNegativeIntArg(args, "--limit");
  if (limitArg !== undefined && limitArg > CONFIG_LIST_MAX_LIMIT) {
    throw new UsageError(`--limit must be at most ${CONFIG_LIST_MAX_LIMIT}`);
  }
  const limit = limitArg ?? CONFIG_LIST_DEFAULT_LIMIT;
  const offset = getNonNegativeIntArg(args, "--offset") ?? 0;
  return { limit, offset };
}

/**
 * The result of paging a config list: the page's `items`, the `offset`
 * it started at, and the `total` number of (post-filter) matches — so a
 * caller can both render the page and say how much was not shown.
 */
export interface ConfigPage<T> {
  readonly items: readonly T[];
  readonly offset: number;
  readonly total: number;
}

/** Slices `items` by the resolved offset+limit, keeping the match total. */
export function pageConfigList<T>(
  items: readonly T[],
  page: { limit: number; offset: number },
): ConfigPage<T> {
  return {
    items: items.slice(page.offset, page.offset + page.limit),
    offset: page.offset,
    total: items.length,
  };
}

/**
 * The "how much was not shown" footer, or undefined when the page is the
 * whole list. Mirrors the `loctt log` footer wording exactly (`Showing
 * N–M of T.`, an en-dash, on its own line after a blank one) so a
 * `--limit`/`--offset` page does not read as the complete list; adds the
 * paging hint K90 asked for. Silent when `offset === 0` and the page
 * holds every match — the common case where nothing was truncated.
 */
export function truncationNotice<T>(page: ConfigPage<T>): string | undefined {
  const end = page.offset + page.items.length;
  if (page.offset === 0 && end >= page.total) return undefined;
  return `\nShowing ${page.offset + 1}–${end} of ${page.total}. Use --limit/--offset to page.`;
}

/**
 * Renders a config's per-entry `broken` degrades (DEG-C3) as marked rows
 * in a `list` command's output, distinct from the valid entries above and
 * from an empty list.
 *
 * The tolerant loaders lift an entry that does not validate into
 * `config.broken` (a `BrokenEntry` carrying its index, its raw text and
 * the validator's message) and load the rest, so the valid entries print
 * normally — but a silent degrade reads as "that sprint just isn't
 * configured", and one broken sprint reads as "no sprints" (A138 / DEG-11).
 * Naming it here is the surface half of the parity the web list already
 * gives (a marked, read-only row) and the CLI saved-views list pioneered
 * (`views.ts` prints `[broken: …]`). On stdout, in the listing, so it is
 * part of the answer rather than a side-channel warning.
 *
 * Prints nothing when the config is clean (`broken` omitted or empty), so
 * a healthy list is byte-identical to before.
 */
export function renderBrokenEntries(
  broken: readonly BrokenEntry[] | undefined,
  log: (line: string) => void = console.log,
): void {
  if (broken === undefined || broken.length === 0) return;
  for (const b of broken) {
    // Name it by id when the loader could read one, else by position —
    // the id is exactly what failed in the latter case.
    const label = b.id !== undefined ? b.id : `#${b.index}`;
    log(`${b.rawText}\t[broken: ${label} — ${b.error}]`);
  }
}
