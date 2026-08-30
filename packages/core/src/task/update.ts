import type { HistoryEntry, Task, TaskFrontmatter, WorkflowConfig } from "@loctt/contracts";

import type { ArchivedGuardConfigs } from "../config/archived-guard.js";
import { assertNotArchivedReferences } from "../config/archived-guard.js";
import { loadCalendarConfig } from "../config/calendar.js";
import { loadLabelsConfig } from "../config/labels.js";
import { loadMilestonesConfig } from "../config/milestones.js";
import { loadSprintsConfig } from "../config/sprints.js";
import type { ValidationError } from "../config/validation.js";
import { validateTaskAgainstWorkflow } from "../config/validation.js";
import type { LocttErrorOptions } from "../errors.js";
import { LocttError } from "../errors.js";
import { resolveLabelIdFromInput } from "../labels/manage.js";
import { resolveMilestoneIdFromInput } from "../milestones/manage.js";
import { resolveSprintIdFromInput } from "../sprints/manage.js";
import { withStateLock } from "../state/lock.js";
import { todayInZone } from "../utils/today.js";
import { appendHistory } from "./history.js";
import { readTask, writeTask } from "./io.js";
import { readField, toFrontmatter, toMutable } from "./mutable.js";

export class TaskUpdateError extends LocttError {
  /**
   * `data_state` defaults to `not_saved` because every throw site is
   * before the write — the guards, the enum check and the archived
   * check all run first. ERR-18 requires the claim, and "not saved" is
   * the true one here rather than a safe-sounding default.
   */
  constructor(message: string, opts: LocttErrorOptions = {}) {
    super("validation_failed", message, { dataState: "not_saved", ...opts });
    this.name = "TaskUpdateError";
  }
}

/**
 * Fields that users cannot set/unset directly through the generic
 * `setField`/`unsetField` API. Most have a dedicated privileged
 * caller that mutates them; see {@link SYSTEM_MUTABLE_VIA} for the
 * authoritative map. Two — `id` and `created_at` — are never
 * mutated by anything after task creation.
 *
 * Exported so callers (CLI, MCP, web) can pre-validate input at
 * their own boundaries and produce clearer errors than waiting for
 * `setField` to throw.
 */
/** Shared so the two write paths cannot drift apart. */
const UPDATED_AT_REFUSAL =
  `cannot set "updated_at" directly; it is stamped on every write`;

export const USER_IMMUTABLE_FIELDS: ReadonlySet<string> = new Set([
  "id",
  "key",
  "created_at",
  // Stamped on every write. Hand-writing it forges the field that
  // git-sync reconciliation, recency sort and the activity feed all
  // read — and per-field merging leans on it harder still, since
  // whole-record recency is the fallback whenever history cannot
  // explain a field. MCP already refused it incidentally, via a
  // different guard; the CLI and web did not.
  "updated_at",
  "project",
  "relationships",
  "key_history",
  "archived",
  "archived_at",
  "status_updated_at",
]);

/**
 * Legacy alias for {@link USER_IMMUTABLE_FIELDS}. The original name
 * lied — some of these fields ARE mutated, just by system code
 * paths (see {@link SYSTEM_MUTABLE_VIA}). Kept as a re-export so
 * existing external imports keep compiling.
 *
 * @deprecated Use `USER_IMMUTABLE_FIELDS`.
 */
export const IMMUTABLE_FIELDS: ReadonlySet<string> = USER_IMMUTABLE_FIELDS;

/**
 * Documents which privileged code path is allowed to mutate each
 * field that's blocked from `setField`/`unsetField`. The keys
 * match {@link USER_IMMUTABLE_FIELDS}; the values name the function
 * or invariant that owns the mutation.
 *
 * This is documentation that lives next to the type — a future
 * reader can grep for the field name and find the one place that
 * legitimately writes it. The runtime guards remain
 * {@link USER_IMMUTABLE_FIELDS} (set/unset path) and the per-call
 * checks at the privileged callers.
 */
export const SYSTEM_MUTABLE_VIA: Readonly<Record<string, string>> = {
  id: "never mutated after createTask",
  key: "rekeyCollisions during git-sync reconcile; writes key_history alongside",
  created_at: "never mutated after createTask",
  updated_at: "stamped by setField/setFields/bulk writes and by git-sync merge",
  project: "deleteProject(hard) remap_project journal handler",
  relationships: "linkTask / unlinkTask (validates against workflow rels)",
  key_history: "rekeyCollisions and key-history append on rekey",
  archived: "archiveTask / unarchiveTask (paired with archived_at)",
  archived_at: "archiveTask / unarchiveTask (paired with archived)",
  status_updated_at: "setField('status', ...) auto-stamps it",
};

/**
 * Fields auto-managed by `setField` — users may not write to them
 * directly even via the generic field setter.
 *
 * `board_rank` is auto-managed too: callers must use the dedicated
 * `reorderBoardRank` API rather than `setField` so the rank
 * computation and rebalance trigger stays in one place.
 */
export const AUTO_MANAGED_FIELDS: ReadonlySet<string> = new Set([
  "completed_date",
  "board_rank",
]);

/**
 * Built-in optional fields that live at the top level of frontmatter
 * and ARE writable through `setField`. Anything not in this set (and
 * not `title` / `updated_at` / immutable / auto-managed) is treated as
 * a custom field under `fields:`.
 */
export const BUILTIN_OPTIONAL_FIELDS: ReadonlySet<string> = new Set([
  "status",
  "task_type",
  "priority",
  "labels",
  "assignee",
  "reporter",
  "start_date",
  "due_date",
  "estimate",
  "milestone",
  "sprint",
]);

/**
 * Built-in fields that `setField` knows how to write — including
 * `title` and `updated_at` in addition to the optional set. Useful for
 * callers that want to enumerate the writable surface for prompting
 * or autocomplete.
 */
export const WRITABLE_BUILTIN_FIELDS: ReadonlySet<string> = new Set([
  "title",
  "updated_at",
  ...BUILTIN_OPTIONAL_FIELDS,
]);

/**
 * Returns true when a status key falls into the `completed`
 * category. Used by the `completed_date` auto-management hook in
 * `setField`. Returns false when the workflow config is absent or
 * doesn't recognise the status — the date stays unset rather than
 * picking a wrong default.
 */
function isCompletedStatus(
  statusKey: unknown,
  workflowConfig: WorkflowConfig | undefined,
): boolean {
  if (typeof statusKey !== "string") return false;
  if (!workflowConfig) return false;
  const def = workflowConfig.statuses.find(s => s.key === statusKey);
  return def?.category === "completed";
}

/**
 * Returns today's date in ISO `YYYY-MM-DD` form, in the workspace
 * timezone. Used for `completed_date` so the field reads as a
 * calendar date rather than a precise instant.
 *
 * Resolving in UTC would stamp yesterday's date on anything completed
 * before 08:00 local in a UTC+8 workspace — and `completed_date`
 * feeds burndown and "done this week" queries, so the off-by-one
 * propagates.
 */
export async function todayDateString(locttDir: string): Promise<string> {
  try {
    return todayInZone((await loadCalendarConfig(locttDir)).timezone);
  } catch {
    return todayInZone();
  }
}

/**
 * Maps a {@link ValidationError}'s `field` back to the top-level name a
 * write addresses it by.
 *
 * `validateTaskAgainstWorkflow` reports positions, not just names:
 * `labels[0]`, `relationships[0].type`, `fields.team`, `fields.team[1]`.
 * A write, by contrast, names `labels`, `relationships` or `team`. This
 * collapses the former onto the latter so the two can be compared.
 *
 * `fields.X` collapses to `X` because that is how the setters address a
 * custom field — `loctt set T-1 team platform`, not `fields.team`.
 */
function errorOwner(errorField: string): string {
  if (errorField.startsWith("fields.")) {
    // `fields.team[1]` -> `team`
    return errorField.slice("fields.".length).replace(/\[\d+\].*$/, "");
  }
  // `relationships[0].type` -> `relationships`; `labels[0]` -> `labels`
  return errorField.replace(/[[.].*$/, "");
}

/**
 * Validates the post-write frontmatter, but reports only the failures
 * this write is answerable for.
 *
 * The defect (TSK-29, last bullet): validation ran over the *whole*
 * record on every write, so one enum value orphaned by a `workflow.yaml`
 * edit froze every other field on the task. Measured against core at
 * `fd8e881`:
 *
 *     loctt set T-1 status in_progress   # ok
 *     # delete `in_progress` from workflow.yaml
 *     loctt set T-1 priority high
 *     -> Error: invalid value: status: unknown status "in_progress";
 *               valid: backlog, done, wont_do
 *
 * P7 wants that drift surfaced, not turned into a wall; P1 wants the
 * file left as the user's until they act. So an error is dropped only
 * when BOTH hold:
 *
 *  1. it belongs to a field this write did not touch, and
 *  2. it was already failing, identically, before the write.
 *
 * **Condition 1 is what keeps an invalid *new* value refused today.**
 * Every field a write can change is named in `touched` — the setters
 * address frontmatter by exactly the names the validator reports, once
 * `errorOwner` has collapsed the indexed forms — so a bad value written
 * directly is always attributed to this write. `loctt set T-1 status
 * nonsense` fails exactly as it did before, and so does a bad value in
 * a field that was *already* orphaned, because the message differs.
 *
 * **Condition 2 is a backstop, and is deliberately unreachable now.**
 * It would catch a write that invalidated a field it does not name —
 * a side effect. The only side-effect field today is `completed_date`,
 * which `validateTaskAgainstWorkflow` does not check, so no current
 * path reaches it. Verified by mutation: deleting condition 2 leaves
 * the whole suite green, while deleting condition 1 does not. It is
 * kept because the cost is one extra in-memory validate and the
 * failure it guards against — a new invalid value reaching disk — is
 * the expensive direction to get wrong. Its unit test calls this
 * function directly, since no write path can stage the case.
 *
 * Comparing on `field` *and* `message`, not `field` alone, matters: an
 * untouched field whose error text changed is a different failure, and
 * a different failure is a new one.
 */
export function attributableErrors(
  before: TaskFrontmatter,
  after: TaskFrontmatter,
  touched: ReadonlySet<string>,
  workflowConfig: WorkflowConfig,
  aux: ArchivedGuardConfigs | undefined,
): readonly ValidationError[] {
  const errors = validateTaskAgainstWorkflow(after, workflowConfig, aux);
  if (errors.length === 0) return errors;

  const preexisting = new Set(
    validateTaskAgainstWorkflow(before, workflowConfig, aux)
      .map(e => `${e.field} ${e.message}`),
  );

  return errors.filter(e =>
    touched.has(errorOwner(e.field))
    || !preexisting.has(`${e.field} ${e.message}`),
  );
}

/**
 * Builds the refusal for a set of validation errors, naming the field
 * that is actually at fault.
 *
 * The second half of the TSK-29 defect: the envelope carried
 * `"field": "priority"` — the field the user had just edited — while
 * the message was about `status`, so a UI keying off `envelope.field`
 * highlighted the wrong input. The web fills `field` in from the
 * request only when core names none (`handleSetField` in
 * `apps/web/src/server/server.ts`), so core naming it is what corrects
 * the highlight.
 *
 * With more than one error no single field is *the* one at fault, so
 * `field` is left unset and each surface falls back to its own context.
 */
function invalidValueError(errors: readonly ValidationError[]): TaskUpdateError {
  const message =
    `invalid value: ${errors.map(e => `${e.field}: ${e.message}`).join("; ")}`;
  const only = errors.length === 1 ? errors[0] : undefined;
  return new TaskUpdateError(message, only ? { field: only.field } : {});
}

/** Options bag for setField. */
export interface SetFieldOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly field: string;
  readonly value: unknown;
  readonly workflowConfig?: WorkflowConfig;
  /**
   * Aux configs for archived-reference checks. When provided,
   * setField rejects newly-set values that point at archived
   * project/label/milestone/sprint/assignee/reporter. Existing
   * archived references on the task are preserved untouched.
   */
  readonly archivedGuard?: ArchivedGuardConfigs;
}

/**
 * Sets a field on a task's frontmatter.
 *
 * - Built-in optional fields are set at the top level.
 * - Other fields are set under `fields:` (custom fields).
 * - Immutable fields (id, key, created_at) cannot be set.
 * - Always updates `updated_at` timestamp.
 * - If setting `status`, also updates `status_updated_at`.
 */
/**
 * Maps a milestone/sprint/assignee/reporter reference to its id,
 * accepting either an id or a name. Other fields pass through untouched.
 *
 * Resolution needs the configs, which the caller already loaded for the
 * archived-reference guard; when it did not pass them the value is left
 * alone rather than the write failing, so a caller that opts out of the
 * guard is no worse off than before.
 *
 * `assignee`/`reporter` were originally omitted here, and storing the
 * name rather than the id silently defeated two separate guards, both of
 * which compare against ids (PRU-C7):
 *
 *  - `deleteUser` filters tasks by `assignee === userId`, matched
 *    nothing, and so deleted a referenced user without ever asking for
 *    `remapTo`/`unassign` — leaving tasks pointing at a user that no
 *    longer exists.
 *  - the archived-reference guard checks `assignee` against archived
 *    *user ids*, so a name assigned an archived user unnoticed.
 *
 * An unknown user is rejected rather than stored: an unresolvable name
 * is the same typo whether or not the field happens to be free-text.
 */
export async function resolveEntityRef(
  locttDir: string,
  field: string,
  value: unknown,
  guard: ArchivedGuardConfigs | undefined,
): Promise<unknown> {
  if (field === "labels") {
    // Labels are an array, and every element takes the same name-or-id
    // treatment the scalar fields get below. Without this, turning on
    // the existence check broke `loctt create one --label bug`: the
    // name reached the validator, which compares against ids.
    if (!Array.isArray(value)) return value;
    const cfg = guard?.labels ?? await loadLabelsConfig(locttDir);
    // `Array.isArray` narrows to `any[]`; re-typing as `unknown[]`
    // keeps the elements opaque until the string check vouches for them.
    return (value as unknown[]).map(v =>
      typeof v === "string" && v !== ""
        ? resolveLabelIdFromInput(cfg, v, { includeArchived: true })
        : v,
    );
  }
  if (typeof value !== "string" || value === "") return value;

  if (field === "milestone") {
    const cfg = guard?.milestones ?? await loadMilestonesConfig(locttDir);
    return resolveMilestoneIdFromInput(cfg, value, { includeArchived: true });
  }
  if (field === "sprint") {
    const cfg = guard?.sprints ?? await loadSprintsConfig(locttDir);
    return resolveSprintIdFromInput(cfg, value, { includeArchived: true });
  }
  if (field === "assignee" || field === "reporter") {
    // Lazy import for the same reason history.ts uses one: users/manage
    // pulls users/lifecycle, which imports task/load-all. A static
    // import here would close that loop at module load.
    const { resolveUserRef } = await import("../users/manage.js");
    return (await resolveUserRef(locttDir, value)).id;
  }
  return value;
}

export async function setField(opts: SetFieldOptions): Promise<Task> {
  if (opts.field === "updated_at") {
    // Both write paths, one message. `updated_at` is in
    // USER_IMMUTABLE_FIELDS, so the generic guard fired first on each
    // of them and the reason never reached the user (BLK-40).
    throw new TaskUpdateError(UPDATED_AT_REFUSAL);
  }
  if (USER_IMMUTABLE_FIELDS.has(opts.field)) {
    throw new TaskUpdateError(`cannot set immutable field "${opts.field}"`);
  }
  if (AUTO_MANAGED_FIELDS.has(opts.field)) {
    throw new TaskUpdateError(
      `cannot set auto-managed field "${opts.field}" directly; ` +
      `it is updated automatically based on status changes`,
    );
  }

  return withStateLock(opts.locttDir, () => setFieldLocked(opts));
}

async function setFieldLocked(opts: SetFieldOptions): Promise<Task> {
  const { locttDir, taskId, field, value, workflowConfig, archivedGuard } = opts;
  const task = await readTask(locttDir, taskId);
  const now = new Date().toISOString();

  let updated: TaskFrontmatter;

  if (field === "title") {
    if (typeof value !== "string" || value.length === 0) {
      throw new TaskUpdateError("title must be a non-empty string");
    }
    updated = { ...task.frontmatter, title: value, updated_at: now };
  } else if (field === "updated_at") {
    if (typeof value !== "string") {
      throw new TaskUpdateError("updated_at must be a string");
    }
    updated = { ...task.frontmatter, updated_at: value };
  } else if (BUILTIN_OPTIONAL_FIELDS.has(field)) {
    const patch = toMutable(task.frontmatter);
    // Resolve a milestone/sprint given by name to its id before writing.
    // Names are mutable and non-unique, so storing one detaches the task
    // the moment it is renamed — invariants.md says so for sprints, and
    // milestones have the identical shape. Storing the name also made
    // every consumer that counts by id (milestone progress, the sprint
    // burndown) report zero (MSL-C1).
    patch[field] = await resolveEntityRef(opts.locttDir, field, value, archivedGuard);
    patch["updated_at"] = now;
    if (field === "status") {
      patch["status_updated_at"] = now;
      // Auto-manage `completed_date` based on the new status's
      // category. Set when transitioning into a `completed` status,
      // clear when transitioning out.
      const wasCompleted = isCompletedStatus(task.frontmatter.status, workflowConfig);
      const isNowCompleted = isCompletedStatus(value, workflowConfig);
      if (isNowCompleted && !wasCompleted) {
        patch["completed_date"] = await todayDateString(opts.locttDir);
      } else if (!isNowCompleted && wasCompleted) {
        delete patch["completed_date"];
      }
    }
    updated = toFrontmatter(patch);
  } else {
    // Custom field — goes under fields:
    const existingFields = task.frontmatter.fields ?? {};
    updated = {
      ...task.frontmatter,
      fields: { ...existingFields, [field]: value },
      updated_at: now,
    };
  }

  if (workflowConfig) {
      // The archived guard's configs are a structural superset of
      // `AuxConfigs`, and every caller that passes one has already
      // loaded them — so existence checking costs nothing extra here.
      //
      // Without this, nothing on any write path checked that a
      // referenced project, milestone, sprint or label *exists*. Only
      // `doctor` passed `aux`, so a task could be written pointing at
      // an entity that was never created, and the user learned about it
      // from a diagnostic rather than from the write that caused it.
    // Only what this write is answerable for: a value already on disk
    // and untouched here stays the user's to repair (TSK-29, P1, P7).
    // The written field is always in `touched`, so an invalid new value
    // is refused exactly as before.
    const errors = attributableErrors(
      task.frontmatter,
      updated,
      new Set([field]),
      workflowConfig,
      archivedGuard,
    );
    if (errors.length > 0) throw invalidValueError(errors);
  }

  if (archivedGuard) {
    assertNotArchivedReferences(updated, task.frontmatter, archivedGuard);
  }

  const updatedTask: Task = { frontmatter: updated, body: task.body };
  await writeTask(locttDir, taskId, updatedTask);

  // Emit history entries
  const historyEntries = buildSetFieldHistory(task.frontmatter, field, value, now);
  if (historyEntries.length > 0) {
    await appendHistory(locttDir, taskId, historyEntries);
  }

  return updatedTask;
}

function buildSetFieldHistory(
  oldFm: TaskFrontmatter,
  field: string,
  value: unknown,
  timestamp: string,
): HistoryEntry[] {
  // Labels: diff old vs new array
  if (field === "labels") {
    const oldLabels = new Set(oldFm.labels ?? []);
    const newLabels = new Set(value as readonly string[]);
    const entries: HistoryEntry[] = [];
    for (const label of newLabels) {
      if (!oldLabels.has(label)) {
        entries.push({ timestamp, kind: "label_added", after: label });
      }
    }
    for (const label of oldLabels) {
      if (!newLabels.has(label)) {
        entries.push({ timestamp, kind: "label_removed", before: label });
      }
    }
    return entries;
  }

  // Custom field. Auto-managed fields are top-level, not custom, so a
  // granted `board_rank` write records a `field_change` like any other
  // built-in rather than a `custom_field_change` naming a `fields:`
  // key that does not exist.
  if (
    !BUILTIN_OPTIONAL_FIELDS.has(field)
    && !AUTO_MANAGED_FIELDS.has(field)
    && field !== "title"
    && field !== "updated_at"
  ) {
    const before = oldFm.fields?.[field];
    if (before === value) return [];
    return [{ timestamp, kind: "custom_field_change", field, before: before ?? null, after: value }];
  }

  // Built-in field
  const before = readField(oldFm, field);
  if (before === value) return [];
  return [{ timestamp, kind: "field_change", field, before: before ?? null, after: value }];
}

/**
 * Unsets (removes) a field from a task's frontmatter.
 *
 * - Built-in optional fields are removed from the top level.
 * - Other fields are removed from `fields:`.
 * - Required/immutable fields cannot be unset.
 * - Always updates `updated_at` timestamp.
 */
export async function unsetField(
  locttDir: string,
  taskId: string,
  field: string,
): Promise<Task> {
  assertUnsettable(field);
  return withStateLock(locttDir, () => unsetFieldLocked(locttDir, taskId, field));
}

/**
 * Rejects fields that must not be cleared. Shared with
 * {@link bulkUnsetField} so the two paths cannot drift — a field the
 * single-task API refuses must not become clearable in bulk.
 */
export function assertUnsettable(field: string): void {
  if (USER_IMMUTABLE_FIELDS.has(field) || field === "title" || field === "updated_at") {
    throw new TaskUpdateError(`cannot unset required field "${field}"`);
  }
  if (AUTO_MANAGED_FIELDS.has(field)) {
    throw new TaskUpdateError(
      `cannot unset auto-managed field "${field}" directly; ` +
      `it is updated automatically based on status changes`,
    );
  }
}

async function unsetFieldLocked(
  locttDir: string,
  taskId: string,
  field: string,
): Promise<Task> {
  const task = await readTask(locttDir, taskId);
  const now = new Date().toISOString();

  let updated: TaskFrontmatter;

  if (BUILTIN_OPTIONAL_FIELDS.has(field)) {
    const copy = toMutable(task.frontmatter);
    delete copy[field];
    copy["updated_at"] = now;
    updated = toFrontmatter(copy);
  } else {
    // Custom field under fields:
    const existingFields = { ...(task.frontmatter.fields ?? {}) };
    if (!(field in existingFields)) {
      throw new TaskUpdateError(`custom field "${field}" is not set`);
    }
    delete existingFields[field];
    const fields = Object.keys(existingFields).length > 0 ? existingFields : undefined;
    const copy = toMutable(task.frontmatter);
    copy["updated_at"] = now;
    if (fields !== undefined) {
      copy["fields"] = fields;
    } else {
      delete copy["fields"];
    }
    updated = toFrontmatter(copy);
  }

  const updatedTask: Task = { frontmatter: updated, body: task.body };
  await writeTask(locttDir, taskId, updatedTask);

  // Emit history entries
  const historyEntries = buildUnsetFieldHistory(task.frontmatter, field, now);
  if (historyEntries.length > 0) {
    await appendHistory(locttDir, taskId, historyEntries);
  }

  return updatedTask;
}

/**
 * Atomic multi-field write. Each entry is either a set (value !== undefined)
 * or an unset (value === undefined). All changes share a single timestamp,
 * the task is written once, and history entries are appended in a single
 * batch. If validation fails for any field, nothing is written.
 */
export interface SetFieldsEntry {
  readonly field: string;
  readonly value: unknown;
}

export interface SetFieldsOptions {
  readonly locttDir: string;
  readonly taskId: string;
  readonly changes: readonly SetFieldsEntry[];
  readonly workflowConfig?: WorkflowConfig;
  readonly archivedGuard?: ArchivedGuardConfigs;
  /**
   * Auto-managed fields this caller is permitted to write directly.
   *
   * Empty by default, so {@link AUTO_MANAGED_FIELDS} stays refused on
   * every existing path. The board-move path passes `board_rank`
   * because it must write it together with `status` in one change set
   * (CW-5); nothing else should widen this.
   */
  readonly allowAutoManaged?: ReadonlySet<string>;
}

/**
 * Validates a change set for {@link setFields} and
 * {@link bulkSetFields}.
 *
 * Shared so the two cannot drift on what may be written. They already
 * had: bulk's own copy omitted the required-field check, so a bulk
 * caller could overwrite `updated_at` directly — a field the
 * single-task API refuses precisely because it is stamped
 * automatically.
 *
 * `label` names the caller so the error reads correctly on both paths.
 */
export function assertChangesWritable(
  changes: readonly SetFieldsEntry[],
  label: string,
  allowAutoManaged: ReadonlySet<string> = new Set(),
): void {
  if (changes.length === 0) {
    throw new TaskUpdateError(`${label} requires at least one change`);
  }
  const seen = new Set<string>();
  for (const c of changes) {
    if (seen.has(c.field)) {
      throw new TaskUpdateError(`duplicate field in ${label}: "${c.field}"`);
    }
    seen.add(c.field);
    if (c.field === "updated_at") {
      // Before the generic immutable guard, not after it. BLK-40
      // requires the refusal to say *why*, and `completed_date` next
      // door already did.
      throw new TaskUpdateError(UPDATED_AT_REFUSAL);
    }
    if (USER_IMMUTABLE_FIELDS.has(c.field)) {
      throw new TaskUpdateError(`cannot set immutable field "${c.field}"`);
    }
    // An auto-managed field stays refused unless this caller is the
    // code that *owns* it. `board_rank` is owned by the board-move
    // path, which must write it in the same change set as `status`
    // so a cross-column drag lands atomically (CW-5/BRD-9); routing
    // that through `reorderBoardRank` instead would be two writes with
    // a half-landed state between them. The refusal is still the
    // default, so `loctt set <task> board_rank u` and every existing
    // caller behave exactly as before.
    if (AUTO_MANAGED_FIELDS.has(c.field) && !allowAutoManaged.has(c.field)) {
      throw new TaskUpdateError(
        `cannot set auto-managed field "${c.field}" directly`,
      );
    }
    if (c.value === undefined && c.field === "title") {
      throw new TaskUpdateError(`cannot unset required field "${c.field}"`);
    }
  }
}

export async function setFields(opts: SetFieldsOptions): Promise<Task> {
  assertChangesWritable(opts.changes, "setFields", opts.allowAutoManaged);
  return withStateLock(opts.locttDir, () => setFieldsLocked(opts));
}

/**
 * The write itself, assuming the state lock is already held and the
 * change set already validated.
 *
 * Exported for {@link bulkSetFields}, which holds one lock across a
 * whole batch and therefore cannot call `setFields` (withStateLock is
 * not re-entrant). Sharing this rather than reimplementing it is what
 * keeps the two paths honest — they previously diverged on unsetting
 * a missing custom field, on writing `updated_at`, and on how history
 * entries were built.
 *
 * `now` and `today` are injected so a batch stamps one timestamp and
 * one date across every task, rather than splitting a run that
 * straddles midnight. `bulkOpId`, when given, is attached to every
 * history entry so an activity feed can group them as one action.
 */
/**
 * What a deferred `setFieldsLocked` would have written.
 *
 * Everything is computed — validation has run, the archived guard has
 * passed, history is built — but nothing has touched disk. The caller
 * owns the write, which is what lets a bulk operation stage the whole
 * set and swap it in atomically (V6).
 */
export interface DeferredFieldWrite {
  readonly task: Task;
  readonly history: readonly HistoryEntry[];
}

export function setFieldsLocked(
  opts: SetFieldsOptions & {
    readonly now?: string;
    readonly today?: string;
    readonly bulkOpId?: string;
    readonly defer: true;
  },
): Promise<DeferredFieldWrite>;
export function setFieldsLocked(
  opts: SetFieldsOptions & {
    readonly now?: string;
    readonly today?: string;
    readonly bulkOpId?: string;
    readonly defer?: false;
  },
): Promise<Task>;
export async function setFieldsLocked(
  opts: SetFieldsOptions & {
    readonly now?: string;
    readonly today?: string;
    readonly bulkOpId?: string;
    readonly defer?: boolean;
  },
): Promise<Task | DeferredFieldWrite> {
  const { locttDir, taskId, changes, workflowConfig, archivedGuard } = opts;
  const task = await readTask(locttDir, taskId);
  const now = opts.now ?? new Date().toISOString();
  const patch = toMutable(task.frontmatter);
  let statusChanged = false;
  let newStatus: unknown = task.frontmatter.status;

  for (const { field, value } of changes) {
    if (field === "title") {
      if (typeof value !== "string" || value.length === 0) {
        throw new TaskUpdateError("title must be a non-empty string");
      }
      patch["title"] = value;
    } else if (field === "updated_at") {
      if (typeof value !== "string") {
        throw new TaskUpdateError("updated_at must be a string");
      }
      patch["updated_at"] = value;
    } else if (AUTO_MANAGED_FIELDS.has(field)) {
      // Reached only when the caller was granted this field above.
      // These live at the *top level* of frontmatter, so they must not
      // fall through to the custom-field branch, which would nest
      // `board_rank` under `fields:` where nothing reads it — the card
      // would render unranked and the drag would look like it did
      // nothing.
      if (value === undefined) delete patch[field];
      else patch[field] = value;
    } else if (BUILTIN_OPTIONAL_FIELDS.has(field)) {
      if (value === undefined) {
        delete patch[field];
      } else {
        // Resolve a milestone/sprint/assignee *name* to its id, exactly
        // as `setField` does at :282. Without this, `setFields` — and
        // `bulkSetFields`, which delegates here — wrote the raw string:
        //
        //   loctt set T1     milestone v1  ->  01M0SAA043ZZ1FQS…
        //   loctt set T1,T2  milestone v1  ->  v1
        //
        // Identity is a ULID (P-2), so the name form is unresolvable:
        // `doctor` reports a dangling reference, milestone progress
        // reads 0/0, and both the archived guard and `deleteUser`'s
        // reference scan match on id and so miss it entirely. This is
        // MSL-C1 (`48b2b57`) reopening on the path that fix did not
        // cover.
        patch[field] = await resolveEntityRef(locttDir, field, value, archivedGuard);
      }
      if (field === "status") {
        statusChanged = true;
        newStatus = value;
        patch["status_updated_at"] = now;
      }
    } else {
      const existingFields = (patch["fields"] as Record<string, unknown> | undefined) ?? {};
      if (value === undefined) {
        if (!(field in existingFields)) {
          throw new TaskUpdateError(`custom field "${field}" is not set`);
        }
        const next = { ...existingFields };
        delete next[field];
        if (Object.keys(next).length === 0) delete patch["fields"];
        else patch["fields"] = next;
      } else {
        patch["fields"] = { ...existingFields, [field]: value };
      }
    }
  }

  if (statusChanged) {
    const wasCompleted = isCompletedStatus(task.frontmatter.status, workflowConfig);
    const isNowCompleted = isCompletedStatus(newStatus, workflowConfig);
    if (isNowCompleted && !wasCompleted) {
      patch["completed_date"] = opts.today ?? await todayDateString(opts.locttDir);
    } else if (!isNowCompleted && wasCompleted) {
      delete patch["completed_date"];
    }
  }

  patch["updated_at"] = now;
  const updated = toFrontmatter(patch);

  if (workflowConfig) {
      // The archived guard's configs are a structural superset of
      // `AuxConfigs`, and every caller that passes one has already
      // loaded them — so existence checking costs nothing extra here.
      //
      // Without this, nothing on any write path checked that a
      // referenced project, milestone, sprint or label *exists*. Only
      // `doctor` passed `aux`, so a task could be written pointing at
      // an entity that was never created, and the user learned about it
      // from a diagnostic rather than from the write that caused it.
    // Same rule as `setField`, over every field this call names: an
    // orphaned value the batch does not touch does not block the batch
    // (TSK-29), while every value the batch *does* write is validated
    // as strictly as before.
    const errors = attributableErrors(
      task.frontmatter,
      updated,
      new Set(changes.map(c => c.field)),
      workflowConfig,
      archivedGuard,
    );
    if (errors.length > 0) throw invalidValueError(errors);
  }
  if (archivedGuard) {
    assertNotArchivedReferences(updated, task.frontmatter, archivedGuard);
  }

  const updatedTask: Task = { frontmatter: updated, body: task.body };

  const historyEntries: HistoryEntry[] = [];
  for (const { field, value } of changes) {
    const entries = value === undefined
      ? buildUnsetFieldHistory(task.frontmatter, field, now)
      : buildSetFieldHistory(task.frontmatter, field, value, now);
    historyEntries.push(...entries);
  }
  const bulkOpId = opts.bulkOpId;
  const stamped: HistoryEntry[] = bulkOpId === undefined
    ? historyEntries
    : historyEntries.map(e => ({ ...e, bulk_op_id: bulkOpId }));

  // `defer` lets a bulk caller compute every task's result before any
  // of them lands, so the whole set can be swapped into place at once
  // (V6). Everything above — validation, the archived guard, history
  // construction — has already run, so a deferred result is one that
  // would have been written.
  if (opts.defer === true) {
    return { task: updatedTask, history: stamped };
  }

  await writeTask(locttDir, taskId, updatedTask);
  if (stamped.length > 0) {
    await appendHistory(locttDir, taskId, stamped);
  }

  return updatedTask;
}

function buildUnsetFieldHistory(
  oldFm: TaskFrontmatter,
  field: string,
  timestamp: string,
): HistoryEntry[] {
  // Labels: emit label_removed for each existing label
  if (field === "labels") {
    return (oldFm.labels ?? []).map(label => ({
      timestamp,
      kind: "label_removed" as const,
      before: label,
    }));
  }

  // Custom field
  if (!BUILTIN_OPTIONAL_FIELDS.has(field)) {
    const before = oldFm.fields?.[field];
    return [{ timestamp, kind: "custom_field_change", field, before: before ?? null, after: null }];
  }

  // Built-in field
  const before = readField(oldFm, field);
  return [{ timestamp, kind: "field_change", field, before: before ?? null, after: null }];
}
