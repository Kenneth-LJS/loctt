import type { KeyboardShortcuts, ShortcutId, ShortcutSpec, UserSettings } from "@loctt/contracts";
import { GLOBAL_SHORTCUTS, KeyboardShortcutsSchema, SHORTCUT_IDS } from "@loctt/contracts";

/**
 * Single-key shortcut switches (K133, A11Y-43): reading, resolving and
 * changing the per-user `keyboard_shortcuts` setting.
 *
 * Pure logic over ids. It imports nothing from node, so the web client
 * imports it directly (`@loctt/core/users/shortcuts.js`), the same way
 * it imports `sidebarGroups.js`. The web dispatcher, the settings
 * editor, the CLI and the MCP tools all decide "does this shortcut
 * fire" here, so the four cannot disagree.
 */

const KNOWN_IDS: ReadonlySet<string> = new Set(SHORTCUT_IDS);

/** Every valid shortcut id, for a "valid ids are: ..." message. */
export const SHORTCUT_VALID_IDS: readonly string[] = SHORTCUT_IDS;

/**
 * One thing the reader lifted out of a hand-edited value, so doctor can
 * name it (corruption-handling-guide rule 4).
 *
 * - `single_key` / `malformed`: the master switch was not a boolean.
 *   It falls back to on.
 * - `disabled` / `unknown`: an id that is not a shortcut.
 * - `disabled` / `duplicate`: an id listed twice (the first is kept).
 * - `disabled` / `malformed`: the list was not a list, or held a
 *   non-string.
 * - `key` / `malformed`: a key other than `single_key` / `disabled`
 *   (a typo like `disable:`), whose content would otherwise vanish.
 */
export interface KeyboardShortcutsDrop {
  readonly field: "single_key" | "disabled" | "key";
  readonly value: string;
  readonly reason: "unknown" | "duplicate" | "malformed";
}

export interface SalvagedKeyboardShortcuts {
  readonly value: KeyboardShortcuts;
  readonly dropped: readonly KeyboardShortcutsDrop[];
  /** True when the value was not an object at all (a scalar, a list). */
  readonly wholeValueDropped: boolean;
}

/**
 * Salvages a raw `keyboard_shortcuts` value **per field**.
 *
 * A clean value passes through. A shaped-but-dirty one keeps every
 * valid part and drops only the bad ones: a stray id in `disabled`
 * drops that id, not the user's other switches; a non-boolean
 * `single_key` falls back to on without touching `disabled`. A value
 * that is not an object degrades to "all on" (`wholeValueDropped`).
 *
 * Failing open (shortcuts on) is the default because it is the state a
 * user who never touched the setting has. A corrupt file must not
 * leave the user in a state they did not choose *and* cannot see, and
 * doctor names every drop.
 */
export function salvageKeyboardShortcuts(raw: unknown): SalvagedKeyboardShortcuts {
  if (raw === undefined) return { value: {}, dropped: [], wholeValueDropped: false };
  const parsed = KeyboardShortcutsSchema.safeParse(raw);
  if (parsed.success) return { value: parsed.data, dropped: [], wholeValueDropped: false };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { value: {}, dropped: [], wholeValueDropped: true };
  }
  const obj = raw as Record<string, unknown>;
  const dropped: KeyboardShortcutsDrop[] = [];
  const value: KeyboardShortcuts = {};

  if ("single_key" in obj) {
    const sk = obj["single_key"];
    if (typeof sk === "boolean") value.single_key = sk;
    else dropped.push({ field: "single_key", value: describeValue(sk), reason: "malformed" });
  }

  if ("disabled" in obj) {
    const list = obj["disabled"];
    if (!Array.isArray(list)) {
      dropped.push({ field: "disabled", value: describeValue(list), reason: "malformed" });
    } else {
      const seen = new Set<string>();
      const kept: ShortcutId[] = [];
      for (const v of list) {
        if (typeof v !== "string") {
          dropped.push({ field: "disabled", value: describeValue(v), reason: "malformed" });
          continue;
        }
        if (!KNOWN_IDS.has(v)) { dropped.push({ field: "disabled", value: v, reason: "unknown" }); continue; }
        if (seen.has(v)) { dropped.push({ field: "disabled", value: v, reason: "duplicate" }); continue; }
        seen.add(v);
        kept.push(v as ShortcutId);
      }
      if (kept.length > 0) value.disabled = kept;
    }
  }

  for (const key of Object.keys(obj)) {
    if (key !== "single_key" && key !== "disabled") {
      dropped.push({ field: "key", value: key, reason: "malformed" });
    }
  }
  return { value, dropped, wholeValueDropped: false };
}

/**
 * Reads `keyboard_shortcuts` out of settings, tolerating a hand-edited
 * value. Never throws.
 */
export function readKeyboardShortcuts(settings: UserSettings | undefined): KeyboardShortcuts {
  const raw = (settings as { keyboard_shortcuts?: unknown } | undefined)?.keyboard_shortcuts;
  return salvageKeyboardShortcuts(raw).value;
}

/** The master switch. Absent means on. */
export function singleKeyShortcutsOn(ks: KeyboardShortcuts): boolean {
  return ks.single_key !== false;
}

/**
 * Whether a shortcut fires: the master switch is on AND the shortcut is
 * not switched off on its own.
 */
export function isShortcutActive(ks: KeyboardShortcuts, id: ShortcutId): boolean {
  return singleKeyShortcutsOn(ks) && !(ks.disabled ?? []).includes(id);
}

/** One row of the resolved state, as every surface prints it. */
export interface ResolvedShortcut extends ShortcutSpec {
  /** The shortcut's own switch, regardless of the master. */
  readonly on: boolean;
  /** Whether it fires now: its own switch AND the master are on. */
  readonly active: boolean;
}

export interface ResolvedKeyboardShortcuts {
  readonly singleKey: boolean;
  readonly shortcuts: readonly ResolvedShortcut[];
}

/** The whole catalog with each shortcut's switch state, in catalog order. */
export function resolveKeyboardShortcuts(ks: KeyboardShortcuts): ResolvedKeyboardShortcuts {
  const disabled = new Set(ks.disabled ?? []);
  const singleKey = singleKeyShortcutsOn(ks);
  return {
    singleKey,
    shortcuts: GLOBAL_SHORTCUTS.map(s => ({
      ...s,
      on: !disabled.has(s.id),
      active: singleKey && !disabled.has(s.id),
    })),
  };
}

/**
 * Splits caller-supplied ids into known and unknown, for a WRITE path
 * that must refuse a typo rather than swallow it (the reader degrades a
 * hand edit; a command is deliberate). CLI and MCP both call this.
 */
export function validateShortcutIds(raw: readonly string[]): {
  readonly known: ShortcutId[];
  readonly unknown: string[];
} {
  const known: ShortcutId[] = [];
  const unknown: string[] = [];
  for (const id of raw) {
    if (KNOWN_IDS.has(id)) {
      if (!known.includes(id as ShortcutId)) known.push(id as ShortcutId);
    } else {
      unknown.push(id);
    }
  }
  return { known, unknown };
}

export interface ShortcutChanges {
  /** Set the master switch. */
  readonly singleKey?: boolean;
  /** Turn these shortcuts off. */
  readonly off?: readonly ShortcutId[];
  /** Turn these shortcuts back on. */
  readonly on?: readonly ShortcutId[];
}

/**
 * Applies switch changes and returns the normalized setting.
 *
 * Normalized so equal states store equally: the master is stored only
 * when off (absent means on), `disabled` is kept in catalog order and
 * omitted when empty. An id in both `off` and `on` ends up on: `on` is
 * applied last, so the caller's last word wins deterministically.
 */
export function applyShortcutChanges(current: KeyboardShortcuts, changes: ShortcutChanges): KeyboardShortcuts {
  const disabled = new Set<ShortcutId>(current.disabled ?? []);
  for (const id of changes.off ?? []) disabled.add(id);
  for (const id of changes.on ?? []) disabled.delete(id);
  const singleKey = changes.singleKey ?? singleKeyShortcutsOn(current);
  const next: KeyboardShortcuts = {};
  if (!singleKey) next.single_key = false;
  const ordered = SHORTCUT_IDS.filter(id => disabled.has(id));
  if (ordered.length > 0) next.disabled = ordered;
  return next;
}

/**
 * Writes a `keyboard_shortcuts` value into a settings object, dropping
 * the key when the value is the default (everything on). "Reset to
 * default" is `withKeyboardShortcuts(settings, {})`.
 */
export function withKeyboardShortcuts(settings: UserSettings, ks: KeyboardShortcuts): UserSettings {
  const { keyboard_shortcuts: _old, ...rest } = settings;
  if (ks.single_key === undefined && (ks.disabled === undefined || ks.disabled.length === 0)) {
    return rest as UserSettings;
  }
  return { ...rest, keyboard_shortcuts: ks } as UserSettings;
}

/** A short, safe label for a non-string value in a doctor message. */
function describeValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  if (typeof v === "object") return "an object";
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return `${v}`;
  return `a ${typeof v}`;
}
