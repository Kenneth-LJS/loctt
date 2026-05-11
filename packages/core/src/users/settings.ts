import { readFile } from "node:fs/promises";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { getUserSettingsPath } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";

/**
 * Per-user UI settings. The shape is intentionally loose because
 * the UI defines the keys (theme, default view, sort prefs, card
 * layout, sidebar pins, default project override). Stored as YAML
 * for hand-editability.
 */
export type UserSettings = Readonly<Record<string, unknown>>;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Loads a user's settings.yaml. Returns `{}` when absent. */
export async function loadUserSettings(
  locttDir: string,
  userId: string,
): Promise<UserSettings> {
  const path = getUserSettingsPath(locttDir, userId);
  if (!(await fileExists(path))) return {};
  const raw = await readFile(path, "utf-8");
  if (raw.trim() === "") return {};
  const parsed: unknown = parseYaml(raw);
  return isPlainObject(parsed) ? parsed : {};
}

/**
 * Atomically writes a user's settings.yaml. The settings file is
 * gitignored — per-checkout, per-user state.
 */
export async function saveUserSettings(
  locttDir: string,
  userId: string,
  settings: UserSettings,
): Promise<void> {
  // Re-stringify via the YAML lib so we keep formatting consistent
  // and round-trip through a known-shape object.
  const yaml = stringifyYaml(settings);
  // Round-trip: parse back to ensure validity.
  const parsed: unknown = parseYaml(yaml);
  const safe = isPlainObject(parsed) ? parsed : {};
  await writeYamlAtomically(getUserSettingsPath(locttDir, userId), safe);
}
