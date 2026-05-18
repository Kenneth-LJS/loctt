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
    description: "List available saved views from queries.yaml.",
    inputSchema: {},
    handler: async ({ locttDir }) => {
      try {
        const config = await loadQueriesConfig(locttDir);
        return text(JSON.stringify(config.queries.map(q => ({
          name: q.name,
          query: q.query,
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
