/**
 * B40 (K140, K141, K143): a task's direct children are reordered on its
 * page with the same handle every other relationship group has — by
 * keyboard and by drag — and the new order is what the file, a reload
 * and `loctt show` on the parent all say.
 *
 * The user report behind it (K140): "under a task/story/etc with
 * children, you cant re-order the children". Every assertion that claims
 * a write reads the parent's `task.md` or asks the CLI, never the panel
 * that made the write.
 *
 * @verifies REL-5 REL-6 REL-13 REL-14 REL-15
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import type { TrackerFixture } from "./fixtures/tracker.ts";
import { expect, test } from "./fixtures/tracker.ts";

async function taskDir(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) return path.join(tasksDir, id);
  }
  throw new Error(`no task on disk with key ${key}`);
}

const idOf = async (root: string, key: string): Promise<string> => path.basename(await taskDir(root, key));

/** The parent's `child` targets in rank order, read from its file. */
async function storedChildOrder(root: string, key: string): Promise<string[]> {
  const text = await readFile(path.join(await taskDir(root, key), "task.md"), "utf8");
  const block = /^relationships:\n((?:[ \t]+.*\n)+)/m.exec(text)?.[1] ?? "";
  const edges: { type: string; target: string; rank: string }[] = [];
  for (const item of block.split(/\n\s*-\s+/)) {
    const type = /type:\s*(\S+)/.exec(item)?.[1];
    const target = /target:\s*(\S+)/.exec(item)?.[1];
    const rank = /rank:\s*(\S+)/.exec(item)?.[1];
    if (type === "child" && target !== undefined && rank !== undefined) edges.push({ type, target, rank });
  }
  return edges.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)).map(e => e.target);
}

/** The child keys `loctt show` lists for the parent, in its order. */
async function shownChildOrder(tracker: TrackerFixture, key: string): Promise<string[]> {
  const out = await tracker.run(["show", key]);
  return [...out.matchAll(/^\s*child → (\S+)/gm)].flatMap(m => (m[1] === undefined ? [] : [m[1]]));
}

/** Depth-0 tree nodes of the Children group, in render order, by id. */
async function renderedChildren(page: Page): Promise<(string | undefined)[]> {
  return page
    .locator('[data-group="child"] [data-testid="tree-node"][data-depth="0"]')
    .evaluateAll(els => els.map(e => (e as HTMLElement).dataset["target"]));
}

function handleFor(page: Page, id: string) {
  return page.locator(
    `[data-group="child"] [data-testid="tree-node"][data-target="${id}"] [data-testid="drag-handle"]`,
  );
}

/** The draggable row (the depth-0 `<li>`, subtree included) for a child. */
function dragRowFor(page: Page, id: string) {
  return page.locator(
    `[data-group="child"] li[draggable="true"]:has(> [data-testid="tree-node"][data-target="${id}"])`,
  );
}

async function openTask(page: Page, tracker: TrackerFixture, key: string): Promise<void> {
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await expect(page.getByTestId("relationships-panel")).toBeVisible();
}

/** P with children A, B, C (in that order) and a grandchild G under A. */
async function family(tracker: TrackerFixture): Promise<Record<"p" | "a" | "b" | "c" | "g", string>> {
  const [p] = await tracker.seed([{ title: "Parent" }]);
  const parent = p ?? "";
  for (const title of ["A", "B", "C"]) await tracker.run(["create", title, "--parent", parent]);
  // Keys are allocated in creation order: T-2, T-3, T-4.
  const [a, b, c] = ["T-2", "T-3", "T-4"];
  await tracker.run(["create", "G", "--parent", a]);
  return { p: parent, a, b, c, g: "T-5" };
}

test("B40: children reorder by keyboard; the order survives a reload and `loctt show` agrees", async ({ page, tracker }) => {
  const k = await family(tracker);
  const id = {
    a: await idOf(tracker.root, k.a),
    b: await idOf(tracker.root, k.b),
    c: await idOf(tracker.root, k.c),
  };
  await openTask(page, tracker, k.p);
  await expect.poll(() => renderedChildren(page)).toEqual([id.a, id.b, id.c]);
  // Every direct child has the handle; the grandchild has none.
  await expect(page.locator('[data-group="child"] [data-testid="drag-handle"]')).toHaveCount(3);
  await expect(handleFor(page, await idOf(tracker.root, "T-5"))).toHaveCount(0);

  // Move C to the top: two ArrowUps buffer, Enter writes once.
  const reranks: string[] = [];
  page.on("request", r => { if (r.url().includes("/rerank")) reranks.push(r.url()); });
  const handle = handleFor(page, id.c);
  await expect(handle).toHaveAttribute("aria-label", /^Reorder T-4, position 3 of 3\./);
  await handle.focus();
  await handle.press("ArrowUp");
  await handle.press("ArrowUp");
  expect(reranks).toHaveLength(0);
  const settled = page.waitForResponse(r => r.url().includes("/rerank") && r.request().method() === "POST");
  await handle.press("Enter");
  expect((await settled).status()).toBe(200);
  expect(reranks).toHaveLength(1);

  await expect.poll(() => storedChildOrder(tracker.root, k.p)).toEqual([id.c, id.a, id.b]);
  await page.reload();
  await expect.poll(() => renderedChildren(page)).toEqual([id.c, id.a, id.b]);
  // The grandchild still sits under A.
  await expect(
    page.locator(`[data-group="child"] li:has(> [data-testid="tree-node"][data-target="${id.a}"]) [data-testid="tree-node"][data-depth="1"]`),
  ).toHaveCount(1);
  expect(await shownChildOrder(tracker, k.p)).toEqual([k.c, k.a, k.b]);
});

test("B40: Escape during a keyboard move puts the child back and writes nothing", async ({ page, tracker }) => {
  const k = await family(tracker);
  const ids = [await idOf(tracker.root, k.a), await idOf(tracker.root, k.b), await idOf(tracker.root, k.c)];
  const before = await readFile(path.join(await taskDir(tracker.root, k.p), "task.md"), "utf8");
  await openTask(page, tracker, k.p);
  await expect.poll(() => renderedChildren(page)).toEqual(ids);

  const reranks: string[] = [];
  page.on("request", r => { if (r.url().includes("/rerank")) reranks.push(r.url()); });
  const handle = handleFor(page, ids[0] as string);
  await handle.focus();
  await handle.press("ArrowDown");
  await expect.poll(() => renderedChildren(page)).toEqual([ids[1], ids[0], ids[2]]);
  await handleFor(page, ids[0] as string).press("Escape");
  await expect.poll(() => renderedChildren(page)).toEqual(ids);
  await page.waitForTimeout(300);
  expect(reranks).toHaveLength(0);
  expect(await readFile(path.join(await taskDir(tracker.root, k.p), "task.md"), "utf8")).toBe(before);
});

test("B40: children reorder by drag; the order survives a reload and `loctt show` agrees", async ({ page, tracker }) => {
  const k = await family(tracker);
  const id = {
    a: await idOf(tracker.root, k.a),
    b: await idOf(tracker.root, k.b),
    c: await idOf(tracker.root, k.c),
  };
  await openTask(page, tracker, k.p);
  await expect.poll(() => renderedChildren(page)).toEqual([id.a, id.b, id.c]);

  // Drop B onto A's row: B lands before A. HTML5 drag-and-drop is driven
  // with dispatched events (Playwright's mouse drag does not reliably
  // produce them), carrying one DataTransfer across the three events as
  // a browser does.
  const settled = page.waitForResponse(r => r.url().includes("/rerank") && r.request().method() === "POST");
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await dragRowFor(page, id.b).dispatchEvent("dragstart", { dataTransfer });
  await dragRowFor(page, id.a).dispatchEvent("dragover", { dataTransfer });
  await dragRowFor(page, id.a).dispatchEvent("drop", { dataTransfer });
  await dragRowFor(page, id.b).dispatchEvent("dragend", { dataTransfer });
  expect((await settled).status()).toBe(200);

  await expect.poll(() => storedChildOrder(tracker.root, k.p)).toEqual([id.b, id.a, id.c]);
  await page.reload();
  await expect.poll(() => renderedChildren(page)).toEqual([id.b, id.a, id.c]);
  expect(await shownChildOrder(tracker, k.p)).toEqual([k.b, k.a, k.c]);
});
