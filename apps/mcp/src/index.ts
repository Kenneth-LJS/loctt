// @loctt/mcp — MCP server for LocTT
// Provides structured tools for task management via Model Context Protocol.

import { access } from "node:fs/promises";

import {
  archiveLabel,
  archiveMilestone,
  archiveProject,
  archiveSprint,
  archiveUser,
  buildListContext,
  buildShowModel,
  BurndownError,
  CONFIG_KEYS,
  createLabel,
  createMilestone,
  createProject,
  createSprint,
  createTask,
  createUser,
  DEFAULT_LIST_LIMIT,
  deleteLabel,
  deleteMilestone,
  deleteProject,
  deleteSprint,
  deleteTask,
  deleteUser,
  disableGit,
  editLabel,
  editMilestone,
  editProject,
  editSprint,
  enableGit,
  getConfigValue,
  getCurrentUser,
  getGitStatus,
  LabelError,
  listTasks,
  loadAllTasks,
  loadAllUsers,
  loadArchivedGuardConfigs,
  loadCalendarConfig,
  loadLabelsConfig,
  loadMilestonesConfig,
  loadOptionalConfigs,
  loadProjectsConfig,
  loadQueriesConfig,
  loadSprintsConfig,
  loadState,
  loadWorkflowConfig,
  lookupTask,
  MilestoneError,
  ProjectError,
  publish,
  readBurndownSeries,
  readHistory,
  requireSupportedSchema,
  resolveLocttDir,
  resolveProjectKeyForUser,
  resolveUserRef,
  saveState,
  setConfigValue,
  setDefaultProject,
  setField,
  SprintError,
  switchCurrentUser,
  sync,
  TaskUpdateError,
  unarchiveLabel,
  unarchiveMilestone,
  unarchiveProject,
  unarchiveSprint,
  unarchiveUser,
  unsetConfigValue,
  unsetField,
  updateUser,
  UserError,
  withStateLock,
} from "@loctt/core";
import { z } from "zod";

import { listRegisteredTools, lookupTool, stripHandler } from "./registry.js";
import { requireConfirm } from "./runtime/confirm.js";
import { errorResult, isKnownDomainError, text } from "./runtime/errors.js";
import {
  validateUnsetFieldArgs,
  validateUpdateTaskArgs,
} from "./runtime/fields.js";
import { SCHEMA_GUARD_EXEMPT_TOOLS } from "./runtime/schema-guard.js";
import { assertWorkflowEnumKey } from "./runtime/workflow-assert.js";
import type { McpTool, McpToolResult } from "./types.js";

export type { McpTool, McpToolResult } from "./types.js";

/**
 * Returns the list of available MCP tools. During the gradual
 * registry migration this concatenates the legacy in-file array
 * with the registry-resident tools; once the migration completes
 * the function body becomes just `listRegisteredTools().map(stripHandler)`.
 */
export function getTools(): McpTool[] {
  return [
    ...listRegisteredTools().map(stripHandler),
    {
      name: "get_task",
      description: "Get a task by key or ID, optionally including the markdown body. Relationship targets are returned as user-facing keys (e.g. T-2); deleted targets carry `missing: true` and retain the raw ID in `target`.",
      inputSchema: {
        ref: z.string().describe("Task key (e.g. T-1) or ID"),
        include_body: z.boolean().optional().describe("Whether to include the markdown body (default true)"),
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
      },
    },
    {
      name: "list_views",
      description: "List available saved views from queries.yaml.",
      inputSchema: {},
    },
    {
      name: "get_workflow_config",
      description: "Get the workflow configuration.",
      inputSchema: {},
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
    },
    {
      name: "enable_git",
      description: "Enables git-backed mode for this tracker. Sets up a dedicated loctt branch for task data on a sparse worktree. Only call when the user has explicitly asked to share tasks across machines or set up sync — this is one-time infrastructure setup, not a routine task operation.",
      inputSchema: {},
    },
    {
      name: "disable_git",
      description: "Disables git-backed mode for this tracker. Local task data is preserved.",
      inputSchema: {},
    },
    {
      name: "get_git_status",
      description: "Returns structured JSON describing git-backed mode state (enabled, branch, remote, auto_push, auto_fetch, in_git_repo, last_synced_commit).",
      inputSchema: {},
    },
    {
      name: "publish_to_git",
      description: "Commits the current task state to the local loctt branch and (if remote+auto_push are set) pushes to remote. Call when the user has indicated they want to share or sync tasks — not speculatively after routine task edits.",
      inputSchema: {},
    },
    {
      name: "sync_from_git",
      description: "Pulls the loctt branch state into the local workspace. If a remote is configured and auto_fetch is set, fetches first. Call when the user wants to bring in changes from another machine.",
      inputSchema: {},
    },
    {
      name: "get_config_value",
      description: "Reads a machine-local config value (currently git.* keys). Returns structured JSON {key, value, type} with the value preserving its native type.",
      inputSchema: {
        key: z.string().describe("Config key (e.g. git.enabled, git.remote)."),
      },
    },
    {
      name: "set_config_value",
      description: "Changes machine-local config (currently git.* keys only). Echo the change you're making in your response so the user can see what was adjusted. Don't call speculatively — only when the user has indicated they want to change a setting.",
      inputSchema: {
        key: z.string(),
        value: z.string().describe("Stringified value; booleans accept true/false/1/0/yes/no."),
      },
    },
    {
      name: "unset_config_value",
      description: "Restores a machine-local config key to its default. Echo the change so the user can see what was reset. Don't call speculatively — only when the user has indicated they want to revert a setting.",
      inputSchema: {
        key: z.string(),
      },
    },
    {
      name: "list_config_values",
      description: "Lists all known config keys with their current values, types, and descriptions. Returns structured JSON array.",
      inputSchema: {},
    },
    {
      name: "get_task_history",
      description: "Get the activity/history log for a task. Returns structured entries (newest first).",
      inputSchema: {
        ref: z.string().describe("Task key (e.g. T-1) or ID"),
        limit: z.number().optional().describe("Max entries to return (default: all)"),
      },
    },
    {
      name: "list_projects",
      description: "List projects defined in projects.yaml. Returns each project's key, label, prefix, and which (if any) is the workspace default.",
      inputSchema: {},
    },
    {
      name: "create_project",
      description: "Create a new project. Project keys are immutable; prefixes must be unique across the tracker. Setting `make_default` true also sets the workspace default.",
      inputSchema: {
        key: z.string().describe("Slug identifier (lowercase letters, digits, hyphen, underscore)"),
        label: z.string().describe("Human-readable label"),
        prefix: z.string().describe("Task-key prefix, e.g. BACKEND-"),
        make_default: z.boolean().optional().describe("If true, also set this project as the workspace default"),
      },
    },
    {
      name: "edit_project",
      description: "Edit an existing project. Only `label` is mutable — `key` and `prefix` are immutable after creation.",
      inputSchema: {
        key: z.string(),
        label: z.string().describe("New label"),
      },
    },
    {
      name: "delete_project",
      description:
        "Permanently remove a project from projects.yaml. For projects with tasks, " +
        "`remap_to` is required to migrate them to another project. Cannot delete the only " +
        "project. The counter is preserved in retired_keys so a later create with the same " +
        "key resumes numbering. Use `archive_project` for the reversible (soft) variant. " +
        "Always requires `confirm: true`.",
      inputSchema: {
        key: z.string(),
        confirm: z.boolean().optional().describe("Required: must be true to proceed"),
        remap_to: z.string().optional().describe("Target project key for tasks in the deleted project"),
      },
    },
    {
      name: "archive_project",
      description: "Mark a project as archived. Archived projects are hidden from default lists and pickers. Reversible via `unarchive_project`.",
      inputSchema: { key: z.string() },
    },
    {
      name: "unarchive_project",
      description: "Clear the archived flag on a project.",
      inputSchema: { key: z.string() },
    },
    {
      name: "set_default_project",
      description: "Set or clear the workspace default project. Pass `key` to set, or omit it to clear the default.",
      inputSchema: {
        key: z.string().optional(),
      },
    },
    {
      name: "list_users",
      description: "List registered users. By default, archived users are hidden; pass include_archived=true to include them.",
      inputSchema: {
        include_archived: z.boolean().optional(),
      },
    },
    {
      name: "get_current_user",
      description: "Returns the currently active user's profile.",
      inputSchema: {},
    },
    {
      name: "switch_user",
      description: "Switches the active user. Accepts either a UUID or an exact name (when unambiguous).",
      inputSchema: {
        ref: z.string().describe("User UUID or exact name"),
      },
    },
    {
      name: "create_user",
      description: "Creates a new user. Names are not unique (UUIDs disambiguate). Timezone defaults to the system timezone. Avatars are not settable via MCP — use the CLI or web UI.",
      inputSchema: {
        name: z.string(),
        email: z.string().optional(),
        timezone: z.string().optional(),
        switch_to_on_create: z.boolean().optional(),
      },
    },
    {
      name: "edit_user",
      description: "Edit an existing user's profile fields. Avatars are not settable via MCP — use the CLI or web UI.",
      inputSchema: {
        ref: z.string(),
        name: z.string().optional(),
        email: z.string().nullable().optional().describe("Pass null to clear"),
        timezone: z.string().optional(),
      },
    },
    {
      name: "archive_user",
      description: "Archives (soft-deletes) a user. Hides them from pickers without breaking historical task references. Blocked when target is the active user.",
      inputSchema: {
        ref: z.string(),
      },
    },
    {
      name: "unarchive_user",
      description: "Reverses archive_user — clears the archived flag.",
      inputSchema: {
        ref: z.string(),
      },
    },
    {
      name: "delete_user",
      description: "Hard-deletes a user. When the user has task references (assignee/reporter), exactly one of `remap_to` or `unassign` is required. Mutually exclusive. Blocked when target is the active user. Requires confirm: true.",
      inputSchema: {
        ref: z.string(),
        confirm: z.boolean().optional().describe("Required: must be true to proceed"),
        remap_to: z.string().optional().describe("Target user UUID/name to migrate references onto"),
        unassign: z.boolean().optional().describe("Clear assignee/reporter on affected tasks"),
      },
    },
    {
      name: "list_labels",
      description: "List labels defined in labels.yaml.",
      inputSchema: {},
    },
    {
      name: "get_calendar",
      description: "Returns the workspace calendar config (timezone, working days, holidays). Read-only — calendar is configured via the UI.",
      inputSchema: {},
    },
    {
      name: "list_sprints",
      description: "List sprints defined in sprints.yaml.",
      inputSchema: {},
    },
    {
      name: "create_sprint",
      description: "Register a new sprint with start/end dates and a state (active|completed|future).",
      inputSchema: {
        key: z.string(),
        label: z.string(),
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
        state: z.enum(["active", "completed", "future"]),
        goal: z.string().optional(),
      },
    },
    {
      name: "edit_sprint",
      description:
        "Edit a sprint. Pass null goal to clear. Re-opening a completed sprint " +
        "(state: 'completed' -> 'active' or 'future') is blocked by default; pass " +
        "force: true to override.",
      inputSchema: {
        key: z.string(),
        label: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        state: z.enum(["active", "completed", "future"]).optional(),
        goal: z.string().nullable().optional(),
        force: z.boolean().optional(),
      },
    },
    {
      name: "delete_sprint",
      description:
        "Permanently remove a sprint from sprints.yaml. The `sprint` field on each affected " +
        "task is unset or remapped via `remap_to`. Use `archive_sprint` for the reversible " +
        "(soft) variant. Always requires `confirm: true`.",
      inputSchema: {
        key: z.string(),
        confirm: z.boolean().optional().describe("Required: must be true to proceed"),
        remap_to: z.string().optional().describe("Target sprint key for affected tasks"),
      },
    },
    {
      name: "archive_sprint",
      description: "Mark a sprint as archived. Reversible via `unarchive_sprint`.",
      inputSchema: { key: z.string() },
    },
    {
      name: "unarchive_sprint",
      description: "Clear the archived flag on a sprint.",
      inputSchema: { key: z.string() },
    },
    {
      name: "list_milestones",
      description: "List milestones defined in milestones.yaml.",
      inputSchema: {},
    },
    {
      name: "create_milestone",
      description: "Register a new milestone with optional target date.",
      inputSchema: {
        key: z.string(),
        label: z.string(),
        target_date: z.string().optional().describe("YYYY-MM-DD"),
      },
    },
    {
      name: "edit_milestone",
      description: "Edit a milestone. Pass null target_date to clear.",
      inputSchema: {
        key: z.string(),
        label: z.string().optional(),
        target_date: z.string().nullable().optional(),
        archived: z.boolean().optional(),
      },
    },
    {
      name: "delete_milestone",
      description:
        "Permanently remove a milestone from milestones.yaml. The `milestone` field on each " +
        "affected task is unset or remapped via `remap_to`. Use `archive_milestone` for the " +
        "reversible (soft) variant. Always requires `confirm: true`.",
      inputSchema: {
        key: z.string(),
        confirm: z.boolean().optional().describe("Required: must be true to proceed"),
        remap_to: z.string().optional().describe("Target milestone key for affected tasks"),
      },
    },
    {
      name: "archive_milestone",
      description: "Mark a milestone as archived. Reversible via `unarchive_milestone`.",
      inputSchema: { key: z.string() },
    },
    {
      name: "unarchive_milestone",
      description: "Clear the archived flag on a milestone.",
      inputSchema: { key: z.string() },
    },
    {
      name: "create_label",
      description: "Register a new label. Keys are immutable; pass --label and optional --color.",
      inputSchema: {
        key: z.string(),
        label: z.string(),
        color: z.string().optional(),
      },
    },
    {
      name: "edit_label",
      description: "Edit a label's display name or color. The key is immutable.",
      inputSchema: {
        key: z.string(),
        label: z.string().optional(),
        color: z.string().nullable().optional().describe("Pass null to clear"),
      },
    },
    {
      name: "delete_label",
      description:
        "Permanently remove a label from labels.yaml; the key is dropped from every task's " +
        "labels array (or remapped via `remap_to`). Use `archive_label` for the reversible " +
        "(soft) variant. Always requires `confirm: true`.",
      inputSchema: {
        key: z.string(),
        confirm: z.boolean().optional().describe("Required: must be true to proceed"),
        remap_to: z.string().optional().describe("Target label key for affected tasks"),
      },
    },
    {
      name: "archive_label",
      description: "Mark a label as archived. Reversible via `unarchive_label`.",
      inputSchema: { key: z.string() },
    },
    {
      name: "unarchive_label",
      description: "Clear the archived flag on a label.",
      inputSchema: { key: z.string() },
    },
    {
      name: "get_sprint_burndown",
      description: "Return the burndown series for a sprint, reconstructed from task history. The response carries the daily 'remaining' total across the sprint window, the unit being summed (points/hours/weighted-enum/task-count), the initial total at sprint start, the ideal straight-line, and per-day incomplete task counts. Scope changes (tasks joining or leaving the sprint mid-run) appear as visible steps in the series.",
      inputSchema: {
        key: z.string().describe("Sprint key (e.g. 's1' / 'sprint_2026.q1')"),
      },
    },
  ];
}

/**
 * Memoized tool list — `getTools()` rebuilds the full ~50-tool array
 * on every call, which would be O(N) per executeTool dispatch. The
 * tool definitions are referentially pure (no config-conditional
 * registration) so caching once at module load is safe; if that
 * assumption ever changes (e.g. config-gated tools), this needs a
 * cache-bust hook.
 */
const ALL_TOOLS: readonly McpTool[] = getTools();

/**
 * Lazy cache of `z.object(tool.inputSchema).strict()` per tool name.
 * Built once on first lookup and reused. We use `.strict()` so an
 * agent that invents a field name (e.g. typo'd `tite` for `title`)
 * gets a clean rejection instead of a silently-ignored field that
 * cascades into a downstream missing-required error.
 *
 * Note: while validation guarantees the shape, individual handlers
 * still bracket-access `args` and cast at the use site
 * (`args["ref"] as string`). Removing those casts requires a
 * larger refactor (replace the `Record<string, unknown>` parameter
 * with the inferred zod type per case) and was deferred from this
 * chunk.
 */
const TOOL_ARG_SCHEMAS = new Map<string, z.ZodObject<Record<string, z.ZodTypeAny>>>();

function getToolArgSchema(name: string): z.ZodObject<Record<string, z.ZodTypeAny>> | undefined {
  let schema = TOOL_ARG_SCHEMAS.get(name);
  if (schema !== undefined) return schema;
  const tool = ALL_TOOLS.find(t => t.name === name);
  if (tool === undefined) return undefined;
  schema = z.object(tool.inputSchema).strict();
  TOOL_ARG_SCHEMAS.set(name, schema);
  return schema;
}

/**
 * Validates `args` against the tool's declared `inputSchema`. On
 * success, returns the parsed (and strictly-typed) object. On
 * failure, returns a structured error result the dispatcher can
 * surface to the agent with field paths and per-field reasons.
 *
 * Tools whose inputSchema is `{}` (no inputs) get a no-op pass.
 */
function parseToolArgs(
  name: string,
  args: Record<string, unknown>,
): { ok: true; value: Record<string, unknown> } | { ok: false; result: McpToolResult } {
  const schema = getToolArgSchema(name);
  if (schema === undefined) {
    // Unknown tool — let the dispatcher's default branch produce
    // the canonical "Unknown tool: …" error.
    return { ok: true, value: args };
  }
  const parsed = schema.safeParse(args);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const detail = parsed.error.issues
    .map(i => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`)
    .join("; ");
  return {
    ok: false,
    result: errorResult(`invalid args for ${name}: ${detail}`),
  };
}

/**
 * Returns true when the directory exists. Used as an inexpensive
 * existence check before applying the schema guard so we don't
 * mask "no .loctt directory" with "missing .schema-version".
 */
async function dirExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Executes an MCP tool call. */
export async function executeTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const locttDir = resolveLocttDir(root);

  // Tools migrated to the registry are dispatched first; everything
  // else falls through to the legacy in-file switch below. During
  // the gradual migration both paths coexist; once every tool is
  // moved the switch + parseToolArgs go away.
  const registered = lookupTool(name);
  if (registered !== undefined) {
    if (!registered.exemptFromSchemaGuard && (await dirExists(locttDir))) {
      try {
        await requireSupportedSchema(locttDir);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
    const schema = z.object(registered.inputSchema).strict();
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map(i => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`)
        .join("; ");
      return errorResult(`invalid args for ${name}: ${detail}`);
    }
    try {
      return await registered.handler({ root, locttDir }, parsed.data);
    } catch (err) {
      if (isKnownDomainError(err)) return errorResult(err.message);
      throw err;
    }
  }

  // Boot guard — refuse to run tools against a tracker whose
  // schema doesn't match this MCP server's expectations. The agent
  // sees a clear error pointing at `loctt migrate` rather than
  // partial reads against an unfamiliar schema.
  if (!SCHEMA_GUARD_EXEMPT_TOOLS.has(name) && (await dirExists(locttDir))) {
    try {
      await requireSupportedSchema(locttDir);
    } catch (err) {
      return errorResult((err as Error).message);
    }
  }

  // Validate args against the tool's declared inputSchema before
  // dispatch. Catches missing required fields, wrong types, and
  // (because we use .strict()) unknown field names.
  //
  // We replace `args` with the parsed result so handlers below
  // see the validated shape. Reassigning the parameter is
  // intentional: every later reference (`args["ref"]` etc.) reads
  // from the parsed object, never the raw caller input.
  const validated = parseToolArgs(name, args);
  if (!validated.ok) return validated.result;
  args = validated.value;

  try {
    switch (name) {
      case "get_task": {
        const ref = args["ref"] as string;
        const includeBody = (args["include_body"] as boolean) ?? true;
        const task = await lookupTask(locttDir, ref);
        const model = await buildShowModel(locttDir, task);
        const result: Record<string, unknown> = {
          ...model.task.frontmatter,
          relationships: model.relationships.map(r => ({
            type: r.type,
            target: r.missing ? r.target : r.resolvedKey ?? r.target,
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
      }

      case "list_tasks": {
        const tasks = await loadAllTasks(locttDir);
        const { workflowConfig, queriesConfig } = await loadOptionalConfigs(locttDir);

        // `project` is a structured filter (not concatenated into
        // the query string) so agent-supplied project keys can't
        // confuse the query parser.
        const projectFilter = args["project"] as string | undefined;
        const baseQuery = args["query"] as string | undefined;
        const view = args["view"] as string | undefined;
        const limit = args["limit"] as number | undefined;
        const includeArchived = args["include_archived"] as boolean | undefined;
        const result = listTasks({
          tasks,
          options: {
            ...(baseQuery !== undefined ? { query: baseQuery } : {}),
            ...(view !== undefined ? { view } : {}),
            ...(limit !== undefined ? { limit } : {}),
            ...(projectFilter !== undefined ? { project: projectFilter } : {}),
            ...(includeArchived !== undefined ? { includeArchived } : {}),
          },
          ...(queriesConfig !== undefined ? { queriesConfig } : {}),
          ...(workflowConfig !== undefined ? { workflowConfig } : {}),
          ctx: buildListContext(tasks),
        });

        const summary = result.map(t => ({
          key: t.frontmatter.key,
          title: t.frontmatter.title,
          status: t.frontmatter.status,
          priority: t.frontmatter.priority,
        }));
        return text(JSON.stringify(summary, null, 2));
      }

      case "list_views": {
        try {
          const config = await loadQueriesConfig(locttDir);
          return text(JSON.stringify(config.queries.map(q => ({
            name: q.name,
            query: q.query,
          })), null, 2));
        } catch {
          return text("No saved views configured.");
        }
      }

      case "get_workflow_config": {
        const config = await loadWorkflowConfig(locttDir);
        return text(JSON.stringify(config, null, 2));
      }

      case "create_task": {
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        // Resolve target project via the shared chain: explicit
        // > per-user default > workspace default > sole project.
        let projectKey: string;
        try {
          projectKey = await resolveProjectKeyForUser(
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
        // Validate enum keys against the workflow at the boundary so
        // the agent gets a "Known: ..." hint instead of the deeper
        // generic "invalid task" string createTask would throw.
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
      }

      case "update_task": {
        const invalid = validateUpdateTaskArgs(args);
        if (invalid) return invalid;
        const task = await lookupTask(locttDir, args["ref"] as string);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const archivedGuard = await loadArchivedGuardConfigs(locttDir);
        const field = args["field"] as string;
        const value = args["value"];
        try {
          const updated = await setField({
            locttDir,
            taskId: task.frontmatter.id,
            field,
            value,
            ...(workflowConfig !== undefined ? { workflowConfig } : {}),
            archivedGuard,
          });
          return text(`Updated ${updated.frontmatter.key}: set ${field} = ${JSON.stringify(value)}`);
        } catch (err) {
          if (err instanceof TaskUpdateError) return errorResult(err.message);
          throw err;
        }
      }

      case "unset_field": {
        const invalid = validateUnsetFieldArgs(args);
        if (invalid) return invalid;
        const task = await lookupTask(locttDir, args["ref"] as string);
        const field = args["field"] as string;
        try {
          const updated = await unsetField(locttDir, task.frontmatter.id, field);
          return text(`Updated ${updated.frontmatter.key}: unset ${field}`);
        } catch (err) {
          if (err instanceof TaskUpdateError) return errorResult(err.message);
          throw err;
        }
      }

      case "delete_task": {
        const blocked = requireConfirm(args, "delete_task");
        if (blocked) return blocked;
        const task = await lookupTask(locttDir, args["ref"] as string);
        await deleteTask(locttDir, task.frontmatter.id, { force: true });
        return text(`Deleted ${task.frontmatter.key}.`);
      }

      case "get_task_history": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const entries = await readHistory(locttDir, task.frontmatter.id);
        entries.reverse();
        const limit = args["limit"] as number | undefined;
        const display = limit !== undefined ? entries.slice(0, limit) : entries;
        return text(JSON.stringify(display, null, 2));
      }

      case "enable_git": {
        await enableGit(locttDir, root);
        return text("Git-backed mode enabled");
      }

      case "disable_git": {
        await disableGit(locttDir);
        return text("Git-backed mode disabled");
      }

      case "get_git_status": {
        const status = await getGitStatus(locttDir, root);
        const result = {
          enabled: status.enabled,
          branch: status.branch,
          remote: status.remote,
          auto_push: status.autoPush,
          auto_fetch: status.autoFetch,
          in_git_repo: status.isGitRepo,
          last_synced_commit: status.lastSyncedCommit ?? null,
        };
        return text(JSON.stringify(result, null, 2));
      }

      case "publish_to_git": {
        const result = await publish(locttDir, root);
        const lines: string[] = [];
        if (result.committed) {
          lines.push("Published local state to loctt branch");
        } else {
          lines.push("No changes to publish");
        }
        if (result.pushed === true) {
          lines.push("Pushed to remote");
        } else if (result.pushError) {
          lines.push(`Published locally; remote push failed: ${result.pushError}`);
        }
        return text(lines.join("\n"));
      }

      case "sync_from_git": {
        const result = await sync(locttDir, root);
        const lines: string[] = [];
        if (result.fetched === true) {
          lines.push("Fetched from remote");
        } else if (result.fetchError) {
          lines.push(`Remote fetch failed: ${result.fetchError}`);
        }
        if (result.updated) {
          lines.push("Synced loctt branch into local workspace");
        } else {
          lines.push("Already up to date");
        }
        return text(lines.join("\n"));
      }

      case "get_config_value": {
        const key = args["key"] as string;
        const def = CONFIG_KEYS.find(d => d.key === key);
        if (!def) {
          return errorResult(`unknown config key '${key}'`);
        }
        const value = await getConfigValue(locttDir, key);
        return text(JSON.stringify({
          key,
          value: value ?? null,
          type: def.type,
        }, null, 2));
      }

      case "set_config_value": {
        const key = args["key"] as string;
        const value = args["value"] as string;
        await setConfigValue({ locttDir, root }, key, value);
        return text(`Set ${key} = ${value}`);
      }

      case "unset_config_value": {
        const key = args["key"] as string;
        await unsetConfigValue({ locttDir, root }, key);
        return text(`Unset ${key}`);
      }

      case "list_config_values": {
        const items = [];
        for (const def of CONFIG_KEYS) {
          let value: string | boolean | null = null;
          try {
            const v = await getConfigValue(locttDir, def.key);
            value = v === undefined ? null : v;
          } catch {
            value = null;
          }
          items.push({
            key: def.key,
            value,
            type: def.type,
            description: def.description,
          });
        }
        return text(JSON.stringify(items, null, 2));
      }

      case "list_projects": {
        const cfg = await loadProjectsConfig(locttDir);
        return text(JSON.stringify({
          projects: cfg.projects,
          default: cfg.default ?? null,
        }, null, 2));
      }

      case "create_project": {
        try {
          await createProject(locttDir, {
            key: args["key"] as string,
            label: args["label"] as string,
            prefix: args["prefix"] as string,
          });
          if (args["make_default"] === true) {
            await setDefaultProject(locttDir, args["key"] as string);
          }
          return text(`Created project ${String(args["key"])}`);
        } catch (err) {
          if (err instanceof ProjectError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "edit_project": {
        try {
          await editProject(locttDir, args["key"] as string, {
            label: args["label"] as string,
          });
          return text(`Updated project ${String(args["key"])}`);
        } catch (err) {
          if (err instanceof ProjectError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "delete_project": {
        try {
          const blocked = requireConfirm(args, "delete_project");
          if (blocked) return blocked;
          const remapTo = args["remap_to"] as string | undefined;
          const result = await deleteProject(locttDir, args["key"] as string, {
            hard: true,
            ...(remapTo !== undefined ? { remapTo } : {}),
          });
          return text(JSON.stringify({
            key: args["key"],
            remappedTaskCount: result.remappedTaskCount,
          }, null, 2));
        } catch (err) {
          if (err instanceof ProjectError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "archive_project":
      case "unarchive_project": {
        try {
          const key = args["key"] as string;
          if (name === "archive_project") await archiveProject(locttDir, key);
          else await unarchiveProject(locttDir, key);
          return text(`${name === "archive_project" ? "Archived" : "Unarchived"} project ${key}`);
        } catch (err) {
          if (err instanceof ProjectError) return errorResult(err.message);
          throw err;
        }
      }

      case "set_default_project": {
        try {
          const key = (args["key"] as string | undefined) ?? null;
          await setDefaultProject(locttDir, key);
          return text(key === null ? `Cleared workspace default project` : `Set workspace default to ${key}`);
        } catch (err) {
          if (err instanceof ProjectError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "list_users": {
        const includeArchived = args["include_archived"] === true;
        const users = await loadAllUsers(locttDir);
        const current = await getCurrentUser(locttDir);
        const filtered = users.filter(u => includeArchived || u.archived !== true);
        return text(JSON.stringify({
          current: current?.id ?? null,
          users: filtered,
        }, null, 2));
      }

      case "get_current_user": {
        const current = await getCurrentUser(locttDir);
        if (!current) return errorResult("no users registered");
        return text(JSON.stringify(current, null, 2));
      }

      case "switch_user": {
        try {
          const target = await resolveUserRef(locttDir, args["ref"] as string);
          await switchCurrentUser(locttDir, target.id);
          return text(`Switched to ${target.name} (${target.id})`);
        } catch (err) {
          if (err instanceof UserError) return errorResult(err.message);
          throw err;
        }
      }

      case "create_user": {
        try {
          const created = await createUser(locttDir, {
            name: args["name"] as string,
            ...(args["email"] !== undefined ? { email: args["email"] as string } : {}),
            ...(args["timezone"] !== undefined ? { timezone: args["timezone"] as string } : {}),
            switchToOnCreate: args["switch_to_on_create"] === true,
          });
          return text(JSON.stringify(created, null, 2));
        } catch (err) {
          if (err instanceof UserError) return errorResult(err.message);
          throw err;
        }
      }

      case "edit_user": {
        try {
          const target = await resolveUserRef(locttDir, args["ref"] as string);
          const updated = await updateUser(locttDir, target.id, {
            ...(args["name"] !== undefined ? { name: args["name"] as string } : {}),
            ...("email" in args
              ? { email: args["email"] as string | null }
              : {}),
            ...(args["timezone"] !== undefined ? { timezone: args["timezone"] as string } : {}),
          });
          return text(JSON.stringify(updated, null, 2));
        } catch (err) {
          if (err instanceof UserError) return errorResult(err.message);
          throw err;
        }
      }

      case "archive_user":
      case "unarchive_user": {
        try {
          const target = await resolveUserRef(locttDir, args["ref"] as string);
          if (name === "archive_user") await archiveUser(locttDir, target.id);
          else await unarchiveUser(locttDir, target.id);
          return text(`${name === "archive_user" ? "Archived" : "Unarchived"} ${target.name}`);
        } catch (err) {
          if (err instanceof UserError) return errorResult(err.message);
          throw err;
        }
      }

      case "delete_user": {
        try {
          const blocked = requireConfirm(args, "delete_user");
          if (blocked) return blocked;
          const target = await resolveUserRef(locttDir, args["ref"] as string);
          const remapToRef = args["remap_to"] as string | undefined;
          const unassign = args["unassign"] === true;
          if (remapToRef !== undefined && unassign) {
            return errorResult("remap_to and unassign are mutually exclusive");
          }
          const remapTo = remapToRef !== undefined
            ? (await resolveUserRef(locttDir, remapToRef)).id
            : undefined;
          const result = await deleteUser(locttDir, target.id, {
            ...(remapTo !== undefined ? { remapTo } : {}),
            ...(unassign ? { unassign: true } : {}),
          });
          return text(JSON.stringify({ deleted: target.id, ...result }, null, 2));
        } catch (err) {
          if (err instanceof UserError) return errorResult(err.message);
          throw err;
        }
      }

      case "list_labels": {
        const cfg = await loadLabelsConfig(locttDir);
        return text(JSON.stringify(cfg, null, 2));
      }

      case "create_label": {
        try {
          const color = args["color"] as string | undefined;
          await createLabel(locttDir, {
            key: args["key"] as string,
            label: args["label"] as string,
            ...(color !== undefined ? { color } : {}),
          });
          return text(`Created label ${String(args["key"])}`);
        } catch (err) {
          if (err instanceof LabelError) return errorResult(err.message);
          throw err;
        }
      }

      case "edit_label": {
        try {
          const colorArg = args["color"] as string | null | undefined;
          await editLabel(locttDir, args["key"] as string, {
            ...(args["label"] !== undefined ? { label: args["label"] as string } : {}),
            ...("color" in args ? { color: colorArg ?? null } : {}),
          });
          return text(`Updated label ${String(args["key"])}`);
        } catch (err) {
          if (err instanceof LabelError) return errorResult(err.message);
          throw err;
        }
      }

      case "delete_label": {
        try {
          const blocked = requireConfirm(args, "delete_label");
          if (blocked) return blocked;
          const remapTo = args["remap_to"] as string | undefined;
          const result = await deleteLabel(locttDir, args["key"] as string, {
            hard: true,
            ...(remapTo !== undefined ? { remapTo } : {}),
          });
          return text(JSON.stringify({
            key: args["key"],
            ...result,
          }, null, 2));
        } catch (err) {
          if (err instanceof LabelError) return errorResult(err.message);
          throw err;
        }
      }

      case "get_calendar": {
        const cfg = await loadCalendarConfig(locttDir);
        return text(JSON.stringify(cfg, null, 2));
      }

      case "list_sprints": {
        const cfg = await loadSprintsConfig(locttDir);
        return text(JSON.stringify(cfg, null, 2));
      }

      case "create_sprint": {
        try {
          const goal = args["goal"] as string | undefined;
          await createSprint(locttDir, {
            key: args["key"] as string,
            label: args["label"] as string,
            start_date: args["start_date"] as string,
            end_date: args["end_date"] as string,
            state: args["state"] as "active" | "completed" | "future",
            ...(goal !== undefined ? { goal } : {}),
          });
          return text(`Created sprint ${String(args["key"])}`);
        } catch (err) {
          if (err instanceof SprintError) return errorResult(err.message);
          throw err;
        }
      }

      case "edit_sprint": {
        try {
          const goal = args["goal"] as string | null | undefined;
          await editSprint(locttDir, args["key"] as string, {
            ...(args["label"] !== undefined ? { label: args["label"] as string } : {}),
            ...(args["start_date"] !== undefined ? { start_date: args["start_date"] as string } : {}),
            ...(args["end_date"] !== undefined ? { end_date: args["end_date"] as string } : {}),
            ...(args["state"] !== undefined ? { state: args["state"] as "active" | "completed" | "future" } : {}),
            ...("goal" in args ? { goal: goal ?? null } : {}),
            ...(args["force"] === true ? { force: true } : {}),
          });
          return text(`Updated sprint ${String(args["key"])}`);
        } catch (err) {
          if (err instanceof SprintError) return errorResult(err.message);
          throw err;
        }
      }

      case "delete_sprint": {
        try {
          const blocked = requireConfirm(args, "delete_sprint");
          if (blocked) return blocked;
          const remapTo = args["remap_to"] as string | undefined;
          const result = await deleteSprint(locttDir, args["key"] as string, {
            hard: true,
            ...(remapTo !== undefined ? { remapTo } : {}),
          });
          return text(JSON.stringify({
            key: args["key"],
            ...result,
          }, null, 2));
        } catch (err) {
          if (err instanceof SprintError) return errorResult(err.message);
          throw err;
        }
      }

      case "list_milestones": {
        const cfg = await loadMilestonesConfig(locttDir);
        return text(JSON.stringify(cfg, null, 2));
      }

      case "create_milestone": {
        try {
          const td = args["target_date"] as string | undefined;
          await createMilestone(locttDir, {
            key: args["key"] as string,
            label: args["label"] as string,
            ...(td !== undefined ? { target_date: td } : {}),
          });
          return text(`Created milestone ${String(args["key"])}`);
        } catch (err) {
          if (err instanceof MilestoneError) return errorResult(err.message);
          throw err;
        }
      }

      case "edit_milestone": {
        try {
          const td = args["target_date"] as string | null | undefined;
          const archived = args["archived"] as boolean | undefined;
          await editMilestone(locttDir, args["key"] as string, {
            ...(args["label"] !== undefined ? { label: args["label"] as string } : {}),
            ...("target_date" in args ? { target_date: td ?? null } : {}),
            ...(archived !== undefined ? { archived } : {}),
          });
          return text(`Updated milestone ${String(args["key"])}`);
        } catch (err) {
          if (err instanceof MilestoneError) return errorResult(err.message);
          throw err;
        }
      }

      case "delete_milestone": {
        try {
          const blocked = requireConfirm(args, "delete_milestone");
          if (blocked) return blocked;
          const remapTo = args["remap_to"] as string | undefined;
          const result = await deleteMilestone(locttDir, args["key"] as string, {
            hard: true,
            ...(remapTo !== undefined ? { remapTo } : {}),
          });
          return text(JSON.stringify({
            key: args["key"],
            ...result,
          }, null, 2));
        } catch (err) {
          if (err instanceof MilestoneError) return errorResult(err.message);
          throw err;
        }
      }

      case "archive_label":
      case "unarchive_label": {
        try {
          const key = args["key"] as string;
          if (name === "archive_label") await archiveLabel(locttDir, key);
          else await unarchiveLabel(locttDir, key);
          return text(`${name === "archive_label" ? "Archived" : "Unarchived"} label ${key}`);
        } catch (err) {
          if (err instanceof LabelError) return errorResult(err.message);
          throw err;
        }
      }

      case "archive_milestone":
      case "unarchive_milestone": {
        try {
          const key = args["key"] as string;
          if (name === "archive_milestone") await archiveMilestone(locttDir, key);
          else await unarchiveMilestone(locttDir, key);
          return text(`${name === "archive_milestone" ? "Archived" : "Unarchived"} milestone ${key}`);
        } catch (err) {
          if (err instanceof MilestoneError) return errorResult(err.message);
          throw err;
        }
      }

      case "archive_sprint":
      case "unarchive_sprint": {
        try {
          const key = args["key"] as string;
          if (name === "archive_sprint") await archiveSprint(locttDir, key);
          else await unarchiveSprint(locttDir, key);
          return text(`${name === "archive_sprint" ? "Archived" : "Unarchived"} sprint ${key}`);
        } catch (err) {
          if (err instanceof SprintError) return errorResult(err.message);
          throw err;
        }
      }

      case "get_sprint_burndown": {
        try {
          const series = await readBurndownSeries(locttDir, args["key"] as string);
          return text(JSON.stringify(series, null, 2));
        } catch (err) {
          if (err instanceof BurndownError) return errorResult(err.message);
          throw err;
        }
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    if (isKnownDomainError(err)) {
      return errorResult(err.message);
    }
    // Re-throw anything else — a TypeError or unexpected I/O failure
    // is a real bug, not a routine tool error. The MCP framework
    // will surface it as a server fault and log it; masking it as
    // an errorResult here would hide the diagnosis.
    throw err;
  }
}
