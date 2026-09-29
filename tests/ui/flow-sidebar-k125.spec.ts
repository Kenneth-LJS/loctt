/**
 * Real-browser checks for K125 (docs/dev/decisions.md).
 *
 * jsdom (`Sidebar.test.tsx`, `SidebarGroupsPanel.test.tsx`,
 * `sidebarGroups.test.ts`) already covers K125's logic exhaustively —
 * the "All projects" row removal, the view-link scope-clearing search
 * function, the grouped/migrated order resolution, and the panel's
 * disabled-state wiring. What jsdom cannot prove:
 *
 *  - That clicking a real `<a>` in a real browser actually navigates
 *    and the resulting URL has no leftover project/view/filter params
 *    (jsdom specs only read the computed `href`, never click through).
 *  - That the disabled child switch/handle in the Customize-sidebar
 *    panel are REALLY inert to a real click (jsdom can assert the
 *    `disabled` DOM attribute, but not that a native browser click is
 *    actually swallowed).
 *  - That "Save as view" measures 28px in a real laid-out toolbar, not
 *    just that its Tailwind class string contains "h-8".
 *
 * Harness: the shared per-test tracker fixture, exactly as every other
 * spec here.
 */

import { expect, test } from "./fixtures/tracker.ts";

test.describe("K125 — sidebar 'All projects' removed, view links clear scope", () => {
  test("K125-1: the sidebar has no 'All projects' row", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);
    await page.goto(`${tracker.baseURL}/list`);
    // Scoped to the sidebar `<aside>`: an unscoped `getByText("Projects")`
    // strict-mode-fails because the FilterBar's toolbar row ("Project
    // Status Priority Assignee Add filter") concatenates into one text
    // node at its wrapping `<div>` that also matches — a different
    // element, same page, not the row this test is about.
    const sidebar = page.locator("aside");
    await expect(sidebar.getByTestId("sidebar-section-toggle-projects")).toBeVisible();
    await expect(page.getByTestId("project-all")).toHaveCount(0);
    await expect(sidebar.getByText("All projects")).toHaveCount(0);
  });

  test("K125-2: scoping a project then clicking List clears the project from the URL, and List lights up", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);
    await page.goto(`${tracker.baseURL}/list`);

    await page.getByRole("link", { name: "Web" }).click();
    await expect(page).toHaveURL(/project=/);

    await page.getByRole("link", { name: "List" }).click();
    await expect(page).not.toHaveURL(/project=/);
    // deriveActiveRow: on a plain /list with nothing scoped, the List
    // row itself is the one lit — checked via the shared `data-active`
    // marker `ItemShell` draws.
    const listRow = page.getByRole("link", { name: "List" });
    await expect(listRow.locator("[data-active]")).toHaveCount(1);
  });

  test("K125-3: a toolbar filter (e.g. status) set on List does not survive a click to Board", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page).toHaveURL(/status=in_progress/);

    await page.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board/);
    await expect(page).not.toHaveURL(/status=in_progress/);
  });
});

// K158 (Ken, 2026-09-29): the K125 "Filters" group these tests were
// written for is gone. *"why are you splitting filters vs saved
// views?!?! ... it should be 1"*. The built-in and saved views are the
// children of one "Views" group; K125's nesting and disabled-children
// rules carry over to it, so these tests now exercise that group.
test.describe("K125 (amended K158) — Customize sidebar: nested Views group", () => {
  async function openCustomizeSidebar(page: import("@playwright/test").Page): Promise<void> {
    await page.getByRole("button", { name: "Customize sidebar" }).click();
    await expect(page.getByTestId("sidebar-groups-panel")).toBeVisible();
  }

  test("K125-4: the built-in views render nested under one 'Views' row, not six flat rows", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await openCustomizeSidebar(page);

    await expect(page.getByTestId("sidebar-group-row-views")).toBeVisible();
    await expect(page.getByTestId("sidebar-view-row-overdue")).toBeVisible();
    // No flat top-level row for an individual built-in.
    await expect(page.getByTestId("sidebar-group-row-overdue")).toHaveCount(0);
  });

  test("K125-5: switching the Views group off visibly disables (and a click on) a child's switch and drag handle", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await openCustomizeSidebar(page);

    await page.getByTestId("sidebar-group-toggle-views").click();

    const childToggle = page.getByTestId("sidebar-view-toggle-overdue");
    await expect(childToggle).toBeDisabled();
    const childHandle = page.getByTestId("sidebar-view-handle-overdue");
    await expect(childHandle).toBeDisabled();

    // A real click on a disabled native control is a no-op — the
    // checked state must not flip.
    const before = await childToggle.isChecked();
    await childToggle.click({ force: true }).catch(() => { /* disabled controls may refuse the click entirely */ });
    expect(await childToggle.isChecked()).toBe(before);
  });

  test("K125-6: hiding the Views group drops every built-in and saved view from the live sidebar", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByTestId("sidebar-section-toggle-views")).toBeVisible();
    await openCustomizeSidebar(page);

    await page.getByTestId("sidebar-group-toggle-views").click();
    await page.keyboard.press("Escape");

    const aside = page.locator("aside");
    await expect(aside.getByText("Overdue")).toHaveCount(0);
    await expect(aside.getByText("Assigned to me")).toHaveCount(0);
    // init's seed view goes too: it is a child of the same group.
    await expect(aside.getByText("recent-open")).toHaveCount(0);
    // The whole section (heading included) is gone; the rest renders.
    await expect(page.getByTestId("sidebar-section-toggle-views")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-section-toggle-projects")).toBeVisible();
  });

  test("K125-8: moving the Views section in Customize sidebar actually moves it in the rendered sidebar", async ({
    page,
    tracker,
  }) => {
    // Ken's complaint about the first cut of K125 was that moving a row
    // in the customiser changed nothing visible ("so its not connected").
    // The literal round-trip: describe the sidebar's section order, move
    // Views via the panel, reload, describe it again.
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByTestId("sidebar-section-toggle-projects")).toBeVisible();

    const sectionOrder = async (): Promise<string[]> => {
      const headings = page.locator("aside button[data-testid^='sidebar-section-toggle-']");
      return headings.evaluateAll(els => els.map(el => el.getAttribute("data-testid") ?? ""));
    };

    const before = await sectionOrder();
    const beforeIndex = before.indexOf("sidebar-section-toggle-views");
    expect(beforeIndex).toBeGreaterThan(0);

    await openCustomizeSidebar(page);
    // Keyboard reorder: arrows pick it up and move it, Enter drops it (K156).
    const viewsHandle = page.getByTestId("sidebar-group-handle-views");
    await viewsHandle.focus();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("ArrowUp");
    }
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");

    await page.reload();
    await expect(page.getByTestId("sidebar-section-toggle-projects")).toBeVisible();
    await expect.poll(async () => (await sectionOrder()).indexOf("sidebar-section-toggle-views")).toBeLessThan(beforeIndex);
  });
});

test.describe("K125 — 'Save as view' is 28px in a real toolbar", () => {
  test("K125-7: the Save-as-view button measures 28px tall", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    const button = page.getByTestId("view-actions-save-view");
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    if (box === null) throw new Error("Save-as-view button has no bounding box");
    expect(Math.round(box.height)).toBe(28);
  });
});
