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
  readTaskBody,
  resolveLocttDir,
  saveState,
  setField,
  unarchiveTask,
  unlinkTask,
  unsetField,
  writeTaskBody,
} from "@loctt/core";

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
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
        type: "object",
        properties: {
          ref: { type: "string", description: "Task key (e.g. T-1) or ID" },
          include_body: { type: "boolean", description: "Whether to include the markdown body (default true)" },
        },
        required: ["ref"],
      },
    },
    {
      name: "list_tasks",
      description: "List tasks with optional query, view, and limit.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Ad hoc query string" },
          view: { type: "string", description: "Named saved view" },
          limit: { type: "number", description: "Max results (default 30)" },
        },
      },
    },
    {
      name: "list_views",
      description: "List available saved views from queries.yaml.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "get_config",
      description: "Get the workflow configuration.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "create_task",
      description: "Create a new task.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          status: { type: "string" },
          priority: { type: "string" },
          task_type: { type: "string" },
          body: { type: "string" },
        },
        required: ["title"],
      },
    },
    {
      name: "update_task",
      description: "Set a field on a task.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Task key or ID" },
          field: { type: "string" },
          value: { description: "The value to set" },
        },
        required: ["ref", "field", "value"],
      },
    },
    {
      name: "append_task_body",
      description: "Append text to a task's markdown body.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          text: { type: "string" },
        },
        required: ["ref", "text"],
      },
    },
    {
      name: "replace_task_body",
      description: "Replace a task's entire markdown body.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          body: { type: "string" },
        },
        required: ["ref", "body"],
      },
    },
    {
      name: "archive_task",
      description: "Archive a task.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string" } },
        required: ["ref"],
      },
    },
    {
      name: "unarchive_task",
      description: "Unarchive a task.",
      inputSchema: {
        type: "object",
        properties: { ref: { type: "string" } },
        required: ["ref"],
      },
    },
    {
      name: "unset_field",
      description: "Remove a field from a task.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string", description: "Task key or ID" },
          field: { type: "string" },
        },
        required: ["ref", "field"],
      },
    },
    {
      name: "delete_task",
      description: "Permanently delete a task. Requires confirm: true.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          confirm: { type: "boolean", description: "Must be true to proceed with deletion" },
        },
        required: ["ref", "confirm"],
      },
    },
    {
      name: "link_tasks",
      description: "Add a relationship between tasks.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          type: { type: "string", description: "Relationship type (e.g. parent, blocks)" },
          target: { type: "string", description: "Target task key or ID" },
        },
        required: ["ref", "type", "target"],
      },
    },
    {
      name: "unlink_tasks",
      description: "Remove a relationship between tasks.",
      inputSchema: {
        type: "object",
        properties: {
          ref: { type: "string" },
          type: { type: "string" },
          target: { type: "string" },
        },
        required: ["ref", "type", "target"],
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

        const result = listTasks(
          tasks,
          {
            query: args["query"] as string | undefined,
            view: args["view"] as string | undefined,
            limit: args["limit"] as number | undefined,
          },
          queriesConfig,
          workflowConfig,
          buildListContext(tasks),
        );

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
        const task = await createTask(locttDir, state, {
          title: args["title"] as string,
          status: args["status"] as string | undefined,
          priority: args["priority"] as string | undefined,
          task_type: args["task_type"] as string | undefined,
          body: args["body"] as string | undefined,
        }, workflowConfig);
        await saveState(locttDir, state);
        return text(`Created ${task.frontmatter.key}: ${task.frontmatter.title}`);
      }

      case "update_task": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const { workflowConfig } = await loadOptionalConfigs(locttDir);
        const field = args["field"] as string;
        const value = args["value"];
        const updated = await setField(locttDir, task.frontmatter.id, field, value, workflowConfig);
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
        await linkTask(locttDir, task.frontmatter.id, relType, target.frontmatter.id, workflowConfig);
        return text(`Linked ${task.frontmatter.key} --${relType}--> ${target.frontmatter.key}`);
      }

      case "unlink_tasks": {
        const task = await lookupTask(locttDir, args["ref"] as string);
        const target = await lookupTask(locttDir, args["target"] as string);
        const relType = args["type"] as string;
        await unlinkTask(locttDir, task.frontmatter.id, relType, target.frontmatter.id);
        return text(`Unlinked ${task.frontmatter.key} --${relType}--> ${target.frontmatter.key}`);
      }

      default:
        return errorResult(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return errorResult((err as Error).message);
  }
}
