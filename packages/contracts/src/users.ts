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
  avatar: z.string().min(1).optional(),
  archived: z.boolean().optional(),
}).strict();
export type UserProfile = z.infer<typeof UserProfileSchema>;

/** A list of registered user profiles. */
export const UsersListSchema = z.object({
  users: z.array(UserProfileSchema),
}).strict();
export type UsersList = z.infer<typeof UsersListSchema>;
