/**
 * Single-key shortcut switches (K133, A11Y-43, A11Y-56 to A11Y-60).
 *
 * Browser specs because what they assert is browser behaviour: a real
 * keypress on a real page doing nothing, a modifier shortcut in a real
 * contenteditable still working, and a switch flipped in the UI landing
 * in `settings.yaml` (the far end, read off disk).
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/tracker.ts";

async function settingsFile(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  for (const id of await readdir(usersDir)) {
    try {
      return await readFile(path.join(usersDir, id, "settings.yaml"), "utf8");
    } catch {
      continue;
    }
  }
  return "";
}

async function openKeyboardSettings(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/settings/keyboard`);
  await expect(page.getByTestId("keyboard-shortcuts-master")).toBeVisible();
}

/** Presses a key with nothing focused, so the global dispatcher sees it. */
async function pressOnPage(page: Page, key: string): Promise<void> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); });
  await page.keyboard.press(key);
}

test.describe("Single-key shortcut switches", () => {
  // @verifies A11Y-43
  // @verifies A11Y-56
  test("A11Y-56: the master switch silences every single-key shortcut; modifier keys still work", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Shortcut task" }]);
    await openKeyboardSettings(page, tracker.baseURL);
    await page.getByTestId("keyboard-shortcuts-master").click();
    await expect(page.getByTestId("keyboard-shortcuts")).toHaveAttribute("data-single-key", "off");
    await expect.poll(() => settingsFile(tracker.root)).toMatch(/single_key: false/);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Shortcut task")).toBeVisible();
    await pressOnPage(page, "n");
    await pressOnPage(page, "?");
    await pressOnPage(page, "g");
    await pressOnPage(page, "b");
    // Give a wrongly-live shortcut the time it would need to act.
    await page.waitForTimeout(300);
    await expect(page.getByTestId("create-task-modal")).toHaveCount(0);
    await expect(page.getByTestId("shortcut-help")).toHaveCount(0);
    await expect(page).toHaveURL(/\/list$/);

    // The CLI reads the same setting back (P10).
    expect(await tracker.run(["user", "shortcuts"])).toContain("single-key\toff");

    // Cmd/Ctrl+Enter carries a modifier, so it still saves a description.
    await page.goto(`${tracker.baseURL}/tasks/${String(key)}`);
    await page.getByTestId("body-editor").waitFor({ state: "visible" });
    const placeholder = page.getByTestId("body-rendered-placeholder");
    if (await placeholder.count() > 0) await placeholder.click();
    else await page.getByTestId("body-edit").click();
    await page.getByTestId("body-editor").getByTestId("rich-editor").click();
    await page.keyboard.type("saved by keyboard");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("body-rendered")).toContainText("saved by keyboard");
    await expect.poll(async () => tracker.run(["body", String(key)])).toContain("saved by keyboard");
  });

  // @verifies A11Y-43
  // @verifies A11Y-57
  test("A11Y-57: one shortcut off is the only one dead; Go to off does not swallow the next key", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One off task" }]);
    await openKeyboardSettings(page, tracker.baseURL);
    await page.getByRole("switch", { name: "Create a task" }).click();
    await page.getByRole("switch", { name: "Go to List, Board or Timeline" }).click();
    await expect.poll(() => settingsFile(tracker.root)).toMatch(/- new-task[\s\S]*- goto/);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("One off task")).toBeVisible();
    await page.evaluate(() => { window.localStorage.setItem("tt-theme", "light"); });
    await page.reload();
    await expect(page.getByText("One off task")).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await pressOnPage(page, "n");
    await page.waitForTimeout(300);
    await expect(page.getByTestId("create-task-modal")).toHaveCount(0);

    // `g` is dead, so the `t` after it is not eaten as a chord tail: it
    // cycles the theme, and nothing navigates.
    await pressOnPage(page, "g");
    await pressOnPage(page, "t");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page).toHaveURL(/\/list$/);

    // A neighbour still fires: `?` opens the dialog, which marks the off
    // shortcut "Off" and not the others.
    await pressOnPage(page, "?");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("shortcut-off-new-task")).toBeVisible();
    await expect(dialog.getByTestId("shortcut-row-new-task")).toHaveAttribute("aria-disabled", "true");
    await expect(dialog.getByTestId("shortcut-off-cycle-theme")).toHaveCount(0);
  });

  // @verifies A11Y-58
  test("A11Y-58: the `?` dialog's Customize view switches a shortcut and Done returns", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Customize task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Customize task")).toBeVisible();

    await pressOnPage(page, "?");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await dialog.getByTestId("shortcut-help-customize").click();
    await expect(dialog.getByTestId("shortcut-help-settings")).toBeVisible();
    // Keyboard-operable: Space on the focused switch flips it.
    await dialog.getByRole("switch", { name: "Collapse or expand the sidebar" }).focus();
    await page.keyboard.press("Space");
    await expect.poll(() => settingsFile(tracker.root)).toMatch(/- toggle-sidebar/);

    await dialog.getByTestId("shortcut-help-done").click();
    await expect(dialog.getByTestId("shortcut-off-toggle-sidebar")).toBeVisible();
    // Focus stayed in the dialog through the view swap.
    await expect(dialog.getByTestId("shortcut-help-close")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // And the switch took effect: `[` no longer collapses the sidebar.
    const sidebar = page.locator("[data-collapsed]");
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");
    await pressOnPage(page, "[");
    await page.waitForTimeout(300);
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  });

  // @verifies A11Y-58
  // @verifies A11Y-60
  test("A11Y-60: with `?` off, the user menu opens the dialog, which offers Turn on", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Menu task" }]);
    await tracker.run(["user", "shortcuts", "--single-key", "off"]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Menu task")).toBeVisible();

    await pressOnPage(page, "?");
    await page.waitForTimeout(300);
    await expect(page.getByTestId("shortcut-help")).toHaveCount(0);

    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId("user-menu-shortcuts").click();
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("shortcut-help-close")).toBeFocused();
    await expect(dialog.getByTestId("shortcut-help-off-notice")).toContainText("Single-key shortcuts are off.");
    await expect(dialog.getByTestId("shortcut-row-new-task")).toHaveAttribute("aria-disabled", "true");

    await dialog.getByTestId("shortcut-help-turn-on").click();
    await expect(dialog.getByTestId("shortcut-help-off-notice")).toHaveCount(0);
    await expect.poll(() => settingsFile(tracker.root)).not.toMatch(/keyboard_shortcuts/);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    await pressOnPage(page, "n");
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
  });

  // @verifies A11Y-59
  test("A11Y-59: Reset to default asks first, then turns everything back on", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "shortcuts", "--single-key", "off", "--off", "goto"]);
    await openKeyboardSettings(page, tracker.baseURL);
    await expect(page.getByTestId("keyboard-shortcuts-master")).not.toBeChecked();

    await page.getByTestId("keyboard-shortcuts-reset").click();
    const confirm = page.getByRole("dialog", { name: "Reset all shortcuts to their defaults?" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByTestId("keyboard-shortcuts-reset-cancel")).toBeFocused();
    await confirm.getByTestId("keyboard-shortcuts-reset-cancel").click();
    await expect(confirm).toBeHidden();
    expect(await settingsFile(tracker.root)).toMatch(/single_key: false/);

    await page.getByTestId("keyboard-shortcuts-reset").click();
    await page.getByTestId("keyboard-shortcuts-reset-confirm").click();
    await expect(page.getByTestId("keyboard-shortcuts-master")).toBeChecked();
    await expect(page.getByTestId("keyboard-shortcuts-toggle-goto")).toBeChecked();
    await expect.poll(() => settingsFile(tracker.root)).not.toMatch(/keyboard_shortcuts/);
  });
});
