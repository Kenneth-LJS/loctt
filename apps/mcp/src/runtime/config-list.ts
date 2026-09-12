/**
 * Shared name-search + pagination inputs for the config-list tools
 * (labels, milestones, sprints, users, projects) — K90.
 *
 * K90 makes name search a core capability on all three surfaces and
 * requires the CLI/MCP list tools to page (a page at a time, ≤1000) so
 * everything beyond the first window is reachable — no unbounded single
 * response. The web server paginates these same five config lists with
 * `DEFAULT_PAGE_LIMIT = 100` / `MAX_PAGE_LIMIT = 1000`
 * (`apps/web/src/server/server.ts`); the MCP tools mirror those numbers,
 * and each tool applies the filter/page in the same order the web
 * handlers do — archived filter, then name filter (`filterByName` /
 * `filterProjects` from core), then page.
 *
 * The web query param is `q`; MCP uses the same name so the surfaces
 * agree. `limit`/`offset` mirror the existing `list_tasks` / history
 * tools, which already take numeric `limit`/`offset`.
 */

import { z } from "zod";

/** Default page size when `limit` is omitted. Matches the web server. */
export const CONFIG_LIST_DEFAULT_LIMIT = 100;
/** Hard cap on `limit`. Matches the web server's `MAX_PAGE_LIMIT`. */
export const CONFIG_LIST_MAX_LIMIT = 1000;

/**
 * The three K90 list inputs, spread into a tool's `inputSchema`.
 * `q` is a case-insensitive name substring (blank/absent = no filter);
 * `limit`/`offset` page the (post-filter) list.
 */
export const configListInputSchema = {
  q: z.string().optional()
    .describe("Case-insensitive name search; substring match. Blank/omitted = no filter."),
  limit: z.number().int().nonnegative().max(CONFIG_LIST_MAX_LIMIT).optional()
    .describe(`Max results (default ${CONFIG_LIST_DEFAULT_LIMIT}, cap ${CONFIG_LIST_MAX_LIMIT}).`),
  offset: z.number().int().nonnegative().optional()
    .describe("Rows to skip, for paging past the first `limit`."),
} as const;

/** Pulls `q` out of a handler's raw args. */
export function getQ(args: Record<string, unknown>): string | undefined {
  return args["q"] as string | undefined;
}

/**
 * Reads `limit`/`offset` and slices `items` by them. `limit` defaults
 * to {@link CONFIG_LIST_DEFAULT_LIMIT}; the zod schema already caps it
 * at {@link CONFIG_LIST_MAX_LIMIT}. `offset` defaults to 0.
 */
export function pageConfigList<T>(
  items: readonly T[],
  args: Record<string, unknown>,
): readonly T[] {
  const limit = (args["limit"] as number | undefined) ?? CONFIG_LIST_DEFAULT_LIMIT;
  const offset = (args["offset"] as number | undefined) ?? 0;
  return items.slice(offset, offset + limit);
}
