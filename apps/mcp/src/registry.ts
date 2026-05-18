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

import { TOOLS as TASK_ARCHIVE_TOOLS } from "./tools/task-archive.js";
import type { McpTool, ToolDef } from "./types.js";

/**
 * Build the registry once at module load. Static imports here are
 * fine: each tools/<entity>.ts file imports only from
 * @loctt/core, ../runtime/*, ../types — no circular deps with
 * this module.
 *
 * Tool groups are added here as they're migrated from the legacy
 * `getTools()` array + `executeTool` switch in index.ts. The
 * legacy paths still answer for any tool NOT in the registry; the
 * dispatcher consults the registry first.
 */
const TOOL_GROUPS: readonly (readonly ToolDef[])[] = [
  TASK_ARCHIVE_TOOLS,
  // Add new tool groups here as they're migrated.
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

/**
 * Returns true if the registry contains any tool with this name.
 * Used by the dispatcher to distinguish registry-migrated tools
 * from those still living in the legacy in-file switch.
 *
 * During the gradual migration, both `lookupTool` and the legacy
 * `executeTool` switch are consulted; once every tool is migrated
 * the switch goes away.
 */
export function hasRegisteredTool(name: string): boolean {
  return REGISTRY.has(name);
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
