/**
 * Read-only config/view introspection. `list_views` reads the
 * saved-query catalog from queries.yaml (and degrades gracefully
 * when the file is missing); the other two return the workflow
 * and calendar configs verbatim as JSON.
 */

import {
  loadCalendarConfig,
  loadQueriesConfig,
  loadWorkflowConfig,
} from "@loctt/core";

import { text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "list_views",
    description: "List saved views from queries.yaml. Returns JSON [{id, name, query, sort?, archived?}]. Address a view by `id`, not `name` — names are not unique, and running a view by an ambiguous name fails. Archived views are returned with `archived: true` and are still runnable by id.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      try {
        const config = await loadQueriesConfig(locttDir);
        // `id`, `sort` and `archived` were dropped here, leaving an
        // agent with `{name, query}` — no way to tell two same-named
        // views apart, and no way to address either, since `findView`
        // throws on an ambiguous name (QRY-C6). Omitted rather than
        // nulled when absent, so "no sort" and "sorted by nothing"
        // stay distinguishable.
        return text(JSON.stringify(config.queries.map(q => ({
          id: q.id,
          name: q.name,
          query: q.query,
          ...(q.sort !== undefined ? { sort: q.sort } : {}),
          ...(q.archived !== undefined ? { archived: q.archived } : {}),
        })), null, 2));
      } catch {
        return text("No saved views configured.");
      }
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
