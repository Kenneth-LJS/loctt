import { useCallback, useEffect, useState } from "react";

import { readLocal, writeLocal } from "../shell/storage.ts";

/**
 * Theme preference. `system` follows OS prefers-color-scheme; `light`
 * and `dark` are explicit overrides.
 */
export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "tt-theme";
const DARK_CLASS = "dark";

function readStored(): ThemePreference {
  // Anything outside the three known values — corrupt, absent, or an
  // unreadable store — falls back to system (SHL-17, SHL-18).
  const v = readLocal(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyResolvedTheme(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add(DARK_CLASS);
  else root.classList.remove(DARK_CLASS);
}

function resolve(pref: ThemePreference): "light" | "dark" {
  return pref === "system" ? (systemPrefersDark() ? "dark" : "light") : pref;
}

/**
 * Read / write the active theme preference. The returned `resolved`
 * value is what's actually applied to the DOM (system collapses to
 * light or dark based on OS preference).
 *
 * The hook also installs a `prefers-color-scheme` listener while the
 * preference is `system` so the page tracks OS dark-mode flips live.
 */
/**
 * Adopts a theme that came from somewhere other than this browser —
 * the acting user's `settings.yaml` (SET-11).
 *
 * Called by the shell once the settings query answers. The stored
 * value is per-*user*, so switching users must repaint to theirs even
 * though this browser's localStorage still holds the previous user's
 * choice; that is why this overwrites the cache rather than deferring
 * to it. The cache's job is only to avoid a flash before the fetch
 * lands.
 */
export function adoptStoredTheme(pref: unknown): void {
  if (pref !== "light" && pref !== "dark" && pref !== "system") return;
  writeLocal(STORAGE_KEY, pref);
  applyResolvedTheme(resolve(pref));
  for (const listener of listeners) listener(pref);
}

/**
 * Subscribers to out-of-band theme changes. `useTheme` is used in more
 * than one place (the picker, and the shell that seeds it), and a
 * `useState` per call site would let the picker keep rendering the
 * previous user's choice after a switch repainted the page.
 */
const listeners = new Set<(pref: ThemePreference) => void>();

export function useTheme(): {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(readStored()));

  // Track adoptions from the user's settings file so every mounted
  // picker agrees with what is painted.
  useEffect(() => {
    const listener = (next: ThemePreference): void => { setPreferenceState(next); };
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  // Apply on mount and whenever preference changes.
  useEffect(() => {
    const next = resolve(preference);
    setResolved(next);
    applyResolvedTheme(next);
  }, [preference]);

  // Track the OS preference while we're in `system` mode. The listener
  // runs only when we're system-tracking; explicit modes don't react.
  useEffect(() => {
    if (preference !== "system") return undefined;
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => {
      const next: "light" | "dark" = mq.matches ? "dark" : "light";
      setResolved(next);
      applyResolvedTheme(next);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    writeLocal(STORAGE_KEY, next);
    setPreferenceState(next);
  }, []);

  return { preference, resolved, setPreference };
}

/**
 * One-shot helper to apply the stored theme before React mounts, so
 * users don't see a flash of the wrong scheme. Called from main.tsx.
 */
export function applyInitialTheme(): void {
  applyResolvedTheme(resolve(readStored()));
}
