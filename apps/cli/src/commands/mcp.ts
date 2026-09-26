/**
 * `loctt mcp` — start the MCP server on stdio. Intended to be
 * launched by an MCP client; runs until the client disconnects.
 *
 * The server itself lives in the internal @loctt/mcp workspace
 * (`startMcpServer`), bundled into the `loctt` package from source
 * (A352, K139). This is its only launcher.
 */
export async function run(_args: string[], root: string): Promise<void> {
  const { startMcpServer } = await import("@loctt/mcp");
  await startMcpServer(root);
}
