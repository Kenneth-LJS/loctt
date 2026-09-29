/**
 * Real-browser checks for K158 (docs/dev/decisions.md): one "Views"
 * section of built-in and saved views, and the count/⋯ slot every row
 * ends in.
 *
 * jsdom (`Sidebar.test.tsx`, `SidebarGroupsPanel.test.tsx`,
 * `sidebarGroups.test.ts`) covers the ordering, the migration, the menus
 * and the writes. What only a real browser can show:
 *
 *  - that the count and the ⋯ occupy the same box, measured, and that the
 *    swap on hover and on keyboard focus moves nothing (the swap is CSS:
 *    `:hover`, `:has(:focus-visible)` and `(hover: none)`, none of which
 *    jsdom evaluates);
 *  - that a touch screen keeps the count and offers no ⋯;
 *  - that Hide and Customize sidebar round-trip through the real server
 *    and survive a reload.
 */

import { appendFile } from "node:fs/promises";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/tracker.ts";

/** Creates a saved view through the CLI and returns its id. */
async function createView(
  tracker: { run(args: readonly string[]): Promise<string> },
  name: string,
  ...filterArgs: string[]
): Promise<string> {
  const out = await tracker.run(["views", "create", name, ...filterArgs]);
  const id = /id (\S+)\)/.exec(out)?.[1];
  if (id === undefined) throw new Error(`no view id in: ${out}`);
  return id;
}

/** The Views section's rows, top to bottom, by their visible name. */
async function rowNames(page: Page): Promise<string[]> {
  return page.locator("#sidebar-section-views .sidebar-views-row").evaluateAll(rows =>
    rows.map(r => r.querySelector("a, [aria-disabled]")?.textContent?.trim() ?? ""));
}

/** The row whose link reads `name`. */
function row(page: Page, name: string): Locator {
  return page.locator("#sidebar-section-views .sidebar-views-row", {
    has: page.getByRole("link", { name, exact: true }),
  });
}

async function box(l: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const b = await l.boundingBox();
  if (b === null) throw new Error("no bounding box");
  return b;
}

test.describe("K158 — one Views section", () => {
  // @verifies SHL-50
  test("SHL-50: built-in and saved views render in one section, in the stored order, with + New view last", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    const bugs = await createView(tracker, "Open bugs");
    await tracker.run(["user", "sidebar-groups", "--order", `view:${bugs},overdue,assigned-to-me`]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByTestId("sidebar-section-toggle-views")).toHaveText("Views");
    await expect.poll(async () => (await rowNames(page)).slice(0, 3))
      .toEqual(["Open bugs", "Overdue", "Assigned to me"]);
    // The unplaced ones follow: the other built-ins, then init's seed view.
    expect((await rowNames(page)).at(-1)).toBe("recent-open");

    const aside = page.locator("aside");
    await expect(aside.getByText("Filters", { exact: true })).toHaveCount(0);
    await expect(aside.getByText("Saved views", { exact: true })).toHaveCount(0);
    const last = page.locator("#sidebar-section-views > :last-child");
    await expect(last).toHaveAttribute("data-testid", "sidebar-new-filter");
    await expect(last).toHaveText(/New view/);
  });

  // @verifies SHL-52
  test("SHL-52: Hide from a row's ⋯ removes it (across a reload), and Customize sidebar brings it back", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    const overdue = row(page, "Overdue");
    await expect(overdue).toBeVisible();

    await page.getByRole("button", { name: 'Actions for view "Overdue"' }).click();
    await page.getByRole("menuitem", { name: "Hide" }).click();
    await expect(overdue).toHaveCount(0);
    await page.reload();
    await expect(row(page, "Assigned to me")).toBeVisible();
    await expect(overdue).toHaveCount(0);

    await page.getByRole("button", { name: "Customize sidebar" }).click();
    const toggle = page.getByTestId("sidebar-view-toggle-overdue");
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    await page.keyboard.press("Escape");
    // Back in its place: between Due this week and High priority.
    await expect.poll(async () => (await rowNames(page)).slice(3, 6))
      .toEqual(["Due this week", "Overdue", "High priority"]);
  });

  // @verifies SHL-52
  test("SHL-52: a saved view's ⋯ offers Edit, Rename, Delete and Hide; Rename renames it through the view dialog", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await page.getByRole("button", { name: 'Actions for view "recent-open"' }).click();
    const menu = page.getByRole("menu", { name: 'Actions for view "recent-open"' });
    await expect(menu.getByRole("menuitem")).toHaveText(["Edit", "Rename", "Delete", "Hide"]);
    await menu.getByRole("menuitem", { name: "Rename" }).click();

    // The name is selected, so typing replaces it.
    await expect(page.getByTestId("view-form-name")).toBeFocused();
    await page.keyboard.type("Recently touched");
    await page.getByTestId("view-form-save").click();
    await expect(row(page, "Recently touched")).toBeVisible();
    await expect(page.locator("aside").getByText("recent-open")).toHaveCount(0);
  });
});

test.describe("K158 — the count/⋯ slot", () => {
  // @verifies SHL-51
  test("SHL-51: the ⋯ replaces the count in the same box on hover, and nothing in the row moves", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Hot", fields: { priority: "high" } }]);
    await page.goto(`${tracker.baseURL}/list`);
    const hp = row(page, "High priority");
    const count = hp.getByTestId("sidebar-row-count");
    await expect(count).toHaveText("1");
    const slot = hp.getByTestId("sidebar-row-slot");
    const kebab = hp.getByRole("button", { name: 'Actions for view "High priority"' });
    // The ⋯'s wrapper carries the show/hide (opacity, so it stays focusable).
    const actions = slot.locator(".sidebar-slot-actions");
    const label = hp.getByText("High priority", { exact: true });

    // At rest: the count shows, the ⋯ does not.
    await page.mouse.move(600, 500);
    await expect(count).toBeVisible();
    await expect(actions).toHaveCSS("opacity", "0");
    const slotAtRest = await box(slot);
    const countAtRest = await box(count);
    const labelAtRest = await box(label);

    await hp.hover();
    await expect(actions).toHaveCSS("opacity", "1");
    await expect(count).toBeHidden();
    const k = await box(kebab);
    // The ⋯ is exactly the slot: same x, same width (K158: the count
    // "must have same width as the ... button").
    expect(k.x).toBeCloseTo(slotAtRest.x, 0);
    expect(k.width).toBeCloseTo(slotAtRest.width, 0);
    // The count was right-aligned in that same box.
    expect(countAtRest.x + countAtRest.width).toBeCloseTo(slotAtRest.x + slotAtRest.width, 0);
    // Nothing shifted.
    expect(await box(slot)).toEqual(slotAtRest);
    expect(await box(label)).toEqual(labelAtRest);

    // Every row's slot ends where a project row's ⋯ does.
    const projectKebab = page.locator("[data-project-row] button[aria-haspopup]").first();
    const p = await box(projectKebab);
    expect(slotAtRest.x + slotAtRest.width).toBeCloseTo(p.x + p.width, 0);

    await page.mouse.move(600, 500);
    await expect(count).toBeVisible();
    await expect(actions).toHaveCSS("opacity", "0");
  });

  // @verifies SHL-51
  test("SHL-51: keyboard focus on a row shows its ⋯ in the count's place", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    const due = row(page, "Due this week");
    await expect(due.getByTestId("sidebar-row-count")).toHaveText("0");
    // Tab from the previous row's link: its ⋯, then this row's link.
    await page.getByRole("link", { name: "Mentions me", exact: true }).focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Due this week", exact: true })).toBeFocused();
    const actions = due.locator(".sidebar-slot-actions");
    await expect(actions).toHaveCSS("opacity", "1");
    await expect(due.getByTestId("sidebar-row-count")).toBeHidden();
    // The next Tab lands on the ⋯ itself, still shown.
    await page.keyboard.press("Tab");
    await expect(due.getByRole("button", { name: 'Actions for view "Due this week"' })).toBeFocused();
    await expect(actions).toHaveCSS("opacity", "1");
  });

  // @verifies SHL-51, SHL-53
  test("SHL-53: a saved view counts what clicking it lists, and above 99 the slot reads 99+", async ({
    page,
    tracker,
  }) => {
    await tracker.seedBulk(100);
    await tracker.seed([{ title: "Hot", fields: { priority: "high" } }]);
    await createView(tracker, "Everything");
    await createView(tracker, "Hot ones", "--filter", "priority = high");

    await page.goto(`${tracker.baseURL}/list`);
    // The visible text is "99+"; the true total is kept for assistive
    // tech (a visually hidden span) and in the tooltip (VUE-16).
    await expect(row(page, "Everything").getByTestId("sidebar-row-count").locator("[aria-hidden='true']")).toHaveText("99+");
    await expect(page.getByRole("link", { name: "Everything", exact: true })).toHaveAttribute("title", "Everything, 101 tasks");
    const hot = row(page, "Hot ones").getByTestId("sidebar-row-count");
    await expect(hot).toHaveText("1");

    await page.getByRole("link", { name: "Hot ones", exact: true }).click();
    await expect(page.getByText(/Showing 1–1 of 1\b/)).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });

  // @verifies SHL-53
  test("SHL-53: a broken saved view shows a labelled warning mark instead of a count", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await appendFile(
      path.join(tracker.root, ".loctt", "config", "queries.yaml"),
      "  - id: v_broken\n    name: Old triage\n    filters:\n      - kind: advanced\n        query: \"nonsense_field = 3 and (\"\n",
      "utf8",
    );
    await page.goto(`${tracker.baseURL}/list`);
    const broken = page.locator("[data-broken-view-row='v_broken']");
    await expect(broken).toBeVisible();
    await expect(broken.getByRole("img", { name: "Broken view" })).toBeVisible();
    await expect(broken.getByTestId("sidebar-row-count")).toHaveCount(0);
    // Still a link (VUE-22).
    await expect(broken.locator("a[data-broken-view='v_broken']")).toBeVisible();
  });
});

test.describe("K158 — touch screens keep the count", () => {
  // Chromium's device emulation: a touch-first device reports
  // `(hover: none)`, the media query the slot's CSS keys on.
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 800 } });

  // @verifies SHL-51
  test("SHL-51: with no hover, the count stays and no ⋯ is offered in the sidebar", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    expect(await page.evaluate(() => matchMedia("(hover: none)").matches)).toBe(true);
    const overdue = row(page, "Overdue");
    await expect(overdue.getByTestId("sidebar-row-count")).toHaveText("0");
    await expect(overdue.getByRole("button", { name: 'Actions for view "Overdue"' })).toBeHidden();
    await overdue.getByRole("link", { name: "Overdue", exact: true }).tap();
    await expect(page).toHaveURL(/q=/);
    await expect(overdue.getByTestId("sidebar-row-count")).toBeVisible();
  });
});
