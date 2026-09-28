import type {
  CustomFieldDef,
  CustomFieldValueDef,
  LabelDef,
  LabelsConfig,
  Task,
  WorkflowConfig,
} from "@loctt/contracts";
import { allowsNewValues, deriveValueKey, isIdShaped } from "@loctt/contracts";
import { ulid } from "ulid";

import type { ArchivedGuardConfigs } from "../config/archived-guard.js";
import { loadArchivedGuardConfigs } from "../config/archived-guard.js";
import { loadLabelsConfig, saveLabelsConfig } from "../config/labels.js";
import { loadWorkflowConfig } from "../config/workflow.js";
import { saveWorkflowConfig } from "../config/workflow-write.js";
import { getTaskFilePath } from "../paths/index.js";
import { withStateLock } from "../state/lock.js";
import { stagedSwap } from "../state/staged-swap.js";
import {
  entityAmbiguousMessage,
  entityNotFoundMessage,
  matchEntityRef,
} from "../utils/entity-ref.js";
import { assembleTaskFile } from "./frontmatter.js";
import { appendHistory } from "./history.js";
import { assertWriteSafe, readTask, writeTask } from "./io.js";
import { lookupTask, TaskNotFoundError } from "./lookup.js";
import { clearLookupCaches } from "./lookup-cache.js";
import type { DeferredFieldWrite, SetFieldsEntry } from "./update.js";
import { assertChangesWritable, setFieldsLocked, TaskUpdateError, todayDateString } from "./update.js";

/**
 * Field edits that read the task's current list (K150).
 *
 * `setField`/`setFields` replace a value outright: to add one label a
 * caller had to read the list, append, and send it back, and a second
 * writer in between lost its change. Here the add/remove is applied to
 * the list as it is on disk, inside the state lock, so two concurrent
 * adds both land.
 *
 * One model for labels and every open choice field (K150): a value the
 * tracker does not know is refused (the K148 message) unless the caller
 * asked to create it (`createMissing`: CLI `--create`, MCP
 * `create_missing: true`, the web picker's "Create 'x'" row). A label
 * is created as `label create` would; an enum value is appended to the
 * field's `values` with a key derived from the label. A closed field
 * (`allow_new_values` off, the default) never grows.
 *
 * Everything is planned and validated in memory first and written only
 * when the whole change is accepted, so a refusal leaves labels.yaml,
 * workflow.yaml and the task untouched.
 */

/** One field's list edit. */
export interface ListEdit {
  readonly add?: readonly unknown[];
  readonly remove?: readonly unknown[];
}

export interface EditTaskFieldsOptions {
  readonly locttDir: string;
  readonly taskId: string;
  /** Replace-form writes, as `setFields` takes them. */
  readonly set?: readonly SetFieldsEntry[];
  /** Add/remove per list field (`labels` or a multi custom field's key). */
  readonly lists?: Readonly<Record<string, ListEdit>>;
  /** Create unknown labels and values of open choice fields (K150). */
  readonly createMissing?: boolean;
  /** Ignored for validation (reloaded under the lock); kept for API parity. */
  readonly workflowConfig?: WorkflowConfig;
  readonly archivedGuard?: ArchivedGuardConfigs;
}

/** A label or choice value created by the edit. */
export interface CreatedValue {
  readonly field: string;
  /** The label's ID, or the new value's key. */
  readonly id: string;
  readonly name: string;
}

export interface EditTaskFieldsResult {
  readonly task: Task;
  /** False when every add was already present and every remove absent. */
  readonly changed: boolean;
  readonly created: readonly CreatedValue[];
}

/**
 * An unknown value was given without asking to create it. `creatable`
 * says whether asking would have worked, so a surface can name its own
 * spelling of the switch (`--create`, `create_missing: true`).
 */
export class UnknownFieldValueError extends TaskUpdateError {
  readonly creatable: boolean;
  constructor(message: string, field: string, creatable: boolean) {
    super(message, { field });
    this.name = "UnknownFieldValueError";
    this.creatable = creatable;
  }
}

interface Resolver {
  /** Resolve a value to add or set; may create (in memory). */
  readonly toStored: (raw: unknown) => unknown;
  /**
   * Resolve a value to remove; never creates. Callers reach it only
   * after the value was not found literally in the stored list.
   */
  readonly toRemove: (raw: unknown) => unknown;
}

/** Mutable in-memory copies the plan grows as it creates things. */
interface Pending {
  labels: LabelsConfig;
  workflow: WorkflowConfig;
  labelsChanged: boolean;
  workflowChanged: boolean;
  created: CreatedValue[];
}

function labelResolver(pending: Pending, createMissing: boolean): Resolver {
  const resolve = (raw: unknown, forAdd: boolean): unknown => {
    if (typeof raw !== "string" || raw === "") return raw;
    const found = matchEntityRef(pending.labels.labels, raw, { includeArchived: true });
    if (found.kind === "match") return found.entity.id;
    if (found.kind === "ambiguous") {
      throw new TaskUpdateError(entityAmbiguousMessage("label", raw, found.matches), { field: "labels" });
    }
    // An ID-shaped input is an ID (K148): one that matches nothing is
    // never created as a name.
    if (!forAdd || !createMissing || isIdShaped(raw)) {
      throw new UnknownFieldValueError(entityNotFoundMessage("label", raw), "labels", forAdd && !isIdShaped(raw));
    }
    const def: LabelDef = { id: ulid(), name: raw };
    pending.labels = { ...pending.labels, labels: [...pending.labels.labels, def] };
    pending.labelsChanged = true;
    pending.created.push({ field: "labels", id: def.id, name: raw });
    return def.id;
  };
  return { toStored: raw => resolve(raw, true), toRemove: raw => resolve(raw, false) };
}

/**
 * Matches a choice value by key, then by label (the key is the value's
 * ID, the label its name). Several values sharing the label is refused,
 * listing each with its key.
 */
function matchChoice(
  values: readonly CustomFieldValueDef[],
  raw: string,
): { kind: "match"; key: string } | { kind: "ambiguous"; matches: readonly CustomFieldValueDef[] } | { kind: "not_found" } {
  const byKey = values.find(v => v.key === raw);
  if (byKey !== undefined) return { kind: "match", key: byKey.key };
  const byLabel = values.filter(v => v.label === raw);
  if (byLabel.length === 1) return { kind: "match", key: (byLabel[0] as CustomFieldValueDef).key };
  if (byLabel.length > 1) return { kind: "ambiguous", matches: byLabel };
  return { kind: "not_found" };
}

function choiceResolver(pending: Pending, fieldKey: string, createMissing: boolean): Resolver {
  const current = (): CustomFieldDef =>
    pending.workflow.custom_fields.find(f => f.key === fieldKey) as CustomFieldDef;
  const resolve = (raw: unknown, forAdd: boolean): unknown => {
    if (typeof raw !== "string" || raw === "") return raw;
    const def = current();
    const values = def.values ?? [];
    const found = matchChoice(values, raw);
    if (found.kind === "match") return found.key;
    if (found.kind === "ambiguous") {
      const listed = found.matches.map(m => `${m.label} (${m.key})`).join(", ");
      throw new TaskUpdateError(
        `'${raw}' matches ${String(found.matches.length)} ${fieldKey} values: ${listed}. Use the key.`,
        { field: fieldKey },
      );
    }
    const open = allowsNewValues(def);
    if (!forAdd || !createMissing) {
      throw new UnknownFieldValueError(
        `No ${fieldKey} value named '${raw}'.`,
        fieldKey,
        forAdd && open,
      );
    }
    if (!open) {
      throw new TaskUpdateError(
        `${fieldKey} does not allow new values. Choose one of: ${values.map(v => v.label).join(", ")}.`,
        { field: fieldKey },
      );
    }
    const created: CustomFieldValueDef = { key: deriveValueKey(raw, values.map(v => v.key)), label: raw };
    pending.workflow = {
      ...pending.workflow,
      custom_fields: pending.workflow.custom_fields.map(f =>
        f.key === fieldKey ? { ...f, values: [...values, created] } : f,
      ),
    };
    pending.workflowChanged = true;
    pending.created.push({ field: fieldKey, id: created.key, name: raw });
    return created.key;
  };
  return { toStored: raw => resolve(raw, true), toRemove: raw => resolve(raw, false) };
}

/** Plain equality for list members (strings, numbers, booleans). */
function sameMember(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** The field's custom def, or undefined for a built-in. */
function customDef(workflow: WorkflowConfig, field: string): CustomFieldDef | undefined {
  return workflow.custom_fields.find(f => f.key === field);
}

function resolverFor(pending: Pending, field: string, createMissing: boolean): Resolver | undefined {
  if (field === "labels") return labelResolver(pending, createMissing);
  const def = customDef(pending.workflow, field);
  if (def?.type === "enum") return choiceResolver(pending, field, createMissing);
  return undefined;
}

/** Refusals about the edit's shape, before anything is read. */
function assertEditShape(sets: readonly SetFieldsEntry[], lists: Readonly<Record<string, ListEdit>>): void {
  const listFields = Object.keys(lists);
  if (sets.length === 0 && listFields.length === 0) {
    throw new TaskUpdateError("Nothing to change: give a value to set, or values to add or remove.");
  }
  for (const f of listFields) {
    if (sets.some(s => s.field === f)) {
      throw new TaskUpdateError(
        `${f} is both replaced and edited in one change. Do one or the other.`,
        { field: f },
      );
    }
    const edit = lists[f] as ListEdit;
    for (const r of edit.remove ?? []) {
      if ((edit.add ?? []).some(a => sameMember(a, r))) {
        throw new TaskUpdateError(
          `'${String(r)}' is both added to and removed from ${f}.`,
          { field: f },
        );
      }
    }
  }
  if (sets.length > 0) assertChangesWritable(sets, "update");
}

/** Every edited field must be a list: `labels` or a `multi` custom field. */
function assertListFields(workflow: WorkflowConfig, listFields: readonly string[]): void {
  for (const field of listFields) {
    const def = field === "labels" ? undefined : customDef(workflow, field);
    if (field !== "labels" && def?.multi !== true) {
      throw new TaskUpdateError(
        def === undefined
          ? `${field} is not a list field. Values can be added to and removed from labels and multi-value custom fields.`
          : `${field} holds one value, not a list. Set it instead.`,
        { field },
      );
    }
  }
}

/**
 * The replace-form changes one task's edit comes to, computed against
 * the task as it is on disk. Creates values in `pending` (in memory)
 * when asked. An empty result means the edit changes nothing.
 */
function planTaskEdit(
  task: Task,
  pending: Pending,
  sets: readonly SetFieldsEntry[],
  lists: Readonly<Record<string, ListEdit>>,
  createMissing: boolean,
): SetFieldsEntry[] {
  // Replace-form values: resolved (and created, when asked) the same
  // way, so `set labels a,b --create` and `add` agree.
  const changes: SetFieldsEntry[] = [];
  for (const entry of sets) {
    const resolver = createMissing ? resolverFor(pending, entry.field, true) : undefined;
    if (resolver === undefined || entry.value === undefined) {
      changes.push(entry);
      continue;
    }
    // A member the task already stores passes through as stored: the
    // web picker sends the whole list plus the new label, and a stored
    // value the config has since dropped must stay as it is, not be
    // "created" back under its key as a label.
    const storedNow: unknown = entry.field === "labels"
      ? task.frontmatter.labels
      : task.frontmatter.fields?.[entry.field];
    const stored = Array.isArray(storedNow) ? (storedNow as unknown[]) : [storedNow];
    const toStored = (v: unknown): unknown =>
      stored.some(m => m !== undefined && sameMember(m, v)) ? v : resolver.toStored(v);
    const value = Array.isArray(entry.value)
      ? (entry.value as unknown[]).map(toStored)
      : toStored(entry.value);
    changes.push({ field: entry.field, value });
  }

  for (const field of Object.keys(lists)) {
    const edit = lists[field] as ListEdit;
    const unreadable = (task.health ?? []).some(h => {
      const base = h.field.replace(/\[.*$/, "");
      return field === "labels" ? base === "labels" : base === `fields.${field}` || base === field;
    });
    const stored: unknown = field === "labels"
      ? task.frontmatter.labels
      : task.frontmatter.fields?.[field];
    if (unreadable || (stored !== undefined && !Array.isArray(stored))) {
      throw new TaskUpdateError(
        `${field} on ${task.frontmatter.key} can't be read as a list, so values can't be added or removed. Replace the whole list instead.`,
        { field },
      );
    }
    const currentList = (stored as unknown[] | undefined) ?? [];
    const resolver = resolverFor(pending, field, createMissing);

    let next = [...currentList];
    for (const raw of edit.remove ?? []) {
      // A stored member given literally is removed even when it no
      // longer resolves (a deleted label's ID, a value dropped from
      // the config): that is how the user cleans it up.
      const target = next.some(m => sameMember(m, raw))
        ? raw
        : resolver !== undefined ? resolver.toRemove(raw) : raw;
      next = next.filter(m => !sameMember(m, target));
    }
    for (const raw of edit.add ?? []) {
      const value = resolver !== undefined ? resolver.toStored(raw) : raw;
      if (!next.some(m => sameMember(m, value))) next.push(value);
    }

    const same = next.length === currentList.length
      && next.every((m, i) => sameMember(m, currentList[i]));
    if (!same) changes.push({ field, value: next });
  }
  return changes;
}

/** The fields a list-edit write owns, for `assertWriteSafe`. */
function touchedBy(changes: readonly SetFieldsEntry[]): Set<string> {
  const touched = new Set<string>([...changes.map(c => c.field), "updated_at"]);
  if (touched.has("status")) { touched.add("status_updated_at"); touched.add("completed_date"); }
  return touched;
}

async function loadPending(locttDir: string): Promise<Pending> {
  return {
    labels: await loadLabelsConfig(locttDir),
    workflow: await loadWorkflowConfig(locttDir),
    labelsChanged: false,
    workflowChanged: false,
    created: [],
  };
}

async function savePending(locttDir: string, pending: Pending): Promise<void> {
  if (pending.labelsChanged) await saveLabelsConfig(locttDir, pending.labels);
  if (pending.workflowChanged) await saveWorkflowConfig(locttDir, pending.workflow);
}

/**
 * Applies set, add and remove edits to one task under the state lock.
 *
 * - `lists` names `labels` or a declared `multi` custom field; anything
 *   else is refused. Adding a value already present, or removing one
 *   that is not, changes nothing. A value both added and removed in the
 *   same call, or a field both set and edited, is refused.
 * - Values go through the K148 resolver (labels by name or ID; choice
 *   values by key or label). An unknown value is refused unless
 *   `createMissing` and the field can grow.
 * - A list whose stored value can't be read as a list is refused: adding
 *   to it would silently replace what the file holds.
 * - When nothing changes, nothing is written (no history, no
 *   `updated_at` bump) and `changed` is false.
 */
export async function editTaskFields(opts: EditTaskFieldsOptions): Promise<EditTaskFieldsResult> {
  const sets = opts.set ?? [];
  const lists = opts.lists ?? {};
  assertEditShape(sets, lists);

  return withStateLock(opts.locttDir, async () => {
    const { locttDir, taskId } = opts;
    const task = await readTask(locttDir, taskId);
    const pending = await loadPending(locttDir);
    assertListFields(pending.workflow, Object.keys(lists));
    const changes = planTaskEdit(task, pending, sets, lists, opts.createMissing === true);

    if (changes.length === 0) {
      // Nothing is written, so nothing was created either: a value
      // planned for creation is saved only with a task that uses it.
      return { task, changed: false, created: [] };
    }

    const guard: ArchivedGuardConfigs = {
      ...(opts.archivedGuard ?? await loadArchivedGuardConfigs(locttDir)),
      labels: pending.labels,
    };
    // Validate and build the write in memory (defer), against the
    // configs as they will be once the created values land.
    const write = await setFieldsLocked({
      locttDir,
      taskId,
      changes,
      workflowConfig: pending.workflow,
      archivedGuard: guard,
      defer: true,
    });

    await savePending(locttDir, pending);
    await writeTask(locttDir, taskId, write.task, touchedBy(changes));
    if (write.history.length > 0) await appendHistory(locttDir, taskId, [...write.history]);
    return { task: write.task, changed: true, created: pending.created };
  });
}

export interface BulkEditTaskFieldsOptions {
  readonly locttDir: string;
  /** Task ids or keys. */
  readonly taskRefs: readonly string[];
  readonly set?: readonly SetFieldsEntry[];
  readonly lists?: Readonly<Record<string, ListEdit>>;
  readonly createMissing?: boolean;
  readonly archivedGuard?: ArchivedGuardConfigs;
}

export interface BulkEditTaskFieldsResult {
  readonly bulk_op_id: string;
  /** Every task the edit covered, the unchanged ones included. */
  readonly succeeded: string[];
  /** Tasks that could not be changed, and why; the rest still were (K153). */
  readonly failed: { taskId: string; error: string }[];
  /** Tasks that already had every added value and none of the removed ones. */
  readonly unchanged: string[];
  readonly created: readonly CreatedValue[];
}

/**
 * {@link editTaskFields} over many tasks, as one operation (K153: the
 * same shape as bulk set, DEG-C8).
 *
 * Under one state lock, each task is resolved and its edit planned and
 * validated. A task that would fail (not found, unreadable, a list that
 * can't be read, a value the field refuses) is reported in `failed` and
 * the rest still change. An unknown value without `createMissing` is
 * about the command, not a task, so it refuses the whole call once as
 * itself. The created labels and values are saved once (only when some
 * task uses them), every changed task.md lands in one staged swap, and
 * each history entry carries the one `bulk_op_id`.
 */
export async function bulkEditTaskFields(opts: BulkEditTaskFieldsOptions): Promise<BulkEditTaskFieldsResult> {
  const sets = opts.set ?? [];
  const lists = opts.lists ?? {};
  assertEditShape(sets, lists);
  const bulkOpId = ulid();

  return withStateLock(opts.locttDir, async () => {
    const { locttDir } = opts;
    const createMissing = opts.createMissing === true;
    const pending = await loadPending(locttDir);
    assertListFields(pending.workflow, Object.keys(lists));
    const baseGuard = opts.archivedGuard ?? await loadArchivedGuardConfigs(locttDir);
    const now = new Date().toISOString();
    const today = await todayDateString(locttDir);

    const writes: { id: string; write: DeferredFieldWrite; touched: Set<string> }[] = [];
    const unchanged: string[] = [];
    const failed: { taskId: string; error: string }[] = [];
    const seen = new Set<string>();
    for (const ref of opts.taskRefs) {
      try {
        const task = await lookupTask(locttDir, ref);
        const id = task.frontmatter.id;
        if (seen.has(id)) continue;
        seen.add(id);
        const changes = planTaskEdit(task, pending, sets, lists, createMissing);
        if (changes.length === 0) {
          unchanged.push(id);
          continue;
        }
        const write = await setFieldsLocked({
          locttDir,
          taskId: id,
          changes,
          workflowConfig: pending.workflow,
          archivedGuard: { ...baseGuard, labels: pending.labels },
          now,
          today,
          bulkOpId,
          defer: true,
        });
        writes.push({ id, write, touched: touchedBy(changes) });
      } catch (err) {
        if (err instanceof UnknownFieldValueError) throw err;
        failed.push({
          taskId: ref,
          error: err instanceof TaskNotFoundError ? "task not found" : (err as Error).message,
        });
      }
    }
    if (writes.length > 0) {
      for (const w of writes) await assertWriteSafe(locttDir, w.id, w.write.task, w.touched);
      await savePending(locttDir, pending);
      await stagedSwap(
        locttDir,
        writes.map(w => ({ path: getTaskFilePath(locttDir, w.id), content: assembleTaskFile(w.write.task) })),
      );
      // The swap wrote task.md behind writeTask's back.
      clearLookupCaches(locttDir);
      for (const w of writes) {
        if (w.write.history.length > 0) await appendHistory(locttDir, w.id, [...w.write.history]);
      }
    }
    return {
      bulk_op_id: bulkOpId,
      succeeded: [...writes.map(w => w.id), ...unchanged],
      failed,
      unchanged,
      // Saved only when some task changed (above); otherwise nothing was.
      created: writes.length > 0 ? pending.created : [],
    };
  });
}
