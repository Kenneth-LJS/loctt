/**
 * Single source of truth for all MCP tools. Each `tools/<entity>.ts`
 * file exports a `readonly ToolDef[]`; this module flattens them
 * into a Map keyed by tool name.
 *
 * Two consumers read from here:
 *
 *   - `getTools()` (the wire-format shim in index.ts) maps registry
 *     entries back to the legacy `McpTool` shape that the MCP SDK
 *     and external test fixtures already expect.
 *
 *   - `executeTool()` (in index.ts) looks up the handler by name
 *     and forwards the validated args plus the shared ToolCtx.
 *
 * Adding a new tool: append it to the relevant `tools/<entity>.ts`
 * file and import that array below. The runtime exhaustiveness is
 * not statically enforced (tool names are open-ended strings) but
 * a build-time test asserts the registry size matches a canonical
 * sorted name list — see registry.test.ts.
 */

import { TOOLS as CONFIG_TOOLS } from "./tools/config.js";
import { TOOLS as GIT_TOOLS } from "./tools/git.js";
import { TOOLS as LABEL_TOOLS } from "./tools/label.js";
import { TOOLS as MILESTONE_TOOLS } from "./tools/milestone.js";
import { TOOLS as PROJECT_TOOLS } from "./tools/project.js";
import { TOOLS as SPRINT_TOOLS } from "./tools/sprint.js";
import { TOOLS as TASK_ARCHIVE_TOOLS } from "./tools/task-archive.js";
import { TOOLS as TASK_BODY_TOOLS } from "./tools/task-body.js";
import { TOOLS as TASK_CRUD_TOOLS } from "./tools/task-crud.js";
import { TOOLS as TASK_FILES_TOOLS } from "./tools/task-files.js";
import { TOOLS as TASK_LINKS_TOOLS } from "./tools/task-links.js";
import { TOOLS as TASK_RANK_TOOLS } from "./tools/task-rank.js";
import { TOOLS as TRACKER_TOOLS } from "./tools/tracker.js";
import { TOOLS as USER_TOOLS } from "./tools/user.js";
import { TOOLS as VIEWS_TOOLS } from "./tools/views.js";
import type { McpTool, ToolDef } from "./types.js";

/**
 * Build the registry once at module load. Static imports here are
 * fine: each tools/<entity>.ts file imports only from
 * @loctt/core, ../runtime/*, ../types — no circular deps with
 * this module.
 */
const TOOL_GROUPS: readonly (readonly ToolDef[])[] = [
  CONFIG_TOOLS,
  GIT_TOOLS,
  LABEL_TOOLS,
  MILESTONE_TOOLS,
  PROJECT_TOOLS,
  SPRINT_TOOLS,
  TASK_ARCHIVE_TOOLS,
  TASK_BODY_TOOLS,
  TASK_CRUD_TOOLS,
  TASK_FILES_TOOLS,
  TASK_LINKS_TOOLS,
  TASK_RANK_TOOLS,
  TRACKER_TOOLS,
  USER_TOOLS,
  VIEWS_TOOLS,
];

function build(): Map<string, ToolDef> {
  const m = new Map<string, ToolDef>();
  for (const group of TOOL_GROUPS) {
    for (const tool of group) {
      if (m.has(tool.name)) {
        throw new Error(`duplicate tool name in registry: ${tool.name}`);
      }
      m.set(tool.name, tool);
    }
  }
  return m;
}

const REGISTRY = build();

/** Looks up a tool by name. Returns undefined for unknown names. */
export function lookupTool(name: string): ToolDef | undefined {
  return REGISTRY.get(name);
}

/** Returns every registered tool. Used by the wire-format shim. */
export function listRegisteredTools(): readonly ToolDef[] {
  return [...REGISTRY.values()];
}

/**
 * Strips the handler + exempt flag off a `ToolDef`, leaving the
 * wire-format `McpTool` shape. Used by the `getTools()` shim in
 * index.ts. Pure function so tests can call it on fixture tools
 * without going through the registry.
 */
export function stripHandler(def: ToolDef): McpTool {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
  };
}
