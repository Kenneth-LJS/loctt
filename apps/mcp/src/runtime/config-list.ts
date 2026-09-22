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

import type { ArchivedScope } from "@loctt/contracts";
import { DEFAULT_ARCHIVED_SCOPE } from "@loctt/contracts";
import { z } from "zod";

/** Default page size when `limit` is omitted. Matches the web server. */
export const CONFIG_LIST_DEFAULT_LIMIT = 100;
/** Hard cap on `limit`. Matches the web server's `MAX_PAGE_LIMIT`. */
export const CONFIG_LIST_MAX_LIMIT = 1000;

/**
 * The K90 list inputs plus the K107 archived scope, spread into a tool's
 * `inputSchema`.
 *
 * `q` is a case-insensitive name substring (blank/absent = no filter);
 * `limit`/`offset` page the (post-filter) list.
 *
 * `archived` (K107) is the tri-state scope every archivable config list
 * shares — `active` (the default, hides archived), `archived` (only
 * archived), or `all`. One param here so all six list_* tools inherit
 * the same spelling and default; a handler applies it via
 * `applyArchivedScope` from core, matching the CLI and web surfaces.
 */
export const configListInputSchema = {
  q: z.string().optional()
    .describe("Case-insensitive name search; substring match. Blank/omitted = no filter."),
  archived: z.enum(["active", "archived", "all"]).optional()
    .describe("Archived scope (K107): `active` (default) hides archived, `archived` shows only archived, `all` shows both."),
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
 * Reads the K107 `archived` scope from a handler's raw args, defaulting
 * to {@link DEFAULT_ARCHIVED_SCOPE} (`active`) when absent. The zod enum
 * on {@link configListInputSchema} already rejects any other value, so
 * this just narrows the type and applies the default.
 */
export function getArchivedScope(args: Record<string, unknown>): ArchivedScope {
  return (args["archived"] as ArchivedScope | undefined) ?? DEFAULT_ARCHIVED_SCOPE;
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
