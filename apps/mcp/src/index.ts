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

import {
  getTrackerInfo,
  recoverInterruptedPrefixRename,
  requireSupportedSchema,
  resolveLocttDir,
  SchemaUnmigratableError,
} from "@loctt/core";
import { z } from "zod";

import { listRegisteredTools, lookupTool, stripHandler } from "./registry.js";
import { errorResult, isKnownDomainError } from "./runtime/errors.js";
import type { McpTool, McpToolResult } from "./types.js";

export { MCP_INSTRUCTIONS, packageVersion, startMcpServer } from "./server.js";
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

/**
 * Whether there is a tracker worth enforcing a schema version on.
 *
 * Deliberately not "does the directory exist". An **empty** `.loctt/`
 * has no `.schema-version`, so the guard refused every tool with "No
 * .schema-version file found … must be re-initialized" — a wrong
 * diagnosis whose remedy (`migrate`) has nothing to migrate. It has no
 * schema because it has no tracker; `init` is what it needs, and the
 * `info` tool now says so.
 *
 * A `.loctt/` missing core files but still holding tasks stays
 * guarded: that one is damaged and its data is real.
 */
async function trackerNeedsSchemaCheck(root: string, locttDir: string): Promise<boolean> {
  if (!(await dirExists(locttDir))) return false;
  const info = await getTrackerInfo(root);
  return info.initState !== "empty";
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
  // schema doesn't match this MCP server's expectations. An older
  // tracker returns "This tracker needs upgrading from X to Y. Run
  // `loctt migrate` (a backup is made first)." and nothing is written:
  // upgrading is the user's deliberate step (K154), which an agent
  // takes only when the user asked (`migrate_schema`). Exempt tools
  // set `exemptFromSchemaGuard: true`: `init`, `migrate_schema`, and
  // the read-only `info` and `doctor`, which report the state instead.
  if (!registered.exemptFromSchemaGuard && (await trackerNeedsSchemaCheck(root, locttDir))) {
    try {
      await requireSupportedSchema(locttDir);
    } catch (err) {
      const message = (err as Error).message;
      return errorResult(err instanceof SchemaUnmigratableError ? `${message} ${err.remedy}` : message);
    }
    // Finish an interrupted prefix rename before the tool reads any
    // task key. Success is deliberately silent — the agent asked for a
    // tool result, not a repair log — but a failure is surfaced,
    // because every key the tool goes on to report would be suspect.
    const { error: recoveryError } =
      await recoverInterruptedPrefixRename(locttDir);
    if (recoveryError) {
      return errorResult(
        `A prefix rename was interrupted and could not be finished: ` +
        `${recoveryError.message}. Task keys may be inconsistent until ` +
        `it completes; run \`loctt doctor\` for detail.`,
      );
    }
  }

  return validateAndRun(root, locttDir, name, registered.handler, args);
}

/** Validates `args` against the tool's schema and runs its handler. */
async function validateAndRun(
  root: string,
  locttDir: string,
  name: string,
  handler: NonNullable<ReturnType<typeof lookupTool>>["handler"],
  args: Record<string, unknown>,
): Promise<McpToolResult> {
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
    return await handler({ root, locttDir }, parsed.data);
  } catch (err) {
    if (isKnownDomainError(err)) return errorResult(err.message);
    // Re-throw anything else — a TypeError or unexpected I/O
    // failure is a real bug, not a routine tool error. The MCP
    // framework will surface it as a server fault and log it;
    // masking it as an errorResult here would hide the diagnosis.
    throw err;
  }
}
