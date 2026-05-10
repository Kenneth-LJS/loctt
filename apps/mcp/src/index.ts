// @loctt/mcp — MCP server for LocTT
// Provides structured tools for task management via Model Context Protocol.

import { access } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  appendTaskBody,
  archiveTask,
  attachFile,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  buildListContext,
  buildShowModel,
  CONFIG_KEYS,
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  detachFile,
  disableGit,
  editProject,
  enableGit,
  getConfigValue,
  getGitStatus,
  getTrackerInfo,
  initLoctt,
  linkTask,
  listTasks,
  loadAllTasks,
  loadOptionalConfigs,
  loadProjectsConfig,
  loadQueriesConfig,
  loadState,
  loadWorkflowConfig,
  lookupTask,
  ProjectError,
  publish,
  readHistory,
  requireSupportedSchema,
  resolveLocttDir,
  resolveProjectKey,
  runDoctor,
  saveState,
  setConfigValue,
  setDefaultProject,
  setField,
  sync,
  unarchiveTask,
  unlinkTask,
  unsetConfigValue,
  unsetField,
  withStateLock,
  writeTaskBody,
} from "@loctt/core";
import { z } from "zod";

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny>;
}

export interface McpToolResult {
  readonly content: Array<{ type: "text"; text: string }>;
  readonly isError?: boolean;
}

/** Returns the list of available MCP tools. */
export function getTools(): McpTool[] {
  return [
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
        limit: z.number().optional().describe("Max results (default 30)"),
        include_archived: z.boolean().optional().describe("If true, include archived tasks (default false). Ignored when a query already mentions `archived` or when a saved view is used."),
      },
    },
    {
      name: "list_views",
      description: "List available saved views from queries.yaml.",
      inputSchema: {},
    },
    {
      name: "get_config",
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
      description: "Set a field on a task.",
      inputSchema: {
        ref: z.string().describe("Task key or ID"),
        field: z.string(),
        value: z.unknown().describe("The value to set"),
      },
    },
    {
      name: "append_task_body",
      description: "Append text to a task's markdown body.",
      inputSchema: {
        ref: z.string(),
        text: z.string(),
      },
    },
    {
      name: "replace_task_body",
      description: "Replace a task's entire markdown body.",
      inputSchema: {
        ref: z.string(),
        body: z.string(),
      },
    },
    {
      name: "archive_task",
      description: "Archive a task.",
      inputSchema: {
        ref: z.string(),
      },
    },
    {
      name: "unarchive_task",
      description: "Unarchive a task.",
      inputSchema: {
        ref: z.string(),
      },
    },
    {
      name: "unset_field",
      description: "Remove a field from a task.",
      inputSchema: {
        ref: z.string().describe("Task key or ID"),
        field: z.string(),
      },
    },
    {
      name: "delete_task",
      description: "Permanently delete a task. Requires confirm: true.",
      inputSchema: {
        ref: z.string(),
        confirm: z.boolean().describe("Must be true to proceed with deletion"),
      },
    },
    {
      name: "link_tasks",
      description: "Add a relationship between tasks.",
      inputSchema: {
        ref: z.string(),
        type: z.string().describe("Relationship type (e.g. parent, blocks)"),
        target: z.string().describe("Target task key or ID"),
      },
    },
    {
      name: "unlink_tasks",
      description: "Remove a relationship between tasks.",
      inputSchema: {
        ref: z.string(),
        type: z.string(),
        target: z.string(),
      },
    },
    {
      name: "attach_file",
      description: "Copy a local file into a task's attachments directory. Only file paths are supported in v1 (no base64 content); the file must be readable from the MCP server's filesystem.",
      inputSchema: {
        ref: z.string().describe("Task key (e.g. T-1) or ID"),
        source_path: z.string().describe("Absolute path to the file to attach. Must be absolute — the MCP server's cwd is not guaranteed to match the agent's mental model."),
        force: z.boolean().optional().describe("If true, overwrite an existing attachment with the same basename."),
      },
    },
    {
      name: "detach_file",
      description: "Remove a file from a task's attachments directory.",
      inputSchema: {
        ref: z.string().describe("Task key or ID"),
        name: z.string().describe("Basename of the attachment, no path separators"),
      },
    },
    {
      name: "info",
      description: "Returns prose summary of the tracker state (locttDir, task count, key prefix, statuses, next key). Mirrors the CLI 'info' command.",
      inputSchema: {},
    },
    {
      name: "doctor",
      description: "Runs diagnostic checks on the tracker. Output is human-prose. Useful for surfacing problems to the user; not designed for chained tool calls.",
      inputSchema: {},
    },
    {
      name: "init",
      description: "Bootstraps a new loctt tracker at the server's working directory if .loctt/ doesn't exist yet. Only call when explicitly asked to set up a new tracker — this is a one-time operation, not a routine task action.",
      inputSchema: {
        prefix: z.string().optional().describe("Key prefix for tasks (default 'T-')."),
        no_docs: z.boolean().optional().describe("If true, skip generating helper docs."),
      },
    },
    {
      name: "git_enable",
      description: "Enables git-backed mode for this tracker. Sets up a dedicated loctt branch for task data on a sparse worktree. Only call when the user has explicitly asked to share tasks across machines or set up sync — this is one-time infrastructure setup, not a routine task operation.",
      inputSchema: {},
    },
    {
      name: "git_disable",
      description: "Disables git-backed mode for this tracker. Local task data is preserved.",
      inputSchema: {},
    },
    {
      name: "git_status",
      description: "Returns structured JSON describing git-backed mode state (enabled, branch, remote, auto_push, auto_fetch, in_git_repo, last_synced_commit).",
      inputSchema: {},
    },
    {
      name: "git_publish",
      description: "Commits the current task state to the local loctt branch and (if remote+auto_push are set) pushes to remote. Call when the user has indicated they want to share or sync tasks — not speculatively after routine task edits.",
      inputSchema: {},
    },
    {
      name: "git_sync",
      description: "Pulls the loctt branch state into the local workspace. If a remote is configured and auto_fetch is set, fetches first. Call when the user wants to bring in changes from another machine.",
      inputSchema: {},
    },
    {
      name: "config_get",
      description: "Reads a machine-local config value (currently git.* keys). Returns structured JSON {key, value, type} with the value preserving its native type.",
      inputSchema: {
        key: z.string().describe("Config key (e.g. git.enabled, git.remote)."),
      },
    },
    {
      name: "config_set",
      description: "Changes machine-local config (currently git.* keys only). Echo the change you're making in your response so the user can see what was adjusted. Don't call speculatively — only when the user has indicated they want to change a setting.",
      inputSchema: {
        key: z.string(),
        value: z.string().describe("Stringified value; booleans accept true/false/1/0/yes/no."),
      },
    },
    {
      name: "config_unset",
      description: "Restores a machine-local config key to its default. Echo the change so the user can see what was reset. Don't call speculatively — only when the user has indicated they want to revert a setting.",
      inputSchema: {
        key: z.string(),
      },
    },
    {
      name: "config_list",
      description: "Lists all known config keys with their current values, types, and descriptions. Returns structured JSON array.",
      inputSchema: {},
    },
    {
      name: "task_history",
      description: "Get the activity/history log for a task. Returns structured entries (newest first).",
      inputSchema: {
        ref: z.string().describe("Task key (e.g. T-1) or ID"),
        limit: z.number().optional().describe("Max entries to return (default: all)"),
      },
    },
    {
      name: "project_list",
      description: "List projects defined in projects.yaml. Returns each project's key, label, prefix, and which (if any) is the workspace default.",
      inputSchema: {},
    },
    {
      name: "project_create",
      description: "Create a new project. Project keys are immutable; prefixes must be unique across the tracker. Setting `make_default` true also sets the workspace default.",
      inputSchema: {
        key: z.string().describe("Slug identifier (lowercase letters, digits, hyphen, underscore)"),
        label: z.string().describe("Human-readable label"),
        prefix: z.string().describe("Task-key prefix, e.g. BACKEND-"),
        make_default: z.boolean().optional().describe("If true, also set this project as the workspace default"),
      },
    },
    {
      name: "project_edit",
      description: "Edit an existing project. Only `label` is mutable — `key` and `prefix` are immutable after creation.",
      inputSchema: {
        key: z.string(),
        label: z.string().describe("New label"),
      },
    },
    {
      name: "project_delete",
      description: "Delete a project. If the project has tasks, `remap_to` is required to migrate them to another project before deletion. Cannot delete the only project.",
      inputSchema: {
        key: z.string(),
        remap_to: z.string().optional().describe("Target project key for tasks in the deleted project"),
      },
    },
    {
      name: "project_set_default",
      description: "Set or clear the workspace default project. Pass `key` to set, or omit it to clear the default.",
      inputSchema: {
        key: z.string().optional(),
      },
    },
  ];
}

function text(content: string): McpToolResult {
  return { content: [{ type: "text", text: content }] };
}

function errorResult(message: string): McpToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * MCP tools that are exempt from the schema-version boot guard.
 * `init` is the only entry point legitimately called against a
 * non-existent or pre-version tracker.
 */
const SCHEMA_GUARD_EXEMPT_TOOLS = new Set(["init"]);

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
          attachments: model.attachments.map(a => ({ name: a.name, size: a.size })),
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

        // Compose ad-hoc query with optional `project` filter sugar.
        const projectFilter = args["project"] as string | undefined;
        const baseQuery = args["query"] as string | undefined;
        const composedQuery = projectFilter !== undefined
          ? (baseQuery !== undefined && baseQuery.length > 0
              ? `(${baseQuery}) and project = ${projectFilter}`
              : `project = ${projectFilter}`)
          : baseQuery;

        const result = listTasks({
          tasks,
          options: {
            query: composedQuery,
            view: args["view"] as string | undefined,
            limit: args["limit"] as number | undefined,
            includeArchived: args["include_archived"] as boolean | undefined,
          },
          queriesConfig,
          workflowConfig,
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

      case "get_config": {
        const config = await loadWorkflowConfig(locttDir);
        return text(JSON.stringify(config, null, 2));
      }

      case "create_task": {
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        // Resolve target project. Mirrors CLI/HTTP semantics.
        const projectsConfig = await loadProjectsConfig(locttDir);
        let projectKey: string;
        try {
          projectKey = resolveProjectKey(projectsConfig, {
            explicit: args["project"] as string | undefined,
          });
        } catch (err) {
          return errorResult((err as Error).message);
        }
        const task = await withStateLock(locttDir, async () => {
          const state = await loadState(locttDir);
          const created = await createTask({
            locttDir, state, workflowConfig,
            options: {
              project: projectKey,
              title: args["title"] as string,
              status: args["status"] as string | undefined,
              priority: args["priority"] as string | undefined,
              task_type: args["task_type"] as string | undefined,
              body: args["body"] as string | undefined,
            },
          });
          await saveState(locttDir, state);
          return created;
        });
        return text(`Created ${task.frontmatter.key}: ${task.frontmatter.title}`);
      }

      case "update_task": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const field = args["field"] as string;
        const value = args["value"];
        const updated = await setField({ locttDir, taskId: task.frontmatter.id, field, value, workflowConfig });
        return text(`Updated ${updated.frontmatter.key}: set ${field} = ${JSON.stringify(value)}`);
      }

      case "append_task_body": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        await appendTaskBody(locttDir, task.frontmatter.id, args["text"] as string);
        return text(`Appended to ${task.frontmatter.key} body.`);
      }

      case "replace_task_body": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        await writeTaskBody(locttDir, task.frontmatter.id, (args["body"] as string) + "\n");
        return text(`Replaced ${task.frontmatter.key} body.`);
      }

      case "archive_task": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        await archiveTask(locttDir, task.frontmatter.id);
        return text(`Archived ${task.frontmatter.key}.`);
      }

      case "unarchive_task": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        await unarchiveTask(locttDir, task.frontmatter.id);
        return text(`Unarchived ${task.frontmatter.key}.`);
      }

      case "unset_field": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const field = args["field"] as string;
        const updated = await unsetField(locttDir, task.frontmatter.id, field);
        return text(`Updated ${updated.frontmatter.key}: unset ${field}`);
      }

      case "delete_task": {
        if (args["confirm"] !== true) {
          return errorResult("delete_task requires confirm: true to proceed");
        }
        const task = await lookupTask(locttDir, args["ref"] as string);
        await deleteTask(locttDir, task.frontmatter.id, { force: true });
        return text(`Deleted ${task.frontmatter.key}.`);
      }

      case "link_tasks": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const target = await lookupTask(locttDir, args["target"] as string);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const relType = args["type"] as string;
        await linkTask({ locttDir, taskId: task.frontmatter.id, type: relType, target: target.frontmatter.id, workflowConfig });
        return text(`Linked ${task.frontmatter.key} --${relType}--> ${target.frontmatter.key}`);
      }

      case "unlink_tasks": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const target = await lookupTask(locttDir, args["target"] as string);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const relType = args["type"] as string;
        await unlinkTask({ locttDir, taskId: task.frontmatter.id, type: relType, target: target.frontmatter.id, workflowConfig });
        return text(`Unlinked ${task.frontmatter.key} --${relType}--> ${target.frontmatter.key}`);
      }

      case "attach_file": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const sourcePath = args["source_path"] as string;
        if (!isAbsolute(sourcePath)) {
          return errorResult("source_path must be absolute");
        }
        const force = (args["force"] as boolean | undefined) ?? false;
        try {
          const result = await attachFile({
            locttDir,
            taskId: task.frontmatter.id,
            sourcePath,
            force,
          });
          return text(JSON.stringify({
            name: result.name,
            size: result.size,
            overwritten: result.overwritten,
            task_key: task.frontmatter.key,
          }, null, 2));
        } catch (err) {
          if (err instanceof AttachmentExistsError) {
            return errorResult(`${err.message}. Pass force: true to overwrite.`);
          }
          if (err instanceof AttachmentSourceError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "detach_file": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const name = args["name"] as string;
        try {
          await detachFile({
            locttDir,
            taskId: task.frontmatter.id,
            name,
          });
          return text(`Detached ${name} from ${task.frontmatter.key}`);
        } catch (err) {
          if (err instanceof AttachmentNotFoundError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "task_history": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const entries = await readHistory(locttDir, task.frontmatter.id);
        entries.reverse();
        const limit = args["limit"] as number | undefined;
        const display = limit !== undefined ? entries.slice(0, limit) : entries;
        return text(JSON.stringify(display, null, 2));
      }

      case "info": {
        const info = await getTrackerInfo(root);
        if (!info.exists) {
          return text("No .loctt directory found. Run 'loctt init' to get started.");
        }
        const lines: string[] = [];
        lines.push(`LocTT directory: ${info.locttDir}`);
        lines.push(`Tasks: ${info.taskCount}`);
        if (info.workflowConfig) {
          lines.push(`Key prefix: ${info.workflowConfig.key.prefix}`);
          lines.push(`Statuses: ${info.workflowConfig.statuses.map(s => s.key).join(", ")}`);
        }
        if (info.state) {
          const taskState = info.state.keys["task"];
          if (taskState) {
            lines.push(`Next key: ${taskState.prefix}${taskState.next_number}`);
          }
        }
        return text(lines.join("\n"));
      }

      case "doctor": {
        const checks = await runDoctor(root);
        const lines = checks.map(c => {
          const icon = c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : "error";
          return `[${icon}] ${c.name}: ${c.message}`;
        });
        return text(lines.join("\n"));
      }

      case "init": {
        try {
          await access(locttDir);
          return errorResult(`.loctt directory already exists at ${locttDir}`);
        } catch {
          // doesn't exist — proceed
        }
        const prefix = args["prefix"] as string | undefined;
        const noDocs = (args["no_docs"] as boolean | undefined) ?? false;
        const result = await initLoctt(root, {
          ...(prefix !== undefined ? { prefix } : {}),
          docs: !noDocs,
        });
        return text(`Initialized .loctt at ${result.locttDir}\nCreated ${result.created.length} files`);
      }

      case "git_enable": {
        await enableGit(locttDir, root);
        return text("Git-backed mode enabled");
      }

      case "git_disable": {
        await disableGit(locttDir);
        return text("Git-backed mode disabled");
      }

      case "git_status": {
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

      case "git_publish": {
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

      case "git_sync": {
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

      case "config_get": {
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

      case "config_set": {
        const key = args["key"] as string;
        const value = args["value"] as string;
        await setConfigValue({ locttDir, root }, key, value);
        return text(`Set ${key} = ${value}`);
      }

      case "config_unset": {
        const key = args["key"] as string;
        await unsetConfigValue({ locttDir, root }, key);
        return text(`Unset ${key}`);
      }

      case "config_list": {
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

      case "project_list": {
        const cfg = await loadProjectsConfig(locttDir);
        return text(JSON.stringify({
          projects: cfg.projects,
          default: cfg.default ?? null,
        }, null, 2));
      }

      case "project_create": {
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

      case "project_edit": {
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

      case "project_delete": {
        try {
          const remapTo = args["remap_to"] as string | undefined;
          const result = await deleteProject(locttDir, args["key"] as string, {
            ...(remapTo !== undefined ? { remapTo } : {}),
          });
          return text(JSON.stringify({
            deleted: args["key"],
            remappedTaskCount: result.remappedTaskCount,
          }, null, 2));
        } catch (err) {
          if (err instanceof ProjectError) {
            return errorResult(err.message);
          }
          throw err;
        }
      }

      case "project_set_default": {
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

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
