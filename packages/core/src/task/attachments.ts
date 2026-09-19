import { copyFile, lstat, mkdir, realpath, rm, stat, unlink } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

import type { HistoryEntry } from "@loctt/contracts";

import {
  assertSafeBasename,
  getAttachmentPath,
  getAttachmentsDir,
  isPathContained,
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
  /**
   * When set, confine the SOURCE path to inside this directory (the
   * tracker root): a source that resolves outside it — an absolute path
   * elsewhere, a `../` escape, or a symlink whose real target is outside
   * — is rejected before any read (F1). The agent (MCP) surface passes
   * the tracker root here so an auto-approved agent cannot copy
   * `~/.ssh/id_rsa` into `.loctt/` and have git-backed mode push it off
   * the machine. Left unset, the source may be any readable path
   * (unchanged behaviour) — the human CLI does not confine, because a
   * person running `loctt attach` choosing a file in ~/Downloads is a
   * deliberate act, not a steered one. See decisions.md § 8.
   */
  readonly confineToRoot?: string;
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
 * - When `confineToRoot` is set, the source must resolve to inside that
 *   directory (the tracker root); a path outside it is rejected before
 *   any read (F1). The MCP/agent surface sets this; the human CLI does
 *   not (see the option's doc and decisions.md § 8).
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

  // F1: confine the source into the tracker root when the caller asks
  // (the MCP/agent surface does). Two layers:
  //  - a lexical check on the resolved path, which catches an absolute
  //    path elsewhere or a `../` escape even for a source that does not
  //    exist yet; and
  //  - a real-path check that resolves every symlink in the chain, which
  //    catches a source reached through an intermediate-directory symlink
  //    that points outside (the top-level symlink guard below only sees a
  //    source that is *itself* a link). realpath needs the file to exist;
  //    a missing source falls through to the lstat below, which raises the
  //    existing "source file does not exist" message.
  if (opts.confineToRoot !== undefined) {
    const root = opts.confineToRoot;
    const outside = (): never => {
      throw new AttachmentSourceError(
        `source path is outside the tracker and cannot be attached over MCP: `
        + `${absSource}. Stage the file inside the tracker first (under `
        + `${resolve(root)}), then attach it by its path there.`,
      );
    };
    if (!isPathContained(root, absSource)) outside();
    try {
      const realSource = await realpath(absSource);
      const realRoot = await realpath(root).catch(() => resolve(root));
      if (!isPathContained(realRoot, realSource)) outside();
    } catch (err) {
      // A missing source (ENOENT) is left to the lstat below so the
      // "does not exist" message is the one the caller sees; only a real
      // containment failure throws here.
      if (err instanceof AttachmentSourceError) throw err;
    }
  }

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
  //
  // A destination the filesystem refuses — most often ENAMETOOLONG,
  // since the task directory's path counts toward the limit even when
  // the basename alone is legal — must not surface as a raw errno, and
  // must not leave a truncated file behind for the next `attach --force`
  // to overwrite silently (REL-C5). copyFile can create the destination
  // before failing, so the cleanup is not hypothetical.
  try {
    await copyFile(copySource, dest);
  } catch (err) {
    await rm(dest, { force: true }).catch(() => {
      // Best-effort: the copy already failed, and a cleanup error must
      // not replace the message that explains why.
    });
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENAMETOOLONG") {
      throw new AttachmentSourceError(
        `attachment name is too long for the filesystem: "${name}" `
        + `(${name.length} characters). Most filesystems cap a single name at `
        + `255 characters, and the task's directory path counts toward the `
        + `total. Rename the file and attach it again.`,
      );
    }
    throw err;
  }

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
