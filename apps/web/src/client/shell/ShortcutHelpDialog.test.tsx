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

    const turnOn = within(notice).getByRole("button", { name: "Turn on" });
    // A keyboard user is on the button when they press it.
    turnOn.focus();
    expect(document.activeElement).toBe(turnOn);
    fireEvent.click(turnOn);
    // The far end: the PUT turns the master back on (absent is on) and
    // keeps the user's other settings.
    await waitFor(() => { expect(store.puts).toHaveLength(1); });
    expect(store.puts[0]).toEqual({ theme: "dark" });
    await waitFor(() => { expect(screen.queryByTestId("shortcut-help-off-notice")).toBeNull(); });
    expect(screen.getByTestId("shortcut-row-new-task").getAttribute("aria-disabled")).toBeNull();
    // A350: the pressed button unmounted with the notice; focus lands on
    // the close button, not `body`, and a live region that was there
    // before the click says what changed.
    expect(document.activeElement).toBe(screen.getByTestId("shortcut-help-close"));
    const status = screen.getByTestId("shortcut-help-status");
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("Single-key shortcuts are on.");
  });

  // A350: "Turn on" is optimistic and rolls back on failure; without a
  // message the rollback was the only sign it had not saved.
  // @verifies A11Y-58
  it("says so when Turn on could not be saved", async () => {
    const store = stubSettingsApi({ keyboard_shortcuts: { single_key: false } });
    store.failPut = true;
    renderDialog();
    fireEvent.click(await screen.findByTestId("shortcut-help-turn-on"));
    await waitFor(() => { expect(store.puts).toHaveLength(1); });
    const notice = await screen.findByTestId("shortcut-help-off-notice");
    const alert = await within(notice).findByRole("alert");
    expect(alert.textContent).toBe("Couldn't save your shortcut settings. Try again.");
    // Rolled back: the rows are disabled again and nothing claims "on".
    expect(screen.getByTestId("shortcut-row-new-task").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByTestId("shortcut-help-status").textContent).toBe("");
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
