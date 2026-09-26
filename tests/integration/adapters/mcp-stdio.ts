import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const cliEntry = path.join(repoRoot, "apps/cli/dist/index.js");

export interface McpToolResultContent {
  readonly type: string;
  readonly text?: string;
}

export interface McpToolResult {
  readonly content: readonly McpToolResultContent[];
  readonly isError?: boolean;
}

export interface McpClient {
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolResult>;
  // `description` is present-but-undefined when a tool declares none, so
  // it is `| undefined` rather than optional: under
  // exactOptionalPropertyTypes those are different types, and the MCP
  // SDK returns the former.
  listTools: () => Promise<Array<{ name: string; description: string | undefined; inputSchema: unknown }>>;
  close: () => Promise<void>;
}

/**
 * Spawn `node apps/cli/dist/index.js mcp` rooted at `cwd`, connect a
 * real MCP client over stdio, and return a thin wrapper.
 *
 * The caller is responsible for `await client.close()` in a finally /
 * afterEach block. The transport will SIGTERM and (after 2s) SIGKILL
 * the child on close.
 */
export async function startMcpClient(cwd: string): Promise<McpClient> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cliEntry, "mcp"],
    cwd,
    stderr: "inherit",
  });

  const client = new Client(
    { name: "loctt-integration-tests", version: "0.0.0" },
    { capabilities: {} },
  );

  await client.connect(transport);

  return {
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args });
      return result as unknown as McpToolResult;
    },
    async listTools() {
      const result = await client.listTools();
      return result.tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    },
    async close() {
      try {
        await client.close();
      } catch {
        // ignore — we still want transport.close() to run
      }
      try {
        await transport.close();
      } catch {
        // ignore
      }
    },
  };
}
