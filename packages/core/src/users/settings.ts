import { readFile } from "node:fs/promises";

import { type UserSettings, UserSettingsSchema } from "@loctt/contracts";
import { parse as parseYaml } from "yaml";

import { getUserSettingsPath } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

/**
 * Per-user settings. `default_project` is the one core-interpreted
 * field — `loctt create` uses it in the project resolution chain.
 * Everything else is UI-managed and round-trips via passthrough.
 *
 * Stored as YAML for hand-editability at
 * `.loctt/users/<id>/settings.yaml` (gitignored).
 */
export type { UserSettings };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Loads a user's settings.yaml. Returns `{}` when absent or empty.
 *
 * Throws when the file is present and validates against
 * `UserSettingsSchema` (currently: `default_project` must be a
 * non-empty string when set). UI-only keys are accepted via the
 * schema's passthrough policy and survive round-trip unchanged.
 */
export async function loadUserSettings(
  locttDir: string,
  userId: string,
): Promise<UserSettings> {
  const path = getUserSettingsPath(locttDir, userId);
  if (!(await fileExists(path))) return UserSettingsSchema.parse({});
  const raw = await readFile(path, "utf-8");
  if (raw.trim() === "") return UserSettingsSchema.parse({});
  const parsed: unknown = parseYaml(raw);
  // Coerce non-object payloads to empty rather than crashing — matches
  // the previous behaviour for malformed-but-not-invalid YAML (e.g. a
  // bare list). Hand edits that violate the typed shape still throw.
  const candidate = isPlainObject(parsed) ? parsed : {};
  return UserSettingsSchema.parse(candidate);
}

/**
 * Atomically writes a user's settings.yaml. The settings file is
 * gitignored — per-checkout, per-user state.
 *
 * The schema is re-applied on save so the on-disk file is always
 * normalized to a validated shape. UI-only keys are preserved through
 * the schema's passthrough policy.
 */
export async function saveUserSettings(
  locttDir: string,
  userId: string,
  settings: UserSettings,
): Promise<void> {
  const safe = UserSettingsSchema.parse(settings);
  await writeYamlAtomically(getUserSettingsPath(locttDir, userId), safe);
}
