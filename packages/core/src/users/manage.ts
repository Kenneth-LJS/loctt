import type { UserProfile } from "@loctt/contracts";

import { readCurrentUserId, writeCurrentUserId } from "./current.js";
import { UserError } from "./errors.js";
import { createUser } from "./lifecycle.js";
import { loadAllUsers, loadUserProfile, userExists } from "./profile.js";

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
