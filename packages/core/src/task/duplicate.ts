import type { LocttState, Task, WorkflowConfig } from "@loctt/contracts";

import type { ArchivedGuardConfigs } from "../config/archived-guard.js";
import { createTask, type CreateTaskOptions } from "./create.js";
import { lookupTask } from "./lookup.js";

/**
 * Optional overrides applied on top of the source task's fields when
 * duplicating. Any field present here replaces the source value; omitted
 * fields fall through. Pass `null` for a scalar field to explicitly clear
 * it on the copy (e.g. drop assignee or milestone).
 */
export interface DuplicateTaskOverrides {
  readonly title?: string;
  readonly project?: string;
  readonly status?: string | null;
  readonly priority?: string | null;
  readonly task_type?: string | null;
  readonly assignee?: string | null;
  readonly reporter?: string | null;
  readonly milestone?: string | null;
  readonly sprint?: string | null;
  readonly labels?: readonly string[];
  readonly start_date?: string | null;
  readonly due_date?: string | null;
  readonly estimate?: string | null;
  readonly fields?: Readonly<Record<string, unknown>>;
  readonly body?: string;
}

/** Parameters for duplicateTask. */
export interface DuplicateTaskParams {
  readonly locttDir: string;
  readonly state: LocttState;
  /** Source task reference: id, current key, or any prior key in key_history. */
  readonly sourceRef: string;
  /** Optional overrides applied on top of the source's fields. */
  readonly overrides?: DuplicateTaskOverrides;
  readonly workflowConfig?: WorkflowConfig;
  readonly archivedGuard?: ArchivedGuardConfigs;
}

/**
 * Creates a new task copying field values from `sourceRef`. The copy
 * gets a fresh id and a fresh key allocated under the source's project
 * (or the override's project, when supplied). Caller persists the
 * updated state afterwards.
 *
 * **What is copied** from the source's frontmatter:
 *   - title (suffixed with " (copy)" unless an explicit `overrides.title`)
 *   - status, priority, task_type
 *   - assignee, reporter
 *   - start_date, due_date, estimate
 *   - milestone, sprint
 *   - labels (deep-copied)
 *   - fields (custom fields, deep-copied)
 *   - body
 *
 * **What is NOT copied** (always fresh):
 *   - id (new ULID)
 *   - key (newly allocated in the destination project)
 *   - created_at, updated_at (now)
 *   - status_updated_at, completed_date (recomputed by createTask)
 *   - relationships (no links; user re-links if desired)
 *   - key_history (none — fresh key)
 *   - attachments (the copy starts with none)
 *   - archived / archived_at (the copy starts active)
 *
 * History on the new task: one `created` entry, same as a regular
 * createTask. Source task is untouched.
 */
/**
 * The result of a duplicate (DUP-H1). `dropped` names the source fields
 * that were corrupt (lifted into `src.health`) and so were NOT carried
 * into the copy — never a raw corrupt value copied in (§ 13.3), but the
 * caller can now tell the user which fields did not come across, instead
 * of handing back a silently-cleaner copy.
 */
export interface DuplicateResult {
  readonly task: Task;
  /** Source field names that were corrupt and not copied. Empty if none. */
  readonly dropped: readonly string[];
}

export async function duplicateTask(params: DuplicateTaskParams): Promise<DuplicateResult> {
  const { locttDir, state, sourceRef, overrides = {}, workflowConfig, archivedGuard } = params;
  const src = await lookupTask(locttDir, sourceRef);
  const fm = src.frontmatter;

  // `null` in an override means "drop this field on the copy"; `undefined`
  // means "inherit from source". Distinguish them precisely.
  function inherit<T>(override: T | null | undefined, source: T | undefined): T | undefined {
    if (override === null) return undefined;
    if (override !== undefined) return override;
    return source;
  }

  // A corrupt field is lifted off `frontmatter` into `src.health`, so
  // reading `fm.<field>` here copies only HEALTHY values into the new
  // task — a raw corrupt value is never carried in (§ 13.3). A degraded
  // title falls back to the key so the copy title is never "undefined
  // (copy)".
  const srcTitle = fm.title ?? fm.key;
  const createOptions: CreateTaskOptions = {
    title: overrides.title ?? `${srcTitle} (copy)`,
    project: overrides.project ?? fm.project ?? "",
    ...(inherit(overrides.status, fm.status) !== undefined ? { status: inherit(overrides.status, fm.status) as string } : {}),
    ...(inherit(overrides.priority, fm.priority) !== undefined ? { priority: inherit(overrides.priority, fm.priority) as string } : {}),
    ...(inherit(overrides.task_type, fm.task_type) !== undefined ? { task_type: inherit(overrides.task_type, fm.task_type) as string } : {}),
    ...(inherit(overrides.assignee, fm.assignee) !== undefined ? { assignee: inherit(overrides.assignee, fm.assignee) as string } : {}),
    ...(inherit(overrides.reporter, fm.reporter) !== undefined ? { reporter: inherit(overrides.reporter, fm.reporter) as string } : {}),
    ...(inherit(overrides.start_date, fm.start_date) !== undefined ? { start_date: inherit(overrides.start_date, fm.start_date) as string } : {}),
    ...(inherit(overrides.due_date, fm.due_date) !== undefined ? { due_date: inherit(overrides.due_date, fm.due_date) as string } : {}),
    ...(inherit(overrides.estimate, fm.estimate) !== undefined ? { estimate: inherit(overrides.estimate, fm.estimate) as string } : {}),
    ...(inherit(overrides.milestone, fm.milestone) !== undefined ? { milestone: inherit(overrides.milestone, fm.milestone) as string } : {}),
    ...(inherit(overrides.sprint, fm.sprint) !== undefined ? { sprint: inherit(overrides.sprint, fm.sprint) as string } : {}),
    ...(overrides.labels !== undefined
      ? { labels: [...overrides.labels] }
      : (fm.labels && fm.labels.length > 0 ? { labels: [...fm.labels] } : {})),
    ...(overrides.fields !== undefined
      ? { fields: { ...overrides.fields } }
      : (fm.fields ? { fields: { ...fm.fields } } : {})),
    body: overrides.body ?? src.body,
  };

  if (!createOptions.project) {
    // A wrong-typed `project` is lifted into health, so `fm.project` is
    // undefined here — duplicate must read it to allocate the copy's key,
    // so it refuses (§ 13.3) rather than minting a key under a broken
    // project. Name the corruption when that is the cause.
    const projectCorrupt = (src.health ?? []).some(h => h.field === "project");
    throw new Error(
      projectCorrupt
        ? "duplicateTask: source task's project is corrupt; repair it or pass --project"
        : "duplicateTask: source task has no project and no override was supplied",
    );
  }

  const task = await createTask({
    locttDir,
    state,
    options: createOptions,
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
    ...(archivedGuard !== undefined ? { archivedGuard } : {}),
  });

  // DUP-H1: the corrupt source fields that were not carried into the copy.
  // A health finding names a dropped field UNLESS the caller supplied it as
  // an override (then it was set from the override, not dropped). The
  // health field path may be `due_date` or `fields.points` or `labels[2]`;
  // report the top-level field the user would recognise.
  const overridden = new Set(
    Object.entries(overrides)
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k),
  );
  const dropped = [
    ...new Set(
      (src.health ?? [])
        .map(h => h.field.replace(/\[.*$/, "").replace(/^fields\./, ""))
        .filter(f => !overridden.has(f) && !overridden.has(`fields.${f}`)),
    ),
  ];

  return { task, dropped };
}
