/**
 * A single user's profile. Stored as `.loctt/users/<id>/profile.yaml`.
 * `id` is a generated UUID — never user-supplied — and is the
 * identifier referenced by `assignee` / `reporter` task fields.
 *
 * `name` and other metadata are mutable. Names are not unique
 * (UUIDs disambiguate); the UI shows truncated UUIDs alongside
 * names where ambiguity matters.
 */
export interface UserProfile {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
  /** IANA timezone (e.g. "America/Los_Angeles"). */
  readonly timezone: string;
  /** Filename of the avatar within the user's folder, when present. */
  readonly avatar?: string;
  /**
   * Soft-delete flag. Archived users hide from pickers but tasks
   * already assigned to them continue to display the name.
   */
  readonly archived?: boolean;
}

/** A list of registered user profiles. Returned by enumeration APIs. */
export interface UsersList {
  readonly users: readonly UserProfile[];
}
