/**
 * Reading a file has three outcomes, not two.
 *
 * Every config loader in core did `readFile` then parse, so a caller
 * could not tell "this file is not there" from "this file is there and
 * I could not read it". Most call sites re-derived the distinction by
 * hand with `err.code === "ENOENT"`. Six did not, and each turned a
 * read failure into a factual claim about data nobody had read:
 * `list_views` reported "No saved views configured", `git status`
 * reported `Enabled: false`, `config list` printed blanks, and
 * `postComment` read `[]` and wrote a three-comment thread down to one.
 *
 * The fix is to stop making the distinction optional. `readFileState`
 * returns which of the three happened and lets the caller decide —
 * absent is usually a supported state, unreadable almost never is.
 *
 * P-11 is the rule this serves: LocTT never overwrites what it could
 * not read, and never reports a failure as an absence.
 */

import { readFile } from "node:fs/promises";

/** True when the error is "the file does not exist", not "it will not parse". */
export function isMissingFile(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/**
 * The file is not there. A supported state for most config: a fresh
 * tracker has not written `labels.yaml` yet and should still work.
 */
export interface AbsentFile {
  readonly state: "absent";
  readonly path: string;
}

/** The file was read. `content` is the raw text, not yet parsed. */
export interface LoadedFile {
  readonly state: "loaded";
  readonly path: string;
  readonly content: string;
}

/**
 * The file exists and could not be read — permissions, I/O error, a
 * directory where a file was expected.
 *
 * Distinct from `absent` because the correct response differs: absent
 * means "carry on with nothing", unreadable means "stop, and do not
 * write over it".
 */
export interface UnreadableFile {
  readonly state: "unreadable";
  readonly path: string;
  /** The errno, e.g. `EACCES`. Empty when the cause carried none. */
  readonly code: string;
  /** One sentence naming the file and the cause, safe to show a user. */
  readonly reason: string;
  readonly cause: unknown;
}

export type FileState = AbsentFile | LoadedFile | UnreadableFile;

function codeOf(err: unknown): string {
  const code = (err as NodeJS.ErrnoException)?.code;
  return typeof code === "string" ? code : "";
}

/**
 * Reads a file, reporting which of the three outcomes occurred instead
 * of collapsing two of them into a default value.
 *
 * Never throws for the ordinary cases. A caller that wants to fail on
 * `unreadable` does so explicitly, which is the point — the decision
 * becomes visible at the call site rather than buried in a bare catch.
 */
export async function readFileState(path: string): Promise<FileState> {
  try {
    return { state: "loaded", path, content: await readFile(path, "utf-8") };
  } catch (err) {
    if (isMissingFile(err)) return { state: "absent", path };
    const code = codeOf(err);
    return {
      state: "unreadable",
      path,
      code,
      reason: describeUnreadable(path, code),
      cause: err,
    };
  }
}

/**
 * One sentence naming the file and the cause.
 *
 * The path is included deliberately: it is the user's own file and the
 * thing they must go and fix. `fs-errors.ts` carries the same rule for
 * the write side, per ERR-16's carve-out.
 */
function describeUnreadable(path: string, code: string): string {
  switch (code) {
    case "EACCES":
    case "EPERM":
      return `LocTT does not have permission to read ${path}. Check the file's permissions and the ownership of the .loctt directory.`;
    case "EISDIR":
      return `${path} is a directory, but LocTT expected a file.`;
    case "ELOOP":
      return `${path} is a symlink loop, so LocTT could not read it.`;
    case "EMFILE":
    case "ENFILE":
      return `The system ran out of file handles while LocTT was reading ${path}. Close some applications, or raise the open-file limit, and try again.`;
    default:
      return code.length > 0
        ? `LocTT could not read ${path} (${code}).`
        : `LocTT could not read ${path}.`;
  }
}

/**
 * Raised when a caller requires a file it could not read.
 *
 * Carries the path and errno so a surface can render the cause rather
 * than reporting a knowable failure as unknown (ERR-31).
 */
export class UnreadableFileError extends Error {
  readonly name = "UnreadableFileError" as const;
  readonly path: string;
  readonly code: string;

  constructor(file: UnreadableFile) {
    super(file.reason, { cause: file.cause });
    this.path = file.path;
    this.code = file.code;
  }
}

/**
 * Narrows a `FileState` to its content, treating absent as the caller's
 * supplied default and throwing on unreadable.
 *
 * For the common loader shape: "a missing file means empty, but a file
 * I cannot read means stop." Callers that need to *report* the
 * unreadable case rather than throw should switch on `state` directly.
 */
export function contentOr(file: FileState, whenAbsent: string): string {
  switch (file.state) {
    case "loaded":
      return file.content;
    case "absent":
      return whenAbsent;
    case "unreadable":
      throw new UnreadableFileError(file);
  }
}
