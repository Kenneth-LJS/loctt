// @loctt/mcp — MCP server for LocTT
// Provides structured tools for task management via Model Context Protocol.

import {
  archiveTask,
  buildListContext,
  buildShowModel,
  createTask,
  deleteTask,
  linkTask,
  listTasks,
  loadAllTasks,
  loadOptionalConfigs,
  loadQueriesConfig,
  loadState,
  loadWorkflowConfig,
  lookupTask,
  readHistory,
  readTaskBody,
  resolveLocttDir,
  saveState,
  setField,
  unarchiveTask,
  unlinkTask,
  unsetField,
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
      description: "Get a task by key or ID, optionally including the markdown body.",
      inputSchema: {
        ref: z.string().describe("Task key (e.g. T-1) or ID"),
        include_body: z.boolean().optional().describe("Whether to include the markdown body (default true)"),
      },
    },
    {
      name: "list_tasks",
      description: "List tasks with optional query, view, and limit.",
      inputSchema: {
        query: z.string().optional().describe("Ad hoc query string"),
        view: z.string().optional().describe("Named saved view"),
        limit: z.number().optional().describe("Max results (default 30)"),
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
      description: "Create a new task.",
      inputSchema: {
        title: z.string(),
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
      name: "task_history",
      description: "Get the activity/history log for a task. Returns structured entries (newest first).",
      inputSchema: {
        ref: z.string().describe("Task key (e.g. T-1) or ID"),
        limit: z.number().optional().describe("Max entries to return (default: all)"),
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

/** Executes an MCP tool call. */
export async function executeTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const locttDir = resolveLocttDir(root);

  try {
    switch (name) {
      case "get_task": {
        const ref = args["ref"] as string;
        const includeBody = (args["include_body"] as boolean) ?? true;
        const task = await lookupTask(locttDir, ref);
        const model = await buildShowModel(locttDir, task);
        const result: Record<string, unknown> = {
          ...model.task.frontmatter,
          attachments: model.attachments.map(a => ({ name: a.name, size: a.size })),
        };
        if (includeBody) result["body"] = model.task.body;
        return text(JSON.stringify(result, null, 2));
      }

      case "list_tasks": {
        const tasks = await loadAllTasks(locttDir);
        const { workflowConfig, queriesConfig } = await loadOptionalConfigs(locttDir);

        const result = listTasks({
          tasks,
          options: {
            query: args["query"] as string | undefined,
            view: args["view"] as string | undefined,
            limit: args["limit"] as number | undefined,
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
        const state = await loadState(locttDir);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const task = await createTask({
          locttDir, state, workflowConfig,
          options: {
            title: args["title"] as string,
            status: args["status"] as string | undefined,
            priority: args["priority"] as string | undefined,
            task_type: args["task_type"] as string | undefined,
            body: args["body"] as string | undefined,
          },
        });
        await saveState(locttDir, state);
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
        const current = await readTaskBody(locttDir, task.frontmatter.id);
        await writeTaskBody(locttDir, task.frontmatter.id, current + (args["text"] as string) + "\n");
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
        const relType = args["type"] as string;
        await unlinkTask({ locttDir, taskId: task.frontmatter.id, type: relType, target: target.frontmatter.id });
        return text(`Unlinked ${task.frontmatter.key} --${relType}--> ${target.frontmatter.key}`);
      }

      case "task_history": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const entries = await readHistory(locttDir, task.frontmatter.id);
        entries.reverse();
        const limit = args["limit"] as number | undefined;
        const display = limit !== undefined ? entries.slice(0, limit) : entries;
        return text(JSON.stringify(display, null, 2));
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
