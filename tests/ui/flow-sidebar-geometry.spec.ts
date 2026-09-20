/**
 * Real-browser geometry checks for the sidebar.
 *
 * These two behaviours were flagged by the coverage audit as covered
 * only in jsdom, which cannot assert them honestly:
 *
 *  - The resize drag: `Sidebar.resize.test.tsx` drives `pointerdown`/
 *    `pointermove` and asserts the hook's *number* and the stored value.
 *    jsdom has no layout, so it never proves the `<aside>` column
 *    actually gets wider — `getBoundingClientRect` there returns zeros.
 *    Only a real browser measures the laid-out column.
 *
 *  - The kebab-menu overflow escape: `Menu.tsx`'s portal-and-clamp was
 *    added because the sidebar's `overflow-y-auto` clipped the saved-
 *    filter row menu and an `align="end"` panel near the right edge ran
 *    off-screen (the MENU-PORTAL bug). A unit test can only assert
 *    against a mocked `getBoundingClientRect`; whether the panel is
 *    truly inside the viewport is a real-layout question.
 *
 * Harness: the shared per-test tracker fixture (`fixtures/tracker.ts`)
 * boots the real built `loctt ui` server against a real seeded `.loctt/`,
 * exactly as every other spec here does.
 */

import { expect, test } from "./fixtures/tracker.ts";

// A viewport comfortably above the sidebar's own 900px overlay
// breakpoint (`NARROW_PX` in Sidebar.tsx), so the expanded sidebar is
// the in-grid `<aside>` column with the resize handle — not the mobile
// overlay drawer, which has a fixed width and no handle.
const DESKTOP = { width: 1280, height: 900 } as const;

// Bounds from useSidebarWidth.ts: default 240, min 180, max 480.
const DEFAULT_WIDTH = 240;
const MAX_WIDTH = 480;

test.describe("SBG — sidebar geometry (real browser)", () => {
  test.use({ viewport: DESKTOP });

  // Covers the resize-drag real-geometry gap the coverage audit flagged:
  // jsdom's Sidebar.resize.test.tsx asserts the hook's number and the
  // localStorage write, but has no layout to prove the column actually
  // widens or that the widened width is what the browser lays out after a
  // reload. Regression guard: if the drag stopped feeding the width into
  // the aside's inline style (or the reload restore broke), the measured
  // bounding-box width below would not grow, or would fall back to 240.
  test("SBG-1: dragging the resize handle widens the sidebar column and persists across reload", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);

    // The expanded, in-grid column. There is exactly one non-collapsed,
    // non-overlay aside in this layout.
    const aside = page.locator('aside[data-collapsed="false"]:not([data-overlay])');
    await expect(aside).toBeVisible();

    const handle = page.getByTestId("sidebar-resize-handle");
    await expect(handle).toBeVisible();

    const startBox = await aside.boundingBox();
    if (startBox === null) throw new Error("sidebar has no bounding box");
    // Sanity: it starts at the default width (allow a px of rounding).
    expect(Math.abs(startBox.width - DEFAULT_WIDTH)).toBeLessThanOrEqual(2);

    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error("resize handle has no bounding box");
    const handleCx = handleBox.x + handleBox.width / 2;
    const handleCy = handleBox.y + handleBox.height / 2;

    // Drag the handle +80px to the right with the real mouse. The width
    // is measured from the sidebar's left edge to the pointer, so a +80
    // move should widen the column by ~80.
    const dragBy = 80;
    await page.mouse.move(handleCx, handleCy);
    await page.mouse.down();
    // Move in two steps so the pointermove listeners fire mid-drag, the
    // way a real drag does, rather than teleporting.
    await page.mouse.move(handleCx + dragBy / 2, handleCy, { steps: 5 });
    await page.mouse.move(handleCx + dragBy, handleCy, { steps: 5 });
    await page.mouse.up();

    // Real layout: the column is measurably wider. Assert it grew by
    // roughly the drag distance (tolerant of sub-pixel rounding and the
    // handle's own 6px width).
    const widened = await expect
      .poll(async () => (await aside.boundingBox())?.width ?? 0, {
        message: "sidebar width after drag",
      })
      .toBeGreaterThan(startBox.width + dragBy - 15);
    void widened;
    const afterBox = await aside.boundingBox();
    if (afterBox === null) throw new Error("sidebar has no bounding box after drag");
    // Not absurdly wider than the drag, either — the width should track
    // the pointer, not run away.
    expect(afterBox.width).toBeLessThan(startBox.width + dragBy + 15);
    const widenedWidth = afterBox.width;

    // Persisted: a reload restores the widened width, not the 240 default.
    await page.reload();
    const reloadedAside = page.locator('aside[data-collapsed="false"]:not([data-overlay])');
    await expect(reloadedAside).toBeVisible();
    await expect
      .poll(async () => (await reloadedAside.boundingBox())?.width ?? 0, {
        message: "sidebar width after reload",
      })
      .toBeGreaterThan(widenedWidth - 5);
    // And it is genuinely the persisted value, not a reset to default.
    const reloadedBox = await reloadedAside.boundingBox();
    if (reloadedBox === null) throw new Error("sidebar has no bounding box after reload");
    expect(reloadedBox.width).toBeGreaterThan(DEFAULT_WIDTH + dragBy - 15);

    // The persisted number is exactly what the hook wrote to localStorage.
    const stored = await page.evaluate(() => window.localStorage.getItem("loctt.sidebarWidth"));
    expect(stored).not.toBeNull();
    expect(Number(stored)).toBeGreaterThan(DEFAULT_WIDTH + dragBy - 15);
  });

  // Optional clamping check, still real-geometry: an over-long drag caps
  // at the 480 max rather than eating the main pane.
  test("SBG-2: dragging past the maximum clamps the column at 480px", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);

    const aside = page.locator('aside[data-collapsed="false"]:not([data-overlay])');
    const handle = page.getByTestId("sidebar-resize-handle");
    await expect(handle).toBeVisible();

    const handleBox = await handle.boundingBox();
    if (handleBox === null) throw new Error("resize handle has no bounding box");
    const handleCy = handleBox.y + handleBox.height / 2;

    // Drag far past the max (well beyond 480px from the sidebar's left).
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleCy);
    await page.mouse.down();
    await page.mouse.move(900, handleCy, { steps: 10 });
    await page.mouse.up();

    await expect
      .poll(async () => (await aside.boundingBox())?.width ?? 0, {
        message: "sidebar width after over-long drag",
      })
      // Capped at the max (allow a couple px of rounding), not wider.
      .toBeLessThanOrEqual(MAX_WIDTH + 2);
    const box = await aside.boundingBox();
    if (box === null) throw new Error("sidebar has no bounding box");
    expect(Math.abs(box.width - MAX_WIDTH)).toBeLessThanOrEqual(2);
  });

  // Covers the menu overflow-escape real-DOM gap the audit flagged. The
  // MENU-PORTAL bug (documented in Menu.tsx): the saved-filter row's
  // kebab menu was clipped by the sidebar's `overflow-y-auto` and, when
  // `align="end"` next to a near-right-edge trigger, ran off the left of
  // the viewport. The fix portals the panel to document.body and clamps
  // it into the viewport. jsdom's unit test can only assert against a
  // mocked getBoundingClientRect; only a real browser proves the panel
  // is genuinely on-screen and not clipped.
  //
  // Regression guard: an un-portaled panel would be a descendant of the
  // scrolling <aside> (the `parentElement is body` assertion fails), and
  // a clamped-but-unportaled or unclamped panel could have a negative
  // left / a right past the viewport (the box assertions fail). Either
  // way this test goes red where the unit test cannot.
  test("SBG-3: a saved-filter row kebab menu opens fully on-screen, not clipped by the sidebar", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);

    // The default tracker's queries.yaml ships two user views —
    // `recent-open` and `blocked` — each rendered as a saved-filter row
    // with a kebab labelled `Actions for saved filter "<name>"`.
    const kebab = page.getByRole("button", {
      name: 'Actions for saved filter "recent-open"',
    });
    await expect(kebab).toBeVisible();
    await kebab.click();

    const menu = page.getByRole("menu", {
      name: 'Actions for saved filter "recent-open"',
    });
    await expect(menu).toBeVisible();

    // The menu items are the real labels from RowActions in Sidebar.tsx.
    const editItem = menu.getByRole("menuitem", { name: "Edit…" });
    const deleteItem = menu.getByRole("menuitem", { name: "Delete…" });
    await expect(editItem).toBeVisible();
    await expect(deleteItem).toBeVisible();

    // Portaled: the panel is a child of <body>, escaping the sidebar's
    // overflow clip. (An un-portaled panel would sit inside the <aside>.)
    const parentTag = await menu.evaluate(
      el => el.parentElement?.tagName.toLowerCase() ?? "",
    );
    expect(parentTag).toBe("body");
    const insideAside = await menu.evaluate(el => el.closest("aside") !== null);
    expect(insideAside).toBe(false);

    // The real-DOM check the unit test cannot make: the panel's box is
    // fully within the viewport — left not negative, right not past the
    // viewport width. A small gutter tolerance mirrors the component's
    // own VIEWPORT_MARGIN (8px).
    const vw = page.viewportSize()?.width ?? DESKTOP.width;
    const menuBox = await menu.boundingBox();
    if (menuBox === null) throw new Error("menu panel has no bounding box");
    expect(menuBox.x).toBeGreaterThanOrEqual(-1);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(vw + 1);

    // And each item is itself within the viewport horizontally — the
    // point of the fix was that "Edit…/Delete…" were unreadable off the
    // edge.
    for (const item of [editItem, deleteItem]) {
      const b = await item.boundingBox();
      if (b === null) throw new Error("menu item has no bounding box");
      expect(b.x).toBeGreaterThanOrEqual(-1);
      expect(b.x + b.width).toBeLessThanOrEqual(vw + 1);
    }
  });
});
