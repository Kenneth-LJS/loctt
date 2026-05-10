import { readdir, readFile } from "node:fs/promises";

import type { UserProfile } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  getUserProfilePath,
  getUsersDir,
} from "../paths/index.js";
import {
  assertObject as _assertObject,
  assertString as _assertString,
} from "../utils/assert.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class UserProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserProfileError";
  }
}

function assertString(value: unknown, path: string): asserts value is string {
  _assertString(value, path, UserProfileError);
}

function assertObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  _assertObject(value, path, UserProfileError);
}

/**
 * Parses a user profile from raw YAML content. Required fields:
 * `id`, `name`, `timezone`. Optional: `email`, `avatar`, `archived`.
 */
export function parseUserProfile(yamlContent: string): UserProfile {
  const raw: unknown = parseYaml(yamlContent);
  assertObject(raw, "user profile");
  assertString(raw["id"], "id");
  assertString(raw["name"], "name");
  assertString(raw["timezone"], "timezone");

  const email = raw["email"];
  if (email !== undefined) assertString(email, "email");
  const avatar = raw["avatar"];
  if (avatar !== undefined) assertString(avatar, "avatar");
  const archived = raw["archived"];
  if (archived !== undefined && typeof archived !== "boolean") {
    throw new UserProfileError("archived must be a boolean");
  }

  return {
    id: raw["id"],
    name: raw["name"],
    timezone: raw["timezone"],
    ...(email !== undefined ? { email: email } : {}),
    ...(avatar !== undefined ? { avatar: avatar } : {}),
    ...(archived === true ? { archived: true } : {}),
  };
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
 * Lists all registered users by scanning `.loctt/users/`. Each
 * subdirectory whose name matches a UUID-ish pattern and contains a
 * profile.yaml is included. Bad entries are skipped (caller should
 * run Doctor to surface them).
 *
 * Returns an empty array when the users dir doesn't exist.
 */
export async function loadAllUsers(locttDir: string): Promise<UserProfile[]> {
  const dir = getUsersDir(locttDir);
  if (!(await fileExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const profiles: UserProfile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const profile = await loadUserProfile(locttDir, entry.name);
      profiles.push(profile);
    } catch {
      // Skip malformed user folders silently — Doctor surfaces them.
    }
  }
  return profiles;
}
