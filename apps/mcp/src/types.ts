/**
 * Public shapes the MCP server exposes to its host.
 *
 * `McpTool` describes a tool definition as the MCP SDK sees it:
 * `inputSchema` is a record of named zod schemas (NOT a wrapper
 * `z.object`), matching what the SDK's `registerTool` expects.
 *
 * `McpToolResult` mirrors the SDK's result shape — currently just
 * a list of `text` content items plus an optional `isError` flag.
 *
 * `ToolDef` is the registry-side shape: `McpTool` plus a `handler`
 * and an optional `exemptFromSchemaGuard` flag. The dispatcher
 * looks up handlers via `TOOL_REGISTRY`; the wire-format
 * `getTools()` shim strips off the handler before returning.
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

/**
 * Shared context passed to every tool handler. `locttDir` is
 * derived once per executeTool call and reused across the handler,
 * matching what the old in-file switch did.
 */
export interface ToolCtx {
  readonly root: string;
  readonly locttDir: string;
}

/**
 * A tool definition with its handler colocated. Each `tools/<entity>.ts`
 * file exports a `readonly ToolDef[]` array; the registry collects
 * those into a single Map keyed by tool name.
 *
 * The handler receives the args object as `Record<string, unknown>`
 * post-validation (parseToolArgs has already strict-parsed against
 * the same `inputSchema` shape, so every declared key is the
 * declared type). Individual handlers cast at the use site —
 * future work could tighten this with z.infer-typed generics, but
 * the current shape preserves the existing handler signatures
 * exactly and keeps the migration mechanical.
 */
export interface ToolDef {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, z.ZodTypeAny>;
  /**
   * When true, this tool bypasses the schema-version boot guard
   * in the dispatcher. Only `init` legitimately runs against a
   * pre-version tracker.
   */
  readonly exemptFromSchemaGuard?: boolean;
  readonly handler: (
    ctx: ToolCtx,
    args: Record<string, unknown>,
  ) => Promise<McpToolResult>;
}
