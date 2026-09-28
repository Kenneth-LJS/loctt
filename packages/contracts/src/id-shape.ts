/**
 * K148: a value shaped like a ULID is an ID; anything else is a name.
 *
 * Storage holds IDs, and every surface also accepts names for labels,
 * users, milestones, sprints and projects. Telling the two apart by
 * shape (Ken rejected a sigil, a length limit and an `id:` prefix) means
 * a name may never have this shape, which is why creating or renaming
 * one to an ID-shaped name is refused with {@link ID_SHAPED_NAME_MESSAGE}.
 *
 * Crockford base32, 26 characters, the first at most `7` (a ULID's
 * 48-bit timestamp). Upper case only: LocTT writes IDs upper case.
 */
export const ID_SHAPE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** True when `value` has the shape of an ID (K148). */
export function isIdShaped(value: string): boolean {
  return ID_SHAPE.test(value);
}

/** The refusal for an ID-shaped name, on every surface (K148). */
export const ID_SHAPED_NAME_MESSAGE = "That looks like an ID; choose a different name.";
