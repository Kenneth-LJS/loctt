/**
 * Read-only config/view introspection. `list_views` reads the
 * saved-query catalog from queries.yaml (and degrades gracefully
 * when the file is missing); the other two return the workflow
 * and calendar configs verbatim as JSON.
 */

import {
  isMissingFile,
  loadCalendarConfig,
  loadQueriesConfig,
  loadWorkflowConfig,
} from "@loctt/core";

import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_views",
    description: "List saved views from queries.yaml. Returns JSON [{id, name, query, sort?, archived?}]. Address a view by `id`, not `name` — names are not unique, and running a view by an ambiguous name fails. Archived views are returned with `archived: true` and are still runnable by id.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      let config;
      try {
        config = await loadQueriesConfig(locttDir);
      } catch (err) {
        // "No saved views configured." used to cover ENOENT, a syntax
        // error and EACCES alike. Only the first is true, and an agent
        // told there are none may offer to recreate a catalog it never
        // read — over the file that holds it.
        if (isMissingFile(err)) return text("No saved views configured.");
        return errorResult(
          `${err instanceof Error ? err.message : String(err)}\n\n`
          + "Saved views could not be listed. This is not the same as having none — "
          + "do not create or overwrite views until this file can be read.",
        );
      }
      // `id`, `sort` and `archived` were dropped here, leaving an
      // agent with `{name, query}` — no way to tell two same-named
      // views apart, and no way to address either, since `findView`
      // throws on an ambiguous name (QRY-C6). Omitted rather than
      // nulled when absent, so "no sort" and "sorted by nothing"
      // stay distinguishable.
      //
      // VUE-22 / north-star principle 5 & parity: a view whose query no
      // longer parses is returned too, carrying `broken: true` and the
      // parser's `error`/`position`, rather than being dropped or taking
      // down the whole list. An agent must see the view exists and is
      // broken — silently omitting it would let the agent recreate it
      // over the file that still holds it.
      const good = config.queries.map(q => ({
        id: q.id,
        name: q.name,
        query: q.query,
        ...(q.sort !== undefined ? { sort: q.sort } : {}),
        ...(q.archived !== undefined ? { archived: q.archived } : {}),
      }));
      const broken = (config.broken ?? []).map(b => ({
        id: b.id,
        name: b.name,
        query: b.query,
        broken: true as const,
        error: b.error,
        ...(b.position !== undefined ? { position: b.position } : {}),
      }));
      return text(JSON.stringify([...good, ...broken], null, 2));
    },
  },
  {
    name: "get_workflow_config",
    description: "Get the workflow configuration.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const config = await loadWorkflowConfig(locttDir);
      return text(JSON.stringify(config, null, 2));
    },
  },
  {
    name: "get_calendar",
    description: "Returns the workspace calendar config (timezone, working days, holidays). Read-only — calendar is configured via the UI.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      const cfg = await loadCalendarConfig(locttDir);
      return text(JSON.stringify(cfg, null, 2));
    },
  },
];
