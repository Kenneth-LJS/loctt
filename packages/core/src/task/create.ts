import type { LocttState,Task, TaskFrontmatter, WorkflowConfig } from "@loctt/contracts";
import { defaultStatus } from "@loctt/contracts";
import { ulid } from "ulid";

import type { ArchivedGuardConfigs } from "../config/archived-guard.js";
import { assertNotArchivedReferences } from "../config/archived-guard.js";
import { validateTaskAgainstWorkflow } from "../config/validation.js";
import { allocateKey } from "../state/keys.js";
import { appendHistory } from "./history.js";
import { writeTask } from "./io.js";
import { clearLookupCaches } from "./lookup-cache.js";
import { invalidValueError, resolveEntityRef } from "./update.js";
import { todayDateString } from "./update.js";

/** Options for creating a new task. */
export interface CreateTaskOptions {
  readonly title: string;
  /**
   * Project the task belongs to (matches `ProjectDef.key`).
   * Required — caller must resolve the default-project rules
   * before invoking createTask.
   */
  readonly project: string;
  readonly status?: string;
  readonly task_type?: string;
  readonly priority?: string;
  readonly parent?: string;
  readonly labels?: readonly string[];
  readonly assignee?: string;
  readonly reporter?: string;
  readonly start_date?: string;
  readonly due_date?: string;
  readonly estimate?: string;
  readonly milestone?: string;
  readonly sprint?: string;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

/** Full options bag for createTask. */
export interface CreateTaskParams {
  readonly locttDir: string;
  readonly state: LocttState;
  readonly options: CreateTaskOptions;
  readonly workflowConfig?: WorkflowConfig;
  /**
   * Aux configs for archived-reference checks. When provided,
   * createTask rejects new assignments to archived project, label,
   * milestone, sprint, assignee, or reporter — the "archive blocks
   * new uses but preserves historical references" policy.
   * Callers that omit this opt out of the check (e.g. internal
   * remap/recovery paths that need to assign archived entities).
   */
  readonly archivedGuard?: ArchivedGuardConfigs;
}

/**
 * Creates a new task on disk and updates key allocation state.
 *
 * Caller is responsible for persisting the updated state afterwards.
 * Returns the created task.
 */
export async function createTask(params: CreateTaskParams): Promise<Task> {
  const { locttDir, state, options, workflowConfig, archivedGuard } = params;
  const id = ulid();
  // Each project owns its own counter in state.yaml. The project
  // key doubles as the entity-type for `allocateKey`.
  const key = allocateKey(state, options.project);
  const now = new Date().toISOString();

  // Status is effectively mandatory on a created task. Omitting it
  // used to leave the key off entirely, and a task with no `status`
  // matches neither `status = backlog` nor `status != done` — so it
  // was invisible to ordinary filtering on every surface, since all
  // three funnel through here.
  //
  // Without workflow config there is nothing to resolve a default
  // from, so the caller keeps the old behaviour rather than getting a
  // guess.
  const resolvedStatus = options.status
    ?? (workflowConfig ? defaultStatus(workflowConfig)?.key : undefined);

  // Resolve entity references to ids before they reach frontmatter.
  // `resolveEntityRef` accepts a name or an id and is the same helper
  // `setField` uses, so all three write paths now agree on what gets
  // stored.
  // The cast is confined here rather than at each call site: every
  // caller knows the field's own type, and `resolveEntityRef` returns
  // `unknown` because it handles scalars and arrays alike.
  const resolveOpt = async <T>(field: string, value: T | undefined): Promise<T | undefined> =>
    value === undefined
      ? undefined
      : (await resolveEntityRef(locttDir, field, value, archivedGuard)) as T;
  // Spread into a fresh mutable array: `options.labels` is readonly and
  // frontmatter's is not.
  const resolvedLabels = options.labels === undefined
    ? undefined
    : [...(await resolveOpt("labels", [...options.labels]) ?? [])];
  const resolvedAssignee = await resolveOpt("assignee", options.assignee);
  const resolvedReporter = await resolveOpt("reporter", options.reporter);
  const resolvedMilestone = await resolveOpt("milestone", options.milestone);
  const resolvedSprint = await resolveOpt("sprint", options.sprint);

  // Normalize parent option into a relationship edge
  const relationships: { type: string; target: string }[] = [];
  if (options.parent !== undefined) {
    relationships.push({ type: "parent", target: options.parent });
  }

  const frontmatter: TaskFrontmatter = {
    id,
    key,
    project: options.project,
    title: options.title,
    created_at: now,
    updated_at: now,
    ...(resolvedStatus !== undefined ? { status: resolvedStatus } : {}),
    ...(options.task_type !== undefined ? { task_type: options.task_type } : {}),
    ...(options.priority !== undefined ? { priority: options.priority } : {}),
    // Entity references accept a name or an id, exactly as `setField`
    // does. `createTask` used to write them raw, so `loctt create one
    // --milestone v1` stored the literal "v1" — a reference that
    // resolves to nothing, since identity is a ULID (P-2). Nothing
    // caught it, because no write path passed `aux` to the validator.
    ...(resolvedLabels !== undefined ? { labels: resolvedLabels } : {}),
    ...(resolvedAssignee !== undefined ? { assignee: resolvedAssignee } : {}),
    ...(resolvedReporter !== undefined ? { reporter: resolvedReporter } : {}),
    ...(options.start_date !== undefined ? { start_date: options.start_date } : {}),
    ...(options.due_date !== undefined ? { due_date: options.due_date } : {}),
    ...(options.estimate !== undefined ? { estimate: options.estimate } : {}),
    ...(resolvedMilestone !== undefined ? { milestone: resolvedMilestone } : {}),
    ...(resolvedSprint !== undefined ? { sprint: resolvedSprint } : {}),
    ...(options.fields !== undefined ? { fields: options.fields } : {}),
    ...(relationships.length > 0 ? { relationships } : {}),
  };

  // If the task is being created directly into a completed-category
  // status, auto-stamp completed_date so it matches the behavior of
  // setField on a status transition. Same date format (YYYY-MM-DD).
  if (workflowConfig && frontmatter.status !== undefined) {
    const statusDef = workflowConfig.statuses.find(s => s.key === frontmatter.status);
    if (statusDef?.category === "completed") {
      // Workspace timezone, not `now.slice(0, 10)`. The UTC slice stamped
      // yesterday on anything created-as-done before 08:00 local in a
      // UTC+8 workspace, and `completed_date` feeds burndown and "done
      // this week" — so the off-by-one propagated. setField has resolved
      // this in the workspace zone all along; create did not, and the
      // same field ended up following two rules.
      (frontmatter as { completed_date?: string }).completed_date =
        await todayDateString(locttDir);
    }
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
    const errors = validateTaskAgainstWorkflow(frontmatter, workflowConfig, archivedGuard);
    if (errors.length > 0) {
      // A *typed* rejection, carrying the offending field — the same
      // shape `setField` has always thrown (`invalidValueError`), and
      // for the same reason.
      //
      // This used to be a bare `Error`. It matched none of the web
      // server's error branches, so an unconfigured status or a
      // non-numeric `number` custom field escaped as a 500 with
      // `code: "unknown"` and `data_state: "unknown"`, stranding the
      // real reason in `detail`. Measured against this SHA: creating
      // with `fields.points = "not-a-number"` returned
      //   HTTP 500 {"code":"unknown","data_state":"unknown", ...}
      // while the identical value through `setField` returned
      //   HTTP 400 {"code":"validation_failed","field":"fields.points"}
      // — two write paths giving two different answers about the same
      // rejected value, and the create side violating P4 (a failure
      // must name its cause) and ERR-18 (a write must state whether
      // the data was saved).
      //
      // `invalidValueError` is shared rather than reimplemented so the
      // message rule and the single-error `field` rule cannot drift
      // between the two paths.
      throw invalidValueError(errors, "invalid task");
    }
  }

  if (archivedGuard) {
    assertNotArchivedReferences(frontmatter, undefined, archivedGuard);
  }

  const task: Task = {
    frontmatter,
    body: options.body ?? "",
  };

  await writeTask(locttDir, id, task);
  // Record what the task was created as (M3), so history reconstructs
  // the task's whole life rather than starting from its first edit.
  // Without this, replaying history from `created` yields nothing to
  // apply the later field changes to.
  await appendHistory(locttDir, id, [
    { timestamp: now, kind: "created", after: { frontmatter, body: task.body } },
  ]);
  // Invalidate any in-process "key not found" verdicts cached by
  // lookupByKey — the new task's key/key_history may now resolve.
  clearLookupCaches(locttDir);
  return task;
}
