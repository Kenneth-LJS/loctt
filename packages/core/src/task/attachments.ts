import { copyFile, lstat, mkdir, stat, unlink } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";

import {
  assertSafeBasename,
  getAttachmentPath,
  getAttachmentsDir,
} from "../paths/index.js";
import { appendHistory } from "./history.js";

/**
 * Default maximum attachment size, in bytes (50 MB). Callers can override
 * via `AttachOptions.maxBytes`. Picked to match the web app's multipart
 * per-file cap so a file accepted via either entry point behaves the same.
 */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

/** Options for attaching a file to a task. */
export interface AttachOptions {
  readonly locttDir: string;
  readonly taskId: string;
  /** Absolute (or process-cwd-relative) path of the source file to copy in. */
  readonly sourcePath: string;
  /** When true, overwrite an existing attachment with the same basename. */
  readonly force?: boolean;
  /**
   * Maximum file size in bytes. Defaults to
   * {@link DEFAULT_MAX_ATTACHMENT_BYTES}. Pass `Infinity` to disable.
   */
  readonly maxBytes?: number;
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
 * - Symlinks are rejected outright; callers must pass the path to the
 *   target file directly.
 * - Files larger than `maxBytes` (default
 *   {@link DEFAULT_MAX_ATTACHMENT_BYTES}) are rejected before any copy.
 * - If the destination already exists and `force` is not true, throws
 *   `AttachmentExistsError`. If `force` is true, overwrites.
 * - On success, appends an `attachment_added` history entry with
 *   `meta: { name, size }`.
 */
export async function attachFile(opts: AttachOptions): Promise<AttachResult> {
  const { locttDir, taskId, sourcePath, force = false } = opts;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;

  const absSource = isAbsolute(sourcePath)
    ? sourcePath
    : resolve(process.cwd(), sourcePath);

  // Reject symlinks outright. We don't want to silently copy the target
  // contents under the link's basename — that's misleading. The caller
  // should pass the target path directly.
  let lst;
  try {
    lst = await lstat(absSource);
  } catch {
    throw new AttachmentSourceError(`source file does not exist: ${sourcePath}`);
  }
  if (lst.isSymbolicLink()) {
    throw new AttachmentSourceError(
      `source path is a symlink; attach the target file directly: ${absSource}`,
    );
  }
  if (lst.isDirectory()) {
    throw new AttachmentSourceError("attachments must be regular files");
  }
  if (!lst.isFile()) {
    throw new AttachmentSourceError("attachments must be regular files");
  }
  if (lst.size > maxBytes) {
    throw new AttachmentSourceError(
      `attachment is ${lst.size} bytes; max is ${maxBytes}`,
    );
  }
  const copySource = absSource;

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

  // Symlinks at the source were already rejected above via lstat.
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
