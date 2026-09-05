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
 * The KNOWN (schema-typed) top-level settings keys. A wrong-typed value
 * for one of these degrades to the field's default; anything NOT in this
 * set is an unknown key and passes through untouched via `.passthrough()`
 * (Group-G: load-bearing — every panel saves `{...stored, ...next}`, so
 * dropping unknown keys would destroy data like sidebar pins).
 */
const KNOWN_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  "default_project",
  "card_layout",
  "editor_mode",
  "theme",
  "sidebar_pins",
]);

/**
 * Parses a settings payload **tolerantly** (Phase-7B).
 *
 * `UserSettings` is `.passthrough()` by design, so unknown keys are not
 * corruption — they must survive untouched. What CAN be corrupt is a
 * genuinely wrong-typed KNOWN key (a hand edit like `theme: 42` or
 * `card_layout: "big"`). Under a plain `.parse()` that throws and locks
 * the user out of their *whole* settings file — every panel 500s and no
 * pin, default project or layout loads. Instead we degrade: the bad
 * KNOWN key is dropped (falls back to the field's default / absent), and
 * everything else — the healthy known keys AND all unknown passthrough
 * keys — still loads.
 *
 * This never makes the schema strict and never drops an unknown key: it
 * only lifts out a known key whose typed value failed its own contract.
 */
function parseSettingsTolerant(candidate: Record<string, unknown>): UserSettings {
  const strict = UserSettingsSchema.safeParse(candidate);
  if (strict.success) return strict.data;

  // Only KNOWN keys can fault (passthrough never rejects an unknown key),
  // so every issue's top-level key is a schema-typed field we can drop.
  const faultKeys = new Set(
    strict.error.issues
      .map(i => i.path[0])
      .filter((k): k is string => typeof k === "string" && KNOWN_SETTINGS_KEYS.has(k)),
  );

  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    // Drop a known-but-corrupt key (degrade to default); keep everything
    // else, INCLUDING every unknown passthrough key, byte-for-byte.
    if (!faultKeys.has(k)) cleaned[k] = v;
  }

  const reparsed = UserSettingsSchema.safeParse(cleaned);
  if (!reparsed.success) {
    // A fault we could not attribute to a known key: fail closed rather
    // than half-degrade. In practice unreachable — every issue on a
    // passthrough object is a known-key fault handled above.
    throw reparsed.error;
  }
  return reparsed.data;
}

/**
 * Loads a user's settings.yaml. Returns `{}` when absent or empty.
 *
 * A wrong-typed KNOWN setting (e.g. `theme: 42`) degrades to its default
 * rather than throwing — a hand edit to one field must not lock the user
 * out of their whole settings surface. Unknown keys are accepted via the
 * schema's passthrough policy and survive round-trip unchanged (Group-G,
 * load-bearing).
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
  // bare list). A wrong-typed KNOWN key degrades to default below.
  const candidate = isPlainObject(parsed) ? parsed : {};
  return parseSettingsTolerant(candidate);
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
