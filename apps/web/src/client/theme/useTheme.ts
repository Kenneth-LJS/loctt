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
export function useTheme(): {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(readStored()));

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
