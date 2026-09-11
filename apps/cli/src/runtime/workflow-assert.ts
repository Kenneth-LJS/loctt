/**
 * Pre-flight checks for workflow-typed CLI args.
 *
 * Core's `setField` / `linkTask` validate against the workflow
 * config and throw with a precise message, but the user has to
 * read a deeper error to recover. These boundary checks intercept
 * the obvious cases (unknown status, unknown relationship) and
 * convert them into a UsageError with a friendly "Known: ..." list.
 *
 * No-ops when `workflowConfig` is undefined (tracker without one,
 * or pre-init state).
 */

import { relationshipTypeKeys, type WorkflowConfig } from "@loctt/contracts";

import { UsageError } from "./errors.js";

/**
 * Pre-flight check for enum-typed CLI args (status / priority /
 * task_type). `undefined` is allowed (the field is being omitted,
 * not set to a bad value).
 */
export function assertWorkflowEnumKey(
  workflowConfig: WorkflowConfig | undefined,
  field: "status" | "priority" | "task_type",
  value: string | undefined,
): void {
  if (workflowConfig === undefined || value === undefined) return;
  const defs = field === "status" ? workflowConfig.statuses
    : field === "priority" ? workflowConfig.priorities
    : workflowConfig.task_types;
  const keys = defs.map(d => d.key);
  if (!keys.includes(value)) {
    const known = keys.length > 0 ? keys.join(", ") : "(none configured)";
    throw new UsageError(`unknown ${field} '${value}'. Known: ${known}`);
  }
}

/**
 * Pre-flight check for relationship-type CLI args. Same rationale
 * as {@link assertWorkflowEnumKey}: surface a "known values" hint
 * at the CLI boundary instead of letting the core throw.
 *
 * Accepts **both directions** of a directional relationship, via
 * `relationshipTypeKeys` — `linkTask` in core (and the web route)
 * take the inverse key too, so `loctt link A blocked_by B` must not
 * be rejected here when core would accept it. A boundary guard that
 * is stricter than the operation it guards is a bug, not a nicety:
 * it turns a valid command into a "Known: ..." error. The listed
 * "Known" set therefore includes the inverse keys.
 */
export function assertWorkflowRelationshipKey(
  workflowConfig: WorkflowConfig | undefined,
  value: string,
): void {
  if (workflowConfig === undefined) return;
  const keys = workflowConfig.relationships.flatMap(relationshipTypeKeys);
  if (!keys.includes(value)) {
    const known = keys.length > 0 ? keys.join(", ") : "(none configured)";
    throw new UsageError(`unknown relationship '${value}'. Known: ${known}`);
  }
}
