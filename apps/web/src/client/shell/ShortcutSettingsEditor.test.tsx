// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_WRITE_TIMEOUT_MS } from "../api/client.ts";
import { ShortcutSettingsEditor } from "./ShortcutSettingsEditor.tsx";
import { renderWithProviders, stubSettingsApi } from "./shortcutSettingsTestUtils.tsx";

/**
 * The shared shortcut-switch editor (K133), used by Settings → Keyboard
 * and the `?` dialog. Asserts the PUT body, the far end, rather than the
 * rendered switch state alone.
 */
function renderEditor() {
  return renderWithProviders(() => <ShortcutSettingsEditor testIdPrefix="ed" />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShortcutSettingsEditor", () => {
  // @verifies A11Y-43
  // @verifies A11Y-56
  it("turns every single-key shortcut off with the master switch, keeping other settings", async () => {
    const store = stubSettingsApi({ theme: "dark", sidebar_pins: ["v1"] });
    renderEditor();
    const master = await screen.findByTestId("ed-master");
    expect((master as HTMLInputElement).checked).toBe(true);
    // Its accessible name is the visible label.
    expect(screen.getByRole("switch", { name: "Single-key shortcuts" })).toBe(master);

    fireEvent.click(master);
    await waitFor(() => { expect(store.puts).toHaveLength(1); });
    expect(store.puts[0]).toEqual({
      theme: "dark",
      sidebar_pins: ["v1"],
      keyboard_shortcuts: { single_key: false },
    });
  });

  // @verifies A11Y-43
  // @verifies A11Y-57
  it("turns one shortcut off on its own", async () => {
    const store = stubSettingsApi();
    renderEditor();
    const toggle = await screen.findByRole("switch", { name: "Cycle the theme" });
    fireEvent.click(toggle);
    await waitFor(() => { expect(store.puts).toHaveLength(1); });
    expect(store.puts[0]).toEqual({ keyboard_shortcuts: { disabled: ["cycle-theme"] } });
  });

  // @verifies A11Y-57
  it("disables the per-shortcut switches while the master is off, keeping their state", async () => {
    stubSettingsApi({ keyboard_shortcuts: { single_key: false, disabled: ["goto"] } });
    renderEditor();
    const gotoToggle = await screen.findByTestId("ed-toggle-goto");
    expect((gotoToggle as HTMLInputElement).disabled).toBe(true);
    expect((gotoToggle as HTMLInputElement).checked).toBe(false);
    const newTask = screen.getByTestId<HTMLInputElement>("ed-toggle-new-task");
    expect(newTask.disabled).toBe(true);
    expect(newTask.checked).toBe(true);
  });

  // @verifies A11Y-59
  it("asks before Reset to default, and Reset turns everything back on", async () => {
    const store = stubSettingsApi({ theme: "light", keyboard_shortcuts: { single_key: false, disabled: ["goto"] } });
    renderEditor();
    fireEvent.click(await screen.findByTestId("ed-reset"));
    const dialog = await screen.findByRole("dialog", { name: "Reset all shortcuts to their defaults?" });
    expect(dialog).toBeTruthy();

    // Cancel writes nothing.
    fireEvent.click(screen.getByTestId("ed-reset-cancel"));
    await waitFor(() => { expect(screen.queryByTestId("ed-reset-dialog")).toBeNull(); });
    expect(store.puts).toHaveLength(0);

    fireEvent.click(screen.getByTestId("ed-reset"));
    fireEvent.click(await screen.findByTestId("ed-reset-confirm"));
    await waitFor(() => { expect(store.puts).toHaveLength(1); });
    expect(store.puts[0]).toEqual({ theme: "light" });
  });

  it("says so when a switch could not be saved", async () => {
    const store = stubSettingsApi();
    store.failPut = true;
    renderEditor();
    fireEvent.click(await screen.findByTestId("ed-master"));
    const alert = await screen.findByTestId("ed-error");
    expect(alert.textContent).toBe("Couldn't save your shortcut settings. Try again.");
  });

  // A350: a timed-out write may have landed, so the failure line must
  // not claim it was not saved; it takes K134's unknown-outcome wording.
  it("says the change may not have been saved when the save timed out", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const store = stubSettingsApi();
      store.hangPut = true;
      renderEditor();
      fireEvent.click(await screen.findByTestId("ed-master"));
      await waitFor(() => { expect(store.puts).toHaveLength(1); });
      await act(async () => { await vi.advanceTimersByTimeAsync(DEFAULT_WRITE_TIMEOUT_MS + 1); });
      const alert = await screen.findByTestId("ed-error");
      expect(alert.textContent).toBe("Your changes may not have been saved. Please try again.");
    } finally {
      vi.useRealTimers();
    }
  });

  // A350: Settings → Keyboard heads the editor with an h1 and puts h2
  // reference groups after it, so the editor's groups must be h2 there,
  // and stay h3 under the `?` dialog's h2 title.
  it("renders its group headings at the level it is given", async () => {
    stubSettingsApi();
    renderWithProviders(() => <ShortcutSettingsEditor testIdPrefix="ed" headingLevel={2} />);
    const levels = async (): Promise<string[]> =>
      within(await screen.findByTestId("ed")).getAllByRole("heading").map(h => h.tagName);
    const asH2 = await levels();
    expect(asH2.length).toBeGreaterThan(0);
    expect(new Set(asH2)).toEqual(new Set(["H2"]));
    cleanup();
    renderEditor();
    expect(new Set(await levels())).toEqual(new Set(["H3"]));
  });
});
