/**
 * The MCP stdio server: one implementation, two launchers (K89, A352).
 *
 * `@loctt/mcp`'s own `loctt-mcp` bin (`bin.ts`) and the CLI's `loctt mcp`
 * both call `startMcpServer`. Before A352 the server wiring lived in the
 * CLI (`apps/cli/src/commands/mcp.ts`) and `@loctt/mcp` was a library with
 * no way to run it, so K89's "MCP is independently installable" was not
 * true. Keeping a single function here is what keeps the two launchers
 * identical: same tools, same instructions, same schema guard (which runs
 * per tool call inside `executeTool`).
 *
 * The SDK and the tool registry are imported lazily, so a consumer that
 * only wants `getTools`/`executeTool` from this package does not load the
 * SDK, and the CLI pays for it only when `loctt mcp` runs.
 */

import { readFileSync } from "node:fs";

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
  "- Before writing any enum-valued field (status, priority, task_type, relationship types, custom fields), call get_workflow_config to discover the valid keys. Use the `list_*` tools (list_projects, list_labels, list_milestones, list_sprints, list_users) to discover valid references, list_views to discover saved views, and get_calendar for the timezone and working days that date queries depend on. Stored values are config keys, not human labels.",
  "- delete_* tools are hard and irreversible; they require confirm: true. Prefer the reversible archive_* tools, and unarchive_* to bring something back.",
  "- Call get_workflow_key_usage before proposing any deletion from workflow.yaml, so you know how many tasks a remap would touch.",
].join("\n");

/**
 * The version of the package this code was bundled into.
 *
 * Read from `../package.json` relative to the running file, which is the
 * package root for every build: `@loctt/mcp`'s `dist/bin.js`, the CLI's
 * `dist/index.js` (which bundles this module), and `src/` under test. The
 * manifest check (`tools/packaging`) keeps the packages on one version,
 * so the CLI reporting its own version here is the same number.
 */
export function packageVersion(): string {
  try {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Starts the LocTT MCP server on stdio against the tracker at `root`.
 * Resolves once connected; the process then stays up until the client
 * disconnects.
 */
export async function startMcpServer(root: string): Promise<void> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { getTools, executeTool } = await import("./index.js");

  const server = new McpServer(
    { name: "loctt", version: packageVersion() },
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
