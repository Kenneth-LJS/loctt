import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Task, UserProfile } from "@loctt/contracts";
import sharp from "sharp";
import { ulid } from "ulid";

import { getUserDir } from "../paths/index.js";
import { withStateLock } from "../state/index.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/load-all.js";
import {
  readCurrentUserId,
  writeCurrentUserId,
} from "./current.js";
import {
  loadAllUsers,
  loadUserProfile,
  saveUserProfile,
  userExists,
} from "./profile.js";

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/**
 * Returns the system-detected timezone, falling back to UTC if the
 * Intl API doesn't return one.
 */
export function detectSystemTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export interface CreateUserOptions {
  /**
   * Display name. Required. Not unique — UUIDs disambiguate.
   */
  readonly name: string;
  readonly email?: string;
  /** IANA timezone. Defaults to the system timezone. */
  readonly timezone?: string;
  /**
   * Absolute path to an avatar image. Will be copied into the
   * user's folder as `avatar.<ext>`.
   */
  readonly avatarSourcePath?: string;
  /**
   * If true, also write `.current-user` so the new user becomes
   * active immediately.
   */
  readonly switchToOnCreate?: boolean;
}

/**
 * Creates a new user folder, profile, and (optionally) avatar copy.
 * Returns the generated profile.
 */
export async function createUser(
  locttDir: string,
  options: CreateUserOptions,
): Promise<UserProfile> {
  if (options.name.trim().length === 0) {
    throw new UserError("name must be non-empty");
  }

  return withStateLock(locttDir, async () => {
    const id = ulid();
    const timezone = options.timezone ?? detectSystemTimezone();
    const userDir = getUserDir(locttDir, id);
    await mkdir(userDir, { recursive: true });

    let avatar: string | undefined;
    if (options.avatarSourcePath !== undefined) {
      avatar = await copyAvatar(locttDir, id, options.avatarSourcePath);
    }

    const profile: UserProfile = {
      id,
      name: options.name,
      timezone,
      ...(options.email !== undefined ? { email: options.email } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
    };
    await saveUserProfile(locttDir, profile);

    if (options.switchToOnCreate) {
      await writeCurrentUserId(locttDir, id);
    }

    return profile;
  });
}

/** Maximum avatar source size in bytes (10 MB). */
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
/** Maximum dimension (width or height) of the stored avatar in px. */
const AVATAR_MAX_DIMENSION = 500;
/** JPEG quality of the stored avatar (1-100). */
const AVATAR_JPEG_QUALITY = 85;
/** Stored avatar filename. Always JPG regardless of input format. */
const AVATAR_FILENAME = "avatar.jpg";

/**
 * Heuristic SVG sniffer for the avatar pipeline's pre-decode reject.
 * Looks past optional UTF-8/UTF-16 BOM and leading whitespace; if
 * the next non-trivial token looks like XML (declaration, doctype,
 * comment, or processing instruction) keeps skipping until a real
 * tag opener; then matches `<svg` case-insensitive.
 *
 * Doesn't replace the post-decode `metadata.format` check inside
 * `copyAvatar` — both run, with this sniff serving as the cheap
 * fast-path DoS rejection (no full sharp decode for an SVG payload)
 * and `metadata.format` as the authoritative gate against any
 * format the sniff failed to flag.
 */
function looksLikeSvg(bytes: Buffer): boolean {
  // 1. Strip BOMs (UTF-8 EF BB BF; UTF-16 LE FF FE; UTF-16 BE FE FF).
  //    For the UTF-16 cases, also fold every other byte (the high
  //    byte for ASCII chars in UTF-16 is 0x00) so the substring
  //    comparison below works against ASCII-only XML prologues.
  let view = bytes;
  if (view.length >= 3 && view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
    view = view.slice(3);
  } else if (view.length >= 2 && view[0] === 0xff && view[1] === 0xfe) {
    // UTF-16 LE: keep low byte of each pair.
    const out: number[] = [];
    for (let i = 2; i + 1 < view.length; i += 2) {
      if (view[i + 1] === 0) out.push(view[i] as number);
      else return false; // non-ASCII; SVG entry point would be ASCII
    }
    view = Buffer.from(out);
  } else if (view.length >= 2 && view[0] === 0xfe && view[1] === 0xff) {
    // UTF-16 BE: keep high byte of each pair (which is the ASCII char).
    const out: number[] = [];
    for (let i = 2; i + 1 < view.length; i += 2) {
      if (view[i] === 0) out.push(view[i + 1] as number);
      else return false;
    }
    view = Buffer.from(out);
  }

  // 2. Skip whitespace + XML preamble tokens (PI, comment, doctype)
  //    until we hit a real start-tag opener `<x` (where x is a
  //    letter). Bound the search at 4 KB to avoid a payload that
  //    pads with infinite comments before its `<svg`.
  const MAX_PREAMBLE = 4096;
  const head = view.slice(0, MAX_PREAMBLE).toString("utf-8").toLowerCase();
  let i = 0;
  while (i < head.length) {
    const c = head.charCodeAt(i);
    // Whitespace.
    if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) { i += 1; continue; }
    // XML processing instruction `<?...?>` — skip to closing `?>`.
    if (head.startsWith("<?", i)) {
      const end = head.indexOf("?>", i + 2);
      if (end === -1) return false;
      i = end + 2;
      continue;
    }
    // XML/HTML comment `<!--...-->` — skip to closing `-->`.
    if (head.startsWith("<!--", i)) {
      const end = head.indexOf("-->", i + 4);
      if (end === -1) return false;
      i = end + 3;
      continue;
    }
    // DOCTYPE / CDATA / etc. `<!...>` — skip to closing `>`.
    if (head.startsWith("<!", i)) {
      const end = head.indexOf(">", i + 2);
      if (end === -1) return false;
      i = end + 1;
      continue;
    }
    // First real start-tag: is it <svg?
    return head.startsWith("<svg", i);
  }
  return false;
}

/**
 * Imports an avatar source image into the user's folder. The source
 * is decoded by sharp (so any format sharp supports — png, jpg,
 * webp, gif, tiff, avif, etc. — is accepted), resized so the longer
 * side is at most {@link AVATAR_MAX_DIMENSION}px while preserving
 * aspect ratio, re-encoded as JPG, and atomically written to
 * `<userDir>/avatar.jpg`.
 *
 * Returns the basename written. Rejects:
 * - sources larger than {@link MAX_AVATAR_BYTES} (DoS guard before
 *   we hand untrusted bytes to sharp's decoder),
 * - inputs sharp can't decode (invalid image, corrupted, or an
 *   unsupported format),
 * - sources that don't exist at the given path.
 *
 * Always-JPG output gives the web layer a uniform served
 * content-type (no SVG XSS hazard, no per-extension MIME guessing)
 * and a smaller on-disk file via the resize+re-encode.
 */
async function copyAvatar(
  locttDir: string,
  userId: string,
  sourcePath: string,
): Promise<string> {
  const actualSource = sourcePath.startsWith("file://")
    ? fileURLToPath(sourcePath)
    : sourcePath;

  // Stat first so we can reject huge files BEFORE reading them
  // into memory and handing them to sharp's decoder. Also surfaces
  // a clearer error than sharp's "input file is missing".
  let info;
  try {
    info = await stat(actualSource);
  } catch {
    throw new UserError(`avatar source not found: ${actualSource}`);
  }
  if (info.size > MAX_AVATAR_BYTES) {
    throw new UserError(
      `avatar source is ${info.size} bytes; max is ${MAX_AVATAR_BYTES}`,
    );
  }

  // Read into a buffer rather than streaming so a malformed image
  // surfaces a single clean error from the sharp pipeline rather
  // than a half-written destination file.
  const sourceBytes = await readFile(actualSource);

  // Explicitly reject SVG inputs even when sharp could decode them.
  // SVG is the XSS vector that motivated the always-JPG output —
  // a malformed SVG with embedded <script> can be downgraded into
  // an image at decode time, but our policy is "no SVG anywhere
  // in the avatar pipeline." Detect by sniffing the leading bytes
  // (after any UTF-8 BOM and whitespace) for the SVG signatures.
  if (looksLikeSvg(sourceBytes)) {
    throw new UserError(
      "SVG avatars are not supported; use a raster image (PNG, JPG, WEBP, GIF, AVIF, …)",
    );
  }

  // Authoritative format check via sharp's own detector. This
  // backstops the looksLikeSvg() pre-decode heuristic — if sharp
  // sees an SVG we missed at the byte sniff (e.g. unusual encoding
  // declaration, XML namespace tricks), we still reject before
  // re-encoding it.
  try {
    const meta = await sharp(sourceBytes).metadata();
    if (meta.format === "svg") {
      throw new UserError(
        "SVG avatars are not supported; use a raster image (PNG, JPG, WEBP, GIF, AVIF, …)",
      );
    }
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError(
      `avatar could not be decoded as an image: ${(err as Error).message}`,
    );
  }

  let processed: Buffer;
  try {
    processed = await sharp(sourceBytes)
      .rotate() // honor EXIF orientation
      .resize({
        width: AVATAR_MAX_DIMENSION,
        height: AVATAR_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: AVATAR_JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (err) {
    throw new UserError(
      `avatar could not be decoded as an image: ${(err as Error).message}`,
    );
  }

  const userDir = getUserDir(locttDir, userId);
  await mkdir(userDir, { recursive: true });
  const targetPath = `${userDir}/${AVATAR_FILENAME}`;
  // Atomic write: temp file + rename, so a crash mid-write never
  // leaves a corrupt avatar.jpg readable by the web layer.
  const tmpPath = `${targetPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, processed);
  try {
    await rename(tmpPath, targetPath);
  } catch (err) {
    // Cross-device rename or permission flap mid-write: clean up
    // the temp file so we don't accumulate leftovers across
    // retried uploads.
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }

  return AVATAR_FILENAME;
}

export interface EditUserOptions {
  readonly name?: string;
  readonly email?: string | null;        // null clears the field
  readonly timezone?: string;
  readonly avatarSourcePath?: string;    // replaces existing avatar
}

/** Mutates an existing user's profile. */
export async function updateUser(
  locttDir: string,
  userId: string,
  changes: EditUserOptions,
): Promise<UserProfile> {
  return withStateLock(locttDir, async () => {
    const existing = await loadUserProfile(locttDir, userId);

    let avatar = existing.avatar;
    if (changes.avatarSourcePath !== undefined) {
      avatar = await copyAvatar(locttDir, userId, changes.avatarSourcePath);
    }

    const updated: UserProfile = {
      id: existing.id,
      name: changes.name ?? existing.name,
      timezone: changes.timezone ?? existing.timezone,
      ...((changes.email === null
        ? {}
        : changes.email !== undefined
          ? { email: changes.email }
          : existing.email !== undefined
            ? { email: existing.email }
            : {})),
      ...(avatar !== undefined ? { avatar } : {}),
      ...(existing.archived === true ? { archived: true } : {}),
    };

    await saveUserProfile(locttDir, updated);
    return updated;
  });
}

/**
 * Marks a user as archived. Blocked when the target is the active
 * user — switch to another user first.
 */
export async function archiveUser(locttDir: string, userId: string): Promise<void> {
  await assertNotActiveUser(locttDir, userId, "archive");
  await withStateLock(locttDir, async () => {
    const profile = await loadUserProfile(locttDir, userId);
    if (profile.archived === true) return;
    await saveUserProfile(locttDir, { ...profile, archived: true });
  });
}

/** Clears the archived flag on a user. */
export async function unarchiveUser(locttDir: string, userId: string): Promise<void> {
  await withStateLock(locttDir, async () => {
    const profile = await loadUserProfile(locttDir, userId);
    if (profile.archived !== true) return;
    const next: UserProfile = {
      id: profile.id,
      name: profile.name,
      timezone: profile.timezone,
      ...(profile.email !== undefined ? { email: profile.email } : {}),
      ...(profile.avatar !== undefined ? { avatar: profile.avatar } : {}),
    };
    await saveUserProfile(locttDir, next);
  });
}

export interface DeleteUserOptions {
  /** Remap affected tasks' assignee/reporter to this user ID. */
  readonly remapTo?: string;
  /** Set affected tasks' assignee/reporter to null. */
  readonly unassign?: boolean;
}

/**
 * Hard-deletes a user. Refuses on the active user. When the user
 * has any task references, requires exactly one of `remapTo` or
 * `unassign`. After rewriting affected tasks, removes the user
 * folder entirely (`.loctt/users/<id>/`).
 */
export async function deleteUser(
  locttDir: string,
  userId: string,
  options: DeleteUserOptions = {},
): Promise<{ remappedAssigneeCount: number; remappedReporterCount: number }> {
  if (options.remapTo !== undefined && options.unassign === true) {
    throw new UserError("--remap-to and --unassign are mutually exclusive");
  }
  await assertNotActiveUser(locttDir, userId, "delete");
  if (!(await userExists(locttDir, userId))) {
    throw new UserError(`unknown user: ${userId}`);
  }

  return withStateLock(locttDir, async () => {
    const tasks = await loadAllTasks(locttDir);
    const affected = tasks.filter(
      t => t.frontmatter.assignee === userId || t.frontmatter.reporter === userId,
    );

    let remappedAssigneeCount = 0;
    let remappedReporterCount = 0;

    if (affected.length > 0) {
      if (options.remapTo === undefined && options.unassign !== true) {
        throw new UserError(
          `user '${userId}' has ${affected.length} task reference(s); ` +
          `pass remapTo or unassign to proceed`,
        );
      }
      if (options.remapTo !== undefined) {
        if (!(await userExists(locttDir, options.remapTo))) {
          throw new UserError(`unknown remap target user: ${options.remapTo}`);
        }
        if (options.remapTo === userId) {
          throw new UserError(`remap target must differ from the user being deleted`);
        }
      }

      const operationNow = new Date().toISOString();
      for (const task of affected) {
        const newFm = { ...task.frontmatter };
        let touched = false;
        if (newFm.assignee === userId) {
          if (options.remapTo !== undefined) {
            (newFm as { assignee?: string }).assignee = options.remapTo;
          } else {
            delete (newFm as { assignee?: string }).assignee;
          }
          remappedAssigneeCount += 1;
          touched = true;
        }
        if (newFm.reporter === userId) {
          if (options.remapTo !== undefined) {
            (newFm as { reporter?: string }).reporter = options.remapTo;
          } else {
            delete (newFm as { reporter?: string }).reporter;
          }
          remappedReporterCount += 1;
          touched = true;
        }
        if (touched) {
          (newFm as { updated_at: string }).updated_at = operationNow;
          const updated: Task = { ...task, frontmatter: newFm };
          await writeTask(locttDir, task.frontmatter.id, updated);
        }
      }
    }

    // Finally remove the user folder entirely.
    await rm(getUserDir(locttDir, userId), { recursive: true, force: true });

    return { remappedAssigneeCount, remappedReporterCount };
  });
}

async function assertNotActiveUser(
  locttDir: string,
  userId: string,
  verb: string,
): Promise<void> {
  const current = await readCurrentUserId(locttDir);
  if (current === userId) {
    throw new UserError(
      `cannot ${verb} the active user; switch to another user first`,
    );
  }
}

/**
 * Resolves a user reference (ULID, exact name, or unique
 * case-insensitive name prefix) against the registered users.
 * Useful for CLI/MCP commands that accept either form.
 *
 * Resolution order: ULID match → exact name match → unique
 * case-insensitive name prefix. Ambiguous prefixes throw.
 */
export async function resolveUserRef(
  locttDir: string,
  ref: string,
): Promise<UserProfile> {
  if (await userExists(locttDir, ref)) {
    return loadUserProfile(locttDir, ref);
  }
  const all = await loadAllUsers(locttDir);
  const exact = all.filter(u => u.name === ref);
  if (exact.length === 1) {
    const only = exact[0];
    if (only) return only;
  }
  if (exact.length > 1) {
    throw new UserError(
      `multiple users named '${ref}'; refer by ID instead`,
    );
  }
  const lowered = ref.toLowerCase();
  const prefix = all.filter(u => u.name.toLowerCase().startsWith(lowered));
  if (prefix.length === 1) {
    const only = prefix[0];
    if (only) return only;
  }
  if (prefix.length > 1) {
    throw new UserError(
      `'${ref}' matches ${prefix.length} users (${prefix.map(u => u.name).join(", ")}); ` +
      `refer by ID or full name instead`,
    );
  }
  throw new UserError(`unknown user: ${ref}`);
}

/**
 * Returns the active user's profile. If `.current-user` is missing
 * or points at a deleted user, attempts to repair by picking any
 * non-archived user and stamping it as the active one. If no users
 * exist at all, returns null — caller should bootstrap a default.
 */
export async function getCurrentUser(locttDir: string): Promise<UserProfile | null> {
  const id = await readCurrentUserId(locttDir);
  if (id !== null && (await userExists(locttDir, id))) {
    return loadUserProfile(locttDir, id);
  }
  // Self-heal: pick any non-archived user, stamp current-user.
  const all = await loadAllUsers(locttDir);
  const candidate = all.find(u => u.archived !== true) ?? all[0];
  if (candidate) {
    await writeCurrentUserId(locttDir, candidate.id);
    return candidate;
  }
  return null;
}

/**
 * Switches the active user. Throws if the target user doesn't
 * exist.
 */
export async function switchCurrentUser(
  locttDir: string,
  userId: string,
): Promise<void> {
  if (!(await userExists(locttDir, userId))) {
    throw new UserError(`unknown user: ${userId}`);
  }
  await writeCurrentUserId(locttDir, userId);
}

/**
 * Bootstraps a default user when none exist. Idempotent: if any
 * user exists, this is a no-op. The default user's name is
 * pulled from `$USER` (env), falling back to `you`.
 */
export async function ensureDefaultUser(locttDir: string): Promise<UserProfile> {
  const existing = await loadAllUsers(locttDir);
  if (existing.length > 0) {
    const current = await getCurrentUser(locttDir);
    if (current) return current;
    // Existing users but no current — point at the first.
    const first = existing[0];
    if (first) {
      await writeCurrentUserId(locttDir, first.id);
      return first;
    }
  }
  const name = process.env["USER"] || process.env["USERNAME"] || "you";
  return createUser(locttDir, { name, switchToOnCreate: true });
}

