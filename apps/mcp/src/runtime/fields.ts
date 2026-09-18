/**
 * The set of frontmatter fields the MCP `update_task` /
 * `unset_field` tools accept, plus the per-field value schemas
 * that gate the shape of each value before it reaches core's
 * `setField`. This file IS the "what fields agents can write"
 * boundary.
 *
 * Adding a new built-in writable field:
 *   1. Add its key + zod schema to `UPDATE_TASK_FIELD_SCHEMAS`.
 *   2. The EXPOSED_FIELDS_LIST string regenerates from the map keys.
 *   3. `checkFieldWritability` automatically allows it for both
 *      set and unset (subject to USER_IMMUTABLE_FIELDS /
 *      AUTO_MANAGED_FIELDS).
 *
 * Workflow-aware checks (status enum, label membership, …) still
 * happen in `validateTaskAgainstWorkflow` inside `setField`. The
 * schemas here only enforce *shape*.
 */

import { AUTO_MANAGED_FIELDS, USER_IMMUTABLE_FIELDS, WRITABLE_BUILTIN_FIELDS } from "@loctt/core";
import { z } from "zod";

import type { McpToolResult } from "../types.js";
import { errorResult } from "./errors.js";

const NonEmptyString = z.string().min(1);

// Date-only (YYYY-MM-DD) or full ISO-8601 timestamp. The brand
// schemas in @loctt/contracts apply the canonical check at write
// time; this regex matches the same shape so the boundary error
// names the field rather than waiting for setField to fail with
// a deeper message.
const DateLikeString = z.string().regex(
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  "must be YYYY-MM-DD or full ISO-8601 timestamp",
);

export const UPDATE_TASK_FIELD_SCHEMAS: Record<string, z.ZodTypeAny> = {
  title: NonEmptyString,
  status: NonEmptyString,
  task_type: NonEmptyString,
  priority: NonEmptyString,
  labels: z.array(z.string()),
  assignee: z.string().nullable(),
  reporter: z.string().nullable(),
  start_date: DateLikeString,
  due_date: DateLikeString,
  estimate: z.union([z.string(), z.number()]),
  milestone: z.string().nullable(),
  sprint: z.string().nullable(),
};

/**
 * Sorted list of writable built-in field names exposed by `update_task`.
 * Used in error messages so the agent always sees the same canonical
 * list as the schema map.
 */
export const EXPOSED_FIELDS_LIST = Object.keys(UPDATE_TASK_FIELD_SCHEMAS).sort().join(", ");

/**
 * Returns an error if `field` is one of the known unsettable categories
 * (immutable, auto-managed, or built-in-but-not-MCP-exposed), or `null`
 * if the field is OK to forward to setField/unsetField. Shared by
 * `validateUpdateTaskArgs` and `validateUnsetFieldArgs`.
 */
export function checkFieldWritability(field: string, action: "set" | "unset"): McpToolResult | null {
  if (USER_IMMUTABLE_FIELDS.has(field)) {
    return errorResult(
      `cannot ${action} immutable field "${field}". ` +
      `Writable built-in fields: ${EXPOSED_FIELDS_LIST}.`,
    );
  }
  if (AUTO_MANAGED_FIELDS.has(field)) {
    return errorResult(
      `cannot ${action} auto-managed field "${field}" directly; ` +
      `it is updated automatically based on status changes`,
    );
  }
  // `updated_at` and any other built-in writable field that isn't in
  // the exposed schema map: not surfaced to MCP. Without this guard a
  // request to set/unset such a field would silently fall through to
  // the custom-field code path in core and write `fields.<name>`.
  if (
    WRITABLE_BUILTIN_FIELDS.has(field)
    && !Object.prototype.hasOwnProperty.call(UPDATE_TASK_FIELD_SCHEMAS, field)
  ) {
    return errorResult(
      `built-in field "${field}" is not settable via MCP. ` +
      `Writable built-in fields: ${EXPOSED_FIELDS_LIST}.`,
    );
  }
  return null;
}

/**
 * Validates `args` for `update_task` and returns either an error
 * result (caller should return it as-is) or `null` to proceed.
 *
 * Catches:
 * - missing/non-string `field`,
 * - immutable / auto-managed / not-exposed built-in fields,
 * - per-field value-shape mismatches for built-in fields.
 *
 * Custom (workflow-defined) fields skip shape validation here and
 * are handed to `setField` directly; that layer applies workflow
 * constraints.
 */
export function validateUpdateTaskArgs(args: Record<string, unknown>): McpToolResult | null {
  const field = args["field"];
  if (typeof field !== "string" || field.length === 0) {
    return errorResult("`field` is required and must be a non-empty string");
  }
  const writability = checkFieldWritability(field, "set");
  if (writability) return writability;
  const schema = UPDATE_TASK_FIELD_SCHEMAS[field];
  if (schema !== undefined) {
    const parsed = schema.safeParse(args["value"]);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`)
        .join("; ");
      return errorResult(`invalid value for field "${field}": ${detail}`);
    }
  }
  return null;
}

/**
 * Validates `args` for `unset_field`. Mirrors `validateUpdateTaskArgs`
 * for the field-level checks but skips value-shape validation (no
 * value to validate when unsetting). Also rejects `title` since it's
 * required and `unsetField` would throw `cannot unset required field`.
 */
export function validateUnsetFieldArgs(args: Record<string, unknown>): McpToolResult | null {
  const field = args["field"];
  if (typeof field !== "string" || field.length === 0) {
    return errorResult("`field` is required and must be a non-empty string");
  }
  if (field === "title") {
    return errorResult(`cannot unset required field "title"`);
  }
  return checkFieldWritability(field, "unset");
}
