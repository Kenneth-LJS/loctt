/**
 * Transcribed from docs/dev/ui-test-cases/flow-settings.md (SET-2,
 * SET-11, SET-12, SET-13, SET-26, SET-27) and flow-saved-views.md
 * (VUE-38).
 *
 * These assert the **far end**: SET-12's fourth bullet is explicit
 * that the render is not the assertion — "re-read the file and confirm
 * the new `card_layout` array, in order". So each write is checked
 * against `settings.yaml` on disk, which is also what survives the
 * server restart SET-11 asks about.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** The acting user's settings.yaml — the far end of every write here. */
async function settingsYaml(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const { readdir } = await import("node:fs/promises");
  const ids = await readdir(usersDir);
  for (const id of ids) {
    try {
      return await readFile(path.join(usersDir, id, "settings.yaml"), "utf8");
    } catch {
      continue;
    }
  }
  return "";
}

test.describe("SET — personal settings", () => {
  // @verifies SET-2
  test("SET-2: every Personal nav item resolves to a real panel, not a placeholder", async ({
    page,
    tracker,
  }) => {
    // SET-2's last bullet: "no nav item routes to a 404 or an
    // unimplemented placeholder **at M4 close**".
    //
    // Scoped to Personal, which is what M4.4 owes. Nine sections
    // elsewhere still render the "not built yet" pane — General,
    // Labels, Milestones, Sprints, Saved views, Board columns,
    // Timeline defaults, Sync, Diagnostics — and they belong to M4.3
    // and M4.5-M4.8. Asserting the whole nav here would fail for work
    // this ticket was never given, and would then have to be deleted
    // rather than tightened. The last ticket in M4 owes that sweep;
    // `sections.ts`'s `built` flags are the checklist.
    for (const [section, testid] of [
      ["preferences", "preferences-panel"],
      ["card-layout", "card-layout-panel"],
      ["sidebar-pins", "sidebar-pins-panel"],
      ["keyboard", "keyboard-panel"],
    ] as const) {
      await page.goto(`${tracker.baseURL}/settings/${section}`);
      await expect(page.getByTestId(testid)).toBeVisible();
      await expect(page.getByTestId("settings-not-built")).toHaveCount(0);
    }
  });

  // @verifies SET-11
  test("SET-11: the theme choice reaches settings.yaml and survives a reload", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/preferences`);
    await page.getByTestId("theme-dark").click();

    // The file, not the picker: a localStorage-only write would repaint
    // correctly and persist nothing per-user.
    await expect
      .poll(async () => settingsYaml(tracker.root), { timeout: 5000 })
      .toContain("theme: dark");

    // The dark class is actually applied — the repaint is real.
    await expect(page.locator("html")).toHaveClass(/dark/);

    // And it comes back from the file after a reload.
    await page.reload();
    await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");
  });

  // @verifies SET-12
  test("SET-12: hiding a field writes the new card_layout array, in order", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/card-layout`);
    await expect(page.getByTestId("card-layout-panel")).toBeVisible();

    // Default layout is key, priority, assignee, labels, due_date.
    await page.getByTestId("card-field-toggle-due_date").click();

    await expect
      .poll(async () => settingsYaml(tracker.root), { timeout: 5000 })
      .toContain("card_layout");

    const text = await settingsYaml(tracker.root);
    // Order is asserted, not membership: card_layout carries render
    // order, so a set-like write would be wrong while looking right.
    const layout = text
      .split("\n")
      .filter(l => l.trim().startsWith("- "))
      .map(l => l.trim().slice(2));
    expect(layout).toEqual(["key", "priority", "assignee", "labels"]);
  });

  // @verifies SET-26
  test("SET-26: hiding every field previews an empty card and keeps the title", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/settings/card-layout`);
    for (const f of ["key", "priority", "assignee", "labels", "due_date"]) {
      await page.getByTestId(`card-field-toggle-${f}`).click();
    }

    // The outcome is visible before leaving the panel.
    await expect(page.getByTestId("card-layout-preview-empty")).toBeVisible();
    // The title survives, so cards never become blank rectangles.
    await expect(page.getByTestId("card-layout-preview"))
      .toContainText("Rewrite the export pipeline");

    await expect
      .poll(async () => settingsYaml(tracker.root), { timeout: 5000 })
      .toContain("card_layout: []");
  });

  // @verifies SET-13
  // @verifies SET-27
  test("SET-27: pins whose views were deleted are named, and swept from settings.yaml", async ({
    page,
    tracker,
  }) => {
    // Pin two views that do not exist in queries.yaml — the state
    // SET-27 reaches by deleting them while the panel is open.
    await tracker.run(["user", "settings"]);
    const usersDir = path.join(tracker.root, ".loctt", "users");
    const { readdir, writeFile, mkdir } = await import("node:fs/promises");
    const [userId] = await readdir(usersDir);
    await mkdir(path.join(usersDir, String(userId)), { recursive: true });
    await writeFile(
      path.join(usersDir, String(userId), "settings.yaml"),
      "sidebar_pins:\n  - v_gone\n  - v_also_gone\n",
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/sidebar-pins`);

    // It SAYS what was removed, rather than silently emptying — the
    // README's P7 amendment resolves SET-13's "silently" in favour of
    // this, the explaining case.
    const notice = page.getByTestId("pins-swept-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("v_gone");
    await expect(notice).toContainText("v_also_gone");

    // And the file is rewritten so the sweep does not re-run each load.
    await expect
      .poll(async () => settingsYaml(tracker.root), { timeout: 5000 })
      .toContain("sidebar_pins: []");
  });

  // @verifies VUE-38
  test("VUE-38: deleting a pinned view warns, removes it from queries.yaml, and drops the pin", async ({
    page,
    tracker,
  }) => {
    // Pin a real view, so the confirmation has a pin to warn about.
    const queriesPath = path.join(tracker.root, ".loctt", "config", "queries.yaml");
    const queries = await readFile(queriesPath, "utf8");
    const idLine = queries.split("\n").find(l => /^\s*-?\s*id:/.test(l));
    const viewId = String(idLine).split(":")[1]?.trim() ?? "";
    expect(viewId).not.toBe("");

    const usersDir = path.join(tracker.root, ".loctt", "users");
    const { readdir, writeFile } = await import("node:fs/promises");
    const [userId] = await readdir(usersDir);
    await writeFile(
      path.join(usersDir, String(userId), "settings.yaml"),
      `sidebar_pins:\n  - ${viewId}\n`,
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/settings/sidebar-pins`);
    await page.getByTestId(`view-delete-${viewId}`).click();

    // The confirmation names the view and states the pin consequence.
    const dialog = page.getByTestId("delete-view-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("recent-open");
    await expect(page.getByTestId("delete-view-pin-warning"))
      .toContainText("pin will be dropped");

    await page.getByTestId("delete-view-confirm").click();

    // The entry is gone from queries.yaml — not merely archived. A
    // soft-archive here would leave `loctt list --view` still resolving
    // it, which VUE-38's third bullet forbids.
    await expect
      .poll(async () => readFile(queriesPath, "utf8"), { timeout: 5000 })
      .not.toContain(viewId);

    // And the pin went with it, rather than being left to a later
    // sweep to explain a deletion the user just performed.
    await expect
      .poll(async () => settingsYaml(tracker.root), { timeout: 5000 })
      .not.toContain(viewId);
  });
});

// @verifies XS-41
//
// XS-41's third bullet — "The exact command is shown and copyable" —
// had no UI test. Its only coverage was a component test with a
// hand-written message, so it never saw what the server actually
// sends. Measured on the shipped app: core's key-index warning read
// "rerun with --rebuild-index to repair", with no `loctt ` prefix, so
// the panel's CLI_COMMAND_RE never matched and **zero** copyable
// commands rendered on genuine drift. Deleting the copyable rendering
// outright left all 11 tests in that component file green.
//
// The fix is in core, because the message is what both surfaces show.
test("XS-41: key-index drift shows the repair command, copyable", async ({ page, tracker }) => {
  const [key] = await tracker.seed([{ title: "Drifty" }]);
  if (key === undefined) throw new Error("seed returned no key");

  // Build the index by looking the task up, then drift it by hand —
  // without the lookup there is no index and a different branch fires.
  await tracker.run(["show", key]);
  const dir = await taskDirFor(tracker.root, key);
  const file = path.join(dir, "task.md");
  const before = await readFile(file, "utf8");
  await writeFile(file, before.replace(/^key: .+$/m, "key: ZZ-404"), "utf8");

  await page.goto(`${tracker.baseURL}/settings/diagnostics`);

  const cmd = page.getByTestId("diagnostics-command");
  await expect(cmd.first()).toBeVisible();
  // The exact command, not merely *a* command — a panel rendering
  // `loctt doctor` alone would satisfy a looser assertion while
  // leaving the user without the flag that actually repairs it.
  await expect(cmd.filter({ hasText: "loctt doctor --rebuild-index" })).toHaveCount(1);

  // Bullet 4: still no rebuild button. Asserted alongside, because on
  // its own it passes on a panel that renders nothing at all — which
  // is exactly what shipped.
  await expect(page.getByRole("button", { name: /rebuild/i })).toHaveCount(0);
});

/** The on-disk directory for a task key. */
async function taskDirFor(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  const { readdir } = await import("node:fs/promises");
  for (const id of await readdir(tasksDir)) {
    const md = path.join(tasksDir, id, "task.md");
    const text = await readFile(md, "utf8").catch(() => "");
    if (new RegExp(`^key: ${key}$`, "m").test(text)) return path.join(tasksDir, id);
  }
  throw new Error(`no task dir for ${key}`);
}
