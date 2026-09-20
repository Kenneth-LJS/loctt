/**
 * Per-entity workflow-write functions.
 *
 * `applyWorkflowEdit` (workflow-write.ts) is the whole-document primitive:
 * validated, atomic, journaled, with task-rewrite + remap. Its only
 * caller today is the web server's `PUT /api/workflow`, which ships the
 * entire config back. Every other surface — CLI, MCP — needs to change
 * *one* entity at a time and get the same guarantees. This module is that
 * layer: each function reads the current config fresh, splices in one
 * change, and hands the result to `applyWorkflowEdit`.
 *
 * The shape mirrors the labels/milestones/sprints per-entity CRUD (the
 * Ken-chosen template): a create/edit/delete/reorder set per entity, with
 * a named error class for refusals and delete-in-use taking a `remapTo`.
 *
 * The hard guarantees this layer enforces (they are the point of it):
 *  - **Key immutability.** `create*` takes a `key`; `edit*` has no path to
 *    change it (nor `type`/`multi` on a custom field, per SET-16). A
 *    rename is delete+create — there is deliberately no rename op.
 *  - **Priority value.** Never a settable argument; `renumberPriorities`
 *    (inside `assertWorkflowConfigValid`) recomputes it from list order.
 *    `reorderPriorities` is the only way to change it.
 *  - **Remap-or-refuse on delete.** Where the op matrix says remap, the
 *    delete fn takes `remapTo` and builds the `WorkflowRemap` directive
 *    `applyWorkflowEdit` understands; it refuses (named error) when the
 *    entity is in use and no `remapTo` is given. Custom-field WHOLE delete
 *    is clear-only (no target). The in-use check reuses
 *    `computeWorkflowKeyUsage`.
 *  - **Read-fresh.** Each function reads the current config itself rather
 *    than accepting a stale one — the concurrency mitigation Ken chose:
 *    shrink the race window between read and validated write.
 *  - **Validation + atomicity.** All writes funnel through
 *    `applyWorkflowEdit`, so a rejected edit leaves workflow.yaml
 *    unchanged. This module never writes partially.
 *
 * A251/A252 · see decisions.md § 8.
 */
import type {
  BoardColumnDef,
  CustomFieldDef,
  CustomFieldValueDef,
  EstimationConfig,
  EstimationScale,
  EstimationUnit,
  EstimationWeights,
  HexColor,
  IconString,
  PriorityDef,
  RelationshipDef,
  RelationshipGraph,
  RelationshipKind,
  StatusCategory,
  StatusDef,
  TaskTypeDef,
  TimelineConfig,
  TimelineGrouping,
  TimelineZoom,
  WorkflowConfig,
} from "@loctt/contracts";

import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import { loadAllTasks } from "../task/load-all.js";
import { loadWorkflowConfig } from "./workflow.js";
import { computeWorkflowKeyUsage } from "./workflow-write.js";
import { applyWorkflowEdit, type WorkflowRemap } from "./workflow-write.js";

/**
 * Errors raised about a workflow-entity edit. Every throw site is a
 * rejected input checked before the write, so the default cause is
 * `validation_failed` / `not_saved` — mirroring `LabelError`.
 */
export class WorkflowEntityError extends LocttError {
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, { dataState: "not_saved", ...opts });
    this.name = "WorkflowEntityError";
  }
}

/** Optional icon/color shared by status/priority/task_type/relationship/field-value. */
export interface IconColorInput {
  readonly icon?: IconString;
  readonly color?: HexColor;
}

/**
 * The single shared splice/validate/remap helper. Reads the config fresh,
 * runs the caller's mutator to produce `next`, and applies it through the
 * primitive. Every function below is a thin wrapper over this: the only
 * thing that differs is the mutation and (for deletes) the remap.
 *
 * `mutator` receives the freshly-loaded config and returns the whole next
 * config. It must not mutate `prev` in place — return a new object — so a
 * validation refusal inside `applyWorkflowEdit` leaves the caller's view
 * of the world unchanged too.
 */
async function mutateWorkflow(
  locttDir: string,
  mutator: (prev: WorkflowConfig) => WorkflowConfig,
  remap: WorkflowRemap = {},
): Promise<void> {
  const prev = await loadWorkflowConfig(locttDir);
  const next = mutator(prev);
  await applyWorkflowEdit(locttDir, next, remap);
}

/**
 * Builds the icon/color spread for a create/edit input, dropping keys the
 * caller did not set so the serializer omits them.
 */
function iconColorFields(input: { icon?: IconString | undefined; color?: HexColor | undefined }): {
  icon?: IconString;
  color?: HexColor;
} {
  return {
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
  };
}

/**
 * Applies an icon/color CHANGE to an existing entity. `null` clears the
 * field; `undefined` leaves it as-is. Returns the merged icon/color slots.
 */
function mergeIconColor(
  existing: { icon?: IconString | undefined; color?: HexColor | undefined },
  changes: { icon?: IconString | null | undefined; color?: HexColor | null | undefined },
): { icon?: IconString; color?: HexColor } {
  const icon =
    changes.icon === null ? undefined
    : changes.icon !== undefined ? changes.icon
    : existing.icon;
  const color =
    changes.color === null ? undefined
    : changes.color !== undefined ? changes.color
    : existing.color;
  return {
    ...(icon !== undefined ? { icon } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

/** Refuses when a key already exists in a sub-list. */
function assertKeyFree(
  existing: readonly { key: string }[],
  key: string,
  entity: string,
): void {
  if (existing.some(e => e.key === key)) {
    throw new WorkflowEntityError(`${entity} key '${key}' already exists`);
  }
}

/** Finds an entity by key or throws a named not-found. */
function requireByKey<T extends { key: string }>(
  list: readonly T[],
  key: string,
  entity: string,
): T {
  const found = list.find(e => e.key === key);
  if (!found) throw new WorkflowEntityError(`unknown ${entity}: ${key}`);
  return found;
}

/**
 * Reorders a sub-list to match `orderedKeys`. Refuses unless the given
 * keys are exactly the existing set (a permutation) — dropping or adding a
 * key through reorder would be a silent create/delete bypassing the remap
 * guards. Returns the reordered list.
 */
function reorderByKeys<T extends { key: string }>(
  list: readonly T[],
  orderedKeys: readonly string[],
  entity: string,
): T[] {
  const byKey = new Map(list.map(e => [e.key, e]));
  if (orderedKeys.length !== list.length) {
    throw new WorkflowEntityError(
      `${entity} reorder must list every key exactly once (expected ${list.length}, got ${orderedKeys.length})`,
    );
  }
  const seen = new Set<string>();
  const out: T[] = [];
  for (const key of orderedKeys) {
    if (seen.has(key)) {
      throw new WorkflowEntityError(`${entity} reorder repeats key '${key}'`);
    }
    const entry = byKey.get(key);
    if (!entry) {
      throw new WorkflowEntityError(`${entity} reorder names unknown key '${key}'`);
    }
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * Shared delete-in-use gate. Returns the `remapTo`-or-refuse decision as a
 * remap sub-table for the given collection. Refuses (named error) when the
 * key is in use and no `remapTo` was supplied; validates that `remapTo` —
 * when given — is not the key itself and names a surviving key.
 *
 * `remapTo === null` is the explicit clear; a caller passes it to drop the
 * value from every task rather than move it. `undefined` means the caller
 * gave nothing, which is only acceptable when the key is unused.
 */
function resolveDeleteRemap(
  key: string,
  remapTo: string | null | undefined,
  inUse: ReadonlySet<string>,
  survivingKeys: ReadonlySet<string>,
  entity: string,
): Record<string, string | null> | undefined {
  if (remapTo === undefined) {
    if (inUse.has(key)) {
      throw new WorkflowEntityError(
        `${entity} '${key}' is in use; provide a remap target (or clear) to delete it`,
      );
    }
    return undefined; // unused — no remap needed
  }
  if (remapTo === key) {
    throw new WorkflowEntityError(`${entity} remap target must differ from '${key}'`);
  }
  if (remapTo !== null && !survivingKeys.has(remapTo)) {
    throw new WorkflowEntityError(
      `${entity} remap target '${remapTo}' is not a surviving ${entity} key`,
    );
  }
  return { [key]: remapTo };
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export interface CreateStatusInput extends IconColorInput {
  readonly key: string;
  readonly label: string;
  readonly category: StatusCategory;
  /** When true, becomes the new default (clearing any prior default). */
  readonly default?: boolean;
}

/** Appends a status. `key` is fixed at creation. */
export async function createStatus(locttDir: string, input: CreateStatusInput): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    assertKeyFree(prev.statuses, input.key, "status");
    const created: StatusDef = {
      key: input.key,
      label: input.label,
      category: input.category,
      ...(input.default === true ? { default: true } : {}),
      ...iconColorFields(input),
    };
    // Exactly-one-default is a config invariant: a new default clears the
    // others so the write does not fail its own validation.
    const priors = input.default === true
      ? prev.statuses.map(stripDefault)
      : prev.statuses;
    return { ...prev, statuses: [...priors, created] };
  });
}

/** Removes the `default` flag from a status def. */
function stripDefault(s: StatusDef): StatusDef {
  const { default: _drop, ...rest } = s;
  return rest;
}

export interface EditStatusChanges {
  readonly label?: string;
  readonly category?: StatusCategory;
  /** Set this status as the default (clearing others). Cannot un-set here. */
  readonly default?: boolean;
  readonly icon?: IconString | null;
  readonly color?: HexColor | null;
}

/**
 * Edits a status's mutable fields. `key` is immutable — there is no path
 * to change it (a rename is delete+create).
 */
export async function editStatus(
  locttDir: string,
  key: string,
  changes: EditStatusChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const existing = requireByKey(prev.statuses, key, "status");
    const updated: StatusDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      category: changes.category ?? existing.category,
      ...(existing.default === true ? { default: true } : {}),
      ...mergeIconColor(existing, changes),
    };
    let statuses = prev.statuses.map(s => (s.key === key ? updated : s));
    // Setting default here means clearing it everywhere else.
    if (changes.default === true) {
      statuses = statuses.map(s => (s.key === key ? { ...s, default: true } : stripDefault(s)));
    }
    return { ...prev, statuses };
  });
}

/** Deletes a status, remapping in-use tasks onto `remapTo` (or clearing). */
export async function deleteStatus(
  locttDir: string,
  key: string,
  remapTo?: string | null,
): Promise<void> {
  const tasks = await loadAllTasks(locttDir);
  const usage = computeWorkflowKeyUsage(tasks);
  await mutateWorkflow(
    locttDir,
    prev => {
      requireByKey(prev.statuses, key, "status");
      const statuses = prev.statuses.filter(s => s.key !== key);
      return { ...prev, statuses };
    },
    buildRemap("statuses", key, remapTo, usage.statuses, await survivingStatusKeys(locttDir, key)),
  );
}

/** Reorders statuses to the given key order. */
export async function reorderStatuses(locttDir: string, orderedKeys: readonly string[]): Promise<void> {
  await mutateWorkflow(locttDir, prev => ({
    ...prev,
    statuses: reorderByKeys(prev.statuses, orderedKeys, "status"),
  }));
}

async function survivingStatusKeys(locttDir: string, deletedKey: string): Promise<ReadonlySet<string>> {
  const cfg = await loadWorkflowConfig(locttDir);
  return new Set(cfg.statuses.map(s => s.key).filter(k => k !== deletedKey));
}

// ---------------------------------------------------------------------------
// Priorities  (value is NEVER an argument — reorder sets it, D20)
// ---------------------------------------------------------------------------

export interface CreatePriorityInput extends IconColorInput {
  readonly key: string;
  readonly label: string;
}

/**
 * Appends a priority. Its `value` is NOT accepted — `renumberPriorities`
 * (inside the write path) assigns it from list order. New priorities land
 * at the bottom (lowest rank); use `reorderPriorities` to rank them.
 */
export async function createPriority(locttDir: string, input: CreatePriorityInput): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    assertKeyFree(prev.priorities, input.key, "priority");
    const created: PriorityDef = {
      key: input.key,
      label: input.label,
      ...iconColorFields(input),
    };
    return { ...prev, priorities: [...prev.priorities, created] };
  });
}

export interface EditPriorityChanges {
  readonly label?: string;
  readonly icon?: IconString | null;
  readonly color?: HexColor | null;
}

/**
 * Edits a priority's label/icon/color. `key` is immutable and `value` is
 * never settable here — it is derived from list order by `reorderPriorities`.
 */
export async function editPriority(
  locttDir: string,
  key: string,
  changes: EditPriorityChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const existing = requireByKey(prev.priorities, key, "priority");
    const updated: PriorityDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      // value is intentionally preserved from `existing`; the write path
      // renumbers it. Not accepting it here is the enforcement.
      ...(existing.value !== undefined ? { value: existing.value } : {}),
      ...mergeIconColor(existing, changes),
    };
    return { ...prev, priorities: prev.priorities.map(p => (p.key === key ? updated : p)) };
  });
}

/** Deletes a priority, remapping in-use tasks onto `remapTo` (or clearing). */
export async function deletePriority(
  locttDir: string,
  key: string,
  remapTo?: string | null,
): Promise<void> {
  const tasks = await loadAllTasks(locttDir);
  const usage = computeWorkflowKeyUsage(tasks);
  const cfg = await loadWorkflowConfig(locttDir);
  const surviving = new Set(cfg.priorities.map(p => p.key).filter(k => k !== key));
  await mutateWorkflow(
    locttDir,
    prev => {
      requireByKey(prev.priorities, key, "priority");
      return { ...prev, priorities: prev.priorities.filter(p => p.key !== key) };
    },
    buildRemap("priorities", key, remapTo, usage.priorities, surviving),
  );
}

/**
 * Reorders priorities. This IS how `value` is set: the write path
 * renumbers 1..N by the new order (top = N, bottom = 1 per D20).
 */
export async function reorderPriorities(locttDir: string, orderedKeys: readonly string[]): Promise<void> {
  await mutateWorkflow(locttDir, prev => ({
    ...prev,
    priorities: reorderByKeys(prev.priorities, orderedKeys, "priority"),
  }));
}

// ---------------------------------------------------------------------------
// Task types
// ---------------------------------------------------------------------------

export interface CreateTaskTypeInput extends IconColorInput {
  readonly key: string;
  readonly label: string;
}

/** Appends a task type. `key` is fixed at creation. */
export async function createTaskType(locttDir: string, input: CreateTaskTypeInput): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    assertKeyFree(prev.task_types, input.key, "task_type");
    const created: TaskTypeDef = {
      key: input.key,
      label: input.label,
      ...iconColorFields(input),
    };
    return { ...prev, task_types: [...prev.task_types, created] };
  });
}

export interface EditTaskTypeChanges {
  readonly label?: string;
  readonly icon?: IconString | null;
  readonly color?: HexColor | null;
}

/** Edits a task type's label/icon/color. `key` is immutable. */
export async function editTaskType(
  locttDir: string,
  key: string,
  changes: EditTaskTypeChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const existing = requireByKey(prev.task_types, key, "task_type");
    const updated: TaskTypeDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      ...mergeIconColor(existing, changes),
    };
    return { ...prev, task_types: prev.task_types.map(t => (t.key === key ? updated : t)) };
  });
}

/** Deletes a task type, remapping in-use tasks onto `remapTo` (or clearing). */
export async function deleteTaskType(
  locttDir: string,
  key: string,
  remapTo?: string | null,
): Promise<void> {
  const tasks = await loadAllTasks(locttDir);
  const usage = computeWorkflowKeyUsage(tasks);
  const cfg = await loadWorkflowConfig(locttDir);
  const surviving = new Set(cfg.task_types.map(t => t.key).filter(k => k !== key));
  await mutateWorkflow(
    locttDir,
    prev => {
      requireByKey(prev.task_types, key, "task_type");
      return { ...prev, task_types: prev.task_types.filter(t => t.key !== key) };
    },
    buildRemap("task_types", key, remapTo, usage.task_types, surviving),
  );
}

/** Reorders task types to the given key order. */
export async function reorderTaskTypes(locttDir: string, orderedKeys: readonly string[]): Promise<void> {
  await mutateWorkflow(locttDir, prev => ({
    ...prev,
    task_types: reorderByKeys(prev.task_types, orderedKeys, "task_type"),
  }));
}

// ---------------------------------------------------------------------------
// Relationships  (no reorder)
// ---------------------------------------------------------------------------

export interface CreateRelationshipInput extends IconColorInput {
  readonly key: string;
  readonly label: string;
  readonly kind?: RelationshipKind;
  readonly inverse?: string;
  readonly inverse_label?: string;
  readonly graph?: RelationshipGraph;
  readonly ranked?: boolean;
}

/** Appends a relationship definition. `key` is fixed at creation. */
export async function createRelationship(
  locttDir: string,
  input: CreateRelationshipInput,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    assertKeyFree(prev.relationships, input.key, "relationship");
    const created: RelationshipDef = {
      key: input.key,
      label: input.label,
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.inverse !== undefined ? { inverse: input.inverse } : {}),
      ...(input.inverse_label !== undefined ? { inverse_label: input.inverse_label } : {}),
      ...(input.graph !== undefined ? { graph: input.graph } : {}),
      ...(input.ranked !== undefined ? { ranked: input.ranked } : {}),
      ...iconColorFields(input),
    };
    return { ...prev, relationships: [...prev.relationships, created] };
  });
}

export interface EditRelationshipChanges {
  readonly label?: string;
  readonly kind?: RelationshipKind;
  readonly inverse?: string;
  readonly inverse_label?: string;
  readonly graph?: RelationshipGraph;
  readonly ranked?: boolean;
  readonly icon?: IconString | null;
  readonly color?: HexColor | null;
}

/**
 * Edits a relationship's mutable fields. `key` is immutable. An
 * inverse-only rename (changing `inverse` while `key` stays) is handled by
 * the write path's `expandRelationshipsRemap`, which follows stored
 * inverse edges automatically.
 */
export async function editRelationship(
  locttDir: string,
  key: string,
  changes: EditRelationshipChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const existing = requireByKey(prev.relationships, key, "relationship");
    const updated: RelationshipDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      ...(pick(changes.kind, existing.kind) !== undefined ? { kind: pick(changes.kind, existing.kind) } : {}),
      ...(pick(changes.inverse, existing.inverse) !== undefined ? { inverse: pick(changes.inverse, existing.inverse) } : {}),
      ...(pick(changes.inverse_label, existing.inverse_label) !== undefined
        ? { inverse_label: pick(changes.inverse_label, existing.inverse_label) }
        : {}),
      ...(pick(changes.graph, existing.graph) !== undefined ? { graph: pick(changes.graph, existing.graph) } : {}),
      ...(pick(changes.ranked, existing.ranked) !== undefined ? { ranked: pick(changes.ranked, existing.ranked) } : {}),
      ...mergeIconColor(existing, changes),
    };
    return { ...prev, relationships: prev.relationships.map(r => (r.key === key ? updated : r)) };
  });
}

/** Returns `next` when set, else `fallback`. */
function pick<T>(next: T | undefined, fallback: T | undefined): T | undefined {
  return next !== undefined ? next : fallback;
}

/**
 * Deletes a relationship. `remapTo` moves in-use edges onto another
 * relationship's key; `null` clears them (drops the edges). Refuses when
 * the relationship is in use and neither is given. No reorder op exists
 * for relationships.
 */
export async function deleteRelationship(
  locttDir: string,
  key: string,
  remapTo?: string | null,
): Promise<void> {
  const tasks = await loadAllTasks(locttDir);
  const usage = computeWorkflowKeyUsage(tasks);
  const cfg = await loadWorkflowConfig(locttDir);
  const surviving = new Set(cfg.relationships.map(r => r.key).filter(k => k !== key));
  await mutateWorkflow(
    locttDir,
    prev => {
      requireByKey(prev.relationships, key, "relationship");
      return { ...prev, relationships: prev.relationships.filter(r => r.key !== key) };
    },
    (() => {
      const table = resolveDeleteRemap(key, remapTo, usage.relationships, surviving, "relationship");
      return table ? { relationships: table } : {};
    })(),
  );
}

// ---------------------------------------------------------------------------
// Custom fields  (type & multi immutable after create; whole delete clear-only)
// ---------------------------------------------------------------------------

export interface CreateCustomFieldInput {
  readonly key: string;
  readonly label: string;
  readonly type: CustomFieldDef["type"];
  readonly multi: boolean;
  readonly searchable: boolean;
  readonly values?: readonly CustomFieldValueDef[];
  readonly task_types?: readonly string[];
}

/**
 * Creates a custom field. `type` and `multi` are fixed at creation
 * (SET-16) — they can never be edited afterwards. For an enum field, seed
 * its `values` here or add them with `addFieldValue`.
 */
export async function createCustomField(
  locttDir: string,
  input: CreateCustomFieldInput,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    assertKeyFree(prev.custom_fields, input.key, "custom_field");
    const created: CustomFieldDef = {
      key: input.key,
      label: input.label,
      type: input.type,
      multi: input.multi,
      searchable: input.searchable,
      ...(input.values !== undefined ? { values: input.values.map(v => ({ ...v })) } : {}),
      ...(input.task_types !== undefined ? { task_types: [...input.task_types] } : {}),
    };
    return { ...prev, custom_fields: [...prev.custom_fields, created] };
  });
}

export interface EditCustomFieldChanges {
  readonly label?: string;
  readonly searchable?: boolean;
  /** Type-scope allowlist. `null` clears it (field becomes global). */
  readonly task_types?: readonly string[] | null;
}

/**
 * Edits a custom field's `label`/`searchable`/`task_types` scope. `type`
 * and `multi` are immutable (SET-16) and there is no path to change them
 * here; `key` is immutable too. Enum `values` are edited via the
 * field-value functions, not here.
 */
export async function editCustomField(
  locttDir: string,
  key: string,
  changes: EditCustomFieldChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const existing = requireByKey(prev.custom_fields, key, "custom_field");
    const nextScope =
      changes.task_types === null ? undefined
      : changes.task_types !== undefined ? [...changes.task_types]
      : existing.task_types;
    const updated: CustomFieldDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      type: existing.type,   // immutable (SET-16)
      multi: existing.multi, // immutable (SET-16)
      searchable: changes.searchable ?? existing.searchable,
      ...(existing.values !== undefined ? { values: existing.values.map(v => ({ ...v })) } : {}),
      ...(nextScope !== undefined ? { task_types: nextScope } : {}),
    };
    return { ...prev, custom_fields: prev.custom_fields.map(f => (f.key === key ? updated : f)) };
  });
}

/**
 * Deletes a whole custom field. Clear-only: there is NO remap target — the
 * field (and any stored values under it) is cleared from every task. This
 * matches the write path's field-level sweep, which drops the field from
 * task frontmatter when its def is gone.
 */
export async function deleteCustomField(locttDir: string, key: string): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    requireByKey(prev.custom_fields, key, "custom_field");
    return { ...prev, custom_fields: prev.custom_fields.filter(f => f.key !== key) };
  });
}

// ---------------------------------------------------------------------------
// Custom-field enum values (sub-list)
// ---------------------------------------------------------------------------

export interface AddFieldValueInput extends IconColorInput {
  readonly key: string;
  readonly label: string;
}

/** Finds an enum field or throws. Refuses non-enum fields. */
function requireEnumField(prev: WorkflowConfig, fieldKey: string): CustomFieldDef {
  const field = requireByKey(prev.custom_fields, fieldKey, "custom_field");
  if (field.type !== "enum") {
    throw new WorkflowEntityError(`custom_field '${fieldKey}' is not an enum; it has no values`);
  }
  return field;
}

/** Replaces a field's values, returning the next config. */
function withFieldValues(
  prev: WorkflowConfig,
  fieldKey: string,
  values: readonly CustomFieldValueDef[],
): WorkflowConfig {
  return {
    ...prev,
    custom_fields: prev.custom_fields.map(f =>
      f.key === fieldKey ? { ...f, values: values.map(v => ({ ...v })) } : f,
    ),
  };
}

/** Appends an enum value to a field. Its `key` is fixed at creation. */
export async function addFieldValue(
  locttDir: string,
  fieldKey: string,
  input: AddFieldValueInput,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const field = requireEnumField(prev, fieldKey);
    const values = field.values ?? [];
    assertKeyFree(values, input.key, `custom_field '${fieldKey}' value`);
    const created: CustomFieldValueDef = {
      key: input.key,
      label: input.label,
      ...iconColorFields(input),
    };
    return withFieldValues(prev, fieldKey, [...values, created]);
  });
}

export interface EditFieldValueChanges {
  readonly label?: string;
  readonly icon?: IconString | null;
  readonly color?: HexColor | null;
}

/** Edits an enum value's label/icon/color. Its `key` is immutable. */
export async function editFieldValue(
  locttDir: string,
  fieldKey: string,
  valueKey: string,
  changes: EditFieldValueChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const field = requireEnumField(prev, fieldKey);
    const values = field.values ?? [];
    const existing = requireByKey(values, valueKey, `custom_field '${fieldKey}' value`);
    const updated: CustomFieldValueDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      ...(existing.value !== undefined ? { value: existing.value } : {}),
      ...mergeIconColor(existing, changes),
    };
    return withFieldValues(prev, fieldKey, values.map(v => (v.key === valueKey ? updated : v)));
  });
}

/**
 * Deletes an enum value. `remapTo` moves in-use tasks onto another value
 * of the same field; `null` clears the value from tasks. Refuses when the
 * value is in use and neither is given.
 */
export async function deleteFieldValue(
  locttDir: string,
  fieldKey: string,
  valueKey: string,
  remapTo?: string | null,
): Promise<void> {
  const tasks = await loadAllTasks(locttDir);
  const usage = computeWorkflowKeyUsage(tasks);
  const inUse = usage.custom_field_values[fieldKey] ?? new Set<string>();
  const cfg = await loadWorkflowConfig(locttDir);
  const field = cfg.custom_fields.find(f => f.key === fieldKey);
  const surviving = new Set((field?.values ?? []).map(v => v.key).filter(k => k !== valueKey));
  await mutateWorkflow(
    locttDir,
    prev => {
      const f = requireEnumField(prev, fieldKey);
      const values = f.values ?? [];
      requireByKey(values, valueKey, `custom_field '${fieldKey}' value`);
      return withFieldValues(prev, fieldKey, values.filter(v => v.key !== valueKey));
    },
    (() => {
      const table = resolveDeleteRemap(
        valueKey, remapTo, inUse, surviving,
        `custom_field '${fieldKey}' value`,
      );
      return table ? { custom_fields: { [fieldKey]: table } } : {};
    })(),
  );
}

/** Reorders an enum field's values to the given key order. */
export async function reorderFieldValues(
  locttDir: string,
  fieldKey: string,
  orderedKeys: readonly string[],
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const field = requireEnumField(prev, fieldKey);
    const values = field.values ?? [];
    return withFieldValues(prev, fieldKey, reorderByKeys(values, orderedKeys, `custom_field '${fieldKey}' value`));
  });
}

// ---------------------------------------------------------------------------
// Board columns
// ---------------------------------------------------------------------------

export interface CreateBoardColumnInput {
  readonly key: string;
  readonly label: string;
  readonly statuses: readonly string[];
  readonly wip?: number;
}

/** Returns the current board columns (empty when boards is unset). */
function boardColumns(cfg: WorkflowConfig): readonly BoardColumnDef[] {
  return cfg.boards?.columns ?? [];
}

/** Replaces the board columns, returning the next config. */
function withBoardColumns(prev: WorkflowConfig, columns: readonly BoardColumnDef[]): WorkflowConfig {
  return { ...prev, boards: { columns: columns.map(c => ({ ...c, statuses: [...c.statuses] })) } };
}

/** Appends a board column. `key` is fixed at creation. */
export async function createBoardColumn(
  locttDir: string,
  input: CreateBoardColumnInput,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const columns = boardColumns(prev);
    assertKeyFree(columns, input.key, "board column");
    const created: BoardColumnDef = {
      key: input.key,
      label: input.label,
      statuses: [...input.statuses],
      ...(input.wip !== undefined ? { wip: input.wip } : {}),
    };
    return withBoardColumns(prev, [...columns, created]);
  });
}

export interface EditBoardColumnChanges {
  readonly label?: string;
  readonly statuses?: readonly string[];
  /** WIP limit; `null` clears it. */
  readonly wip?: number | null;
}

/** Edits a board column's label/statuses/wip. `key` is immutable. */
export async function editBoardColumn(
  locttDir: string,
  key: string,
  changes: EditBoardColumnChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const columns = boardColumns(prev);
    const existing = requireByKey(columns, key, "board column");
    const wip =
      changes.wip === null ? undefined
      : changes.wip !== undefined ? changes.wip
      : existing.wip;
    const updated: BoardColumnDef = {
      key: existing.key,
      label: changes.label ?? existing.label,
      statuses: changes.statuses !== undefined ? [...changes.statuses] : [...existing.statuses],
      ...(wip !== undefined ? { wip } : {}),
    };
    return withBoardColumns(prev, columns.map(c => (c.key === key ? updated : c)));
  });
}

/**
 * Deletes a board column. Board columns carry no task data (they only
 * group statuses for display), so there is no remap — deleting one never
 * orphans a task. Deleting the last column removes the `boards` block
 * entirely (the schema rejects an empty `columns`), reverting the board to
 * its 1:1 status-per-column default.
 */
export async function deleteBoardColumn(locttDir: string, key: string): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const columns = boardColumns(prev);
    requireByKey(columns, key, "board column");
    const remaining = columns.filter(c => c.key !== key);
    if (remaining.length === 0) {
      const { boards: _drop, ...rest } = prev;
      return rest;
    }
    return withBoardColumns(prev, remaining);
  });
}

/** Reorders board columns to the given key order. */
export async function reorderBoardColumns(locttDir: string, orderedKeys: readonly string[]): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const columns = boardColumns(prev);
    return withBoardColumns(prev, reorderByKeys(columns, orderedKeys, "board column"));
  });
}

// ---------------------------------------------------------------------------
// Estimation (singleton — no create/delete)
// ---------------------------------------------------------------------------

export interface EditEstimationChanges {
  readonly enabled?: boolean;
  readonly unit?: EstimationUnit;
  readonly unit_label?: string | null;
  readonly scale?: EstimationScale | null;
  readonly preset_values?: readonly (number | string)[] | null;
  readonly weights?: EstimationWeights | null;
}

/**
 * Edits the estimation config (a singleton — no create/delete). Supports
 * `scale`, `weights`, and every other field. A `null` clears an optional
 * field. When estimation is unset, an edit must supply at least `enabled`
 * and `unit` (the required fields) or validation refuses it.
 */
export async function editEstimationConfig(
  locttDir: string,
  changes: EditEstimationChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const existing = prev.estimation;
    const enabled = changes.enabled ?? existing?.enabled;
    const unit = changes.unit ?? existing?.unit;
    if (enabled === undefined || unit === undefined) {
      throw new WorkflowEntityError(
        `estimation is not configured; an edit must set at least 'enabled' and 'unit'`,
      );
    }
    const clearOrKeep = <T>(change: T | null | undefined, current: T | undefined): T | undefined =>
      change === null ? undefined : change !== undefined ? change : current;

    const unit_label = clearOrKeep(changes.unit_label, existing?.unit_label);
    const scale = clearOrKeep(changes.scale, existing?.scale);
    const preset_values = clearOrKeep(
      changes.preset_values !== undefined && changes.preset_values !== null
        ? [...changes.preset_values]
        : changes.preset_values,
      existing?.preset_values ? [...existing.preset_values] : undefined,
    );
    const weights = clearOrKeep(changes.weights, existing?.weights);

    const next: EstimationConfig = {
      enabled,
      unit,
      ...(unit_label !== undefined ? { unit_label } : {}),
      ...(scale !== undefined ? { scale } : {}),
      ...(preset_values !== undefined ? { preset_values } : {}),
      ...(weights !== undefined ? { weights } : {}),
    };
    return { ...prev, estimation: next };
  });
}

// ---------------------------------------------------------------------------
// Timeline (singleton)
// ---------------------------------------------------------------------------

export interface EditTimelineChanges {
  /** Relationship key for dependency arrows; `null` explicitly disables. */
  readonly dependency_relationship?: string | null;
  readonly default_zoom?: TimelineZoom | null;
  readonly show_arrows?: boolean | null;
  readonly default_grouping?: TimelineGrouping | null;
}

/**
 * Edits the timeline config (a singleton). `dependency_relationship` and
 * `default_grouping` are references that may dangle — they are written
 * through as given, even naming a deleted key, and the timeline view
 * reports the dangle (TML-34). `null` on `dependency_relationship` is the
 * explicit "no arrows" value (distinct from unset); on the other fields it
 * clears the override.
 */
export async function editTimelineConfig(
  locttDir: string,
  changes: EditTimelineChanges,
): Promise<void> {
  await mutateWorkflow(locttDir, prev => {
    const existing = prev.timeline;
    // dependency_relationship: null is meaningful (explicitly disabled), so
    // it is NOT treated as a clear — it is written through.
    const dependency_relationship =
      changes.dependency_relationship !== undefined
        ? changes.dependency_relationship
        : existing?.dependency_relationship;
    const clearOrKeep = <T>(change: T | null | undefined, current: T | undefined): T | undefined =>
      change === null ? undefined : change !== undefined ? change : current;
    const default_zoom = clearOrKeep(changes.default_zoom, existing?.default_zoom);
    const show_arrows = clearOrKeep(changes.show_arrows, existing?.show_arrows);
    const default_grouping = clearOrKeep(changes.default_grouping, existing?.default_grouping);

    const next: TimelineConfig = {
      ...(dependency_relationship !== undefined ? { dependency_relationship } : {}),
      ...(default_zoom !== undefined ? { default_zoom } : {}),
      ...(show_arrows !== undefined ? { show_arrows } : {}),
      ...(default_grouping !== undefined ? { default_grouping } : {}),
    };
    return { ...prev, timeline: next };
  });
}

// ---------------------------------------------------------------------------
// Shared remap builder for the top-level scalar collections
// ---------------------------------------------------------------------------

/**
 * Builds a `WorkflowRemap` for deleting `key` from one of the scalar
 * collections (statuses/priorities/task_types), applying the
 * remap-or-refuse gate. Relationship and field-value deletes have their
 * own inline builders because their remap tables sit at different shapes
 * in `WorkflowRemap`.
 */
function buildRemap(
  collection: "statuses" | "priorities" | "task_types",
  key: string,
  remapTo: string | null | undefined,
  inUse: ReadonlySet<string>,
  survivingKeys: ReadonlySet<string>,
): WorkflowRemap {
  const table = resolveDeleteRemap(key, remapTo, inUse, survivingKeys, singular(collection));
  return table ? { [collection]: table } : {};
}

function singular(collection: "statuses" | "priorities" | "task_types"): string {
  return collection === "statuses" ? "status"
    : collection === "priorities" ? "priority"
    : "task_type";
}
