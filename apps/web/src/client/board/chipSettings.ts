import type { UserSettings } from "@loctt/contracts";

/**
 * Board chip visibility, stored per user (BRD-3, BRD-4).
 *
 * **Hidden, not visible.** The setting records the columns the user
 * turned *off*, so a column added to `workflow.yaml` later is visible
 * by default rather than invisible until the user finds the chip. A
 * stored visible-list would silently hide every new column, which is
 * the same silent-omission failure P7 rules out — and BRD-4 says a
 * user who has never toggled sees all columns.
 *
 * **In `settings.yaml`, not `localStorage`.** BRD-4 verifies the file
 * on disk and requires a second user to get their own state, which
 * per-browser storage cannot provide.
 *
 * The key is not in `UserSettingsSchema`, which is `.passthrough()`
 * and deliberately open to UI-defined keys — the server stores
 * settings schema-lessly. So it is read defensively: anything that is
 * not an array of strings means "nothing hidden" rather than a throw.
 */
export const HIDDEN_COLUMNS_KEY = "board_hidden_columns";

export function hiddenColumnsOf(settings: UserSettings | undefined): readonly string[] {
  const raw = (settings as Record<string, unknown> | undefined)?.[HIDDEN_COLUMNS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter((id): id is string => typeof id === "string");
}

/**
 * Returns the full settings object to PUT.
 *
 * `PUT /api/user-settings` replaces the whole document — there is no
 * PATCH — so the other keys have to be carried through. Dropping them
 * here would erase `card_layout` and `default_project` every time a
 * chip was clicked.
 */
export function withHiddenColumns(
  settings: UserSettings,
  hidden: readonly string[],
): UserSettings {
  return { ...settings, [HIDDEN_COLUMNS_KEY]: [...hidden] } as UserSettings;
}
