/**
 * Task CRUD + history — read, list, create, field-update, delete.
 *
 * Domain errors (TaskUpdateError, TaskNotFoundError, …) surface as
 * errorResult through the dispatcher's outer catch, so per-handler
 * try/catches that just rethrow the same class are omitted.
 *
 * `create_task` retains the explicit withStateLock wrapper because
 * createTask in core consumes a state object the caller must
 * persist; the lock ensures that read/derive-key/save cycle is
 * atomic.
 */

import {
  buildListContext,
  buildShowModel,
  bulkMoveTasksToProject,
  bulkSetFields,
  createTask,
  DEFAULT_LIST_LIMIT,
  deleteTask,
  duplicateTask,
  listTasks,
  loadAllTasks,
  loadArchivedGuardConfigs,
  loadOptionalConfigs,
  loadState,
  lookupTask,
  readHistory,
  resolveProjectIdForUser,
  saveState,
  setField,
  unsetField,
  withStateLock,
} from "@loctt/core";
import { z } from "zod";

import { requireConfirm } from "../runtime/confirm.js";
import { errorResult, text } from "../runtime/errors.js";
import {
  validateUnsetFieldArgs,
  validateUpdateTaskArgs,
} from "../runtime/fields.js";
import { assertWorkflowEnumKey } from "../runtime/workflow-assert.js";
import type { ToolDef } from "../types.js";

export const TOOLS: readonly ToolDef[] = [
  {
    name: "get_task",
    description: "Get a task by key or ID, optionally including the markdown body. Relationship targets are returned as user-facing keys (e.g. T-2); deleted targets carry `missing: true` and retain the raw ID in `target`.",
    inputSchema: {
      ref: z.string().describe("Task key (e.g. T-1) or ID"),
      include_body: z.boolean().optional().describe("Whether to include the markdown body (default true)"),
    },
    handler: async ({ locttDir }, args) => {
      const ref = args["ref"] as string;
      const includeBody = (args["include_body"] as boolean | undefined) ?? true;
      const task = await lookupTask(locttDir, ref);
      const model = await buildShowModel(locttDir, task);
      const result: Record<string, unknown> = {
        ...model.task.frontmatter,
        relationships: model.relationships.map(r => ({
          type: r.type,
          target: r.missing ? r.target : r.resolvedKey ?? r.target,
          // Title and status save the agent a get_task per edge to
          // learn what a linked task actually is.
          ...(r.resolvedTitle !== undefined ? { title: r.resolvedTitle } : {}),
          ...(r.resolvedStatus !== undefined ? { status: r.resolvedStatus } : {}),
          ...(r.missing ? { missing: true } : {}),
        })),
        attachments: model.attachments.map(a => ({
          name: a.name,
          size: a.size,
          ...(a.mime !== undefined ? { mime: a.mime } : {}),
        })),
      };
      if (model.relationships.length === 0) {
        delete result["relationships"];
      }
      if (includeBody) result["body"] = model.task.body;
      return text(JSON.stringify(result, null, 2));
    },
  },
  {
    name: "list_tasks",
    description: "List tasks with optional query, view, and limit. Archived tasks are hidden by default; pass include_archived=true to include them. Saved views are respected as authored — they are not modified by this flag.",
    inputSchema: {
      query: z.string().optional().describe("Ad hoc query string"),
      view: z.string().optional().describe("Named saved view"),
      project: z.string().optional().describe("Filter to a specific project. AND-merges with `query` if both are supplied."),
      limit: z.number().optional().describe(`Max results (default ${DEFAULT_LIST_LIMIT})`),
      include_archived: z.boolean().optional().describe("If true, include archived tasks (default false). Ignored when a query already mentions `archived` or when a saved view is used."),
      sort: z.string().optional().describe("Field to order by, e.g. priority, due_date, updated_at. Priority orders by its configured value, not alphabetically."),
      direction: z.enum(["asc", "desc"]).optional().describe("Sort direction (default asc)."),
      offset: z.number().optional().describe("Rows to skip, for paging past the first `limit`."),
    },
    handler: async ({ locttDir }, args) => {
      const tasks = await loadAllTasks(locttDir);
      const { workflowConfig, queriesConfig, today } = await loadOptionalConfigs(locttDir);
      const projectFilter = args["project"] as string | undefined;
      const baseQuery = args["query"] as string | undefined;
      const view = args["view"] as string | undefined;
      const limit = args["limit"] as number | undefined;
      const includeArchived = args["include_archived"] as boolean | undefined;
      // Core supported both from the start; only the web exposed them,
      // so an agent wanting "the highest-priority open task" had to
      // fetch everything and order it itself (QRY-C4).
      const sortField = args["sort"] as string | undefined;
      const direction = (args["direction"] as "asc" | "desc" | undefined) ?? "asc";
      const offset = args["offset"] as number | undefined;
      // A saved view referencing a since-deleted custom field runs
      // anyway, but matches less than its author intended. An agent
      // has no stderr to read, so surface it in the response — a bare
      // short list would otherwise read as a definitive answer.
      const warnings: string[] = [];
      const result = listTasks({
        tasks,
        options: {
          ...(baseQuery !== undefined ? { query: baseQuery } : {}),
          ...(view !== undefined ? { view } : {}),
          ...(limit !== undefined ? { limit } : {}),
          ...(sortField !== undefined ? { sort: [{ field: sortField, direction }] } : {}),
          ...(projectFilter !== undefined ? { project: projectFilter } : {}),
          ...(includeArchived !== undefined ? { includeArchived } : {}),
          ...(today !== undefined ? { today } : {}),
        },
        ...(queriesConfig !== undefined ? { queriesConfig } : {}),
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        ctx: buildListContext(tasks),
        onWarning: err => warnings.push(err.message),
      });
      // `listTasks` applies `limit` but not `offset`; slicing after the
      // sort gives the same answer without changing what `limit` means.
      const paged = offset !== undefined ? result.slice(offset) : result;
      const summary = paged.map(t => ({
        key: t.frontmatter.key,
        title: t.frontmatter.title,
        status: t.frontmatter.status,
        priority: t.frontmatter.priority,
      }));
      const body = JSON.stringify(summary, null, 2);
      return text(
        warnings.length > 0
          ? `Warning: saved view "${view ?? ""}" — ${warnings.join("; ")}\nResults may be incomplete.\n\n${body}`
          : body,
      );
    },
  },
  {
    name: "create_task",
    description: "Create a new task. When the tracker has multiple projects, pass `project` to disambiguate; otherwise the workspace default (or the only project) is used.",
    inputSchema: {
      title: z.string(),
      project: z.string().optional().describe("Project key (slug). Optional when a default project is configured or only one project exists."),
      status: z.string().optional(),
      priority: z.string().optional(),
      task_type: z.string().optional(),
      body: z.string().optional(),
    },
    handler: async ({ locttDir }, args) => {
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      let projectKey: string;
      try {
        projectKey = await resolveProjectIdForUser(
          locttDir,
          args["project"] as string | undefined,
        );
      } catch (err) {
        return errorResult((err as Error).message);
      }
      const status = args["status"] as string | undefined;
      const priority = args["priority"] as string | undefined;
      const taskType = args["task_type"] as string | undefined;
      const body = args["body"] as string | undefined;
      const enumCheck = assertWorkflowEnumKey(workflowConfig, "status", status)
        ?? assertWorkflowEnumKey(workflowConfig, "priority", priority)
        ?? assertWorkflowEnumKey(workflowConfig, "task_type", taskType);
      if (enumCheck) return enumCheck;
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
            title: args["title"] as string,
            ...(status !== undefined ? { status } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(taskType !== undefined ? { task_type: taskType } : {}),
            ...(body !== undefined ? { body } : {}),
          },
        });
        await saveState(locttDir, state);
        return created;
      });
      return text(`Created ${task.frontmatter.key}: ${task.frontmatter.title}`);
    },
  },
  {
    name: "update_task",
    description:
      "Set a field on a task. Writable built-in fields: title, status, " +
      "task_type, priority, labels, assignee, reporter, start_date, due_date, " +
      "estimate, milestone, sprint. Any other field is treated as a custom " +
      "field (must be declared in workflow.yaml under custom_fields). " +
      "These fields are managed elsewhere and rejected here: id, key, " +
      "created_at, project (immutable); relationships (use link_tasks / " +
      "unlink_tasks); archived / archived_at (use archive_task / " +
      "unarchive_task); status_updated_at (auto-stamped on status change); " +
      "completed_date and board_rank (auto-managed).",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      field: z.string(),
      value: z.unknown().describe("The value to set"),
    },
    handler: async ({ locttDir }, args) => {
      const invalid = validateUpdateTaskArgs(args);
      if (invalid) return invalid;
      const task = await lookupTask(locttDir, args["ref"] as string);
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const field = args["field"] as string;
      const value = args["value"];
      const updated = await setField({
        locttDir,
        taskId: task.frontmatter.id,
        field,
        value,
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        archivedGuard,
      });
      return text(`Updated ${updated.frontmatter.key}: set ${field} = ${JSON.stringify(value)}`);
    },
  },
  {
    name: "unset_field",
    description:
      "Remove a field from a task. Same allowlist as update_task: writable " +
      "built-ins (status/priority/etc.) and declared custom fields. The " +
      "system-managed fields rejected by update_task are also rejected here. " +
      "title and updated_at cannot be unset (they are required).",
    inputSchema: {
      ref: z.string().describe("Task key or ID"),
      field: z.string(),
    },
    handler: async ({ locttDir }, args) => {
      const invalid = validateUnsetFieldArgs(args);
      if (invalid) return invalid;
      const task = await lookupTask(locttDir, args["ref"] as string);
      const field = args["field"] as string;
      const updated = await unsetField(locttDir, task.frontmatter.id, field);
      return text(`Updated ${updated.frontmatter.key}: unset ${field}`);
    },
  },
  {
    name: "move_task",
    description:
      "Move one or more tasks to another project. The key is reallocated " +
      "under the target project; the old key is retired into key_history " +
      "and stays resolvable, so existing references keep working. Pass " +
      "several refs to move them as one operation.",
    inputSchema: {
      refs: z.array(z.string()).min(1).max(500).describe("Task keys or IDs"),
      project: z.string().describe("Target project key or ID"),
    },
    handler: async ({ locttDir }, args) => {
      const refs = args["refs"] as string[];
      const project = args["project"] as string;
      try {
        const targetProjectId = await resolveProjectIdForUser(locttDir, project);
        const result = await bulkMoveTasksToProject({
          locttDir, taskRefs: refs, targetProjectId,
        });
        const lines = [`Moved ${result.succeeded.length}, failed ${result.failed.length}`];
        for (const s of result.succeeded) lines.push(`  ${s.oldKey} → ${s.newKey}`);
        for (const f of result.failed) lines.push(`  ${f.taskId}: ${f.error}`);
        return text(lines.join("\n"));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  },
  {
    name: "duplicate_task",
    description:
      "Create a copy of a task with a fresh key. Copies title (suffixed " +
      "\"(copy)\" unless overridden), status, priority, type, assignee, " +
      "reporter, dates, estimate, milestone, sprint, labels, custom fields " +
      "and body. Deliberately does NOT copy relationships, attachments, or " +
      "archived state — the copy starts unlinked and active.",
    inputSchema: {
      ref: z.string().describe("Task key or ID to copy"),
      title: z.string().optional().describe("Title for the copy; defaults to '<source> (copy)'"),
      project: z.string().optional().describe("Target project; defaults to the source's"),
    },
    handler: async ({ locttDir }, args) => {
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const title = args["title"] as string | undefined;
      const project = args["project"] as string | undefined;
      try {
        const created = await withStateLock(locttDir, async () => {
          const state = await loadState(locttDir);
          const task = await duplicateTask({
            locttDir,
            state,
            sourceRef: args["ref"] as string,
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
        return text(`Created ${created.frontmatter.key}: ${created.frontmatter.title}`);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    },
  },
  {
    name: "bulk_update_tasks",
    description:
      "Set or clear one field across many tasks in a single operation. " +
      "Prefer this over repeated update_task calls when changing the same " +
      "field on several tasks: it runs under one lock, stamps every " +
      "history entry with a shared bulk_op_id so the change reads as one " +
      "action, and reports per-task outcomes instead of failing at the " +
      "first bad ref. Omit `value` (or pass null) to CLEAR the field. " +
      "Same field allowlist as update_task.",
    inputSchema: {
      refs: z.array(z.string()).min(1).max(500)
        .describe("Task keys or IDs. Capped at 500 — one bulk op holds the tracker lock for its whole run."),
      field: z.string(),
      value: z.unknown().optional()
        .describe("The value to set. Omit or pass null to clear the field."),
    },
    handler: async ({ locttDir }, args) => {
      const refs = args["refs"] as string[];
      const field = args["field"] as string;
      const raw = args["value"];
      const { workflowConfig } = await loadOptionalConfigs(locttDir);
      const archivedGuard = await loadArchivedGuardConfigs(locttDir);
      const result = await bulkSetFields({
        locttDir,
        taskRefs: refs,
        // null and omitted both mean "clear" — core reads `undefined`
        // as the unset, and JSON cannot carry undefined.
        changes: [{ field, value: raw === null ? undefined : raw }],
        ...(workflowConfig !== undefined ? { workflowConfig } : {}),
        archivedGuard,
      });
      const lines = [
        `${result.succeeded.length} updated, ${result.failed.length} failed (bulk_op_id ${result.bulk_op_id})`,
      ];
      for (const f of result.failed) lines.push(`  ${f.taskId}: ${f.error}`);
      return text(lines.join("\n"));
    },
  },
  {
    name: "delete_task",
    description:
      "Permanently remove a task directory. Use `archive_task` for the reversible (soft) " +
      "variant. Always requires `confirm: true`.",
    inputSchema: {
      ref: z.string(),
      confirm: z.boolean().optional().describe("Required: must be true to proceed"),
    },
    handler: async ({ locttDir }, args) => {
      const blocked = requireConfirm(args, "delete_task");
      if (blocked) return blocked;
      const task = await lookupTask(locttDir, args["ref"] as string);
      await deleteTask(locttDir, task.frontmatter.id, { force: true });
      return text(`Deleted ${task.frontmatter.key}.`);
    },
  },
  {
    name: "get_task_history",
    description: "Get the activity/history log for a task. Returns structured entries (newest first).",
    inputSchema: {
      ref: z.string().describe("Task key (e.g. T-1) or ID"),
      limit: z.number().optional().describe("Max entries to return (default: all)"),
    },
    handler: async ({ locttDir }, args) => {
      const task = await lookupTask(locttDir, args["ref"] as string);
      const entries = await readHistory(locttDir, task.frontmatter.id);
      entries.reverse();
      const limit = args["limit"] as number | undefined;
      const display = limit !== undefined ? entries.slice(0, limit) : entries;
      return text(JSON.stringify(display, null, 2));
    },
  },
];
