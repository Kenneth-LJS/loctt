// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyInitialTheme, useTheme } from "./useTheme.ts";

// jsdom doesn't implement matchMedia. Each test wires its own
// listener-aware stub so we can drive system-preference flips.
function installMatchMedia(initialDark: boolean): {
  setSystemDark: (dark: boolean) => void;
  listenerCount: () => number;
} {
  let isDark = initialDark;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() { return isDark; },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    // legacy APIs the hook doesn't use, but jsdom's typing wants them
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  };
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return {
    setSystemDark: (dark: boolean) => {
      isDark = dark;
      listeners.forEach(fn => fn());
    },
    listenerCount: () => listeners.size,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useTheme", () => {
  it("defaults to system when no preference stored", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("resolves system to dark when OS prefers dark", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setPreference('dark') forces dark regardless of OS", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("dark"));
    expect(result.current.preference).toBe("dark");
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("persists the preference to localStorage", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("dark"));
    expect(window.localStorage.getItem("tt-theme")).toBe("dark");
  });

  it("reads the stored preference on mount", () => {
    window.localStorage.setItem("tt-theme", "dark");
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("dark");
    expect(result.current.resolved).toBe("dark");
  });

  it("follows OS changes while in system mode", () => {
    const { setSystemDark } = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.resolved).toBe("light");
    act(() => setSystemDark(true));
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("ignores OS changes when an explicit preference is set", () => {
    const { setSystemDark } = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setPreference("light"));
    act(() => setSystemDark(true));
    expect(result.current.resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("removes the OS listener when switching away from system mode", () => {
    const { listenerCount } = installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(listenerCount()).toBe(1);
    act(() => result.current.setPreference("dark"));
    expect(listenerCount()).toBe(0);
  });

  it("rejects junk values in storage and falls back to system", () => {
    window.localStorage.setItem("tt-theme", "neon");
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
  });
});

describe("applyInitialTheme", () => {
  it("applies dark class when stored preference is dark", () => {
    window.localStorage.setItem("tt-theme", "dark");
    installMatchMedia(false);
    applyInitialTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applies dark class for system preference when OS prefers dark", () => {
    installMatchMedia(true);
    applyInitialTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("clears dark class for system preference when OS prefers light", () => {
    document.documentElement.classList.add("dark");
    installMatchMedia(false);
    applyInitialTheme();
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
