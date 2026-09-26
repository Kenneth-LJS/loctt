/**
 * `loctt mcp` — start the MCP server on stdio. Intended to be
 * launched by an MCP client; runs until the client disconnects.
 *
 * The server itself lives in @loctt/mcp (`startMcpServer`), which is
 * also what that package's own `loctt-mcp` bin runs (K89, A352). The
 * CLI is only a second launch surface, so the two cannot drift: same
 * tools, same agent instructions, same schema guard.
 */
export async function run(_args: string[], root: string): Promise<void> {
  const { startMcpServer } = await import("@loctt/mcp");
  await startMcpServer(root);
}
