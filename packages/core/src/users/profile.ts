import { readdir, readFile } from "node:fs/promises";

import type { FieldHealth, FieldHealthKind, UserProfile } from "@loctt/contracts";
import { UserProfileSchema } from "@loctt/contracts";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { formatZodIssues } from "../config/zod-error.js";
import {
  getUserProfilePath,
  getUsersDir,
} from "../paths/index.js";
import { renderRawText } from "../task/frontmatter.js";
import { writeFileAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

export class UserProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserProfileError";
  }
}

/**
 * The object-fatal identity set for a profile (Phase-7B, mirrors the
 * task's `FATAL_IDENTITY_FIELDS`). A user is *addressed* by `id`, so a
 * missing/blank/wrong-typed `id` has no coherent record to degrade
 * around and still throws. Everything else is field-local.
 */
const FATAL_IDENTITY_FIELDS: ReadonlySet<string> = new Set(["id"]);

/**
 * Required-but-degradable fields (Phase-7B, mirrors the task's
 * `DEGRADABLE_REQUIRED_FIELDS`). Required on disk, but a missing/null
 * value degrades to `missing_required` rather than fatalling — the user
 * still loads by id.
 */
const DEGRADABLE_REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "timezone",
]);

/** The keys the profile schema declares. Anything else is `unrecognised`. */
const KNOWN_PROFILE_KEYS: ReadonlySet<string> = new Set([
  "id",
  "name",
  "email",
  "timezone",
  "avatar",
  "archived",
]);

/** Builds a `FieldHealth` entry for one intrinsic (schema) profile fault. */
function intrinsicHealth(field: string, raw: unknown, error: string): FieldHealth {
  const missing =
    DEGRADABLE_REQUIRED_FIELDS.has(field) && (raw === null || raw === undefined);
  const kind: FieldHealthKind = missing ? "missing_required" : "wrong_type";
  const repair: FieldHealth["repair"] = missing ? "set" : "set_or_remove";
  return { field, kind, raw, rawText: renderRawText(raw), error, repair };
}

/**
 * Parses a user profile from raw YAML content **tolerantly** (Phase-7B).
 *
 * A profile is a single addressable record, so it degrades per-FIELD
 * exactly like task frontmatter: the returned object holds only the
 * fields that passed the schema; every field that did not — a bad
 * `email`/`timezone`/`avatar`/`name`, or an unknown key — is lifted into
 * `health` with its raw stored value preserved (never rewritten, K27),
 * and the profile still loads. A clean profile takes the strict fast
 * path and carries no `health`, so the tolerant path costs nothing.
 *
 * Object-fatal cases still throw `UserProfileError`, unchanged:
 *   - a YAML *syntax* error, or a non-object payload (no record to
 *     degrade around);
 *   - a bad/absent `id` — the field that *addresses* the user (K26);
 *   - a remainder that still fails after the corrupt fields are lifted
 *     out (fail closed rather than half-degrade).
 */
export function parseUserProfile(yamlContent: string): UserProfile {
  let raw: unknown;
  try {
    raw = parseYaml(yamlContent);
  } catch (err) {
    throw new UserProfileError(err instanceof Error ? err.message : String(err));
  }

  const rawObj = (raw !== null && typeof raw === "object" && !Array.isArray(raw))
    ? raw as Record<string, unknown>
    : undefined;

  // A non-object payload (a bare scalar or list) has no record to
  // degrade around — object-fatal, exactly as the old strict parse.
  if (rawObj === undefined) {
    const parsed = UserProfileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new UserProfileError(formatZodIssues("user profile", parsed.error));
    }
    return parsed.data;
  }

  // Unrecognised top-level keys: the schema is `.strict()`, so these
  // surface as `unrecognized_keys` Zod issues. Split them out by hand so
  // they degrade into `health` (kind `unrecognised`) rather than fatal a
  // profile over a typo/stale key, preserving the value for round-trip.
  const unrecognised: FieldHealth[] = [];
  for (const [k, v] of Object.entries(rawObj)) {
    if (!KNOWN_PROFILE_KEYS.has(k)) {
      unrecognised.push({
        field: k,
        kind: "unrecognised",
        raw: v,
        rawText: renderRawText(v),
        error: "LocTT has no type for this key",
        repair: "remove",
      });
    }
  }

  // A degradable-required field that is simply ABSENT produces no Zod
  // issue (the field is optional in the schema), so detect it here.
  const missingRequired: FieldHealth[] = [];
  for (const field of DEGRADABLE_REQUIRED_FIELDS) {
    if (!(field in rawObj)) {
      missingRequired.push({
        field,
        kind: "missing_required",
        raw: undefined,
        rawText: "",
        error: `${field} is required but absent`,
        repair: "set",
      });
    }
  }

  // Strict-key check with only the known keys, so unrecognised keys do
  // not count as faults (they are already lifted above).
  const known: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawObj)) {
    if (KNOWN_PROFILE_KEYS.has(k)) known[k] = v;
  }

  const strict = UserProfileSchema.safeParse(known);
  if (strict.success) {
    const health = [...unrecognised, ...missingRequired];
    return health.length > 0 ? { ...strict.data, health } : strict.data;
  }

  const issues = strict.error.issues;
  const faultKeys = new Set(
    issues
      .map(i => i.path[0])
      .filter((k): k is string => typeof k === "string"),
  );

  // Object-fatal: a fault on `id` means the user cannot be addressed.
  for (const k of faultKeys) {
    if (FATAL_IDENTITY_FIELDS.has(k)) {
      throw new UserProfileError(formatZodIssues("user profile", strict.error));
    }
  }

  // Lift every faulting field out and reparse the remainder. If it still
  // fails, the object is fatal (fail closed).
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(known)) {
    if (!faultKeys.has(k)) cleaned[k] = v;
  }
  const reparsed = UserProfileSchema.safeParse(cleaned);
  if (!reparsed.success) {
    throw new UserProfileError(formatZodIssues("user profile", reparsed.error));
  }

  const health: FieldHealth[] = [...unrecognised];
  for (const field of faultKeys) {
    const issue = issues.find(i => i.path[0] === field);
    health.push(intrinsicHealth(field, known[field], issue?.message ?? "value has the wrong type"));
  }
  for (const m of missingRequired) {
    if (!faultKeys.has(m.field)) health.push(m);
  }

  return { ...reparsed.data, health };
}

/**
 * Serializes a profile to YAML with stable key order.
 *
 * Healthy fields are emitted in canonical order. Corrupt fields lifted
 * into `health` are re-emitted from their preserved raw value (K27:
 * value-preserved round-trip) so a load → save does not silently drop a
 * hand-corrupted `email`/`timezone`/unknown key — a repair the user did
 * not ask for. A field absent because it degraded to `missing_required`
 * (no raw value) is not re-emitted.
 */
export function serializeUserProfile(profile: UserProfile): string {
  const out: Record<string, unknown> = { id: profile.id };
  if (profile.name !== undefined) out["name"] = profile.name;
  if (profile.timezone !== undefined) out["timezone"] = profile.timezone;
  if (profile.email !== undefined) out["email"] = profile.email;
  if (profile.avatar !== undefined) out["avatar"] = profile.avatar;
  if (profile.archived === true) out["archived"] = true;
  // Re-emit corrupt/unrecognised values so they survive a round trip.
  // `missing_required` carries no raw value (`undefined`) — skip it.
  for (const h of profile.health ?? []) {
    if (h.raw !== undefined && !(h.field in out)) out[h.field] = h.raw;
  }
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
  // Serialize to canonical YAML, then validate the *text* round-trips
  // (throws on genuinely object-fatal input, e.g. a blank id). We write
  // the serialized string rather than the re-parsed object, because a
  // parsed profile may now carry a `health` array — writing that object
  // would persist `health:` into the file and corrupt it.
  const text = serializeUserProfile(profile);
  parseUserProfile(text);
  await writeFileAtomically(getUserProfilePath(locttDir, profile.id), text);
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
