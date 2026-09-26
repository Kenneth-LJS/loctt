// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ShortcutHelpDialog } from "./ShortcutHelpDialog.tsx";
import { renderWithProviders, stubSettingsApi } from "./shortcutSettingsTestUtils.tsx";

/**
 * The `?` keyboard reference overlay (A11Y-4), its CONFIG-5 footer link
 * into Settings → Keyboard, and its K133 states: the master-off notice
 * with "Turn on", the per-shortcut "Off" label, and the Customize view.
 */
function renderDialog(onClose: () => void = () => undefined) {
  return renderWithProviders(() => <ShortcutHelpDialog onClose={onClose} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShortcutHelpDialog", () => {
  /**
   * @verifies SHL-48
   *
   * P4/config-discoverability: the `?` overlay is a summary; the full
   * reference lives in Settings → Keyboard. Without a link the two are
   * disconnected surfaces — the overlay must point at the panel.
   */
  it("links its footer to Settings → Keyboard", async () => {
    stubSettingsApi();
    renderDialog();
    const link = (await screen.findByTestId("shortcut-help-keyboard-link")).closest("a") as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.getAttribute("href")).toContain("/settings/keyboard");
  });

  /**
   * @verifies SHL-48
   *
   * Following the link dismisses the overlay (it is a modal layer): a
   * stale dialog left open over the destination panel would trap focus.
   */
  it("closes the dialog when the Keyboard link is followed", async () => {
    stubSettingsApi();
    const onClose = vi.fn();
    renderDialog(onClose);
    (await screen.findByTestId("shortcut-help-keyboard-link")).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // @verifies A11Y-58
  it("with the master switch off, disables every row and offers Turn on", async () => {
    const store = stubSettingsApi({ theme: "dark", keyboard_shortcuts: { single_key: false } });
    renderDialog();
    const notice = await screen.findByTestId("shortcut-help-off-notice");
    expect(notice.textContent).toContain("Single-key shortcuts are off.");
    for (const id of ["new-task", "focus-search", "goto", "toggle-sidebar", "cycle-theme", "shortcut-help"]) {
      expect(screen.getByTestId(`shortcut-row-${id}`).getAttribute("aria-disabled"), id).toBe("true");
    }

    fireEvent.click(within(notice).getByRole("button", { name: "Turn on" }));
    // The far end: the PUT turns the master back on (absent is on) and
    // keeps the user's other settings.
    await waitFor(() => { expect(store.puts).toHaveLength(1); });
    expect(store.puts[0]).toEqual({ theme: "dark" });
    await waitFor(() => { expect(screen.queryByTestId("shortcut-help-off-notice")).toBeNull(); });
    expect(screen.getByTestId("shortcut-row-new-task").getAttribute("aria-disabled")).toBeNull();
  });

  // @verifies A11Y-58
  it("marks only a shortcut switched off on its own as Off", async () => {
    stubSettingsApi({ keyboard_shortcuts: { disabled: ["cycle-theme"] } });
    renderDialog();
    await screen.findByTestId("shortcut-off-cycle-theme");
    expect(screen.getByTestId("shortcut-row-cycle-theme").getAttribute("aria-disabled")).toBe("true");
    // Neighbours stay on, and there is no master-off notice.
    expect(screen.queryByTestId("shortcut-off-new-task")).toBeNull();
    expect(screen.getByTestId("shortcut-row-new-task").getAttribute("aria-disabled")).toBeNull();
    expect(screen.queryByTestId("shortcut-help-off-notice")).toBeNull();
  });

  // @verifies A11Y-58
  it("swaps to the settings editor on Customize and back on Done", async () => {
    const store = stubSettingsApi();
    renderDialog();
    fireEvent.click(await screen.findByTestId("shortcut-help-customize"));
    const toggle = await screen.findByTestId("shortcut-help-settings-toggle-new-task");
    fireEvent.click(toggle);
    await waitFor(() => { expect(store.puts).toHaveLength(1); });
    expect(store.puts[0]).toEqual({ keyboard_shortcuts: { disabled: ["new-task"] } });

    fireEvent.click(screen.getByTestId("shortcut-help-done"));
    await screen.findByTestId("shortcut-off-new-task");
    expect(screen.queryByTestId("shortcut-help-settings")).toBeNull();
  });

  // @verifies A11Y-59
  it("closes only the Reset confirm on Esc, not the dialog under it", async () => {
    stubSettingsApi();
    const onClose = vi.fn();
    renderDialog(onClose);
    fireEvent.click(await screen.findByTestId("shortcut-help-customize"));
    fireEvent.click(await screen.findByTestId("shortcut-help-settings-reset"));
    await screen.findByTestId("shortcut-help-settings-reset-dialog");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => { expect(screen.queryByTestId("shortcut-help-settings-reset-dialog")).toBeNull(); });
    expect(onClose).not.toHaveBeenCalled();
  });
});
