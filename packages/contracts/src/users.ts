import { z } from "zod";

import { IanaTimezone } from "./brands.js";

/**
 * A single user's profile. Stored as `.loctt/users/<id>/profile.yaml`.
 * `id` is a generated ULID — never user-supplied — and is the
 * identifier referenced by `assignee` / `reporter` task fields.
 *
 * `name` and other metadata are mutable. Names are not unique
 * (ULIDs disambiguate); the UI shows truncated IDs alongside
 * names where ambiguity matters.
 *
 * `archived` hides the user from default pickers; tasks already
 * assigned to them continue to display the name.
 */
export const UserProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  email: z.email().optional(),
  timezone: IanaTimezone,
  // Avatar is the basename of a file inside the user's folder
  // (e.g. "avatar.png"). Reject path separators and traversal at
  // the contract layer so a hand-edited profile.yaml can't point
  // at files outside the user dir.
  avatar: z
    .string()
    .min(1)
    .regex(/^[^/\\]+$/, "must be a basename (no path separators)")
    .refine(s => s !== "." && s !== "..", "must not be \".\" or \"..\"")
    .optional(),
  archived: z.boolean().optional(),
}).strict();
export type UserProfile = z.infer<typeof UserProfileSchema>;

/** A list of registered user profiles. */
export const UsersListSchema = z.object({
  users: z.array(UserProfileSchema),
}).strict();
export type UsersList = z.infer<typeof UsersListSchema>;
