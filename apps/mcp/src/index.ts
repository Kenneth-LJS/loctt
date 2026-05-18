// @loctt/mcp — MCP server for LocTT
// Provides structured tools for task management via Model Context Protocol.
//
// This module is intentionally thin: every tool lives in
// `tools/<entity>.ts` and is registered through `registry.ts`. The
// dispatcher here just resolves the locttDir, applies the boot
// schema-version guard, strict-parses args against the tool's
// declared zod inputSchema, and forwards to the handler. Any
// "expected, user-actionable" domain error (see
// `runtime/errors.ts::isKnownDomainError`) is mapped to an
// errorResult; anything else propagates so the MCP framework can
// surface it as a real fault.

import { access } from "node:fs/promises";

import { requireSupportedSchema, resolveLocttDir } from "@loctt/core";
import { z } from "zod";

import { listRegisteredTools, lookupTool, stripHandler } from "./registry.js";
import { errorResult, isKnownDomainError } from "./runtime/errors.js";
import type { McpTool, McpToolResult } from "./types.js";

export type { McpTool, McpToolResult } from "./types.js";

/**
 * Returns the wire-format tool list. Drops handlers off each
 * ToolDef so the result matches the `McpTool` shape the MCP SDK
 * and external test fixtures expect.
 *
 * Memoized at module load below — calling `getTools()` repeatedly
 * is cheap.
 */
export function getTools(): McpTool[] {
  return listRegisteredTools().map(stripHandler);
}

const ALL_TOOLS: readonly McpTool[] = getTools();

/**
 * Lazy cache of `z.object(tool.inputSchema).strict()` per tool name.
 * Built once on first lookup and reused. `.strict()` so an agent
 * that invents a field name (e.g. typo'd `tite` for `title`) gets
 * a clean rejection instead of a silently-ignored field that
 * cascades into a downstream missing-required error.
 */
const TOOL_ARG_SCHEMAS = new Map<string, z.ZodObject<Record<string, z.ZodTypeAny>>>();

function getToolArgSchema(name: string): z.ZodObject<Record<string, z.ZodTypeAny>> | undefined {
  let schema = TOOL_ARG_SCHEMAS.get(name);
  if (schema !== undefined) return schema;
  const tool = ALL_TOOLS.find(t => t.name === name);
  if (tool === undefined) return undefined;
  schema = z.object(tool.inputSchema).strict();
  TOOL_ARG_SCHEMAS.set(name, schema);
  return schema;
}

/**
 * Returns true when the directory exists. Used as an inexpensive
 * existence check before applying the schema guard so we don't
 * mask "no .loctt directory" with "missing .schema-version".
 */
async function dirExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Executes an MCP tool call. */
export async function executeTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> {
  const locttDir = resolveLocttDir(root);

  const registered = lookupTool(name);
  if (registered === undefined) {
    return errorResult(`Unknown tool: ${name}`);
  }

  // Boot guard — refuse to run tools against a tracker whose
  // schema doesn't match this MCP server's expectations. The agent
  // sees a clear error pointing at `loctt migrate` rather than
  // partial reads against an unfamiliar schema. `init` is the one
  // legitimately tool that runs against a pre-version tracker; it
  // sets `exemptFromSchemaGuard: true`.
  if (!registered.exemptFromSchemaGuard && (await dirExists(locttDir))) {
    try {
      await requireSupportedSchema(locttDir);
    } catch (err) {
      return errorResult((err as Error).message);
    }
  }

  // Validate args against the tool's declared inputSchema. Strict
  // mode rejects unknown fields with a structured error pointing
  // at the offending path.
  const schema = getToolArgSchema(name);
  if (schema === undefined) {
    // Shouldn't happen — registry hit means the schema cache will
    // populate on this call. Defensive: surface as a tool error
    // rather than a TypeError.
    return errorResult(`Unknown tool: ${name}`);
  }
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map(i => `${i.path.length > 0 ? `${i.path.join(".")}: ` : ""}${i.message}`)
      .join("; ");
    return errorResult(`invalid args for ${name}: ${detail}`);
  }

  try {
    return await registered.handler({ root, locttDir }, parsed.data);
  } catch (err) {
    if (isKnownDomainError(err)) return errorResult(err.message);
    // Re-throw anything else — a TypeError or unexpected I/O
    // failure is a real bug, not a routine tool error. The MCP
    // framework will surface it as a server fault and log it;
    // masking it as an errorResult here would hide the diagnosis.
    throw err;
  }
}
