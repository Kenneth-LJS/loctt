/**
 * Public shapes the MCP server exposes to its host.
 *
 * `McpTool` describes a tool definition as the MCP SDK sees it:
 * `inputSchema` is a record of named zod schemas (NOT a wrapper
 * `z.object`), matching what the SDK's `registerTool` expects.
 *
 * `McpToolResult` mirrors the SDK's result shape — currently just
 * a list of `text` content items plus an optional `isError` flag.
 */

import type { z } from "zod";

export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny>;
}

export interface McpToolResult {
  readonly content: Array<{ type: "text"; text: string }>;
  readonly isError?: boolean;
}
