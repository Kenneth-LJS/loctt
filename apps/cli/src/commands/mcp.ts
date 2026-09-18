/**
 * `loctt mcp` — start the MCP server on stdio. Intended to be
 * launched by an MCP client; runs until the client disconnects.
 *
 * Loads @modelcontextprotocol/sdk lazily so the dep cost only
 * applies when this command is invoked. The MCP server lives in
 * @loctt/mcp; the loctt CLI is just the launch surface here.
 */
export async function run(_args: string[], root: string): Promise<void> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { getTools, executeTool } = await import("@loctt/mcp");

  const server = new McpServer({ name: "loctt", version: "0.1.0" });
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
