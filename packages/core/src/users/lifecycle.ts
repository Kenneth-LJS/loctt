import { mkdir, rm } from "node:fs/promises";

import type { UserProfile } from "@loctt/contracts";
import { ulid } from "ulid";

import { getUserDir } from "../paths/index.js";
import {
  appendJournalEntry,
  clearJournalEntry,
  loadJournal,
  registerRecoveryHandler,
  replayTaskRemap,
  saveJournal,
  withStateLock,
} from "../state/index.js";
import type { JournalEntry } from "../state/journal.js";
import { loadAllTasks } from "../task/load-all.js";
import { copyAvatar } from "./avatar.js";
import { readCurrentUserId, writeCurrentUserId } from "./current.js";
import { UserError } from "./errors.js";
import { loadUserProfile, saveUserProfile, userExists } from "./profile.js";

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
    const affectedAssignee = tasks.filter(t => t.frontmatter.assignee === userId);
    const affectedReporter = tasks.filter(t => t.frontmatter.reporter === userId);
    const affected = tasks.filter(
      t => t.frontmatter.assignee === userId || t.frontmatter.reporter === userId,
    );

    if (affected.length > 0) {
      if (options.remapTo === undefined && options.unassign !== true) {
        // Name the user, not the ULID (P-4): the caller addressed them
        // by name, and a raw id is not vocabulary they can act on.
        const profile = await loadUserProfile(locttDir, userId).catch(() => undefined);
        throw new UserError(
          `user '${profile?.name ?? userId}' has ${affected.length} task reference(s); ` +
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
        const target = await loadUserProfile(locttDir, options.remapTo);
        if (target.archived === true) {
          throw new UserError(
            `remap target user "${options.remapTo}" is archived; unarchive them first or pick an active user`,
          );
        }
      }
    }

    // Journal the user remap. The "config edit" half here is the
    // user-folder removal (rm -rf <userDir>), which is also
    // idempotent — but we encode it via a separate field so the
    // recovery handler can decide to skip it on a partial replay.
    const entry: JournalEntry = {
      id: ulid(),
      kind: "remap_user",
      started_at: new Date().toISOString(),
      from: userId,
      to: options.remapTo ?? null,
      task_ids: affected.map(t => t.frontmatter.id),
      fields: ["assignee", "reporter"],
    };
    const journal = await loadJournal(locttDir);
    await saveJournal(locttDir, appendJournalEntry(journal, entry));

    if (affected.length > 0) {
      await replayTaskRemap(locttDir, entry);
    }

    // Pre-compute return value before the user dir disappears —
    // affected counts are derived from the in-memory snapshot.
    const remappedAssigneeCount = affectedAssignee.length;
    const remappedReporterCount = affectedReporter.length;

    // Finally remove the user folder entirely. Idempotent (rm -rf).
    await rm(getUserDir(locttDir, userId), { recursive: true, force: true });

    await clearJournalEntry(locttDir, entry.id);

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

// Recovery handler for a partially-completed deleteUser. Same
// shape as the project/label/milestone/sprint handlers: replay
// the task remap idempotently, complete the user-dir removal
// (idempotent rm -rf), drop the journal entry.
registerRecoveryHandler("remap_user", async (locttDir, entry) => {
  if (entry.kind !== "remap_user") return;
  await replayTaskRemap(locttDir, entry);
  await rm(getUserDir(locttDir, entry.from), { recursive: true, force: true });
  await clearJournalEntry(locttDir, entry.id);
});
