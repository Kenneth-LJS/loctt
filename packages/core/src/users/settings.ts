import { readdir, readFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

import { type UserSettings, UserSettingsSchema } from "@loctt/contracts";
import { parse as parseYaml } from "yaml";

import { LocttError } from "../errors.js";
import { getUsersDir, getUserSettingsPath } from "../paths/index.js";
import { writeYamlAtomically } from "../utils/atomic-yaml.js";
import { fileExists } from "../utils/fs.js";
import { type KeyboardShortcutsDrop, salvageKeyboardShortcuts } from "./shortcuts.js";
import { salvageSidebarGroups, type SidebarGroupsDrop } from "./sidebarGroups.js";

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
 * dropping unknown keys would destroy data a newer client wrote).
 */
const KNOWN_SETTINGS_KEYS: ReadonlySet<string> = new Set([
  "default_project",
  "card_layout",
  "editor_mode",
  "theme",
  "sidebar_groups",
  "keyboard_shortcuts",
]);

/**
 * Settings loctt wrote once and retired: `sidebar_pins` (K159). Not
 * unknown keys a newer client wrote, so passthrough does not protect
 * them. The 0.3.0 → 0.4.0 upgrade step moves pins into the sidebar's
 * Views order and deletes the key (K160); one left on disk after that is
 * corrupt. The loader lifts it out (nothing reads it), so the next write
 * of the settings leaves it behind, and doctor names the file until then
 * (`collectSidebarGroupsDrops`, `retiredPins`).
 */
const RETIRED_SETTINGS_KEYS: readonly string[] = ["sidebar_pins"];

/**
 * Parses a settings payload **tolerantly** (Phase-7B).
 *
 * `UserSettings` is `.passthrough()` by design, so unknown keys are not
 * corruption — they must survive untouched. What CAN be corrupt is a
 * genuinely wrong-typed KNOWN key (a hand edit like `theme: 42` or
 * `card_layout: "big"`). Under a plain `.parse()` that throws and locks
 * the user out of their *whole* settings file — every panel 500s and no
 * default project or layout loads. Instead we degrade: the bad
 * KNOWN key is dropped (falls back to the field's default / absent), and
 * everything else — the healthy known keys AND all unknown passthrough
 * keys — still loads.
 *
 * This never makes the schema strict and never drops an unknown key: it
 * only lifts out a known key whose typed value failed its own contract.
 *
 * **`sidebar_groups` is salvaged per-FIELD, not dropped whole (SHL-45).**
 * Every other known key degrades to its default when corrupt, but
 * `sidebar_groups` holds two independent id lists, and the field-local
 * principle (corruption-handling-guide) says a single stray id must drop
 * one entry, not the user's whole customization. So a faulting
 * `sidebar_groups` is run through `salvageSidebarGroups` — keeping the
 * valid ids, lifting out the bad ones — and the salvaged value replaces
 * it in-place. It falls back to a full drop only when nothing survives
 * (a scalar / bare-list value with no per-field structure to keep).
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

  // Per-field salvage for `sidebar_groups` (see the note above): recover
  // the valid ids rather than dropping the whole key. Only when the
  // salvage keeps something do we stop treating the key as a fault; an
  // empty salvage still degrades to absent, same as any other bad key.
  let salvagedSidebarGroups: UserSettings["sidebar_groups"] | undefined;
  if (faultKeys.has("sidebar_groups")) {
    const salvaged = salvageSidebarGroups(candidate["sidebar_groups"]);
    if (salvaged.groups.order !== undefined || salvaged.groups.hidden !== undefined) {
      salvagedSidebarGroups = salvaged.groups;
      faultKeys.delete("sidebar_groups");
    }
  }

  // Per-field salvage for `keyboard_shortcuts` (K133), same reasoning:
  // a stray id in `disabled` drops that id, not every other switch, and
  // a non-boolean master falls back to on without losing `disabled`.
  let salvagedShortcuts: UserSettings["keyboard_shortcuts"] | undefined;
  if (faultKeys.has("keyboard_shortcuts")) {
    const salvaged = salvageKeyboardShortcuts(candidate["keyboard_shortcuts"]);
    if (salvaged.value.single_key !== undefined || salvaged.value.disabled !== undefined) {
      salvagedShortcuts = salvaged.value;
      faultKeys.delete("keyboard_shortcuts");
    }
  }

  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(candidate)) {
    // Drop a known-but-corrupt key (degrade to default); keep everything
    // else, INCLUDING every unknown passthrough key, byte-for-byte.
    if (faultKeys.has(k)) continue;
    if (k === "sidebar_groups" && salvagedSidebarGroups !== undefined) {
      cleaned[k] = salvagedSidebarGroups;
    } else if (k === "keyboard_shortcuts" && salvagedShortcuts !== undefined) {
      cleaned[k] = salvagedShortcuts;
    } else {
      cleaned[k] = v;
    }
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
 * What a user's stored `settings.yaml` holds, read once for the loader,
 * the write guard and doctor (B56).
 *
 * - `none`: no file, an empty file, or one holding only comments. No
 *   settings, nothing to lose.
 * - `settings`: a mapping, the only shape a settings file has.
 * - `unreadable`: the file could not be read, does not parse as YAML, or
 *   parses to something other than a mapping (a list, a bare value).
 *   `error` is one line naming the cause.
 */
type StoredSettings =
  | { readonly kind: "none" }
  | { readonly kind: "settings"; readonly value: Record<string, unknown> }
  | { readonly kind: "unreadable"; readonly error: string };

/** The cause recorded for a settings file that parses to a non-mapping. */
const NOT_A_MAPPING = "it isn't a set of name: value settings";

async function readStoredSettings(path: string): Promise<StoredSettings> {
  if (!(await fileExists(path))) return { kind: "none" };
  let parsed: unknown;
  try {
    const raw = await readFile(path, "utf-8");
    if (raw.trim() === "") return { kind: "none" };
    parsed = parseYaml(raw);
  } catch (err) {
    return { kind: "unreadable", error: firstLine(err) };
  }
  // A file of comments only parses to null: no settings, not corruption.
  if (parsed === null || parsed === undefined) return { kind: "none" };
  if (!isPlainObject(parsed)) return { kind: "unreadable", error: NOT_A_MAPPING };
  return { kind: "settings", value: parsed };
}

/**
 * Refused: a settings write would replace a `settings.yaml` that could
 * not be read (B56). The file may hold a hand edit with one typo in it,
 * and the write cannot merge into what it cannot read, so writing would
 * destroy it silently (corruption-handling-guide rules 2 and 3). Nothing
 * is written. The message names the file because fixing it by hand is
 * the way out. Doctor names it too (`collectUnreadableSettings`).
 */
export class UnreadableSettingsError extends LocttError {
  readonly path: string;

  constructor(locttDir: string, path: string, cause: string) {
    const shown = relative(dirname(locttDir), path);
    super(
      "config_invalid",
      `Couldn't read ${shown}, so your settings weren't saved. Fix the file by hand and try again.`,
      { dataState: "not_saved", recovery: { kind: "none" }, detail: `${shown}: ${cause}` },
    );
    this.name = "UnreadableSettingsError";
    this.path = path;
  }
}

/**
 * Loads a user's settings.yaml. Returns `{}` when absent or empty.
 *
 * A wrong-typed KNOWN setting (e.g. `theme: 42`) degrades to its default
 * rather than throwing — a hand edit to one field must not lock the user
 * out of their whole settings surface. Unknown keys are accepted via the
 * schema's passthrough policy and survive round-trip unchanged (Group-G,
 * load-bearing).
 *
 * A file that cannot be read, does not parse, or is not a mapping loads
 * as `{}` too (B56): every setting falls back to its default, so the web
 * app, CLI and MCP keep working for that user. The file is left as it
 * is. Doctor names it (`collectUnreadableSettings`) and a settings write
 * refuses rather than overwrite it (`saveUserSettings`).
 */
export async function loadUserSettings(
  locttDir: string,
  userId: string,
): Promise<UserSettings> {
  const stored = await readStoredSettings(getUserSettingsPath(locttDir, userId));
  if (stored.kind !== "settings") return UserSettingsSchema.parse({});
  // A wrong-typed KNOWN key degrades to default below.
  return parseSettingsTolerant(withoutRetiredKeys(stored.value));
}

/**
 * Atomically writes a user's settings.yaml. The settings file is
 * gitignored — per-checkout, per-user state.
 *
 * The schema is re-applied on save so the on-disk file is always
 * normalized to a validated shape. UI-only keys are preserved through
 * the schema's passthrough policy.
 *
 * Refuses with `UnreadableSettingsError`, writing nothing, when the
 * stored file could not be read (B56). The caller's settings were built
 * from the defaults that file loaded as, so writing them would replace
 * the user's file with the defaults plus one change.
 */
export async function saveUserSettings(
  locttDir: string,
  userId: string,
  settings: UserSettings,
): Promise<UserSettings> {
  const safe = UserSettingsSchema.parse(settings);
  const path = getUserSettingsPath(locttDir, userId);
  const stored = await readStoredSettings(path);
  if (stored.kind === "unreadable") throw new UnreadableSettingsError(locttDir, path, stored.error);
  await writeYamlAtomically(path, safe);
  return safe;
}

/** `settings` without the retired keys (`RETIRED_SETTINGS_KEYS`). */
function withoutRetiredKeys(settings: Record<string, unknown>): Record<string, unknown> {
  if (!RETIRED_SETTINGS_KEYS.some(k => k in settings)) return settings;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (!RETIRED_SETTINGS_KEYS.includes(k)) out[k] = v;
  }
  return out;
}

/**
 * A user whose `sidebar_groups` setting had ids salvaged out on load, or
 * whose settings still hold what the 0.3.0 → 0.4.0 upgrade converts.
 *
 * The loader keeps the valid ids and lifts out the bad ones silently
 * (P7 — the sidebar must render); this is how doctor learns what was
 * dropped so it can report it (corruption-handling-guide § "what to add
 * to doctor"). `wholeValueDropped` is true when the value was not a
 * shaped object at all and degraded to "no customization" entirely.
 * `olderLayout` is a pre-K158 value (no `version`), ignored for the
 * default layout; `retiredPins` a `sidebar_pins` key, ignored (K160).
 */
export interface SidebarGroupsDropReport {
  readonly userId: string;
  readonly path: string;
  readonly dropped: readonly SidebarGroupsDrop[];
  readonly wholeValueDropped: boolean;
  readonly olderLayout: boolean;
  readonly retiredPins: boolean;
}

/**
 * Scans every user's `settings.yaml` for a corrupt `sidebar_groups`
 * value and reports what salvage lifted out (SHL-45), and for what the
 * 0.3.0 → 0.4.0 upgrade converts (a pre-K158 value, a `sidebar_pins`
 * key; K160). Read-only.
 *
 * Reads the raw YAML rather than the loaded settings: by the time
 * `loadUserSettings` has run, the salvage has already happened and the
 * dropped ids are gone. A user with a clean (or absent) setting produces
 * no report. A settings file that will not parse as YAML is skipped here
 * and reported by `collectUnreadableSettings`; one that is not an object
 * is not specifically a `sidebar_groups` fault.
 */
export async function collectSidebarGroupsDrops(
  locttDir: string,
): Promise<SidebarGroupsDropReport[]> {
  const dir = getUsersDir(locttDir);
  if (!(await fileExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const reports: SidebarGroupsDropReport[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = getUserSettingsPath(locttDir, entry.name);
    if (!(await fileExists(path))) continue;
    let parsed: unknown;
    try {
      const raw = await readFile(path, "utf-8");
      if (raw.trim() === "") continue;
      parsed = parseYaml(raw);
    } catch {
      // Unparseable settings — not attributable to sidebar_groups.
      continue;
    }
    if (!isPlainObject(parsed)) continue;
    const retiredPins = "sidebar_pins" in parsed;
    if (!("sidebar_groups" in parsed) && !retiredPins) continue;
    const salvaged = salvageSidebarGroups(parsed["sidebar_groups"]);
    if (salvaged.dropped.length === 0 && !salvaged.wholeValueDropped && !salvaged.olderLayout && !retiredPins) continue;
    reports.push({
      userId: entry.name,
      path,
      dropped: salvaged.dropped,
      wholeValueDropped: salvaged.wholeValueDropped,
      olderLayout: salvaged.olderLayout,
      retiredPins,
    });
  }
  return reports;
}

/**
 * A user whose `keyboard_shortcuts` setting had parts dropped on load
 * (K133). The loader degrades silently so the app still works; this is
 * how doctor learns what was dropped (corruption-handling-guide rule 4).
 */
export interface KeyboardShortcutsDropReport {
  readonly userId: string;
  readonly path: string;
  readonly dropped: readonly KeyboardShortcutsDrop[];
  readonly wholeValueDropped: boolean;
}

/**
 * Scans every user's `settings.yaml` for a corrupt `keyboard_shortcuts`
 * value and reports what the salvage dropped. Read-only. Reads the raw
 * YAML for the same reason `collectSidebarGroupsDrops` does: after
 * `loadUserSettings` the dropped parts are gone.
 */
export async function collectKeyboardShortcutsDrops(
  locttDir: string,
): Promise<KeyboardShortcutsDropReport[]> {
  const dir = getUsersDir(locttDir);
  if (!(await fileExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const reports: KeyboardShortcutsDropReport[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = getUserSettingsPath(locttDir, entry.name);
    if (!(await fileExists(path))) continue;
    let parsed: unknown;
    try {
      const raw = await readFile(path, "utf-8");
      if (raw.trim() === "") continue;
      parsed = parseYaml(raw);
    } catch {
      continue;
    }
    if (!isPlainObject(parsed) || !("keyboard_shortcuts" in parsed)) continue;
    const salvaged = salvageKeyboardShortcuts(parsed["keyboard_shortcuts"]);
    if (salvaged.dropped.length === 0 && !salvaged.wholeValueDropped) continue;
    reports.push({
      userId: entry.name,
      path,
      dropped: salvaged.dropped,
      wholeValueDropped: salvaged.wholeValueDropped,
    });
  }
  return reports;
}

/**
 * A user's `settings.yaml` that cannot be read, does not parse as YAML,
 * or is not a mapping.
 */
export interface UnreadableSettingsReport {
  readonly userId: string;
  readonly path: string;
  readonly error: string;
}

/**
 * Scans every user's `settings.yaml` for a file that cannot be read,
 * does not parse as YAML, or is not a mapping. Read-only.
 * `loadUserSettings` loads such a file as no settings and
 * `saveUserSettings` refuses to overwrite it (B56), and the 0.3.0 →
 * 0.4.0 upgrade step leaves it as it is (K160), so doctor names it
 * (corruption-handling-guide rule 4). An empty file, or one of comments
 * only, is not a fault: it loads as no settings.
 */
export async function collectUnreadableSettings(
  locttDir: string,
): Promise<UnreadableSettingsReport[]> {
  const dir = getUsersDir(locttDir);
  if (!(await fileExists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const reports: UnreadableSettingsReport[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = getUserSettingsPath(locttDir, entry.name);
    const stored = await readStoredSettings(path);
    if (stored.kind === "unreadable") reports.push({ userId: entry.name, path, error: stored.error });
  }
  return reports;
}

function firstLine(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return (msg.split("\n")[0] ?? msg).trim();
}
