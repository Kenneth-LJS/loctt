/**
 * K156: every relationship group renders through one component
 * (`relationships/TaskTree` on `ui/SortableTree`), so rows line up across
 * flat and tree groups, and moving a row draws a drop line where it will
 * land. Geometry is measured in a real laid-out page: jsdom has no layout,
 * so only a browser can say two things start at the same x.
 *
 * Drags are driven with dispatched `dragstart`/`dragover` events sharing
 * one DataTransfer; Playwright's mouse drag does not reliably produce the
 * HTML5 pair (the same approach as the B40 reorder spec).
 */

import type { Locator, Page } from "@playwright/test";

import type { TrackerFixture } from "./fixtures/tracker.ts";
import { expect, test } from "./fixtures/tracker.ts";

async function left(loc: Locator): Promise<number> {
  const box = await loc.boundingBox();
  if (box === null) throw new Error("element has no box");
  return box.x;
}

async function box(loc: Locator): Promise<{ top: number; bottom: number; height: number }> {
  const b = await loc.boundingBox();
  if (b === null) throw new Error("element has no box");
  return { top: b.y, bottom: b.y + b.height, height: b.height };
}

/** The row of a group for the task with `key`. */
function rowFor(page: Page, group: string, key: string): Locator {
  return page
    .locator(`[data-group="${group}"] [data-testid="relationship-row"]`)
    .filter({ has: page.locator("a > span", { hasText: new RegExp(`^${key}$`) }) });
}

/** The sortable `<li>` holding that row. */
function itemFor(page: Page, group: string, key: string): Locator {
  return page
    .locator(`[data-group="${group}"] li[data-sortable-row]`)
    .filter({
      has: page.locator('[data-testid="relationship-row"]')
        .filter({ has: page.locator("a > span", { hasText: new RegExp(`^${key}$`) }) }),
    });
}

async function openTask(page: Page, tracker: TrackerFixture, key: string): Promise<void> {
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await expect(page.getByTestId("relationships-panel")).toBeVisible();
}

// @verifies REL-52
test("REL-52: handle and key start at the same x in flat and tree groups", async ({ page, tracker }) => {
  const [root, blocked, parent] = await tracker.seed([
    { title: "Root" }, { title: "Blocked one" }, { title: "The parent" },
  ]);
  await tracker.run(["link", root ?? "", "blocks", blocked ?? ""]);
  await tracker.run(["link", root ?? "", "parent", parent ?? ""]);
  await tracker.run(["create", "The child", "--parent", root ?? ""]); // T-4, a leaf
  await openTask(page, tracker, root ?? "");

  const groups = [
    { group: "blocks", key: blocked ?? "" },
    { group: "parent", key: parent ?? "" },
    { group: "child", key: "T-4" },
  ];
  const handles: number[] = [];
  const keys: number[] = [];
  for (const g of groups) {
    const r = rowFor(page, g.group, g.key);
    await expect(r).toBeVisible();
    handles.push(await left(r.getByTestId("drag-handle")));
    keys.push(await left(r.locator("a > span").first()));
  }
  for (const x of handles) expect(Math.abs(x - (handles[0] as number))).toBeLessThanOrEqual(1);
  for (const x of keys) expect(Math.abs(x - (keys[0] as number))).toBeLessThanOrEqual(1);
  // A leaf in a tree group has no toggle taking space.
  await expect(page.locator('[data-group="child"] [data-testid="tree-toggle"]')).toHaveCount(0);

  // The child-progress readout sits beside its bar, inside the list.
  const meter = page.getByTestId("child-progress");
  await expect(page.getByTestId("child-progress-readout")).toContainText("0 / 1");
  const bar = await page.getByTestId("child-progress-bar").boundingBox();
  const readout = await page.getByTestId("child-progress-readout").boundingBox();
  const list = await page.locator('[data-group="child"]').boundingBox();
  if (bar === null || readout === null || list === null) throw new Error("meter not laid out");
  expect(readout.x - (bar.x + bar.width)).toBeLessThan(16);
  expect(readout.x + readout.width).toBeLessThanOrEqual(list.x + list.width);
  await expect(meter).toBeVisible();
});

/** Root blocks A, B, C in that order. */
async function threeBlocked(tracker: TrackerFixture): Promise<string[]> {
  const keys = await tracker.seed([{ title: "Root" }, { title: "A" }, { title: "B" }, { title: "C" }]);
  const [root, a, b, c] = keys as [string, string, string, string];
  for (const t of [a, b, c]) await tracker.run(["link", root, "blocks", t]);
  return [root, a, b, c];
}

// @verifies REL-53
test("REL-53: dragging a row draws the line between the two rows it will land between", async ({ page, tracker }) => {
  const [root, a, b, c] = await threeBlocked(tracker);
  await openTask(page, tracker, root ?? "");
  await expect(page.locator("[data-testid='drop-line']")).toHaveCount(0);

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await itemFor(page, "blocks", c ?? "").dispatchEvent("dragstart", { dataTransfer });
  // Over its own slot: nothing would change, so no line.
  await itemFor(page, "blocks", c ?? "").dispatchEvent("dragover", { dataTransfer });
  await expect(page.getByTestId("drop-line")).toHaveCount(0);

  // Over B while moving up: the line sits between A and B.
  await itemFor(page, "blocks", b ?? "").dispatchEvent("dragover", { dataTransfer });
  const line = page.getByTestId("drop-line");
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute("data-edge", "above");
  await expect(itemFor(page, "blocks", b ?? "").getByTestId("drop-line")).toHaveCount(1);
  const l = await box(line);
  const rowA = await box(rowFor(page, "blocks", a ?? ""));
  const rowB = await box(rowFor(page, "blocks", b ?? ""));
  expect(l.height).toBeCloseTo(2, 0);
  expect(l.top).toBeGreaterThanOrEqual(rowA.bottom - 2);
  expect(l.bottom).toBeLessThanOrEqual(rowB.top + 2);
  const accent = await line.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(accent).not.toBe("rgba(0, 0, 0, 0)");

  // Drag end clears it; nothing was written.
  await itemFor(page, "blocks", c ?? "").dispatchEvent("dragend", { dataTransfer });
  await expect(page.getByTestId("drop-line")).toHaveCount(0);
});

// @verifies REL-53
test("REL-53: a keyboard move shows the line at the pending edge; Escape clears it", async ({ page, tracker }) => {
  const [root, a, , c] = await threeBlocked(tracker);
  await openTask(page, tracker, root ?? "");

  const handle = rowFor(page, "blocks", c ?? "").getByTestId("drag-handle");
  await handle.focus();
  await handle.press("ArrowUp");
  // C now sits between A and B on screen; the line marks the edge it
  // crossed, between A and C.
  const line = page.getByTestId("drop-line");
  await expect(line).toBeVisible();
  await expect(itemFor(page, "blocks", c ?? "").getByTestId("drop-line")).toHaveAttribute("data-edge", "above");
  const l = await box(line);
  const rowA = await box(rowFor(page, "blocks", a ?? ""));
  const rowC = await box(rowFor(page, "blocks", c ?? ""));
  expect(l.top).toBeGreaterThanOrEqual(rowA.bottom - 2);
  expect(l.bottom).toBeLessThanOrEqual(rowC.top + 2);

  await handle.press("Escape");
  await expect(page.getByTestId("drop-line")).toHaveCount(0);
});

// @verifies REL-53
test("REL-53: a direct child cannot be dropped among grandchildren", async ({ page, tracker }) => {
  const [p] = await tracker.seed([{ title: "Parent" }]);
  for (const title of ["A", "B"]) await tracker.run(["create", title, "--parent", p ?? ""]);
  await tracker.run(["create", "G", "--parent", "T-2"]); // T-4 under A
  await openTask(page, tracker, p ?? "");
  const reranks: string[] = [];
  page.on("request", r => { if (r.url().includes("/rerank")) reranks.push(r.url()); });

  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  const bItem = page.locator('[data-group="child"] li[data-depth="0"]').filter({ has: page.locator('[data-testid="tree-node"][data-depth="0"]', { hasText: "T-3" }) });
  const gRow = page.locator('[data-group="child"] li[data-depth="1"]');
  await bItem.dispatchEvent("dragstart", { dataTransfer });
  await gRow.dispatchEvent("dragover", { dataTransfer });
  // The drop lands next to G's top-level ancestor A, never inside A.
  await expect(page.getByTestId("drop-line")).toHaveCount(1);
  await expect(gRow.getByTestId("drop-line")).toHaveCount(0);
  await bItem.dispatchEvent("dragend", { dataTransfer });
  expect(reranks).toHaveLength(0);
});
