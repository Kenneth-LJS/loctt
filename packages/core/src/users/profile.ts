import { readdir, readFile } from "node:fs/promises";

import type { UserProfile } from "@loctt/contracts";
import { UserProfileSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";

import { formatZodIssues } from "../config/zod-error.js";
import {
  getUserProfilePath,
  getUsersDir,
} from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class UserProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserProfileError";
  }
}

/**
 * Parses a user profile from raw YAML content.
 */
export function parseUserProfile(yamlContent: string): UserProfile {
  const raw: unknown = parseYaml(yamlContent);
  try {
    return UserProfileSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      throw new UserProfileError(formatZodIssues("user profile", err));
    }
    throw err;
  }
}

/** Serializes a profile to YAML with stable key order. */
export function serializeUserProfile(profile: UserProfile): string {
  const out: Record<string, unknown> = {
    id: profile.id,
    name: profile.name,
    timezone: profile.timezone,
  };
  if (profile.email !== undefined) out["email"] = profile.email;
  if (profile.avatar !== undefined) out["avatar"] = profile.avatar;
  if (profile.archived === true) out["archived"] = true;
  return stringifyYaml(out);
}

/** Loads a single user's profile by ID. Throws if missing. */
export async function loadUserProfile(
  locttDir: string,
  userId: string,
): Promise<UserProfile> {
  const path = getUserProfilePath(locttDir, userId);
  const raw = await readFile(path, "utf-8");
  const profile = parseUserProfile(raw);
  if (profile.id !== userId) {
    throw new UserProfileError(
      `profile.yaml at ${path} has id '${profile.id}', expected '${userId}'`,
    );
  }
  return profile;
}

/** Writes a user's profile.yaml atomically. */
export async function saveUserProfile(
  locttDir: string,
  profile: UserProfile,
): Promise<void> {
  await writeYamlAtomically(
    getUserProfilePath(locttDir, profile.id),
    parseUserProfile(serializeUserProfile(profile)),
  );
}

/**
 * Returns true when the given user folder exists on disk.
 */
export async function userExists(locttDir: string, userId: string): Promise<boolean> {
  return fileExists(getUserProfilePath(locttDir, userId));
}

/**
 * A user directory whose profile could not be read or parsed.
 *
 * V7: kept and reported, never silently dropped. The id is the
 * directory name, which is the only thing we know about them — and it
 * is enough for a guard to refuse rather than guess.
 */
export interface UnreadableUser {
  /** The directory name, which is the user's id. */
  readonly id: string;
  readonly path: string;
  /** One sentence naming the file and the cause. */
  readonly reason: string;
}

export interface AllUsers {
  readonly profiles: UserProfile[];
  /**
   * Users whose profile could not be read. Non-empty means any
   * archived-state answer is incomplete, so a guard consulting it must
   * fail closed rather than treat the set as authoritative.
   */
  readonly unreadable: UnreadableUser[];
}

/**
 * Lists all registered users by scanning `.loctt/users/`, reporting
 * the ones it could not read rather than dropping them.
 *
 * The bug this replaces: a profile that threw was skipped silently,
 * with a comment claiming Doctor surfaces it. That made the user vanish
 * from `archivedUserIds`, so the archived guard stopped blocking
 * assignment to them — it failed *open* on missing information.
 *
 * Returns empty lists when the users dir doesn't exist, which is a
 * real state on a fresh tracker.
 */
export async function loadAllUsersDetailed(locttDir: string): Promise<AllUsers> {
  const dir = getUsersDir(locttDir);
  if (!(await fileExists(dir))) return { profiles: [], unreadable: [] };
  const entries = await readdir(dir, { withFileTypes: true });
  const profiles: UserProfile[] = [];
  const unreadable: UnreadableUser[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      profiles.push(await loadUserProfile(locttDir, entry.name));
    } catch (err) {
      unreadable.push({
        id: entry.name,
        path: getUserProfilePath(locttDir, entry.name),
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Sort by id (ULID = chronological) so callers that need a
  // deterministic pick — e.g. getCurrentUser self-heal — get the
  // same answer across machines and processes.
  profiles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  unreadable.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { profiles, unreadable };
}

/**
 * The readable profiles only.
 *
 * Kept for callers that legitimately want "who can I show in a
 * picker". Anything making a *safety* decision — whether a reference is
 * archived — must use {@link loadAllUsersDetailed} and account for the
 * unreadable set, or it fails open on missing information.
 */
export async function loadAllUsers(locttDir: string): Promise<UserProfile[]> {
  return (await loadAllUsersDetailed(locttDir)).profiles;
}
