import type { WorkflowConfig } from "@loctt/contracts";
import {
  appendTaskBody,
  bodyToken,
  buildListContext,
  buildShowModel,
  bulkMoveTasksToProject,
  bulkSetFields,
  createTask,
  deleteTask,
  duplicateTask,
  listTasks,
  loadAllTasks,
  loadAllUsers,
  loadArchivedGuardConfigs,
  loadLabelsConfig,
  loadMilestonesConfig,
  loadOptionalConfigs,
  loadProjectsConfig,
  loadSprintsConfig,
  loadState,
  loadWorkflowConfig,
  lookupTask,
  moveTaskToProject,
  readHistory,
  readTaskBody,
  resolveLocttDir,
  resolveProjectIdForUser,
  resolveProjectIdFromInput,
  saveState,
  setField,
  unsetField,
  withStateLock,
  writeTaskBody,
} from "@loctt/core";

import type { HistoryDisplayContext } from "../format/history.js";
import { formatHistoryEntry } from "../format/history.js";
import { getArg, getNonNegativeIntArg, hasFlag, rejectUnknownFlags } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, UsageError } from "../runtime/errors.js";
import { assertWorkflowEnumKey } from "../runtime/workflow-assert.js";

/**
 * Task CRUD commands. Each function runs the body that was
 * previously inline in `index.ts`'s case switch; the dispatcher
 * routes via these names.
 */

/**
 * Accepted flags per command, so an unrecognised one is refused rather
 * than dropped. The parser's extractors (`getArg`/`hasFlag`) are pure
 * lookups and cannot notice a flag nobody asked about, so a typo used to
 * mean the command ran without it — `delete T-1 --hard --yes` deleted,
 * and two e2e tests passed `--hard` for years while the reference doc
 * said no such flag exists.
 *
 * `rejectUnknownFlags` adds `--cwd` itself and stops at `--`.
 */
const TASK_CREATE_FLAGS: readonly string[] = [
  "--project", "--status", "--priority", "--type",
  // Core's createTask has accepted these from the start; exposing only
  // the first four meant a create had to be followed by `set` calls for
  // the rest, and MCP accepted a different subset again (TSK-C5).
  "--assignee", "--reporter", "--due", "--start", "--estimate",
  "--milestone", "--sprint", "--label", "--body",
];
const TASK_LIST_FLAGS: readonly string[] = ["--limit", "--project", "--archived", "--query", "--view", "--sort", "--dir", "--offset"];
const TASK_SHOW_FLAGS: readonly string[] = [];
const TASK_DUPLICATE_FLAGS: readonly string[] = ["--title", "--project"];
const TASK_MOVE_FLAGS: readonly string[] = [];
const TASK_SET_FLAGS: readonly string[] = [];
const TASK_UNSET_FLAGS: readonly string[] = [];
const TASK_DELETE_CMD_FLAGS: readonly string[] = ["--yes"];
const TASK_BODY_FLAGS: readonly string[] = ["--set", "--append", "--token", "--expect"];
const TASK_LOG_FLAGS: readonly string[] = ["--limit", "--offset"];

export async function create(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_CREATE_FLAGS);
  const title = args[1];
  if (!title) throw new UsageError("missing title", "loctt create <title>");
  const locttDir = resolveLocttDir(root);
  const { workflowConfig } = await loadOptionalConfigs(locttDir);

  // Resolve target project via the shared chain: explicit
  // > per-user default > workspace default > sole project.
  const explicit = getArg(args, "--project");
  const projectKey = await resolveProjectIdForUser(locttDir, explicit);

  const status = getArg(args, "--status");
  const priority = getArg(args, "--priority");
  const taskType = getArg(args, "--type");
  assertWorkflowEnumKey(workflowConfig, "status", status);
  assertWorkflowEnumKey(workflowConfig, "priority", priority);
  assertWorkflowEnumKey(workflowConfig, "task_type", taskType);

  // Repeatable: `--label a --label b`. getArg returns the last, so the
  // raw argv is scanned for every occurrence.
  const labels: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--label" && args[i + 1] !== undefined) labels.push(args[i + 1] as string);
  }
  const assignee = getArg(args, "--assignee");
  const reporter = getArg(args, "--reporter");
  const dueDate = getArg(args, "--due");
  const startDate = getArg(args, "--start");
  const estimate = getArg(args, "--estimate");
  const milestone = getArg(args, "--milestone");
  const sprint = getArg(args, "--sprint");
  const body = getArg(args, "--body");

  const archivedGuard = await loadArchivedGuardConfigs(locttDir);
  const task = await withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const created = await createTask({
      locttDir,
      state,
      ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      archivedGuard,
      options: {
        project: projectKey,
        title,
        ...(status !== undefined ? { status } : {}),
        ...(priority !== undefined ? { priority } : {}),
        ...(taskType !== undefined ? { task_type: taskType } : {}),
        ...(assignee !== undefined ? { assignee } : {}),
        ...(reporter !== undefined ? { reporter } : {}),
        ...(dueDate !== undefined ? { due_date: dueDate } : {}),
        ...(startDate !== undefined ? { start_date: startDate } : {}),
        ...(estimate !== undefined ? { estimate } : {}),
        ...(milestone !== undefined ? { milestone } : {}),
        ...(sprint !== undefined ? { sprint } : {}),
        ...(labels.length > 0 ? { labels } : {}),
        ...(body !== undefined ? { body } : {}),
      },
    });
    await saveState(locttDir, state);
    return created;
  });
  console.log(`Created ${task.frontmatter.key}: ${task.frontmatter.title}`);
}

export async function list(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_LIST_FLAGS);
  const locttDir = resolveLocttDir(root);
  const tasks = await loadAllTasks(locttDir);
  const { workflowConfig, queriesConfig, today } = await loadOptionalConfigs(locttDir);

  const limit = getNonNegativeIntArg(args, "--limit");

  // `--project <name|id>` is a structured filter; passing it as an option
  // keeps user-supplied values away from the query parser so ones
  // containing operators or spaces can't break parsing.
  //
  // Resolve it to an id rather than forwarding the raw string: tasks
  // reference their project by ULID (P-2), so a name could never match
  // and the command reported "No tasks found." with exit 0 — identical
  // to a project that genuinely has no tasks, and to one that does not
  // exist at all. `resolveProjectIdFromInput` is the id-or-name
  // primitive, and unlike `resolveProjectIdForUser` it applies no
  // defaulting: an absent filter means every project, not the default one.
  const projectArg = getArg(args, "--project");
  let projectFilter: string | undefined;
  if (projectArg !== undefined) {
    const projectsConfig = await loadProjectsConfig(locttDir);
    projectFilter = resolveProjectIdFromInput(projectsConfig, projectArg, {
      includeArchived: hasFlag(args, "--archived"),
    });
  }
  const baseQuery = getArg(args, "--query");

  const view = getArg(args, "--view");

  // Core supported sort and offset from the start; only the web exposed
  // them, so an agent wanting "the highest-priority open task" had to
  // fetch everything and order it itself (QRY-C4).
  const sortField = getArg(args, "--sort");
  const dirArg = getArg(args, "--dir");
  if (dirArg !== undefined && dirArg !== "asc" && dirArg !== "desc") {
    throw new UsageError(`--dir must be asc or desc, got: ${dirArg}`);
  }
  // Narrowed into a typed const rather than asserted inline: the check
  // above proves the union, but eslint's no-unnecessary-type-assertion
  // strips an inline `as` and the widened `string` then fails the
  // ListOptions signature under exactOptionalPropertyTypes.
  const direction: "asc" | "desc" = dirArg === "desc" ? "desc" : "asc";
  const sort = sortField !== undefined
    ? [{ field: sortField, direction }]
    : undefined;

  let offset: number | undefined;
  const offsetArg = getArg(args, "--offset");
  if (offsetArg !== undefined) {
    offset = Number(offsetArg);
    if (Number.isNaN(offset) || offset < 0 || !Number.isInteger(offset)) {
      throw new UsageError("--offset must be a non-negative integer");
    }
  }

  const result = listTasks({
    tasks,
    options: {
      ...(baseQuery !== undefined ? { query: baseQuery } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(sort !== undefined ? { sort } : {}),
      ...(projectFilter !== undefined ? { project: projectFilter } : {}),
      includeArchived: hasFlag(args, "--archived"),
      ...(today !== undefined ? { today } : {}),
    },
    ...(queriesConfig !== undefined ? { queriesConfig } : {}),
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
    ctx: buildListContext(tasks),
    // A saved view referencing a since-deleted custom field still
    // runs (breaking existing trackers would be worse), but the
    // results are narrower than the view's author intended — so say
    // so. stderr keeps the task list on stdout pipeable.
    onWarning: err => {
      console.error(`Warning: saved view "${view ?? ""}" — ${err.message}`);
    },
  });

  // `listTasks` applies `limit` but not `offset` — only
  // `listTasksPaginated` does, and switching to it here would change the
  // `total` semantics the rest of this command relies on. Slicing after
  // the sort gives the same answer.
  const page = offset !== undefined ? result.slice(offset) : result;

  if (page.length === 0) {
    console.log("No tasks found.");
  } else {
    for (const task of page) {
      const status = task.frontmatter.status ? ` [${task.frontmatter.status}]` : "";
      console.log(`${task.frontmatter.key}  ${task.frontmatter.title}${status}`);
    }
  }
}

/**
 * Resolves an entity id to its configured name for display.
 *
 * Returns the input unchanged when the entity is missing — a task
 * pointing at a deleted milestone should show the dangling value rather
 * than hide the reference entirely.
 */
async function nameOfEntity(
  locttDir: string,
  kind: "milestones" | "sprints" | "labels",
  id: string,
): Promise<string> {
  try {
    const cfg = kind === "milestones"
      ? (await loadMilestonesConfig(locttDir)).milestones
      : kind === "sprints"
        ? (await loadSprintsConfig(locttDir)).sprints
        : (await loadLabelsConfig(locttDir)).labels;
    return (cfg as { id: string; name: string }[]).find(e => e.id === id)?.name ?? id;
  } catch {
    return id;
  }
}

/**
 * Loads the workflow config and user roster once per `log` invocation so
 * the formatter can render labels and display names instead of stored
 * keys and ULIDs.
 *
 * Both loads are best-effort: a tracker whose workflow.yaml is being
 * edited, or whose users/ directory is unreadable, should still be able
 * to show its history. The formatter falls back to raw values for
 * whichever half is missing.
 */
async function buildHistoryDisplayContext(
  locttDir: string,
): Promise<HistoryDisplayContext> {
  const ctx: { workflow?: WorkflowConfig; users?: Map<string, string> } = {};
  try {
    ctx.workflow = await loadWorkflowConfig(locttDir);
  } catch {
    // Leave undefined — raw keys render unmarked, since without the
    // config we cannot tell a valid key from a drifted one.
  }
  try {
    const users = await loadAllUsers(locttDir);
    // K26/O5: a user's name is now degradable — a corrupt profile may
    // have none. Fall back to the id so a nameless actor still renders as
    // something (its id), never `undefined`.
    ctx.users = new Map(users.map(u => [u.id, u.name ?? u.id]));
  } catch {
    // Leave undefined — actor ids render in place of names.
  }
  return ctx;
}

export async function show(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_SHOW_FLAGS);
  const ref = args[1];
  if (!ref) throw new UsageError("missing task ref", "loctt show <task>");
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  // Load configs so extrinsic health (invalid_value / dangling) is
  // classified alongside intrinsic health. The archived-guard configs are
  // a structural superset of AuxConfigs, so they double as `aux`.
  const { workflowConfig } = await loadOptionalConfigs(locttDir);
  const aux = await loadArchivedGuardConfigs(locttDir);
  const model = await buildShowModel(locttDir, task, {
    ...(workflowConfig !== undefined ? { workflow: workflowConfig } : {}),
    aux,
  });

  console.log(`${model.task.frontmatter.key}: ${model.task.frontmatter.title ?? "(no title)"}`);
  const fm = model.task.frontmatter;
  if (fm.status) console.log(`Status: ${fm.status}`);
  if (fm.priority) console.log(`Priority: ${fm.priority}`);
  if (fm.task_type) console.log(`Type: ${fm.task_type}`);
  if (fm.assignee) console.log(`Assignee: ${fm.assignee}`);
  if (fm.reporter) console.log(`Reporter: ${fm.reporter}`);
  if (fm.start_date) console.log(`Start: ${fm.start_date}`);
  if (fm.due_date) console.log(`Due: ${fm.due_date}`);
  if (fm.completed_date) console.log(`Completed: ${fm.completed_date}`);
  if (fm.estimate !== undefined) console.log(`Estimate: ${String(fm.estimate)}`);
  // Milestones and sprints are stored by id (P-2); a ULID on screen is
  // no more useful than the omission this replaces (P-4), so resolve
  // back to the configured name. Falls back to the raw value when the
  // entity is gone, which is a drift signal rather than a blank.
  if (fm.milestone) {
    console.log(`Milestone: ${await nameOfEntity(locttDir, "milestones", fm.milestone)}`);
  }
  if (fm.sprint) {
    console.log(`Sprint: ${await nameOfEntity(locttDir, "sprints", fm.sprint)}`);
  }
  if (fm.labels && fm.labels.length > 0) {
    const names = await Promise.all(
      fm.labels.map(l => nameOfEntity(locttDir, "labels", l)),
    );
    console.log(`Labels: ${names.join(", ")}`);
  }
  if (fm.fields && Object.keys(fm.fields).length > 0) {
    for (const [k, v] of Object.entries(fm.fields)) {
      console.log(`${k}: ${String(v)}`);
    }
  }
  if (fm.archived) console.log(`Archived: ${fm.archived_at}`);
  if (model.relationships.length > 0) {
    console.log(`Relationships:`);
    for (const r of model.relationships) {
      const display = r.missing
        ? `${r.target.slice(0, 8)}… (deleted)`
        : r.resolvedKey ?? r.target;
      // Title and status make the line readable on its own — "blocks
      // T-2" says less than "blocks T-2  Fix login  [in_progress]".
      const detail = r.missing
        ? ""
        : [r.resolvedTitle, r.resolvedStatus ? `[${r.resolvedStatus}]` : undefined]
            .filter(Boolean).join("  ");
      console.log(`  ${r.type} → ${display}${detail ? `  ${detail}` : ""}`);
    }
  }
  // REL-49: an unreadable `attachments/` degrades **this section** and
  // nothing else. Silence here would say "no attachments" about a
  // directory that may be full — the conflation the core fix removed,
  // reintroduced one layer up.
  if (model.attachmentsError !== undefined) {
    console.log(`Attachments: could not be read — ${model.attachmentsError}`);
  } else if (model.attachments.length > 0) {
    console.log(`Attachments:`);
    for (const a of model.attachments) {
      console.log(`  ${a.name} (${a.size} bytes)`);
    }
  }
  // Field-level health (proposal § 6). A degraded field is not in
  // `frontmatter`; its stored value is printed from `rawText` so the user
  // can see what is there and repair it with `loctt set` / `loctt unset`.
  //
  // A dangling relationship *target* is already rendered (truncated) in
  // the Relationships section above, so it is filtered out here — showing
  // it again would duplicate the row and leak the full 26-char target
  // ULID that K22 deliberately truncates. Any other rawText that is a
  // bare ULID is truncated as defence-in-depth.
  const truncateUlids = (s: string): string =>
    s.replace(/\b[0-9A-HJKMNP-TV-Z]{26}\b/gi, m => `${m.slice(0, 8)}…`);
  const health = (model.task.health ?? []).filter(
    h => !(h.kind === "dangling" && /^relationships\[\d+\]\.target$/.test(h.field)),
  );
  if (health.length > 0) {
    const unrecognised = health.filter(h => h.kind === "unrecognised");
    const needsAttention = health.filter(h => h.kind !== "unrecognised");
    if (needsAttention.length > 0) {
      console.log(`\nNeeds attention:`);
      for (const h of needsAttention) {
        console.log(`  ⚠ ${h.field}: ${truncateUlids(h.rawText)} — ${truncateUlids(h.error)}`);
      }
    }
    if (unrecognised.length > 0) {
      console.log(`\nNot recognised:`);
      for (const h of unrecognised) {
        console.log(`  ${h.field}: ${truncateUlids(h.rawText)}`);
      }
    }
  }
  if (model.task.body.trim()) {
    console.log(`\n${model.task.body}`);
  }
}

/**
 * `loctt duplicate <task> [--title <t>] [--project <p>]`
 *
 * Copies field values and body to a new task with a fresh key.
 * Relationships and attachments are deliberately not copied — see
 * `duplicateTask`'s contract — so the copy starts unlinked.
 */
export async function duplicate(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_DUPLICATE_FLAGS);
  const ref = args[1];
  if (!ref) {
    throw new UsageError("missing args", "loctt duplicate <task> [--title <t>] [--project <p>]");
  }
  const locttDir = resolveLocttDir(root);
  const { workflowConfig } = await loadOptionalConfigs(locttDir);
  const archivedGuard = await loadArchivedGuardConfigs(locttDir);
  const title = getArg(args, "--title");
  // Resolve a name to an id before handing it to core (P-3). Forwarding
  // the raw string put a name into the slot `allocateKey` expects an id
  // in, so `--project Backend` failed with `no key allocation state for
  // entity type "Backend"` — an allocator internal that named neither
  // the flag nor the remedy, and that a nonexistent project produced
  // byte-identically. `create` and `move` have always resolved first.
  const projectArg = getArg(args, "--project");
  const project =
    projectArg === undefined
      ? undefined
      : resolveProjectIdFromInput(await loadProjectsConfig(locttDir), projectArg);

  const created = await withStateLock(locttDir, async () => {
    const state = await loadState(locttDir);
    const task = await duplicateTask({
      locttDir,
      state,
      sourceRef: ref,
      ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      archivedGuard,
      overrides: {
        ...(title !== undefined ? { title } : {}),
        ...(project !== undefined ? { project } : {}),
      },
    });
    await saveState(locttDir, state);
    return task;
  });
  console.log(`Created ${created.frontmatter.key}: ${created.frontmatter.title}`);
}

/**
 * `loctt move <task>[,<task>...] <project>`
 *
 * Moving reallocates the key under the target project, so the task's
 * old key is retired into `key_history` and stays resolvable — a
 * bookmark or a link written before the move keeps working.
 */
export async function move(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_MOVE_FLAGS);
  const ref = args[1];
  const project = args[2];
  if (!ref || !project) {
    throw new UsageError("missing args", "loctt move <task>[,<task>...] <project>");
  }
  const locttDir = resolveLocttDir(root);
  const targetProjectId = await resolveProjectIdForUser(locttDir, project);
  const refs = splitRefs(ref);

  if (refs.length > 1) {
    const result = await bulkMoveTasksToProject({ locttDir, taskRefs: refs, targetProjectId });
    console.log(`Moved ${result.succeeded.length} task(s) to ${project}`);
    for (const s of result.succeeded) console.log(`  ${s.oldKey} → ${s.newKey}`);
    if (result.failed.length > 0) {
      console.error(`${result.failed.length} failed:`);
      for (const f of result.failed) console.error(`  ${f.taskId}: ${f.error}`);
      process.exitCode = EXIT.RUNTIME;
    }
    return;
  }

  const result = await moveTaskToProject({
    locttDir, taskRef: refs[0] as string, targetProjectId,
  });
  console.log(`Moved ${result.oldKey} → ${result.newKey}`);
}

export async function set(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_SET_FLAGS);
  const ref = args[1];
  const field = args[2];
  const value = args[3];
  if (!ref || !field || value === undefined) {
    throw new UsageError("missing args", "loctt set <task> <field> <value>");
  }
  const locttDir = resolveLocttDir(root);
  const { workflowConfig } = await loadOptionalConfigs(locttDir);
  const archivedGuard = await loadArchivedGuardConfigs(locttDir);
  const refs = splitRefs(ref);

  // The enum check used to run first, so `set T-999 status doing` on an
  // absent task blamed the status vocabulary and exited 2 (usage) rather
  // than 1 (domain) — sending the user to fix the wrong thing. MCP
  // already ordered it the other way (TSK-C3).
  //
  // Bulk keeps the pre-check: it resolves refs internally and reports
  // per-task failures, so an unknown enum there is genuinely a usage
  // error about the whole command rather than about one task.
  const assertEnum = (): void => {
    if (field === "status" || field === "priority" || field === "task_type") {
      assertWorkflowEnumKey(workflowConfig, field, value);
    }
  };

  if (refs.length > 1) {
    assertEnum();
    const result = await bulkSetFields({
      locttDir,
      taskRefs: refs,
      changes: [{ field, value }],
      ...(workflowConfig !== undefined ? { workflowConfig } : {}),
      archivedGuard,
    });
    reportBulk(`Set ${field} = ${value}`, result);
    return;
  }

  const task = await lookupTask(locttDir, refs[0] as string);
  assertEnum();
  await setField({
    locttDir,
    taskId: task.frontmatter.id,
    field,
    value,
    ...(workflowConfig !== undefined ? { workflowConfig } : {}),
    archivedGuard,
  });
  console.log(`Set ${field} = ${value} on ${task.frontmatter.key}`);
}

/**
 * Splits `T-1,T-2` into refs. A single ref is the overwhelmingly
 * common case and keeps the single-task code path, which reports a
 * friendlier message than a one-item bulk result.
 *
 * Empty segments are dropped so a trailing comma is not an error.
 */
function splitRefs(raw: string): string[] {
  return raw.split(",").map(r => r.trim()).filter(Boolean);
}

/**
 * Prints a bulk result. Failures are listed individually and set a
 * non-zero exit code, so a script does not read a partial success as
 * a complete one.
 */
function reportBulk(
  action: string,
  result: { succeeded: readonly string[]; failed: readonly { taskId: string; error: string }[] },
): void {
  console.log(`${action} on ${result.succeeded.length} task(s)`);
  if (result.failed.length > 0) {
    console.error(`${result.failed.length} failed:`);
    for (const f of result.failed) console.error(`  ${f.taskId}: ${f.error}`);
    process.exitCode = EXIT.RUNTIME;
  }
}

export async function unset(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_UNSET_FLAGS);
  const ref = args[1];
  const field = args[2];
  if (!ref || !field) {
    throw new UsageError("missing args", "loctt unset <task> <field>");
  }
  const locttDir = resolveLocttDir(root);
  const refs = splitRefs(ref);

  if (refs.length > 1) {
    // `value: undefined` is core's spelling for a clear, so the same
    // bulk primitive covers unset — no second bulk function needed.
    const { workflowConfig } = await loadOptionalConfigs(locttDir);
    const result = await bulkSetFields({
      locttDir,
      taskRefs: refs,
      changes: [{ field, value: undefined }],
      ...(workflowConfig !== undefined ? { workflowConfig } : {}),
    });
    reportBulk(`Unset ${field}`, result);
    return;
  }

  const task = await lookupTask(locttDir, refs[0] as string);
  await unsetField(locttDir, task.frontmatter.id, field);
  console.log(`Unset ${field} on ${task.frontmatter.key}`);
}

/**
 * `loctt delete <task>` — permanent removal. Uses the confirm
 * prompt's three-state outcome to map cleanly to exit codes:
 * declined → SUCCESS, refused (non-interactive without --yes) →
 * USAGE. The lookup happens inside runCommand so a missing task
 * surfaces as a domain error, not as bubbling unhandled.
 */
export async function deleteCmd(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_DELETE_CMD_FLAGS);
  const ref = args[1];
  if (!ref) {
    throw new UsageError("missing task ref", "loctt delete <task> [--yes]");
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  const outcome = await confirmHardDelete(
    args,
    `Permanently delete task ${task.frontmatter.key}? (use 'loctt archive' for a reversible alternative)`,
  );
  if (outcome !== "yes") {
    process.exitCode = outcome === "refused" ? EXIT.USAGE : EXIT.SUCCESS;
    return;
  }
  await deleteTask(locttDir, task.frontmatter.id, { force: true });
  console.log(`Deleted ${task.frontmatter.key}`);
}

/**
 * Whether this tracker opts every `loctt body` write into the K10
 * precondition (`cli.require_body_token` in workflow.yaml).
 *
 * **A config that cannot be read answers `false`, deliberately.** The
 * setting's default is off, and `body --set` has never needed
 * workflow.yaml at all — reading it here to decide an opt-in must not
 * turn an unrelated broken config into a failed body write. Measured:
 * without this, `loctt body T-1 --set x` against a tracker with
 * malformed YAML exited 1 where it previously succeeded.
 *
 * The direction is the safe one: an unreadable config cannot silently
 * *enable* a guard either, and every other command that needs
 * workflow.yaml still reports the parse error itself.
 */
async function requiresBodyToken(locttDir: string): Promise<boolean> {
  try {
    return (await loadWorkflowConfig(locttDir)).cli?.require_body_token === true;
  } catch {
    return false;
  }
}

export async function body(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_BODY_FLAGS);
  const ref = args[1];
  if (!ref) {
    throw new UsageError(
      "missing task ref",
      "loctt body <task> [--set <text>] [--append <text>] [--expect <token>] [--token]",
    );
  }
  const newBody = getArg(args, "--set");
  const appendText = getArg(args, "--append");
  if (newBody !== undefined && appendText !== undefined) {
    throw new UsageError("--set and --append are mutually exclusive");
  }
  const wantToken = hasFlag(args, "--token");
  const expected = getArg(args, "--expect");
  if (wantToken && (newBody !== undefined || appendText !== undefined)) {
    throw new UsageError("--token reads the current token; it cannot be combined with a write");
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  if (wantToken) {
    // Bare token on stdout so `--expect "$(loctt body T-1 --token)"`
    // works without the caller having to strip a label.
    console.log(await bodyToken(locttDir, task.frontmatter.id));
    return;
  }
  if (newBody !== undefined || appendText !== undefined) {
    // K10: last-write-wins is the CLI default. `--expect` opts in per
    // command; `cli.require_body_token` in workflow.yaml opts the whole
    // workspace in, and then a write without `--expect` is refused
    // rather than silently falling back to clobbering.
    if (expected === undefined && await requiresBodyToken(locttDir)) {
      throw new UsageError(
        "this tracker requires a body-write token (cli.require_body_token in workflow.yaml)",
        `loctt body ${ref} --expect "$(loctt body ${ref} --token)" --set <text>`,
      );
    }
    const opts = expected === undefined ? {} : { expectedToken: expected };
    if (newBody !== undefined) {
      await writeTaskBody(locttDir, task.frontmatter.id, newBody + "\n", opts);
      console.log(`Updated body for ${task.frontmatter.key}`);
    } else {
      await appendTaskBody(locttDir, task.frontmatter.id, appendText as string, opts);
      console.log(`Appended to body for ${task.frontmatter.key}`);
    }
  } else if (expected !== undefined) {
    throw new UsageError("--expect applies to a write; pass --set or --append");
  } else {
    const taskBody = await readTaskBody(locttDir, task.frontmatter.id);
    if (taskBody.trim()) {
      console.log(taskBody);
    } else {
      console.log("(empty body)");
    }
  }
}

export async function log(args: string[], root: string): Promise<void> {
  rejectUnknownFlags(args, TASK_LOG_FLAGS);
  const ref = args[1];
  if (!ref) {
    throw new UsageError("missing task ref", "loctt log <task> [--limit <n>] [--offset <n>]");
  }
  const limit = getNonNegativeIntArg(args, "--limit");
  // Without offset a long history is reachable only from its newest
  // end: the older entries are on disk and nothing can display them
  // (CMT-C4). readHistory has supported offset all along.
  let offset: number | undefined;
  const offsetArg = getArg(args, "--offset");
  // `--offset -1` reaches here as undefined: getArg treats a leading `-`
  // as the next flag rather than a value, so a bare `--offset` looks
  // identical to one that was never passed. Catch the present-but-empty
  // case explicitly rather than silently paging from 0.
  if (offsetArg === undefined && args.includes("--offset")) {
    throw new UsageError("--offset needs a non-negative integer value");
  }
  if (offsetArg !== undefined) {
    offset = Number(offsetArg);
    if (Number.isNaN(offset) || offset < 0 || !Number.isInteger(offset)) {
      throw new UsageError("--offset must be a non-negative integer");
    }
  }

  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);

  const entries = await readHistory(locttDir, task.frontmatter.id);
  // Reverse first: offset counts from the newest entry, which is what
  // the display order is and therefore what a pager means by "skip 2".
  const reversed = [...entries].reverse();
  const fromOffset = offset !== undefined ? reversed.slice(offset) : reversed;
  const display = limit !== undefined ? fromOffset.slice(0, limit) : fromOffset;

  if (display.length === 0) {
    console.log("No history entries.");
  } else {
    const ctx = await buildHistoryDisplayContext(locttDir);
    for (const entry of display) {
      console.log(formatHistoryEntry(entry, ctx));
    }
  }
}
