/**
 * Pre-flight check for enum-typed workflow values on create_task /
 * update_task. Mirrors the CLI's assertWorkflowEnumKey: surface the
 * known-values hint at the boundary instead of letting `createTask`
 * throw a generic "invalid task" string the agent has to puzzle
 * over.
 *
 * Returning McpToolResult | null (rather than throwing) is the
 * MCP-side convention so the dispatcher can early-return the error
 * directly without an outer try/catch.
 */

import type { WorkflowConfig } from "@loctt/contracts";

import type { McpToolResult } from "../types.js";
import { errorResult } from "./errors.js";

export function assertWorkflowEnumKey(
  workflowConfig: WorkflowConfig | undefined,
  field: "status" | "priority" | "task_type",
  value: string | undefined,
): McpToolResult | null {
  if (workflowConfig === undefined || value === undefined) return null;
  const defs = field === "status"
    ? workflowConfig.statuses
    : field === "priority"
      ? workflowConfig.priorities
      : workflowConfig.task_types;
  const keys = defs.map(d => d.key);
  if (!keys.includes(value)) {
    const known = keys.length > 0 ? keys.join(", ") : "(none configured)";
    return errorResult(`unknown ${field} '${value}'. Known: ${known}`);
  }
  return null;
}
