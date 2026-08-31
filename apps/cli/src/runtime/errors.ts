/**
 * Error-handling primitives shared by every CLI command.
 *
 * Two distinct ways a command can fail:
 *
 *   - **Usage error** (`UsageError`) — the user typed the command
 *     wrong: missing args, bad flag, mutually-exclusive flags.
 *     Exits {@link EXIT.USAGE} (2). Scripts can distinguish this
 *     from a runtime failure.
 *
 *   - **Domain error** — the operation was syntactically fine but
 *     the tracker rejected it: not-found, validation, IO. Exits
 *     {@link EXIT.RUNTIME} (1). Classes are listed in
 *     {@link KNOWN_DOMAIN_ERRORS} so adding a new one is one
 *     import + one-line append rather than a new try/catch arm in
 *     every command.
 *
 * Wire it all together via {@link runCommand}.
 */

import {
  ArchivedReferenceError,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  BurndownError,
  FsAccessError,
  LabelError,
  LocttError,
  MilestoneError,
  ProjectError,
  ReorderError,
  SprintError,
  StaleBodyWriteError,
  TaskNotFoundError,
  UserError,
} from "@loctt/core";

/**
 * Process exit codes used across all `loctt` subcommands. Scripts and
 * tests can switch on these to distinguish "user said no" from "the
 * tracker is on a newer schema" from "you typed the command wrong."
 */
export const EXIT = {
  /** Command succeeded, or user declined a confirm prompt. */
  SUCCESS: 0,
  /** Domain/runtime error (validation, IO, schema mismatch, …). */
  RUNTIME: 1,
  /** Usage error: missing args, bad flag, mutually-exclusive flags. */
  USAGE: 2,
} as const;

/**
 * Thrown by commands when the *user's input* is wrong (missing arg,
 * bad flag combination). Carries an optional `usage` string that
 * {@link runCommand} prints as `Usage: …` after the error line.
 *
 * Domain errors (e.g. `ProjectError`) bubble out as themselves and
 * are mapped to {@link EXIT.RUNTIME} by the dispatcher; only throw
 * `UsageError` when the *user's input* is wrong.
 */
export class UsageError extends Error {
  readonly name = "UsageError" as const;
  constructor(message: string, readonly usage?: string) {
    super(message);
  }
}

/**
 * Domain-error classes that the CLI dispatcher knows how to report
 * cleanly: print `Error: <message>` to stderr, exit
 * {@link EXIT.RUNTIME}. Anything not in this list bubbles through
 * the top-level catch (which still prints a clean message but
 * cannot show a "this was a known kind of failure" hint).
 *
 * Listed once here so adding a new domain error class is a single
 * import + one-line append rather than a new try/catch arm in
 * every command.
 */
export const KNOWN_DOMAIN_ERRORS: ReadonlyArray<new (...args: never[]) => Error> = [
  ArchivedReferenceError,
  AttachmentExistsError,
  AttachmentNotFoundError,
  AttachmentSourceError,
  BurndownError,
  // A filesystem failure the user can act on — an unwritable .loctt/, a
  // full disk. Its message already names the cause and the remedy, so
  // it is a domain error (exit 1), not an unexpected crash.
  FsAccessError,
  LabelError,
  LocttError,
  MilestoneError,
  ProjectError,
  ReorderError,
  SprintError,
  // K10: a refused body write is a rejection the user can act on
  // (re-read, reapply, retry), not a crash. Its message already says
  // the text was NOT saved; without this it bubbles to main()'s
  // catch and reads as an internal failure.
  StaleBodyWriteError,
  TaskNotFoundError,
  UserError,
  // RelationshipError surfaces from link/unlink; not currently
  // imported here because the existing handlers let it bubble.
  // Add it when a future command catches it.
];

/**
 * Runs a command handler and maps thrown errors to the right exit
 * code + stderr message:
 * - `UsageError` → print `Error: …` (and `Usage: …` if provided),
 *   exit {@link EXIT.USAGE}.
 * - Any class in {@link KNOWN_DOMAIN_ERRORS} → print `Error: …`,
 *   exit {@link EXIT.RUNTIME}.
 * - Anything else → re-throw so the outer `main()` catch handles it.
 *
 * The body owns the success path: `runCommand` only touches
 * `process.exitCode` on a thrown error. A body that needs to
 * report partial success can set `process.exitCode` itself before
 * returning normally.
 */
export async function runCommand(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`Error: ${err.message}`);
      if (err.usage) console.error(`Usage: ${err.usage}`);
      process.exitCode = EXIT.USAGE;
      return;
    }
    if (err instanceof Error) {
      for (const Klass of KNOWN_DOMAIN_ERRORS) {
        if (err instanceof Klass) {
          console.error(`Error: ${err.message}`);
          // `detail` is where the machinery lives — a YAML parse
          // position, a Zod path. The web UI puts it behind a "Show
          // details" disclosure (ERR-16); the terminal has no such
          // affordance, so it prints, indented.
          //
          // Without this a `LocttError` carrying its whole diagnosis
          // in `detail` reduces to one flat sentence: a broken
          // `labels.yaml` printed "labels.yaml could not be parsed."
          // and nothing else, with the line and column the parser
          // gave us thrown away.
          const detail = err instanceof LocttError ? err.detail : undefined;
          if (detail !== undefined && detail !== err.message) {
            for (const line of detail.split("\n")) console.error(`  ${line}`);
          }
          process.exitCode = EXIT.RUNTIME;
          return;
        }
      }
    }
    throw err;
  }
}
