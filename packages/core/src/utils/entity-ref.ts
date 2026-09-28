import { ID_SHAPED_NAME_MESSAGE, isIdShaped } from "@loctt/contracts";

/**
 * The one resolver for a label, user, milestone, sprint or project given
 * by name or ID (K148). Every write path and the query language go
 * through it, so the same input means the same thing everywhere.
 *
 * - An ID-shaped input (`^[0-7][0-9A-HJKMNP-TV-Z]{25}$`) is an ID and
 *   matches only by ID.
 * - Anything else is a name. A project's slug counts as a name, ahead of
 *   the display name (it is unique, K3). A user may also be named by a
 *   unique case-insensitive prefix of their name, as before.
 * - A name held by more than one entity is refused, listing each with
 *   its ID. A name held by none says so.
 * - A non-ID-shaped input that matches no name falls back to an exact
 *   ID match. LocTT only writes ULIDs, so this only reaches an entity
 *   whose ID was hand-edited into another shape, which would otherwise
 *   be unreachable (A360).
 */
export type EntityKind = "label" | "user" | "milestone" | "sprint" | "project";

/** The fields the resolver reads. `name` is degradable on users. */
export interface NamedEntity {
  readonly id: string;
  readonly name?: string | undefined;
  readonly slug?: string | undefined;
  readonly archived?: boolean | undefined;
}

export interface EntityRefOptions {
  /** Consider archived entities too. Default false. */
  readonly includeArchived?: boolean;
  /** Match a unique case-insensitive name prefix after the exact name (users). */
  readonly prefix?: boolean;
}

export type EntityRefMatch<T> =
  | { readonly kind: "match"; readonly entity: T }
  | { readonly kind: "ambiguous"; readonly matches: readonly T[] }
  | { readonly kind: "not_found" };

const PLURAL: Record<EntityKind, string> = {
  label: "labels",
  user: "users",
  milestone: "milestones",
  sprint: "sprints",
  project: "projects",
};

/** Matches `input` against `entities` by the K148 rule, without throwing. */
export function matchEntityRef<T extends NamedEntity>(
  entities: readonly T[],
  input: string,
  options: EntityRefOptions = {},
): EntityRefMatch<T> {
  const pool = options.includeArchived === true
    ? entities
    : entities.filter(e => e.archived !== true);
  if (isIdShaped(input)) {
    const byId = pool.find(e => e.id === input);
    return byId !== undefined ? { kind: "match", entity: byId } : { kind: "not_found" };
  }
  const bySlug = pool.filter(e => e.slug !== undefined && e.slug === input);
  if (bySlug.length === 1) return { kind: "match", entity: bySlug[0] as T };
  const exact = pool.filter(e => e.name === input);
  if (exact.length === 1) return { kind: "match", entity: exact[0] as T };
  if (exact.length > 1) return { kind: "ambiguous", matches: exact };
  if (options.prefix === true) {
    const lowered = input.toLowerCase();
    const prefixed = pool.filter(e => e.name?.toLowerCase().startsWith(lowered) ?? false);
    if (prefixed.length === 1) return { kind: "match", entity: prefixed[0] as T };
    if (prefixed.length > 1) return { kind: "ambiguous", matches: prefixed };
  }
  const byOddId = pool.find(e => e.id === input);
  if (byOddId !== undefined) return { kind: "match", entity: byOddId };
  return { kind: "not_found" };
}

/** "No label named 'x'." / "No label with ID '…'." */
export function entityNotFoundMessage(kind: EntityKind, input: string): string {
  return isIdShaped(input)
    ? `No ${kind} with ID '${input}'.`
    : `No ${kind} named '${input}'.`;
}

/** Lists each match with its ID, so the user can pick one. */
export function entityAmbiguousMessage(
  kind: EntityKind,
  input: string,
  matches: readonly NamedEntity[],
): string {
  const listed = matches.map(m => `${m.name ?? m.id} (${m.id})`).join(", ");
  return `'${input}' matches ${String(matches.length)} ${PLURAL[kind]}: ${listed}. Use the ID.`;
}

/**
 * Resolves `input` or throws the entity's own error class with the K148
 * message.
 */
export function resolveEntityRefOrThrow<T extends NamedEntity>(
  kind: EntityKind,
  entities: readonly T[],
  input: string,
  options: EntityRefOptions,
  makeError: (message: string) => Error,
): T {
  const found = matchEntityRef(entities, input, options);
  if (found.kind === "match") return found.entity;
  if (found.kind === "ambiguous") {
    throw makeError(entityAmbiguousMessage(kind, input, found.matches));
  }
  throw makeError(entityNotFoundMessage(kind, input));
}

/**
 * Refuses an ID-shaped name on create or rename (K148). Every entity a
 * user names (label, user, milestone, sprint, project, saved view) calls
 * this, so a name can never be mistaken for an ID.
 */
export function assertNameNotIdShaped(
  name: string | undefined,
  makeError: (message: string) => Error,
): void {
  if (name !== undefined && isIdShaped(name.trim())) throw makeError(ID_SHAPED_NAME_MESSAGE);
}
