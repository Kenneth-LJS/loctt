import type { UserProfile } from "@loctt/contracts";
import { isIdShaped } from "@loctt/contracts";

import { resolveEntityRefOrThrow } from "../utils/entity-ref.js";
import { readCurrentUserId, writeCurrentUserId } from "./current.js";
import { UserError } from "./errors.js";
import { createUser } from "./lifecycle.js";
import { loadAllUsers, loadUserProfile, userExists } from "./profile.js";

/**
 * Resolves a user reference against the registered users, archived ones
 * included, by the one K148 rule: an ID-shaped ref is an ID; anything
 * else is the exact name, else a unique case-insensitive name prefix.
 * Ambiguous and unmatched names are refused (see `utils/entity-ref.ts`).
 */
export async function resolveUserRef(
  locttDir: string,
  ref: string,
): Promise<UserProfile> {
  if (isIdShaped(ref) && await userExists(locttDir, ref)) {
    return loadUserProfile(locttDir, ref);
  }
  const all = await loadAllUsers(locttDir);
  return resolveEntityRefOrThrow("user", all, ref, { includeArchived: true, prefix: true }, m => new UserError(m));
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
    throw new UserError(`Unknown user: ${userId}`);
  }
  await writeCurrentUserId(locttDir, userId);
}

/**
 * The display name `ensureDefaultUser` would give a user it creates:
 * `$USER`, else `$USERNAME`, else `you`.
 *
 * Exported so a surface can *name* that identity before creating it —
 * the init wizard says "You'll be set up as ken" (ONB-5). Reading the
 * rule rather than restating it is what keeps the promise and the
 * creation from drifting, and the `you` fallback is why the note can
 * never render an empty name (ONB-21).
 */
export function defaultUserDisplayName(): string {
  return process.env["USER"] || process.env["USERNAME"] || "you";
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
  const name = defaultUserDisplayName();
  return createUser(locttDir, { name, switchToOnCreate: true });
}
