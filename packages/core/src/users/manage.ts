import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";

import type { Task, UserProfile } from "@loctt/contracts";
import { ulid } from "ulid";

import { getUserDir } from "../paths/index.js";
import { withStateLock } from "../state/index.js";
import { writeTask } from "../task/io.js";
import { loadAllTasks } from "../task/lookup.js";
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

const ALLOWED_AVATAR_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
/** Maximum avatar file size in bytes (2 MB). */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/**
 * Copies an avatar source file into the user's folder. Returns the
 * basename written (e.g. `avatar.png`). Rejects unsupported
 * extensions and files larger than 2 MB.
 */
async function copyAvatar(
  locttDir: string,
  userId: string,
  sourcePath: string,
): Promise<string> {
  const actualSource = sourcePath.startsWith("file://")
    ? fileURLToPath(sourcePath)
    : sourcePath;
  const ext = extname(actualSource).toLowerCase();
  if (!ALLOWED_AVATAR_EXTENSIONS.has(ext)) {
    throw new UserError(
      `unsupported avatar extension '${ext || "(none)"}'; ` +
      `must be one of ${[...ALLOWED_AVATAR_EXTENSIONS].join(", ")}`,
    );
  }
  const info = await stat(actualSource);
  if (info.size > MAX_AVATAR_BYTES) {
    throw new UserError(
      `avatar is ${info.size} bytes; max is ${MAX_AVATAR_BYTES}`,
    );
  }
  const targetName = `avatar${ext}`;
  const targetPath = `${getUserDir(locttDir, userId)}/${targetName}`;
  await copyFile(actualSource, targetPath);
  return targetName;
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

