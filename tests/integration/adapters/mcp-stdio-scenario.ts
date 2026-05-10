import type { Op, ScenarioAdapter } from "../scenarios/types.js";
import { type McpClient,startMcpClient } from "./mcp-stdio.js";

/**
 * Drives the MCP server over stdio. One client per scenario; each op
 * becomes a tool call. The client is closed in a finally so the child
 * process doesn't leak even if a tool errors mid-scenario.
 */
export const mcpStdioAdapter: ScenarioAdapter = {
  name: "mcp-stdio",

  async run(ops, root) {
    const client = await startMcpClient(root);
    try {
      for (const op of ops) {
        const { name, args } = opToToolCall(op);
        const result = await client.callTool(name, args);
        if (result.isError) {
          const message = result.content[0]?.text ?? "(no detail)";
          throw new Error(
            `mcp-stdio: tool ${name} for op ${JSON.stringify(op)} returned error: ${message}`,
          );
        }
      }
    } finally {
      await client.close();
    }
  },
};

export function opToToolCall(op: Op): { name: string; args: Record<string, unknown> } {
  switch (op.kind) {
    case "create": {
      const args: Record<string, unknown> = { title: op.title };
      if (op.status !== undefined) args["status"] = op.status;
      if (op.priority !== undefined) args["priority"] = op.priority;
      if (op.task_type !== undefined) args["task_type"] = op.task_type;
      if (op.body !== undefined) args["body"] = op.body;
      return { name: "create_task", args };
    }
    case "set_field":
      return { name: "update_task", args: { ref: op.ref, field: op.field, value: op.value } };
    case "unset_field":
      return { name: "unset_field", args: { ref: op.ref, field: op.field } };
    case "replace_body":
      return { name: "replace_task_body", args: { ref: op.ref, body: op.body } };
    case "append_body":
      return { name: "append_task_body", args: { ref: op.ref, text: op.text } };
    case "archive":
      return { name: "archive_task", args: { ref: op.ref } };
    case "unarchive":
      return { name: "unarchive_task", args: { ref: op.ref } };
    case "delete":
      return { name: "delete_task", args: { ref: op.ref, hard: true, confirm: true } };
    case "link":
      return { name: "link_tasks", args: { ref: op.from, type: op.type, target: op.to } };
    case "unlink":
      return { name: "unlink_tasks", args: { ref: op.from, type: op.type, target: op.to } };
  }
}

export type { McpClient };
