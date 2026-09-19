/**
 * `loctt mcp` — start the MCP server on stdio. Intended to be
 * launched by an MCP client; runs until the client disconnects.
 *
 * Loads @modelcontextprotocol/sdk lazily so the dep cost only
 * applies when this command is invoked. The MCP server lives in
 * @loctt/mcp; the loctt CLI is just the launch surface here.
 */
/**
 * Agent guidance delivered as the MCP server's `instructions` on
 * connect, so a cold agent that never reads docs/user/mcp/reference.md
 * still gets the load-bearing rules before its first tool call. Kept a
 * tight system prompt — a compact version of that doc's "Agent
 * Guidelines" — not the whole reference. Exported so a test can assert
 * the server is constructed with it without driving a live transport.
 */
export const MCP_INSTRUCTIONS = [
  "LocTT is a local task tracker. Manage tasks and config through these structured tools only.",
  "",
  "- Never edit task.md frontmatter or any .loctt/ config file by hand. Edit a task's body via replace_task_body / append_task_body; edit metadata via the update/set tools.",
  "- Before writing any enum-valued field (status, priority, task_type, relationship types, custom fields), call get_workflow_config to discover the valid keys. Use the *_list tools (list_projects, list_labels, list_milestones, list_sprints, list_users) to discover valid references. Stored values are config keys, not human labels.",
  "- delete_* tools are hard and irreversible; they require confirm: true. Prefer the reversible archive_* tools, and unarchive_* to bring something back.",
  "- Call get_workflow_key_usage before proposing any deletion from workflow.yaml, so you know how many tasks a remap would touch.",
].join("\n");

export async function run(_args: string[], root: string): Promise<void> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { getTools, executeTool } = await import("@loctt/mcp");

  const server = new McpServer(
    { name: "loctt", version: "0.1.0" },
    { instructions: MCP_INSTRUCTIONS },
  );
  for (const tool of getTools()) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (params: unknown) => {
        const result = await executeTool(root, tool.name, (params ?? {}) as Record<string, unknown>);
        return { content: result.content.map(c => ({ ...c })), isError: result.isError };
      },
    );
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
