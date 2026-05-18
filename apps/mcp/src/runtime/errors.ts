/**
 * MCP-side error mapping.
 *
 * The dispatcher's outer catch needs to know which errors are
 * "expected, user-actionable conditions" (agent passed the wrong
 * args / asked for a missing task) vs "real bugs" (TypeError,
 * unexpected I/O failure). The first becomes an `errorResult`; the
 * second propagates so the MCP framework can log and surface it.
 *
 * Listed once here so adding a new domain-error class is an
 * import + one-line append, not a new instanceof in every handler.
 */

import {
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  BurndownError,
  LabelError,
  MilestoneError,
  ProjectError,
  RelationshipError,
  ReorderError,
  SchemaTooNewError,
  SchemaVersionError,
  SprintError,
  TaskLifecycleError,
  TaskNotFoundError,
  TaskUpdateError,
  UserError,
} from "@loctt/core";

import type { McpToolResult } from "../types.js";

/** Plain text result wrapper. */
export function text(content: string): McpToolResult {
  return { content: [{ type: "text", text: content }] };
}

/** Error result wrapper — sets isError so the host can distinguish. */
export function errorResult(message: string): McpToolResult {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * Returns true for errors that represent expected, user-actionable
 * conditions (a bad arg, a not-found task, a workflow validation
 * miss). Used by the dispatcher's outer catch: known domain errors
 * become `errorResult` so the agent sees a clear message; anything
 * else is a real bug and is rethrown so the MCP framework can log
 * and surface it as a server fault instead of papering over it.
 */
export function isKnownDomainError(err: unknown): err is Error {
  return (
    err instanceof TaskUpdateError
    || err instanceof TaskNotFoundError
    || err instanceof TaskLifecycleError
    || err instanceof RelationshipError
    || err instanceof AttachmentExistsError
    || err instanceof AttachmentNotFoundError
    || err instanceof AttachmentSourceError
    || err instanceof BurndownError
    || err instanceof LabelError
    || err instanceof MilestoneError
    || err instanceof ProjectError
    || err instanceof ReorderError
    || err instanceof SprintError
    || err instanceof UserError
    || err instanceof SchemaVersionError
    || err instanceof SchemaTooNewError
  );
}
