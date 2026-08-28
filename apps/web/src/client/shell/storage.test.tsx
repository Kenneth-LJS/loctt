// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyInitialTheme, useTheme } from "../theme/useTheme.ts";
import { useSidebarCollapse } from "./useSidebarCollapse.ts";

/**
 * The two shell preferences against a hostile `localStorage`.
 *
 * Both read storage during the initial render, so anything that throws
 * there takes the app down before the shell paints — which is the
 * failure SHL-18 is written against, and which is exactly what happened
 * in private mode with site data blocked.
 */

/** Makes every localStorage access throw, as a blocked store does. */
function blockStorage(): void {
  const boom = (): never => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
}

function installMatchMedia(dark: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
  installMatchMedia(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("shell preferences with storage blocked (SHL-18)", () => {
  /**
   * @verifies SHL-18
   *
   * Not "the value is ignored" — the hook *threw*, so the shell never
   * rendered. Reading through a guard is the whole fix.
   */
  it("the sidebar hook mounts and toggles in-session without persisting", () => {
    blockStorage();

    const { result } = renderHook(() => useSidebarCollapse());
    expect(result.current.collapsed).toBe(false);

    // Toggling still works for the session; the dropped write must not
    // surface as an exception at the call site.
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
  });

  /**
   * @verifies SHL-18
   *
   * "Theme selection degrades the same way — it works in-session even
   * if it can't persist."
   */
  it("the theme hook mounts, applies, and switches in-session", () => {
    blockStorage();

    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");
    expect(result.current.resolved).toBe("light");

    act(() => result.current.setPreference("dark"));
    expect(result.current.preference).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  /**
   * @verifies SHL-18
   *
   * `applyInitialTheme` runs before React mounts, so a throw here is
   * not even caught by the error boundary — it is a blank page.
   */
  it("the pre-mount theme application does not throw", () => {
    blockStorage();
    expect(() => { applyInitialTheme(); }).not.toThrow();
  });
});

describe("shell preferences with a corrupt stored value (SHL-17)", () => {
  /**
   * @verifies SHL-17
   *
   * A junk value must read as the default rather than as a truthy
   * "collapsed", and the next toggle must overwrite it — the
   * corruption is self-healing.
   */
  it("a junk sidebar value reads as expanded and is replaced on the next toggle", () => {
    for (const junk of ["banana", "null", '{"collapsed":true}', ""]) {
      window.localStorage.setItem("tt-sidebar-collapsed", junk);
      const { result, unmount } = renderHook(() => useSidebarCollapse());
      expect(result.current.collapsed).toBe(false);
      unmount();
    }

    window.localStorage.setItem("tt-sidebar-collapsed", "banana");
    const { result } = renderHook(() => useSidebarCollapse());
    act(() => result.current.toggle());
    expect(window.localStorage.getItem("tt-sidebar-collapsed")).toBe("1");
  });

  /**
   * @verifies SHL-17
   *
   * The same for the theme: an unrecognised preference is not a third
   * mode, it is no preference.
   */
  it("a junk theme value falls back to system and is replaced on the next choice", () => {
    window.localStorage.setItem("tt-theme", "neon");
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe("system");

    act(() => result.current.setPreference("light"));
    expect(window.localStorage.getItem("tt-theme")).toBe("light");
  });
});
