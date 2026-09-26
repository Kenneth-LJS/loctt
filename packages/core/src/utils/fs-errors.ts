/**
 * Turns filesystem errnos into errors that name the cause.
 *
 * Node reports these precisely — `EACCES` is not a mystery, it is a
 * permission the user can change — but an unwrapped `Error: EACCES:
 * permission denied, open '...'` reaches a surface as an unattributable
 * failure. Every front-end then reports a knowable cause as unknown,
 * which `flow-error-handling.md` ERR-31 names as a violation, and
 * ERR-11/ERR-12 ask for by name.
 *
 * These are also the failures a user is uniquely able to fix: LocTT
 * cannot grant itself write permission or free up a disk. Naming the
 * path and the remedy is the whole value.
 */

/** What a caller can do about the failure. Mirrors the API's recovery kinds. */
export type FsFailureKind =
  | "permission_denied"
  | "disk_full"
  | "read_only"
  | "too_many_open_files"
  | "quota_exceeded";

/**
 * A filesystem failure whose cause is known and stated.
 *
 * `message` is written for a user: it names the path and what to do.
 * The original error is kept on `cause` so a surface can still put the
 * raw errno behind a "show details" affordance without putting it in
 * the headline (ERR-16).
 */
export class FsAccessError extends Error {
  readonly kind: FsFailureKind;
  readonly path: string;
  readonly code: string;

  constructor(kind: FsFailureKind, path: string, code: string, message: string, cause: unknown) {
    super(message, { cause });
    this.name = "FsAccessError";
    this.kind = kind;
    this.path = path;
    this.code = code;
  }
}

interface ErrnoLike {
  readonly code?: unknown;
  readonly path?: unknown;
}

function errnoOf(err: unknown): { code: string; path: string } | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const { code, path } = err as ErrnoLike;
  if (typeof code !== "string") return undefined;
  return { code, path: typeof path === "string" ? path : "" };
}

/**
 * Builds the user-facing sentence for a known errno.
 *
 * Paths inside `.loctt/` are deliberately included: they are the user's
 * own files and the thing they must go and fix. ERR-16 keeps LocTT's
 * internals out of error copy but carves these out explicitly.
 */
function describe(kind: FsFailureKind, path: string): string {
  const at = path.length > 0 ? ` (${path})` : "";
  switch (kind) {
    case "permission_denied":
      return `Permission denied writing to this file${at}. Check the file's permissions and the ownership of the .loctt directory.`;
    case "read_only":
      return `This file is on a read-only filesystem${at} and cannot be saved to.`;
    case "disk_full":
      return `There is no space left on the disk, so the save failed${at}. Free up space and try again.`;
    case "quota_exceeded":
      return `Your disk quota is exhausted, so the save failed${at}. Free up space and try again.`;
    case "too_many_open_files":
      return `The system ran out of file handles while saving${at}. Close some applications, or raise the open-file limit, and try again.`;
  }
}

const KINDS: Readonly<Record<string, FsFailureKind>> = {
  EACCES: "permission_denied",
  EPERM: "permission_denied",
  EROFS: "read_only",
  ENOSPC: "disk_full",
  EDQUOT: "quota_exceeded",
  EMFILE: "too_many_open_files",
  ENFILE: "too_many_open_files",
};

/**
 * Rethrows a filesystem error as an `FsAccessError` when the errno is
 * one a user can act on; otherwise rethrows it untouched.
 *
 * Unrecognised errors pass through deliberately. Wrapping everything
 * would turn genuinely unknown faults into confidently-worded wrong
 * explanations, which is worse than admitting ignorance — ERR-30 permits
 * an unknown cause, ERR-31 forbids a *misattributed* one.
 *
 * `fallbackPath` is used when the error carries no `path` of its own,
 * which happens on fd-based operations.
 */
export function rethrowFsError(err: unknown, fallbackPath: string): never {
  const errno = errnoOf(err);
  if (errno === undefined) throw err;
  const kind = KINDS[errno.code];
  if (kind === undefined) throw err;
  const path = errno.path.length > 0 ? errno.path : fallbackPath;
  throw new FsAccessError(kind, path, errno.code, describe(kind, path), err);
}

/**
 * Runs a filesystem operation, mapping actionable errnos on the way out.
 *
 * Prefer this at the point of the write rather than at a surface
 * boundary: the CLI, MCP and web server share these paths, so mapping
 * once here fixes the blind spot in all three.
 */
export async function withFsErrors<T>(path: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    rethrowFsError(err, path);
  }
}

/**
 * A filesystem error's message without the path Node embeds in it, for
 * an aggregator that already prints `path: reason` (A350).
 *
 * Node writes `EACCES: permission denied, open '/x/task.md'`; beside a
 * path that list line already names, the tail says the path twice. This
 * keeps the code and Node's own short description (`EACCES: permission
 * denied`) and drops the `, open '<path>'` tail. Returns `undefined`
 * when `err` is not an errno error that names a path in its message, so
 * the caller falls back to the message as it is.
 */
export function errnoReasonWithoutPath(err: unknown): string | undefined {
  const errno = errnoOf(err);
  if (errno === undefined || errno.path === "" || !(err instanceof Error)) return undefined;
  const message = err.message;
  const quoted = message.indexOf(`'${errno.path}'`);
  if (quoted === -1) return undefined;
  const cut = message.lastIndexOf(", ", quoted);
  if (cut > 0) return message.slice(0, cut);
  // An unfamiliar shape: still never repeat the path.
  return message.split(`'${errno.path}'`).join("").trim();
}
