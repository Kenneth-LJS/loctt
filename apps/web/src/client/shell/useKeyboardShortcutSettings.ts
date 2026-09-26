import type { KeyboardShortcuts, ShortcutId } from "@loctt/contracts";
// Imported from the module directly, not through `@loctt/core`'s barrel:
// the barrel pulls in core's filesystem paths and `node:path` has no
// browser build. `users/shortcuts.js` is pure logic over ids.
import {
  applyShortcutChanges,
  readKeyboardShortcuts,
  type ResolvedKeyboardShortcuts,
  resolveKeyboardShortcuts,
  type ShortcutChanges,
  withKeyboardShortcuts,
} from "@loctt/core/users/shortcuts.js";
import { useCallback, useMemo } from "react";

import { useUserSettingsMutation } from "../api/hooks/useUserSettingsMutation.ts";
import { useUserSettings } from "../api/hooks/useWorkflow.ts";

/**
 * The acting user's single-key shortcut switches (K133), read from and
 * written to their `settings.yaml` through core's rules, so the web app
 * decides "does this shortcut fire" exactly as `loctt user shortcuts`
 * and the MCP tools report it.
 *
 * While the settings are loading, or if the read failed, the state is
 * the default (everything on): that is what a user who never touched
 * the switches has, and a failed read must not silently disable the
 * keyboard.
 */
export function useKeyboardShortcutSettings(): {
  readonly stored: KeyboardShortcuts;
  readonly state: ResolvedKeyboardShortcuts;
  readonly isOn: (id: ShortcutId) => boolean;
  readonly change: (changes: ShortcutChanges) => void;
  readonly reset: () => void;
  readonly settingsQuery: ReturnType<typeof useUserSettings>;
  readonly save: ReturnType<typeof useUserSettingsMutation>;
} {
  const settingsQuery = useUserSettings();
  const save = useUserSettingsMutation();
  const settings = settingsQuery.data?.settings;
  const stored = useMemo(() => readKeyboardShortcuts(settings), [settings]);
  const state = useMemo(() => resolveKeyboardShortcuts(stored), [stored]);
  const isOn = useCallback(
    (id: ShortcutId) => state.shortcuts.some(s => s.id === id && s.active),
    [state],
  );

  /** Whole-document write: `PUT /api/user-settings` has no PATCH. */
  const write = useCallback(
    (next: KeyboardShortcuts) => {
      save.mutate(withKeyboardShortcuts(settings ?? {}, next));
    },
    [save, settings],
  );

  const change = useCallback(
    (changes: ShortcutChanges) => { write(applyShortcutChanges(stored, changes)); },
    [write, stored],
  );
  const reset = useCallback(() => { write({}); }, [write]);

  return { stored, state, isOn, change, reset, settingsQuery, save };
}
