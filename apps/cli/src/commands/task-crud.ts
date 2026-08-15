import {
  appendTaskBody,
  buildListContext,
  buildShowModel,
  bulkSetFields,
  createTask,
  deleteTask,
  listTasks,
  loadAllTasks,
  loadArchivedGuardConfigs,
  loadOptionalConfigs,
  loadState,
  lookupTask,
  readHistory,
  readTaskBody,
  resolveLocttDir,
  resolveProjectIdForUser,
  saveState,
  setField,
  unsetField,
  withStateLock,
  writeTaskBody,
} from "@loctt/core";

import { formatHistoryEntry } from "../format/history.js";
import { getArg, hasFlag } from "../runtime/args.js";
import { confirmHardDelete } from "../runtime/confirm.js";
import { EXIT, UsageError } from "../runtime/errors.js";
import { assertWorkflowEnumKey } from "../runtime/workflow-assert.js";

/**
 * Task CRUD commands. Each function runs the body that was
 * previously inline in `index.ts`'s case switch; the dispatcher
 * routes via these names.
 */

export async function create(args: string[], root: string): Promise<void> {
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
      },
    });
    await saveState(locttDir, state);
    return created;
  });
  console.log(`Created ${task.frontmatter.key}: ${task.frontmatter.title}`);
}

export async function list(args: string[], root: string): Promise<void> {
  const locttDir = resolveLocttDir(root);
  const tasks = await loadAllTasks(locttDir);
  const { workflowConfig, queriesConfig, today } = await loadOptionalConfigs(locttDir);

  let limit: number | undefined;
  const limitArg = getArg(args, "--limit");
  if (limitArg !== undefined) {
    limit = Number(limitArg);
    if (Number.isNaN(limit) || limit < 0 || !Number.isInteger(limit)) {
      throw new UsageError("--limit must be a non-negative integer");
    }
  }

  // `--project <key>` is a structured filter; passing it as
  // an option keeps user-supplied project keys away from the
  // query parser so values containing operators or spaces
  // can't break parsing.
  const projectFilter = getArg(args, "--project");
  const baseQuery = getArg(args, "--query");

  const view = getArg(args, "--view");
  const result = listTasks({
    tasks,
    options: {
      ...(baseQuery !== undefined ? { query: baseQuery } : {}),
      ...(view !== undefined ? { view } : {}),
      ...(limit !== undefined ? { limit } : {}),
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

  if (result.length === 0) {
    console.log("No tasks found.");
  } else {
    for (const task of result) {
      const status = task.frontmatter.status ? ` [${task.frontmatter.status}]` : "";
      console.log(`${task.frontmatter.key}  ${task.frontmatter.title}${status}`);
    }
  }
}

export async function show(args: string[], root: string): Promise<void> {
  const ref = args[1];
  if (!ref) throw new UsageError("missing task ref", "loctt show <task>");
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  const model = await buildShowModel(locttDir, task);

  console.log(`${model.task.frontmatter.key}: ${model.task.frontmatter.title}`);
  const fm = model.task.frontmatter;
  if (fm.status) console.log(`Status: ${fm.status}`);
  if (fm.priority) console.log(`Priority: ${fm.priority}`);
  if (fm.task_type) console.log(`Type: ${fm.task_type}`);
  if (fm.assignee) console.log(`Assignee: ${fm.assignee}`);
  if (fm.due_date) console.log(`Due: ${fm.due_date}`);
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
  if (model.attachments.length > 0) {
    console.log(`Attachments:`);
    for (const a of model.attachments) {
      console.log(`  ${a.name} (${a.size} bytes)`);
    }
  }
  if (model.task.body.trim()) {
    console.log(`\n${model.task.body}`);
  }
}

export async function set(args: string[], root: string): Promise<void> {
  const ref = args[1];
  const field = args[2];
  const value = args[3];
  if (!ref || !field || value === undefined) {
    throw new UsageError("missing args", "loctt set <task> <field> <value>");
  }
  const locttDir = resolveLocttDir(root);
  const { workflowConfig } = await loadOptionalConfigs(locttDir);
  // Pre-validate enum-typed fields against the workflow config
  // so the CLI can surface a friendly "known values" hint
  // instead of letting the core throw a generic update error.
  if (field === "status" || field === "priority" || field === "task_type") {
    assertWorkflowEnumKey(workflowConfig, field, value);
  }
  const archivedGuard = await loadArchivedGuardConfigs(locttDir);
  const refs = splitRefs(ref);

  if (refs.length > 1) {
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

export async function body(args: string[], root: string): Promise<void> {
  const ref = args[1];
  if (!ref) {
    throw new UsageError(
      "missing task ref",
      "loctt body <task> [--set <text>] [--append <text>]",
    );
  }
  const newBody = getArg(args, "--set");
  const appendText = getArg(args, "--append");
  if (newBody !== undefined && appendText !== undefined) {
    throw new UsageError("--set and --append are mutually exclusive");
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);
  if (newBody !== undefined) {
    await writeTaskBody(locttDir, task.frontmatter.id, newBody + "\n");
    console.log(`Updated body for ${task.frontmatter.key}`);
  } else if (appendText !== undefined) {
    await appendTaskBody(locttDir, task.frontmatter.id, appendText);
    console.log(`Appended to body for ${task.frontmatter.key}`);
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
  const ref = args[1];
  if (!ref) {
    throw new UsageError("missing task ref", "loctt log <task> [--limit <n>]");
  }
  let limit: number | undefined;
  const limitArg = getArg(args, "--limit");
  if (limitArg !== undefined) {
    limit = Number(limitArg);
    if (Number.isNaN(limit) || limit < 0 || !Number.isInteger(limit)) {
      throw new UsageError("--limit must be a non-negative integer");
    }
  }
  const locttDir = resolveLocttDir(root);
  const task = await lookupTask(locttDir, ref);

  const entries = await readHistory(locttDir, task.frontmatter.id);
  const reversed = [...entries].reverse();
  const display = limit !== undefined ? reversed.slice(0, limit) : reversed;

  if (display.length === 0) {
    console.log("No history entries.");
  } else {
    for (const entry of display) {
      console.log(formatHistoryEntry(entry));
    }
  }
}
