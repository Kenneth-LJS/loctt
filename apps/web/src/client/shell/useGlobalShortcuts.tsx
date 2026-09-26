import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { useCreateTask } from "../create/CreateTaskProvider.tsx";
import { type ThemePreference,useTheme } from "../theme/useTheme.ts";
import { useAnnouncer } from "../ui/Announcer.tsx";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog.tsx";
import { useKeyboardShortcutSettings } from "./useKeyboardShortcutSettings.ts";
import { useShortcuts } from "./useShortcuts.ts";

/**
 * The documented theme cycle (A11Y-7): light → dark → system.
 *
 * Exported so the test asserts the same order the handler advances
 * through, rather than a re-derivation of it that could agree with a
 * bug.
 */
export const THEME_CYCLE: readonly ThemePreference[] = ["light", "dark", "system"];

export function nextTheme(current: ThemePreference): ThemePreference {
  const i = THEME_CYCLE.indexOf(current);
  // An unrecognised stored value lands at the start of the cycle
  // rather than at index 0 by accident of `indexOf` returning -1.
  if (i === -1) return THEME_CYCLE[0] as ThemePreference;
  return THEME_CYCLE[(i + 1) % THEME_CYCLE.length] as ThemePreference;
}

/**
 * Binds the global shortcut table to real behaviour, and owns the `?`
 * dialog's open state.
 *
 * Returns the dialog element for the shell to render. A hook that
 * renders is unusual, but the alternative — a component wrapping the
 * shell — would put the dialog inside the region the shell marks
 * `inert` while a modal is open, which is exactly where it must not
 * be.
 */
export function useGlobalShortcuts(options: {
  readonly onFocusSearch: () => void;
  readonly onToggleSidebar: () => void;
}): { readonly helpDialog: React.ReactNode; readonly openHelp: () => void } {
  const { onFocusSearch, onToggleSidebar } = options;
  const navigate = useNavigate();
  const createTask = useCreateTask();
  const { preference, setPreference } = useTheme();
  const { announce } = useAnnouncer();
  const [helpOpen, setHelpOpen] = useState(false);
  // K133: the user's off switches decide which shortcuts fire.
  const { isOn } = useKeyboardShortcutSettings();
  const openHelp = useCallback(() => { setHelpOpen(true); }, []);

  const cycleTheme = useCallback(() => {
    const next = nextTheme(preference);
    setPreference(next);
    // A11Y-7's first bullet: the change is announced (A11Y-24). A
    // theme flip has no other non-visual signal at all, so without
    // this the key is silent to the user who most needs to know it
    // did something.
    announce(`Theme: ${next}`);
  }, [preference, setPreference, announce]);

  useShortcuts({
    "new-task": () => { createTask.open(); },
    "focus-search": onFocusSearch,
    "goto-list": () => { void navigate({ to: "/list" }); },
    "goto-board": () => { void navigate({ to: "/board" }); },
    "goto-timeline": () => { void navigate({ to: "/timeline" }); },
    "toggle-sidebar": onToggleSidebar,
    "cycle-theme": cycleTheme,
    "shortcut-help": openHelp,
  }, isOn);

  return {
    // The user menu's "Keyboard shortcuts" item opens the same dialog
    // (K133), since `?` itself can be switched off.
    openHelp,
    helpDialog: helpOpen ? (
      <ShortcutHelpDialog onClose={() => { setHelpOpen(false); }} />
    ) : null,
  };
}
