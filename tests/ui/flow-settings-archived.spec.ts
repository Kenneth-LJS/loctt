/**
 * Transcribed from tests/cases/ui-test-cases/flow-settings.md § D,
 * Settings → Archived (K121 #1, backlog B1): SET-52, SET-53, SET-54.
 *
 * Archived items are browsable nowhere else in the web UI. These drive
 * the real app against a real tracker: archive through the CLI, look for
 * the items on every browsing surface (absent, no reveal), then see,
 * restore and delete them in Settings → Archived and check the far end
 * on disk / through the CLI.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/tracker.ts";

/** A row of the Archived list, found by the text it shows. */
function archivedRow(page: Page, text: string) {
  return page.locator('[data-testid^="archived-row-"]').filter({ hasText: text });
}

async function rowMenu(page: Page, text: string, action: "restore" | "delete"): Promise<void> {
  const row = archivedRow(page, text);
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.locator(`[data-testid^="archived-${action}-"]`).click();
}

async function configId(root: string, file: string, name: string): Promise<string> {
  const yaml = await readFile(path.join(root, ".loctt", "config", file), "utf8");
  const m = new RegExp(`id:\\s*(\\S+)\\s*\\n\\s*name:\\s*["']?${name}`).exec(yaml);
  if (m?.[1] === undefined) throw new Error(`no id for ${name} in ${file}`);
  return m[1];
}

test.describe("Settings → Archived (K121 #1)", () => {
  // @verifies SET-52
  test("SET-52: archived items are reachable only from Settings → Archived", async ({
    page,
    tracker,
  }) => {
    const [liveKey, goneKey] = await tracker.seed([{ title: "Live task" }, { title: "Gone task" }]);
    await tracker.run(["archive", String(goneKey)]);
    await tracker.run(["label", "create", "stale"]);
    await tracker.run(["label", "archive", "stale"]);
    await tracker.run(["milestone", "create", "Old milestone"]);
    await tracker.run(["milestone", "archive", "Old milestone"]);
    await tracker.run(["sprint", "create", "Old sprint", "--start", "2025-01-01", "--end", "2025-01-14", "--state", "completed"]);
    await tracker.run(["sprint", "archive", "Old sprint"]);
    await tracker.run(["project", "create", "Legacy", "--prefix", "LEG"]);
    await tracker.run(["project", "archive", "Legacy"]);

    // Every browsing surface: the archived item is absent and nothing
    // offers to show it (no toggle, no scope control, no URL param).
    const surfaces: readonly [string, string][] = [
      ["/list", "Gone task"],
      ["/list?archived=all", "Gone task"],
      ["/board", "Gone task"],
      ["/board?archived=all", "Gone task"],
      ["/timeline", "Gone task"],
      ["/sprints", "Old sprint"],
      ["/milestones", "Old milestone"],
      ["/settings/labels", "stale"],
      ["/settings/milestones", "Old milestone"],
      ["/settings/sprints", "Old sprint"],
      ["/settings/projects", "Legacy"],
    ];
    for (const [url, hidden] of surfaces) {
      await page.goto(`${tracker.baseURL}${url}`);
      await expect(page.locator("main")).toBeVisible();
      if (url.startsWith("/list")) await expect(page.getByText("Live task")).toBeVisible();
      await expect(page.locator("main").getByText(hidden, { exact: true }), `${url} shows ${hidden}`).toHaveCount(0);
      await expect(page.getByText(/show archived/i), `${url} offers a reveal`).toHaveCount(0);
      await expect(page.locator('[data-testid$="archived-scope-reveal"], [data-testid$="archived-scope"]'), url)
        .toHaveCount(0);
    }
    expect(liveKey).toBeDefined();

    // Settings has an Archived section, listing every archivable type
    // with its archived count.
    await page.goto(`${tracker.baseURL}/settings`);
    await page.getByTestId("settings-nav-archived").click();
    await expect(page.getByTestId("archived-panel")).toBeVisible();
    for (const [kind, count] of [
      ["tasks", "1"], ["projects", "1"], ["views", "0"], ["labels", "1"],
      ["milestones", "1"], ["sprints", "1"], ["users", "0"],
    ] as const) {
      await expect(page.getByTestId(`archived-kind-${kind}`)).toHaveAttribute("data-count", count);
    }

    // A type's items are a plain list — name, and when it was archived
    // where that is known. No search box, no filter.
    const row = archivedRow(page, "Gone task");
    await expect(row).toContainText(String(goneKey));
    await expect(row.getByTestId("archived-at")).toHaveText(/^Archived \d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(page.getByTestId("archived-panel").getByRole("textbox")).toHaveCount(0);

    await page.getByTestId("archived-kind-labels").click();
    await expect(archivedRow(page, "stale")).toBeVisible();
  });

  // @verifies SET-53
  test("SET-53: restore one, the selected ones, or all", async ({ page, tracker }) => {
    const keys = await tracker.seed([
      { title: "Arch one" }, { title: "Arch two" }, { title: "Arch three" },
      { title: "Arch four" }, { title: "Arch five" },
    ]);
    for (const k of keys) await tracker.run(["archive", String(k)]);

    await page.goto(`${tracker.baseURL}/settings/archived`);
    await expect(page.getByTestId("archived-kind-tasks")).toHaveAttribute("data-count", "5");

    // One row's Restore: it leaves the list and is back in the list view.
    await rowMenu(page, "Arch one", "restore");
    await expect(page.getByTestId("archived-outcome")).toHaveText("Restored 1 task.");
    await expect(archivedRow(page, "Arch one")).toHaveCount(0);

    // Restore selected: exactly the selected rows.
    await archivedRow(page, "Arch two").getByRole("checkbox").check();
    await archivedRow(page, "Arch four").getByRole("checkbox").check();
    await page.getByTestId("archived-restore-selected").click();
    await expect(page.getByTestId("archived-outcome")).toHaveText("Restored 2 tasks.");
    await expect(archivedRow(page, "Arch two")).toHaveCount(0);
    await expect(archivedRow(page, "Arch four")).toHaveCount(0);
    await expect(archivedRow(page, "Arch three")).toBeVisible();
    await expect(archivedRow(page, "Arch five")).toBeVisible();

    // The far end: the CLI agrees on which are still archived.
    const stillArchived = await tracker.run(["list", "--archived", "archived"]);
    expect(stillArchived).toContain("Arch three");
    expect(stillArchived).toContain("Arch five");
    expect(stillArchived).not.toContain("Arch two");

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody")).toContainText("Arch one");
    await expect(page.locator("tbody")).toContainText("Arch four");
    await expect(page.locator("tbody")).not.toContainText("Arch three");

    // Restore all: every archived item of the type.
    await page.goto(`${tracker.baseURL}/settings/archived`);
    await page.getByTestId("archived-restore-all").click();
    await expect(page.getByTestId("archived-outcome")).toHaveText("Restored 2 tasks.");
    await expect(page.getByTestId("archived-empty")).toHaveText("No archived tasks.");
  });

  // @verifies SET-54
  test("SET-54: delete one through the entity's own flow, or all with a typed confirmation", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "stale"]);
    const labelId = await configId(tracker.root, "labels.yaml", "stale");
    const [labelled] = await tracker.seed([
      { title: "Carries the label", fields: { labels: `[${labelId}]` } },
    ]);
    await tracker.run(["label", "archive", "stale"]);
    const gone = await tracker.seed([{ title: "Doomed one" }, { title: "Doomed two" }]);
    for (const k of gone) await tracker.run(["archive", String(k)]);

    await page.goto(`${tracker.baseURL}/settings/archived`);

    // Delete all tasks: a typed confirmation naming what and how many,
    // saying it is permanent. Nothing is sent until the word is typed.
    await page.getByTestId("archived-delete-all").click();
    const dialog = page.getByRole("dialog", { name: "Permanently delete 2 tasks?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("archived-delete-names")).toContainText("Doomed one");
    await expect(dialog.getByTestId("archived-delete-names")).toContainText("Doomed two");
    await expect(dialog).toContainText("Deleting is permanent.");
    const confirm = dialog.getByTestId("archived-delete-confirm");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await confirm.click();
    await expect(page.getByTestId("archived-outcome")).toHaveText("Deleted 2 tasks.");
    const all = await tracker.run(["list", "--archived", "all"]);
    expect(all).not.toContain("Doomed one");
    expect(all).not.toContain("Doomed two");

    // A label still on a task: its row Delete is the labels panel's own
    // remap-or-clear dialog, with the count, and a required choice.
    await page.getByTestId("archived-kind-labels").click();
    await rowMenu(page, "stale", "delete");
    await expect(page.getByTestId("remap-refcount")).toContainText("1 task currently uses");
    await expect(page.getByTestId("remap-permanent")).toHaveText("Deleting is permanent.");
    await expect(page.getByTestId("remap-confirm")).toBeDisabled();
    await page.getByTestId("remap-clear").check();
    await page.getByTestId("remap-confirm").click();
    await expect(archivedRow(page, "stale")).toHaveCount(0);

    // Far end: the label is gone from config and from the task.
    const labels = await readFile(path.join(tracker.root, ".loctt", "config", "labels.yaml"), "utf8");
    expect(labels).not.toContain(labelId);
    expect(await tracker.run(["show", String(labelled)])).not.toContain(labelId);
  });
});
