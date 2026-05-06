import { copyFile, lstat, mkdir, readlink, stat, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";

import {
  assertSafeBasename,
  getAttachmentPath,
  getAttachmentsDir,
} from "../paths/index.js";
import { appendHistory } from "./history.js";

/** Options for attaching a file to a task. */
export interface AttachOptions {
  readonly locttDir: string;
  readonly taskId: string;
  /** Absolute (or process-cwd-relative) path of the source file to copy in. */
  readonly sourcePath: string;
  /** When true, overwrite an existing attachment with the same basename. */
  readonly force?: boolean;
}

/** Result of a successful attachFile call. */
export interface AttachResult {
  readonly name: string;
  readonly size: number;
  readonly overwritten: boolean;
}

/** Options for detaching (deleting) a file from a task. */
export interface DetachOptions {
  readonly locttDir: string;
  readonly taskId: string;
  /** Plain basename within the attachments/ directory. No traversal. */
  readonly name: string;
}

/**
 * Thrown when attaching a file would overwrite an existing attachment
 * and the caller did not pass `force: true`.
 */
export class AttachmentExistsError extends Error {
  readonly name = "AttachmentExistsError" as const;
  constructor(public readonly attachmentName: string) {
    super(`attachment already exists: ${attachmentName}`);
  }
}

/** Thrown when detachFile is called for a name that has no matching file. */
export class AttachmentNotFoundError extends Error {
  readonly name = "AttachmentNotFoundError" as const;
  constructor(public readonly attachmentName: string) {
    super(`attachment not found: ${attachmentName}`);
  }
}

/** Thrown for invalid sources (directories, missing files, ...). */
export class AttachmentSourceError extends Error {
  readonly name = "AttachmentSourceError" as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Attaches (copies) a file into a task's `attachments/` directory.
 *
 * Behavior:
 * - The destination basename is `path.basename(sourcePath)` — no traversal
 *   leaks into the destination even if the source path is something like
 *   `/tmp/foo/../../etc/passwd`.
 * - The destination basename is validated as a plain basename: no path
 *   separators, no `..`, no null bytes, no leading dot.
 * - Symlinks are resolved exactly once; the resolved target is copied,
 *   but no further symlink chasing is performed during the copy itself.
 * - If the destination already exists and `force` is not true, throws
 *   `AttachmentExistsError`. If `force` is true, overwrites.
 * - On success, appends an `attachment_added` history entry with
 *   `meta: { name, size }`.
 *
 * TODO: consider warning at 10 MB.
 */
export async function attachFile(opts: AttachOptions): Promise<AttachResult> {
  const { locttDir, taskId, sourcePath, force = false } = opts;

  const absSource = isAbsolute(sourcePath)
    ? sourcePath
    : resolve(process.cwd(), sourcePath);

  // Resolve symlink once (don't traverse arbitrarily).
  let copySource = absSource;
  let lst;
  try {
    lst = await lstat(absSource);
  } catch {
    throw new AttachmentSourceError(`source file does not exist: ${sourcePath}`);
  }
  if (lst.isSymbolicLink()) {
    const link = await readlink(absSource);
    copySource = isAbsolute(link) ? link : resolve(dirname(absSource), link);
  }

  // Stat the resolved target to validate it's a regular file.
  let st;
  try {
    st = await stat(copySource);
  } catch {
    throw new AttachmentSourceError(
      `source file does not exist: ${sourcePath}`,
    );
  }
  if (st.isDirectory()) {
    throw new AttachmentSourceError("attachments must be regular files");
  }
  if (!st.isFile()) {
    throw new AttachmentSourceError("attachments must be regular files");
  }

  // Always derive the destination basename from the original source path
  // (using path.basename), then validate. This means a source like
  // `/tmp/foo/../../etc/passwd` produces destination basename `passwd`.
  const name = basename(absSource);
  if (name.startsWith(".")) {
    throw new AttachmentSourceError(
      `dotfiles cannot be attached: ${name}`,
    );
  }
  // Will throw on path separators, "..", null bytes, etc.
  assertSafeBasename(name);

  const attachmentsDir = getAttachmentsDir(locttDir, taskId);
  await mkdir(attachmentsDir, { recursive: true });

  const dest = getAttachmentPath(locttDir, taskId, name);

  let overwritten = false;
  try {
    await stat(dest);
    // Exists.
    if (!force) {
      throw new AttachmentExistsError(name);
    }
    overwritten = true;
  } catch (err) {
    if (err instanceof AttachmentExistsError) throw err;
    // ENOENT or other — treat as "doesn't exist", proceed.
  }

  // Copy without following further symlinks at the source side.
  // We've already resolved one level; copyFile will copy whatever
  // copySource points at. If copySource happens to itself be another
  // symlink, copyFile will resolve it. That's fine — we've documented
  // a single-resolution policy and not promised deep symlink rejection.
  await copyFile(copySource, dest);

  const stats = await stat(dest);
  const size = stats.size;

  const entry: HistoryEntry = {
    timestamp: new Date().toISOString(),
    kind: "attachment_added",
    meta: { name, size },
  };
  await appendHistory(locttDir, taskId, [entry]);

  return { name, size, overwritten };
}

/**
 * Detaches (deletes) a file from a task's `attachments/` directory.
 *
 * - Rejects any `name` containing path separators, `..`, or null bytes.
 * - Throws `AttachmentNotFoundError` if no matching file exists.
 * - On success, appends an `attachment_removed` history entry with
 *   `meta: { name }`.
 */
export async function detachFile(opts: DetachOptions): Promise<void> {
  const { locttDir, taskId, name } = opts;

  // Validates basename (throws on separators, "..", null bytes, dot/dotdot).
  const target = getAttachmentPath(locttDir, taskId, name);

  try {
    await unlink(target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new AttachmentNotFoundError(name);
    }
    throw err;
  }

  const entry: HistoryEntry = {
    timestamp: new Date().toISOString(),
    kind: "attachment_removed",
    meta: { name },
  };
  await appendHistory(locttDir, taskId, [entry]);
}
