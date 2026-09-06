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
  FsAccessError,
  GitSyncFirstError,
  LabelError,
  MilestoneError,
  PartialRemapError,
  ProjectError,
  RelationshipError,
  ReorderError,
  SchemaTooNewError,
  SchemaVersionError,
  SprintError,
  StaleBodyWriteError,
  TaskLifecycleError,
  TaskNotFoundError,
  TaskUpdateError,
  UnreadableFileError,
  UnreadableTaskError,
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
    // An unwritable .loctt/ or a full disk. Its message already names
    // the cause and the remedy, so an agent can act on it — that makes
    // it a domain error, not a server fault to rethrow.
    || err instanceof FsAccessError
    || err instanceof LabelError
    || err instanceof MilestoneError
    // MSL-33 / PRU-34: a partly-landed remap on a label or project
    // delete. Its message already names the split — how many tasks
    // moved, which failed by key, that the entry was NOT removed, and
    // that a retry is safe — which is exactly what an agent needs to
    // act on. Without this it was rethrown as an opaque server fault,
    // hiding the honest report the error was built to carry.
    || err instanceof PartialRemapError
    || err instanceof ProjectError
    || err instanceof ReorderError
    || err instanceof SprintError
    // K10: a refused body write is the guard working. The agent's
    // remedy is in the message — re-read, reapply, write again — so
    // it must reach the agent as an error result, not be rethrown as
    // a server fault it cannot act on.
    || err instanceof StaleBodyWriteError
    || err instanceof UserError
    || err instanceof SchemaVersionError
    || err instanceof SchemaTooNewError
    // A corrupt task.md is the user's file, and the message names the
    // path and the parse line. That is actionable by the agent (tell
    // the user which file to fix), so it is a domain error — not a
    // server fault to rethrow, which would have shown the agent an
    // opaque stack instead of the one sentence that helps (TSK-54).
    || err instanceof UnreadableTaskError
    // A config or state file that exists but could not be read
    // (permission denied, a directory where a file was expected). Its
    // message names the file and the fix (ERR-31), so it is actionable
    // by the agent, not a server fault. It extends LocttError, so this
    // also gives the web/CLI-parity the "capability in core is not done
    // until CLI and MCP have it" rule requires — without it, an
    // unreadable workflow.yaml/state.yaml reached the agent as an opaque
    // stack rather than the one sentence that helps.
    || err instanceof UnreadableFileError
    // Phase Z G1: publish refused because the branch holds remote-only
    // work a blind mirror would clobber. The message names the remedy
    // ("run sync first"), so it is actionable by the agent — a domain
    // error, not a server fault. The publish handler catches it
    // explicitly too; this keeps parity for any other caller.
    || err instanceof GitSyncFirstError
  );
}
