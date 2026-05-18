/**
 * Confirm-gate for destructive MCP tools. Every `delete_*` tool
 * requires `confirm: true` so an agent can't destroy data by
 * forgetting a flag — the asymmetry with `archive_*` (which is
 * reversible and needs no confirm) is the agent-safety net.
 */

import type { McpToolResult } from "../types.js";
import { errorResult } from "./errors.js";

/**
 * Returns a structured error when a destructive tool was invoked
 * without `confirm: true`. Pulls the boilerplate string into one
 * place so every gate reads the same way.
 */
export function requireConfirm(args: Record<string, unknown>, action: string): McpToolResult | null {
  if (args["confirm"] === true) return null;
  return errorResult(`${action} requires confirm: true to proceed`);
}
