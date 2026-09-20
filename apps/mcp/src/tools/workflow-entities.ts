/**
 * Workflow.yaml entity editing over MCP — the MCP half of the A252/A253
 * parity wave (web + CLI already call the core per-entity functions).
 *
 * Ken's chosen shape (A265): ONE consolidated collection tool,
 * `edit_workflow_entity`, rather than ~32 per-entity tools. It dispatches
 * on `{ entity, op }` to the matching `@loctt/core`
 * `config/workflow-entities.ts` function. Two singletons that are not
 * collection entities — estimation and timeline — get their own tools
 * (`set_estimation_config`, `set_timeline_config`) instead of an
 * awkward create/edit/delete/reorder op that only "edit" would be legal
 * for. The read side already exists: `get_workflow_config` (views.ts).
 *
 * The core layer owns every guarantee — key immutability, remap-or-refuse
 * on delete, priority renumber-on-reorder, read-fresh, atomic validated
 * write. This tool adds only: (1) the entity/op legality matrix, (2)
 * arg-shape validation, (3) the `confirm: true` gate on delete (matching
 * every other `delete_*` MCP tool), (4) mapping `WorkflowEntityError` to
 * an errorResult (registered in runtime/errors.ts). A status created here
 * and one created through the web settings panels or the CLI are
 * indistinguishable — same core, same rules (surface parity).
 *
 * Zod approach — permissive `fields` object, per-entity handler
 * validation. `fields` varies by entity (a status has `category`, a
 * relationship has `kind`/`inverse`, a custom field has `type`/`multi`).
 * A discriminated union on `entity` would give sharper wire-level errors,
 * but the MCP `inputSchema` is a flat record of named zod schemas (not a
 * single wrapper `z.object`), so a top-level discriminant is not
 * expressible in that shape without abandoning the record convention every
 * other tool uses. We therefore take a `fields: z.record(z.unknown())`
 * and validate its contents per (entity, op) in the handler, where the
 * error can name the exact field and the legal set — the tradeoff Ken's
 * plan flagged, resolved toward the record convention + explicit handler
 * messages. (`entity`/`op` themselves ARE strict enums, so the common
 * mistake — a bad entity or op — is still caught at the wire.)
 */

import type {
  CustomFieldDef,
  CustomFieldValueDef,
  EstimationScale,
  EstimationUnit,
  RelationshipGraph,
  RelationshipKind,
  StatusCategory,
  TimelineGrouping,
  TimelineZoom,
} from "@loctt/contracts";
import {
  addFieldValue,
  createBoardColumn,
  createCustomField,
  createPriority,
  createRelationship,
  createStatus,
  createTaskType,
  deleteBoardColumn,
  deleteCustomField,
  deleteFieldValue,
  deletePriority,
  deleteRelationship,
  deleteStatus,
  deleteTaskType,
  editBoardColumn,
  editCustomField,
  editEstimationConfig,
  editFieldValue,
  editPriority,
  editRelationship,
  editStatus,
  editTaskType,
  editTimelineConfig,
  reorderBoardColumns,
  reorderFieldValues,
  reorderPriorities,
  reorderStatuses,
  reorderTaskTypes,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { errorResult, text } from "../runtime/errors.js";
import type { ToolDef } from "../types.js";

// ---------------------------------------------------------------------------
// The entity/op matrix. This is the contract the tool description advertises.
// ---------------------------------------------------------------------------

type Entity =
  | "status"
  | "priority"
  | "task_type"
  | "relationship"
  | "custom_field"
  | "custom_field_value"
  | "board_column";

type Op = "create" | "edit" | "delete" | "reorder";

const ENTITIES = [
  "status",
  "priority",
  "task_type",
  "relationship",
  "custom_field",
  "custom_field_value",
  "board_column",
] as const;

const OPS = ["create", "edit", "delete", "reorder"] as const;

/**
 * Which ops are legal for each entity. Relationships have no reorder;
 * whole custom-field delete is clear-only (a separate remap-rejection in
 * the handler). Everything else supports the full four.
 */
const LEGAL_OPS: Record<Entity, readonly Op[]> = {
  status: ["create", "edit", "delete", "reorder"],
  priority: ["create", "edit", "delete", "reorder"],
  task_type: ["create", "edit", "delete", "reorder"],
  relationship: ["create", "edit", "delete"], // no reorder (core has none)
  custom_field: ["create", "edit", "delete", "reorder"],
  custom_field_value: ["create", "edit", "delete", "reorder"],
  board_column: ["create", "edit", "delete", "reorder"],
};

/** Entities whose delete does NOT accept a remap target. */
const NO_REMAP_DELETE: ReadonlySet<Entity> = new Set<Entity>([
  "custom_field", // whole-field delete is clear-only (SET / A252)
  "board_column", // columns carry no task data — nothing to remap
]);

// ---------------------------------------------------------------------------
// Enum whitelists (mirrors the CLI's VALID_* lists — one source of truth
// would be nicer, but core does not export them and the CLI inlines them
// too; kept identical here on purpose).
// ---------------------------------------------------------------------------

const VALID_STATUS_CATEGORIES: readonly StatusCategory[] = ["pending", "active", "completed", "discarded"];
const VALID_RELATIONSHIP_KINDS: readonly RelationshipKind[] = ["directional", "symmetric"];
const VALID_RELATIONSHIP_GRAPHS: readonly RelationshipGraph[] = ["none", "acyclic", "tree"];
const VALID_FIELD_TYPES: readonly CustomFieldDef["type"][] = ["string", "number", "date", "boolean", "enum"];
const VALID_ESTIMATION_UNITS: readonly EstimationUnit[] = ["points", "hours", "days", "custom_numeric", "custom_enum"];
const VALID_ESTIMATION_SCALES: readonly EstimationScale[] = ["free", "linear", "fibonacci"];
const VALID_TIMELINE_ZOOMS: readonly TimelineZoom[] = ["day", "week", "month"];

// ---------------------------------------------------------------------------
// Small typed readers over the permissive `fields` object. Each throws a
// FieldsError (mapped to an errorResult below) naming the offending field.
// ---------------------------------------------------------------------------

/** A rejected arg-shape, distinct from core's WorkflowEntityError. */
class FieldsError extends Error {}

type Fields = Record<string, unknown>;

function getFields(args: Record<string, unknown>): Fields {
  const f = args["fields"];
  if (f === undefined) return {};
  if (typeof f !== "object" || f === null || Array.isArray(f)) {
    throw new FieldsError("`fields` must be an object");
  }
  return f as Fields;
}

function str(fields: Fields, name: string): string | undefined {
  const v = fields[name];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new FieldsError(`\`fields.${name}\` must be a string`);
  return v;
}

function requireStr(fields: Fields, name: string): string {
  const v = str(fields, name);
  if (v === undefined) throw new FieldsError(`\`fields.${name}\` is required`);
  return v;
}

function bool(fields: Fields, name: string): boolean | undefined {
  const v = fields[name];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new FieldsError(`\`fields.${name}\` must be a boolean`);
  return v;
}

function num(fields: Fields, name: string): number | undefined {
  const v = fields[name];
  if (v === undefined) return undefined;
  if (typeof v !== "number") throw new FieldsError(`\`fields.${name}\` must be a number`);
  return v;
}

/** A string-or-null (null = clear on edit); undefined = absent. */
function nullableStr(fields: Fields, name: string): string | null | undefined {
  if (!(name in fields)) return undefined;
  const v = fields[name];
  if (v === null) return null;
  if (typeof v !== "string") throw new FieldsError(`\`fields.${name}\` must be a string or null`);
  return v;
}

function strArray(fields: Fields, name: string): readonly string[] | undefined {
  const v = fields[name];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some(e => typeof e !== "string")) {
    throw new FieldsError(`\`fields.${name}\` must be an array of strings`);
  }
  return v as string[];
}

/** A string-array-or-null (null = clear scope); undefined = absent. */
function nullableStrArray(fields: Fields, name: string): readonly string[] | null | undefined {
  if (!(name in fields)) return undefined;
  if (fields[name] === null) return null;
  return strArray(fields, name);
}

function enumStr<T extends string>(
  fields: Fields,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const v = str(fields, name);
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) {
    throw new FieldsError(`\`fields.${name}\` must be one of: ${allowed.join(", ")} (got "${v}")`);
  }
  return v as T;
}

/** icon/color for a CREATE (a value or nothing — no clear semantics). */
function iconColorCreate(fields: Fields): { icon?: string; color?: string } {
  const icon = str(fields, "icon");
  const color = str(fields, "color");
  return {
    ...(icon !== undefined ? { icon } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

/** icon/color for an EDIT (null clears, absent leaves, value sets). */
function iconColorEdit(fields: Fields): { icon?: string | null; color?: string | null } {
  const icon = nullableStr(fields, "icon");
  const color = nullableStr(fields, "color");
  return {
    ...(icon !== undefined ? { icon } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

/** The reorder key list, from the top-level `order` arg. */
function requireOrder(args: Record<string, unknown>): string[] {
  const order = args["order"];
  if (order === undefined) throw new FieldsError("`order` (an array of keys) is required for reorder");
  if (!Array.isArray(order) || order.some(k => typeof k !== "string")) {
    throw new FieldsError("`order` must be an array of strings");
  }
  if (order.length === 0) throw new FieldsError("`order` must not be empty");
  return order as string[];
}

/** The entity key, required for edit/delete and for create's new key. */
function requireKey(args: Record<string, unknown>, purpose: string): string {
  const key = args["key"];
  if (typeof key !== "string" || key.length === 0) {
    throw new FieldsError(`\`key\` is required (${purpose})`);
  }
  return key;
}

/** The parent field key for custom_field_value ops (`field` top-level arg). */
function requireFieldParent(args: Record<string, unknown>): string {
  const field = args["field"];
  if (typeof field !== "string" || field.length === 0) {
    throw new FieldsError("`field` (the parent custom-field key) is required for custom_field_value ops");
  }
  return field;
}

/** remap_to top-level arg: string | null | undefined. */
function remapToArg(args: Record<string, unknown>): string | null | undefined {
  if (!("remap_to" in args)) return undefined;
  const v = args["remap_to"];
  if (v === null) return null;
  if (typeof v !== "string") throw new FieldsError("`remap_to` must be a string or null");
  return v;
}

// ---------------------------------------------------------------------------
// Per-(entity, op) dispatch. Each returns a success message.
// ---------------------------------------------------------------------------

async function dispatch(
  locttDir: string,
  entity: Entity,
  op: Op,
  args: Record<string, unknown>,
): Promise<string> {
  const fields = getFields(args);

  // Keys are immutable across every entity (a rename is delete+create).
  // The top-level `key` identifies the edit target; a `key` smuggled into
  // `fields` is a rename attempt, and there is no path for it. Reject it
  // loudly on edit rather than silently ignoring it (which would leave the
  // agent believing the rename happened).
  if (op === "edit" && "key" in fields) {
    throw new FieldsError(
      "`fields.key` is not accepted — an entity's key is immutable; a rename is delete+create. The top-level `key` identifies the target.",
    );
  }

  switch (entity) {
    case "status":
      return dispatchStatus(locttDir, op, args, fields);
    case "priority":
      return dispatchPriority(locttDir, op, args, fields);
    case "task_type":
      return dispatchTaskType(locttDir, op, args, fields);
    case "relationship":
      return dispatchRelationship(locttDir, op, args, fields);
    case "custom_field":
      return dispatchCustomField(locttDir, op, args, fields);
    case "custom_field_value":
      return dispatchCustomFieldValue(locttDir, op, args, fields);
    case "board_column":
      return dispatchBoardColumn(locttDir, op, args, fields);
  }
}

async function dispatchStatus(locttDir: string, op: Op, args: Record<string, unknown>, fields: Fields): Promise<string> {
  switch (op) {
    case "create": {
      const key = requireKey(args, "the new status key");
      const category = enumStr(fields, "category", VALID_STATUS_CATEGORIES);
      if (category === undefined) throw new FieldsError(`\`fields.category\` is required (one of: ${VALID_STATUS_CATEGORIES.join(", ")})`);
      await createStatus(locttDir, {
        key,
        label: requireStr(fields, "label"),
        category,
        ...(bool(fields, "default") === true ? { default: true } : {}),
        ...iconColorCreate(fields),
      });
      return `Created status "${key}"`;
    }
    case "edit": {
      const key = requireKey(args, "the status to edit");
      const label = str(fields, "label");
      const category = enumStr(fields, "category", VALID_STATUS_CATEGORIES);
      const setDefault = bool(fields, "default") === true;
      const ic = iconColorEdit(fields);
      await editStatus(locttDir, key, {
        ...(label !== undefined ? { label } : {}),
        ...(category !== undefined ? { category } : {}),
        ...(setDefault ? { default: true } : {}),
        ...ic,
      });
      return `Updated status "${key}"`;
    }
    case "delete": {
      const key = requireKey(args, "the status to delete");
      await deleteStatus(locttDir, key, remapToArg(args));
      return `Deleted status "${key}"`;
    }
    case "reorder": {
      await reorderStatuses(locttDir, requireOrder(args));
      return "Reordered statuses";
    }
  }
}

async function dispatchPriority(locttDir: string, op: Op, args: Record<string, unknown>, fields: Fields): Promise<string> {
  switch (op) {
    case "create": {
      const key = requireKey(args, "the new priority key");
      // No `value` — it is derived from list order (D20). Reject it loudly.
      rejectPriorityValue(fields);
      await createPriority(locttDir, { key, label: requireStr(fields, "label"), ...iconColorCreate(fields) });
      return `Created priority "${key}"`;
    }
    case "edit": {
      const key = requireKey(args, "the priority to edit");
      rejectPriorityValue(fields);
      const label = str(fields, "label");
      await editPriority(locttDir, key, {
        ...(label !== undefined ? { label } : {}),
        ...iconColorEdit(fields),
      });
      return `Updated priority "${key}"`;
    }
    case "delete": {
      const key = requireKey(args, "the priority to delete");
      await deletePriority(locttDir, key, remapToArg(args));
      return `Deleted priority "${key}"`;
    }
    case "reorder": {
      // This IS how priority `value` is set — the write path renumbers.
      await reorderPriorities(locttDir, requireOrder(args));
      return "Reordered priorities";
    }
  }
}

/** Priority `value` is never settable (D20) — name it if an agent tries. */
function rejectPriorityValue(fields: Fields): void {
  if ("value" in fields) {
    throw new FieldsError(
      "`fields.value` is not accepted for priorities — a priority's value is derived from list order; use op:\"reorder\" to change ranking",
    );
  }
}

async function dispatchTaskType(locttDir: string, op: Op, args: Record<string, unknown>, fields: Fields): Promise<string> {
  switch (op) {
    case "create": {
      const key = requireKey(args, "the new task_type key");
      await createTaskType(locttDir, { key, label: requireStr(fields, "label"), ...iconColorCreate(fields) });
      return `Created task type "${key}"`;
    }
    case "edit": {
      const key = requireKey(args, "the task_type to edit");
      const label = str(fields, "label");
      await editTaskType(locttDir, key, {
        ...(label !== undefined ? { label } : {}),
        ...iconColorEdit(fields),
      });
      return `Updated task type "${key}"`;
    }
    case "delete": {
      const key = requireKey(args, "the task_type to delete");
      await deleteTaskType(locttDir, key, remapToArg(args));
      return `Deleted task type "${key}"`;
    }
    case "reorder": {
      await reorderTaskTypes(locttDir, requireOrder(args));
      return "Reordered task types";
    }
  }
}

async function dispatchRelationship(locttDir: string, op: Op, args: Record<string, unknown>, fields: Fields): Promise<string> {
  switch (op) {
    case "create": {
      const key = requireKey(args, "the new relationship key");
      const kind = enumStr(fields, "kind", VALID_RELATIONSHIP_KINDS);
      const graph = enumStr(fields, "graph", VALID_RELATIONSHIP_GRAPHS);
      const inverse = str(fields, "inverse");
      const inverseLabel = str(fields, "inverse_label");
      const ranked = bool(fields, "ranked");
      await createRelationship(locttDir, {
        key,
        label: requireStr(fields, "label"),
        ...(kind !== undefined ? { kind } : {}),
        ...(inverse !== undefined ? { inverse } : {}),
        ...(inverseLabel !== undefined ? { inverse_label: inverseLabel } : {}),
        ...(graph !== undefined ? { graph } : {}),
        ...(ranked !== undefined ? { ranked } : {}),
        ...iconColorCreate(fields),
      });
      return `Created relationship "${key}"`;
    }
    case "edit": {
      const key = requireKey(args, "the relationship to edit");
      const label = str(fields, "label");
      const kind = enumStr(fields, "kind", VALID_RELATIONSHIP_KINDS);
      const graph = enumStr(fields, "graph", VALID_RELATIONSHIP_GRAPHS);
      const inverse = str(fields, "inverse");
      const inverseLabel = str(fields, "inverse_label");
      const ranked = bool(fields, "ranked");
      await editRelationship(locttDir, key, {
        ...(label !== undefined ? { label } : {}),
        ...(kind !== undefined ? { kind } : {}),
        ...(inverse !== undefined ? { inverse } : {}),
        ...(inverseLabel !== undefined ? { inverse_label: inverseLabel } : {}),
        ...(graph !== undefined ? { graph } : {}),
        ...(ranked !== undefined ? { ranked } : {}),
        ...iconColorEdit(fields),
      });
      return `Updated relationship "${key}"`;
    }
    case "delete": {
      const key = requireKey(args, "the relationship to delete");
      await deleteRelationship(locttDir, key, remapToArg(args));
      return `Deleted relationship "${key}"`;
    }
    case "reorder":
      // Unreachable — LEGAL_OPS excludes it — but keep the switch exhaustive.
      throw new FieldsError("relationship does not support reorder");
  }
}

async function dispatchCustomField(locttDir: string, op: Op, args: Record<string, unknown>, fields: Fields): Promise<string> {
  switch (op) {
    case "create": {
      const key = requireKey(args, "the new custom_field key");
      const type = enumStr(fields, "type", VALID_FIELD_TYPES);
      if (type === undefined) throw new FieldsError(`\`fields.type\` is required (one of: ${VALID_FIELD_TYPES.join(", ")})`);
      const values = parseFieldValueSeeds(fields);
      if (type === "enum" && (values === undefined || values.length === 0)) {
        throw new FieldsError("an enum field needs at least one value at creation — pass `fields.values: [{key,label}, …]`");
      }
      if (type !== "enum" && values !== undefined && values.length > 0) {
        throw new FieldsError("`fields.values` is only meaningful for type \"enum\"");
      }
      const taskTypes = strArray(fields, "task_types");
      await createCustomField(locttDir, {
        key,
        label: requireStr(fields, "label"),
        type,
        multi: bool(fields, "multi") ?? false,
        searchable: bool(fields, "searchable") ?? false,
        ...(values !== undefined && values.length > 0 ? { values } : {}),
        ...(taskTypes !== undefined ? { task_types: taskTypes } : {}),
      });
      return `Created custom field "${key}"`;
    }
    case "edit": {
      const key = requireKey(args, "the custom_field to edit");
      // type/multi are immutable (SET-16). Reject an attempt to change them.
      if ("type" in fields) throw new FieldsError("`fields.type` is immutable after creation (SET-16)");
      if ("multi" in fields) throw new FieldsError("`fields.multi` is immutable after creation (SET-16)");
      const label = str(fields, "label");
      const searchable = bool(fields, "searchable");
      const taskTypes = nullableStrArray(fields, "task_types");
      await editCustomField(locttDir, key, {
        ...(label !== undefined ? { label } : {}),
        ...(searchable !== undefined ? { searchable } : {}),
        ...(taskTypes !== undefined ? { task_types: taskTypes } : {}),
      });
      return `Updated custom field "${key}"`;
    }
    case "delete": {
      // Whole-field delete is clear-only — remap_to is rejected upstream.
      const key = requireKey(args, "the custom_field to delete");
      await deleteCustomField(locttDir, key);
      return `Deleted custom field "${key}"`;
    }
    case "reorder":
      throw new FieldsError("custom_field does not support reorder (reorder its values with entity:\"custom_field_value\")");
  }
}

/** Parses `fields.values` = [{key,label,icon?,color?}, …] for enum seeds. */
function parseFieldValueSeeds(fields: Fields): CustomFieldValueDef[] | undefined {
  const v = fields["values"];
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw new FieldsError("`fields.values` must be an array of {key,label} objects");
  return v.map((raw, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new FieldsError(`\`fields.values[${i}]\` must be an object with key and label`);
    }
    const o = raw as Record<string, unknown>;
    if (typeof o["key"] !== "string" || typeof o["label"] !== "string") {
      throw new FieldsError(`\`fields.values[${i}]\` must have string \`key\` and \`label\``);
    }
    const icon = o["icon"];
    const color = o["color"];
    return {
      key: o["key"],
      label: o["label"],
      ...(typeof icon === "string" ? { icon } : {}),
      ...(typeof color === "string" ? { color } : {}),
    } as CustomFieldValueDef;
  });
}

async function dispatchCustomFieldValue(locttDir: string, op: Op, args: Record<string, unknown>, fields: Fields): Promise<string> {
  const field = requireFieldParent(args);
  switch (op) {
    case "create": {
      const key = requireKey(args, "the new value key");
      await addFieldValue(locttDir, field, { key, label: requireStr(fields, "label"), ...iconColorCreate(fields) });
      return `Added value "${key}" to custom field "${field}"`;
    }
    case "edit": {
      const key = requireKey(args, "the value to edit");
      const label = str(fields, "label");
      await editFieldValue(locttDir, field, key, {
        ...(label !== undefined ? { label } : {}),
        ...iconColorEdit(fields),
      });
      return `Updated value "${key}" of custom field "${field}"`;
    }
    case "delete": {
      const key = requireKey(args, "the value to delete");
      await deleteFieldValue(locttDir, field, key, remapToArg(args));
      return `Deleted value "${key}" of custom field "${field}"`;
    }
    case "reorder": {
      await reorderFieldValues(locttDir, field, requireOrder(args));
      return `Reordered values of custom field "${field}"`;
    }
  }
}

async function dispatchBoardColumn(locttDir: string, op: Op, args: Record<string, unknown>, fields: Fields): Promise<string> {
  switch (op) {
    case "create": {
      const key = requireKey(args, "the new board_column key");
      const statuses = strArray(fields, "statuses");
      if (statuses === undefined) throw new FieldsError("`fields.statuses` (array of status keys) is required");
      const wip = num(fields, "wip");
      await createBoardColumn(locttDir, {
        key,
        label: requireStr(fields, "label"),
        statuses,
        ...(wip !== undefined ? { wip } : {}),
      });
      return `Created board column "${key}"`;
    }
    case "edit": {
      const key = requireKey(args, "the board_column to edit");
      const label = str(fields, "label");
      const statuses = strArray(fields, "statuses");
      // wip: null clears, number sets, absent leaves unchanged.
      let wip: number | null | undefined;
      if ("wip" in fields) {
        wip = fields["wip"] === null ? null : num(fields, "wip");
      }
      await editBoardColumn(locttDir, key, {
        ...(label !== undefined ? { label } : {}),
        ...(statuses !== undefined ? { statuses } : {}),
        ...(wip !== undefined ? { wip } : {}),
      });
      return `Updated board column "${key}"`;
    }
    case "delete": {
      // No remap — board columns hold no task data (rejected upstream too).
      const key = requireKey(args, "the board_column to delete");
      await deleteBoardColumn(locttDir, key);
      return `Deleted board column "${key}"`;
    }
    case "reorder": {
      await reorderBoardColumns(locttDir, requireOrder(args));
      return "Reordered board columns";
    }
  }
}

// ---------------------------------------------------------------------------
// The consolidated tool + the two singleton tools.
// ---------------------------------------------------------------------------

const ENTITY_OP_MATRIX =
  "status/priority/task_type/board_column: create, edit, delete, reorder. " +
  "custom_field_value: create, edit, delete, reorder (needs `field` = parent field key). " +
  "relationship: create, edit, delete (NO reorder). " +
  "custom_field: create, edit, delete (clear-only, NO reorder; delete rejects remap_to).";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "edit_workflow_entity",
    description:
      "Create, edit, delete, or reorder a workflow.yaml collection entity — a status, priority, task type, relationship, custom field, custom-field enum value, or board column. " +
      "This is the WRITE side of the workflow config; `get_workflow_config` is the read side (call it first to see current keys). " +
      "One tool, dispatched on {entity, op}. Entity/op matrix: " + ENTITY_OP_MATRIX + " " +
      "Args: `entity` and `op` (required); `key` (the entity key — required for edit/delete, and is the NEW key on create); " +
      "`field` (the parent custom-field key, required only for entity:\"custom_field_value\"); " +
      "`fields` (the create/edit payload: label, category, icon, color, kind, inverse, type, multi, task_types, statuses, wip, etc. — per entity); " +
      "`remap_to` (delete-in-use target: another key, or null to clear the value from every task); " +
      "`order` (the full ordered key list, for reorder); `confirm` (must be true for delete). " +
      "Keys are immutable — an `edit` cannot rename (there is no key change; a rename is delete+create). Priority `value` is never settable (derived from order — use reorder). " +
      "Custom-field `type`/`multi` are immutable after create. Deleting an in-use status/priority/task_type/relationship/enum-value requires `remap_to`; whole custom_field and board_column deletes take no remap.",
    inputSchema: {
      entity: z.enum(ENTITIES).describe("Which workflow entity: " + ENTITIES.join(" | ")),
      op: z.enum(OPS).describe("create | edit | delete | reorder (must be legal for the entity — see description)"),
      key: z.string().optional().describe("Entity key. Required for edit/delete; the new key for create. Not used by reorder."),
      field: z.string().optional().describe("Parent custom-field key. Required only for entity:\"custom_field_value\"."),
      fields: z.record(z.string(), z.unknown()).optional().describe("The create/edit payload; shape depends on entity (see description)."),
      remap_to: z.string().nullable().optional().describe("Delete-in-use target key, or null to clear the value from every task. Rejected for custom_field and board_column deletes."),
      order: z.array(z.string()).optional().describe("The full ordered list of keys, for op:\"reorder\" (must be a permutation of the existing keys)."),
      confirm: z.boolean().optional().describe("Required true for op:\"delete\" (destructive)."),
    },
    handler: async ({ locttDir }, args) => {
      const entity = args["entity"] as Entity;
      const op = args["op"] as Op;

      // op legality for the entity.
      if (!LEGAL_OPS[entity].includes(op)) {
        return errorResult(
          `op "${op}" is not valid for entity "${entity}"; legal ops: ${LEGAL_OPS[entity].join(", ")}`,
        );
      }
      // confirm gate on delete, matching every other delete_* tool.
      if (op === "delete") {
        const blocked = requireConfirm(args, `deleting a ${entity}`);
        if (blocked) return blocked;
        // Clear-only entities must not be handed a remap target.
        if (NO_REMAP_DELETE.has(entity) && "remap_to" in args && args["remap_to"] !== undefined) {
          return errorResult(
            `entity "${entity}" delete is clear-only and does not accept remap_to (the value is cleared from every task)`,
          );
        }
      }

      let message: string;
      try {
        message = await dispatch(locttDir, entity, op, args);
      } catch (err) {
        if (err instanceof FieldsError) return errorResult(err.message);
        throw err; // WorkflowEntityError and real bugs handled by the dispatcher.
      }
      return text(message);
    },
  },
  {
    name: "set_estimation_config",
    description:
      "Configure the estimation singleton in workflow.yaml (not a collection entity, so it is its own tool). " +
      "When estimation is unset, this must supply at least `enabled` and `unit`. Pass null to clear an optional field. " +
      "`scale` and `weights` are supported. See `get_workflow_config` for the current value.",
    inputSchema: {
      enabled: z.boolean().optional().describe("Whether estimation is on."),
      unit: z.enum(VALID_ESTIMATION_UNITS).optional().describe("points | hours | days | custom_numeric | custom_enum"),
      unit_label: z.string().nullable().optional().describe("Display label for the unit; null clears."),
      scale: z.enum(VALID_ESTIMATION_SCALES).nullable().optional().describe("free | linear | fibonacci; null clears."),
      preset_values: z.array(z.union([z.number(), z.string()])).nullable().optional().describe("Allowed estimate values; null clears."),
      weights: z.record(z.string(), z.number()).nullable().optional().describe("Per-category weight map (key → number); null clears."),
    },
    handler: async ({ locttDir }, args) => {
      const changes: Parameters<typeof editEstimationConfig>[1] = {
        ...("enabled" in args ? { enabled: args["enabled"] as boolean } : {}),
        ...("unit" in args ? { unit: args["unit"] as EstimationUnit } : {}),
        ...("unit_label" in args ? { unit_label: args["unit_label"] as string | null } : {}),
        ...("scale" in args ? { scale: args["scale"] as EstimationScale | null } : {}),
        ...("preset_values" in args ? { preset_values: args["preset_values"] as (number | string)[] | null } : {}),
        ...("weights" in args ? { weights: args["weights"] as Record<string, number> | null } : {}),
      };
      if (Object.keys(changes).length === 0) {
        return errorResult("nothing to change — supply at least one estimation field");
      }
      await editEstimationConfig(locttDir, changes);
      return text("Updated estimation config");
    },
  },
  {
    name: "set_timeline_config",
    description:
      "Configure the timeline singleton in workflow.yaml (not a collection entity, so it is its own tool). " +
      "`dependency_relationship` names the relationship key used for dependency arrows; null is the explicit \"no arrows\" value (written through, distinct from unset). " +
      "The other fields clear with null. See `get_workflow_config` for the current value.",
    inputSchema: {
      dependency_relationship: z.string().nullable().optional().describe("Relationship key for dependency arrows; null = explicitly no arrows."),
      default_zoom: z.enum(VALID_TIMELINE_ZOOMS).nullable().optional().describe("day | week | month; null clears."),
      show_arrows: z.boolean().nullable().optional().describe("Whether to draw dependency arrows; null clears the override."),
      default_grouping: z.string().nullable().optional().describe("Grouping key (builtin or field.<key>); null clears."),
    },
    handler: async ({ locttDir }, args) => {
      const changes: Parameters<typeof editTimelineConfig>[1] = {
        ...("dependency_relationship" in args ? { dependency_relationship: args["dependency_relationship"] as string | null } : {}),
        ...("default_zoom" in args ? { default_zoom: args["default_zoom"] as TimelineZoom | null } : {}),
        ...("show_arrows" in args ? { show_arrows: args["show_arrows"] as boolean | null } : {}),
        ...("default_grouping" in args ? { default_grouping: args["default_grouping"] as TimelineGrouping | null } : {}),
      };
      if (Object.keys(changes).length === 0) {
        return errorResult("nothing to change — supply at least one timeline field");
      }
      await editTimelineConfig(locttDir, changes);
      return text("Updated timeline config");
    },
  },
];
