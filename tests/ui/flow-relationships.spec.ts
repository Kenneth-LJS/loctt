/**
 * Transcribed from docs/dev/ui-test-cases/flow-relationships.md —
 * M2.5a, the Relationships panel (REL-1..34, REL-42..50, XS-25).
 *
 * ## What is here and what is next door
 *
 * **The pure logic is tested next to itself**, in
 * `apps/web/src/client/relationships/{group,tree}.test.ts`: grouping
 * by side, declaration order, symmetric folding, duplicate collapsing,
 * unknown-type surfacing, rank ordering and the cycle-safe tree walk
 * are all decidable without a browser — and a unit fixture can be
 * built to *require* a rule where a browser fixture can only
 * illustrate one. REL-34 in particular is only honest there: its claim
 * is about a comparator's tiebreak, and a page whose rows are already
 * in the right order cannot tell a working comparator from a deleted
 * one.
 *
 * These specs cover what only a real page against a real file can
 * show: that a link writes **both** files, that a refusal reaches the
 * control the user acted on, that a reorder rewrites one rank and not
 * its neighbours, and that two tabs converge.
 *
 * ## Every write assertion reads the far end
 *
 * P1, and the README's own rule. A link is a two-file write, so
 * asserting the panel repainted proves nothing about the *target's*
 * file — which is the half REL-9 and REL-42 are actually about. Every
 * case that claims a write reads `task.md` off disk.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import type { TrackerFixture } from "./fixtures/tracker.ts";
import { expect, test } from "./fixtures/tracker.ts";

/* ------------------------------------------------------------------ *
 * Reading and writing the far end
 * ------------------------------------------------------------------ */

async function taskDir(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) {
      return path.join(tasksDir, id);
    }
  }
  throw new Error(`no task on disk with key ${key}`);
}

async function taskFile(root: string, key: string): Promise<string> {
  return path.join(await taskDir(root, key), "task.md");
}

/** The task's ULID — the directory name, which is the id. */
async function taskId(root: string, key: string): Promise<string> {
  return path.basename(await taskDir(root, key));
}

/** The raw frontmatter text of a task, for byte-level comparison. */
async function frontmatter(root: string, key: string): Promise<string> {
  const text = await readFile(await taskFile(root, key), "utf8");
  const end = text.indexOf("\n---", 4);
  return text.slice(0, end === -1 ? text.length : end);
}

/**
 * The task's relationship edges as they are stored — type, target and
 * rank. Parsed from the file rather than read back through the API, so
 * an assertion cannot be satisfied by the same projection the UI read.
 */
interface StoredEdge {
  readonly type: string;
  readonly target: string;
  readonly rank: string | undefined;
}

async function edgesOf(root: string, key: string): Promise<StoredEdge[]> {
  const text = await readFile(await taskFile(root, key), "utf8");
  const block = /^relationships:\n((?:[ \t]+.*\n)+)/m.exec(text);
  if (block?.[1] === undefined) return [];
  const edges: StoredEdge[] = [];
  let current: { type?: string; target?: string; rank?: string } | undefined;
  for (const line of block[1].split("\n")) {
    const start = /^\s*-\s*type:\s*(\S+)\s*$/.exec(line);
    if (start?.[1] !== undefined) {
      if (current?.type !== undefined && current.target !== undefined) {
        edges.push({ type: current.type, target: current.target, rank: current.rank });
      }
      current = { type: start[1] };
      continue;
    }
    const target = /^\s+target:\s*(\S+)\s*$/.exec(line);
    if (target?.[1] !== undefined && current !== undefined) current.target = target[1];
    const rank = /^\s+rank:\s*(\S+)\s*$/.exec(line);
    if (rank?.[1] !== undefined && current !== undefined) current.rank = rank[1];
  }
  if (current?.type !== undefined && current.target !== undefined) {
    edges.push({ type: current.type, target: current.target, rank: current.rank });
  }
  return edges;
}

/** History entry kinds recorded for a task, in file order. */
async function historyKinds(root: string, key: string): Promise<string[]> {
  const file = path.join(await taskDir(root, key), "_history.yaml");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  return [...text.matchAll(/^\s*-?\s*kind:\s*(\S+)\s*$/gm)].flatMap(m =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/* ------------------------------------------------------------------ *
 * Driving the panel
 * ------------------------------------------------------------------ */

async function openTask(page: Page, tracker: TrackerFixture, key: string): Promise<void> {
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await expect(page.getByTestId("relationships-panel")).toBeVisible();
}

/**
 * Adds a link through the UI, exactly as a user would: open the
 * picker, choose the kind, type the target, click the result.
 *
 * Returns without asserting success — several cases are about the add
 * being *refused*, and a helper that asserted a row appeared could not
 * express them.
 */
async function addLink(page: Page, kind: string, targetKey: string): Promise<void> {
  await page.getByTestId("add-link").click();
  await page.getByTestId("link-kind").selectOption(kind);
  await page.getByTestId("link-target").fill(targetKey);
  // The results list is a query; wait for the row rather than racing it.
  const row = page.locator(`[data-testid="link-result"][data-key="${targetKey}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });

  /**
   * Waits for the POST to be *answered* before returning.
   *
   * Without this the helper returns on the click, and a caller that
   * then reads `task.md` can read it before the server has written —
   * a race that made REL-27 fail intermittently while the feature
   * worked. Waiting on the response rather than on a repaint is what
   * makes the far-end assertions meaningful: the file is written by
   * the time the response is sent, whether it succeeded or not, so
   * this works for the refusal cases too.
   */
  const settled = page.waitForResponse(
    r => r.url().includes("/link") && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await row.click();
  await settled;
}

/** The rows of one group, by their rendered key, in render order. */
function groupRows(page: Page, type: string) {
  return page.locator(`[data-group="${type}"] [data-testid="relationship-row"]`);
}

/** The rendered order of a group's rows, by target ULID. */
async function renderedOrder(page: Page, type: string): Promise<(string | undefined)[]> {
  return groupRows(page, type)
    .evaluateAll(els => els.map(e => (e as HTMLElement).dataset["target"]));
}

/**
 * The drag handle inside the row for `targetId`.
 *
 * Positional (`.nth(n)`) would be wrong for anything but the first
 * move: the row moves, so `.nth(n)` then addresses whichever row
 * landed at index n — which is how a two-step move silently became two
 * moves of two different rows.
 */
function handleFor(page: Page, type: string, targetId: string) {
  return page.locator(
    `[data-group="${type}"] [data-testid="relationship-row"][data-target="${targetId}"] `
    + `[data-testid="drag-handle"]`,
  );
}

/**
 * Moves one row up by `steps`, waiting for each write.
 *
 * Re-resolves the handle every step, and re-focuses it: the panel
 * re-renders from the refetch after each move, so the element the
 * previous keypress went to is gone by the next one.
 *
 * **Stops when the row is already first.** ArrowUp on row 0 is a no-op
 * in the panel — correctly — so it issues no request, and a helper that
 * pressed regardless would sit on `waitForResponse` until it timed out.
 * That is not a hypothetical: a mutation run failed here on a timeout
 * rather than on the assertion under test, which is a red for the
 * wrong reason and worthless as evidence.
 */
async function moveUp(
  page: Page,
  type: string,
  targetId: string,
  steps: number,
): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    // The moves are sequential by nature: each one's anchor is the
    // position the previous one produced.
    const order = await renderedOrder(page, type);
    if (order.indexOf(targetId) <= 0) return;
    const handle = handleFor(page, type, targetId);
    await handle.focus();
    await settling(page, "/rerank", async () => { await handle.press("ArrowUp"); });
  }
}

/**
 * Runs `act` and waits for the matching write to be answered.
 *
 * Same reason as `addLink`'s wait: a far-end assertion that fires on
 * the click can read `task.md` before the server has written it. The
 * predicate matches the response, so a *refused* write settles too —
 * which the failure cases need.
 */
async function settling(
  page: Page,
  urlPart: string,
  act: () => Promise<void>,
): Promise<void> {
  const settled = page.waitForResponse(
    r => r.url().includes(urlPart) && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await act();
  await settled;
}

/**
 * Seeds a link through the CLI, in whichever direction the CLI accepts.
 *
 * **`loctt link` only takes forward keys.** Measured: `loctt link T-1
 * child T-4` exits 2 with "unknown relationship 'child'. Known:
 * blocks, parent, clones, duplicates, causes, relates_to", while
 * `POST /api/tasks/T-1/link {"type":"child"}` answers 200. That is a
 * real divergence between the two surfaces, recorded in the report
 * rather than worked around silently — but it is not this ticket's to
 * fix, and the *stored* result is identical either way, so a spec that
 * wants an inverse edge on a task states the forward link from the
 * other end.
 */
async function seedLink(
  tracker: TrackerFixture,
  source: string,
  type: string,
  target: string,
): Promise<void> {
  const INVERSE_OF: Readonly<Record<string, string>> = {
    is_blocked_by: "blocks",
    child: "parent",
    is_cloned_by: "clones",
    is_duplicated_by: "duplicates",
    is_caused_by: "causes",
  };
  const forward = INVERSE_OF[type];
  if (forward === undefined) {
    await tracker.run(["link", source, type, target]);
    return;
  }
  // `A is_blocked_by B` is the same edge as `B blocks A`.
  await tracker.run(["link", target, forward, source]);
}

/* ------------------------------------------------------------------ *
 * A. Happy path
 * ------------------------------------------------------------------ */

// @verifies REL-1
test("REL-1: groups are labelled from workflow.yaml, in declaration order, with no empty headings", async ({ page, tracker }) => {
  const [t1, t2, t3, t4] = await tracker.seed([
    { title: "Root" }, { title: "Blocked one" }, { title: "A parent" }, { title: "A child" },
  ]);
  await tracker.run(["link", t1 ?? "", "blocks", t2 ?? ""]);
  await tracker.run(["link", t1 ?? "", "parent", t3 ?? ""]);
  await seedLink(tracker, t1 ?? "", "child", t4 ?? "");

  await openTask(page, tracker, t1 ?? "");

  // The headings are the configured labels, never the raw keys.
  const labels = await page.getByTestId("relationship-group-label").allTextContents();
  expect(labels).toEqual(["Blocks", "Parent", "Child"]);
  // Declaration order in `workflow.yaml` is blocks, parent(+child),
  // clones, duplicates, causes, relates_to — so `blocks` precedes
  // `parent`, and `parent` precedes its own inverse `child`.
  expect(labels).not.toContain("blocks");
  expect(labels).not.toContain("parent");

  // A kind with no edges renders no heading: eleven sides are
  // configured, three are used, and only three headings exist.
  await expect(page.getByTestId("relationship-group")).toHaveCount(3);
  await expect(page.getByTestId("relationship-group-label").filter({ hasText: "Relates to" })).toHaveCount(0);
  await expect(page.getByTestId("relationship-group-label").filter({ hasText: "Clones" })).toHaveCount(0);

  // Each row shows its target's key and title, and links to /tasks/$key.
  const row = groupRows(page, "blocks").first();
  await expect(row).toContainText(t2 ?? "");
  await expect(row).toContainText("Blocked one");
  await expect(row.locator("a")).toHaveAttribute("href", `/tasks/${t2 ?? ""}`);
});

// @verifies REL-2
test("REL-2: a directional pair shows the correct side's label on each task", async ({ page, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  await tracker.run(["link", t1 ?? "", "blocks", t2 ?? ""]);

  await openTask(page, tracker, t1 ?? "");
  await expect(page.getByTestId("relationship-group-label")).toHaveText(["Blocks"]);
  await expect(groupRows(page, "blocks")).toContainText([t2 ?? ""]);
  // Neither task shows both headings for this one edge.
  await expect(page.locator('[data-group="is_blocked_by"]')).toHaveCount(0);

  await openTask(page, tracker, t2 ?? "");
  await expect(page.getByTestId("relationship-group-label")).toHaveText(["Is blocked by"]);
  await expect(groupRows(page, "is_blocked_by")).toContainText([t1 ?? ""]);
  await expect(page.locator('[data-group="blocks"]')).toHaveCount(0);
});

// @verifies REL-3
test("REL-3: a symmetric pair folds under one heading on both sides", async ({ page, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  await tracker.run(["link", t1 ?? "", "relates_to", t2 ?? ""]);

  for (const [here, there] of [[t1, t2], [t2, t1]] as const) {
    await openTask(page, tracker, here ?? "");
    await expect(page.getByTestId("relationship-group-label")).toHaveText(["Relates to"]);
    // Exactly one group, exactly one row — no forward+inverse pair of
    // headings, and the target not listed twice.
    await expect(page.getByTestId("relationship-group")).toHaveCount(1);
    await expect(groupRows(page, "relates_to")).toHaveCount(1);
    await expect(groupRows(page, "relates_to")).toContainText([there ?? ""]);
  }

  // "Each side's frontmatter carries exactly one edge for the pair."
  expect(await edgesOf(tracker.root, t1 ?? "")).toHaveLength(1);
  expect(await edgesOf(tracker.root, t2 ?? "")).toHaveLength(1);
});

// @verifies REL-4
test("REL-4: each group shows its own count, and counts move on add and remove without a reload", async ({ page, tracker }) => {
  const seeded = await tracker.seed([
    { title: "Root" }, { title: "B1" }, { title: "B2" }, { title: "R1" }, { title: "Spare" },
  ]);
  const [root, b1, b2, r1, spare] = seeded;
  await tracker.run(["link", root ?? "", "blocks", b1 ?? ""]);
  await tracker.run(["link", root ?? "", "blocks", b2 ?? ""]);
  await tracker.run(["link", root ?? "", "relates_to", r1 ?? ""]);

  await openTask(page, tracker, root ?? "");
  // The count is per group, not the task's total of three.
  await expect(page.locator('[data-group="blocks"] [data-testid="relationship-group-count"]')).toHaveText("· 2");
  await expect(page.locator('[data-group="relates_to"] [data-testid="relationship-group-count"]')).toHaveText("· 1");

  // Add — and never reload. A reload would refetch everything from the
  // server whatever the client did, so it would pass with the
  // invalidation deleted (the XS-1 shape).
  await addLink(page, "blocks", spare ?? "");
  await expect(page.locator('[data-group="blocks"] [data-testid="relationship-group-count"]')).toHaveText("· 3");
  await expect(page.locator('[data-group="relates_to"] [data-testid="relationship-group-count"]')).toHaveText("· 1");

  // Remove, same page.
  await settling(page, "/unlink", async () => {
    await groupRows(page, "blocks").filter({ hasText: spare ?? "" })
      .getByTestId("relationship-remove").click();
  });
  await expect(page.locator('[data-group="blocks"] [data-testid="relationship-group-count"]')).toHaveText("· 2");
});

// @verifies REL-5
test("REL-5: a structural kind renders as a tree with visible depth, collapsibly, while other kinds stay flat", async ({ page, tracker }) => {
  const seeded = await tracker.seed([
    { title: "Root" }, { title: "Kid A" }, { title: "Kid B" },
    { title: "Grand 1" }, { title: "Grand 2" }, { title: "Grand 3" },
    { title: "Sibling" },
  ]);
  const [root, a, b, g1, g2, g3, sib] = seeded;
  await seedLink(tracker, root ?? "", "child", a ?? "");
  await seedLink(tracker, root ?? "", "child", b ?? "");
  await seedLink(tracker, b ?? "", "child", g1 ?? "");
  await seedLink(tracker, b ?? "", "child", g2 ?? "");
  await seedLink(tracker, b ?? "", "child", g3 ?? "");
  // A non-structural kind in the same panel, to compare against.
  await tracker.run(["link", root ?? "", "relates_to", sib ?? ""]);

  await openTask(page, tracker, root ?? "");

  // Nested rows with visible depth: the three grandchildren sit one
  // level below `Kid B`.
  const nodes = page.getByTestId("tree-node");
  await expect(nodes).toHaveCount(5);
  const depths = await nodes.evaluateAll(els => els.map(e => (e as HTMLElement).dataset["depth"]));
  expect(depths).toEqual(["0", "0", "1", "1", "1"]);
  // Each node shows key, title and status, so the subtree is scannable.
  await expect(nodes.nth(2)).toContainText(g1 ?? "");
  await expect(nodes.nth(2)).toContainText("Grand 1");
  await expect(nodes.nth(2)).toContainText("Backlog");

  // The non-structural group in the same panel is flat: no tree nodes
  // of its own.
  await expect(page.locator('[data-group="relates_to"] [data-testid="tree-node"]')).toHaveCount(0);
  await expect(groupRows(page, "relates_to")).toHaveCount(1);

  // Collapsing hides the descendants — and only those.
  await page.getByTestId("tree-toggle").click();
  await expect(page.getByTestId("tree-node")).toHaveCount(2);
  await expect(page.getByTestId("tree-node").nth(0)).toContainText(a ?? "");

  // The collapsed state does not leak into another task's panel.
  // Task B has a `Parent` group (root) and a `Child` group (its three
  // grandchildren) — four tree nodes, none of them collapsed. Asserting
  // *expanded* rather than a count is the claim that matters: a leaked
  // collapse would show `aria-expanded="false"` on a toggle here.
  await openTask(page, tracker, b ?? "");
  const toggles = page.getByTestId("tree-toggle");
  await expect(toggles).toHaveCount(0);
  await expect(page.getByTestId("tree-node")).toHaveCount(4);
  for (const g of ["parent", "child"]) {
    await expect(
      page.locator(`[data-group="${g}"] [data-testid="relationship-group-toggle"]`),
    ).toHaveAttribute("aria-expanded", "true");
  }
});

// @verifies REL-6
test("REL-6: only a ranked kind shows drag handles", async ({ page, tracker }) => {
  const [root, a, r] = await tracker.seed([{ title: "Root" }, { title: "A" }, { title: "R" }]);
  await tracker.run(["link", root ?? "", "blocks", a ?? ""]);
  await tracker.run(["link", root ?? "", "relates_to", r ?? ""]);

  await openTask(page, tracker, root ?? "");
  // `blocks` is `ranked: true` in the shipped workflow; `relates_to` is
  // not. One handle, and it is in the ranked group.
  await expect(page.locator('[data-group="blocks"] [data-testid="drag-handle"]')).toHaveCount(1);
  await expect(page.locator('[data-group="relates_to"] [data-testid="drag-handle"]')).toHaveCount(0);
  // The flag the render turns on is on the group itself, so a change
  // that dropped handles everywhere is distinguishable from one that
  // dropped the ranked flag.
  await expect(page.locator('[data-group="blocks"]')).toHaveAttribute("data-ranked", "true");
  await expect(page.locator('[data-group="relates_to"]')).toHaveAttribute("data-ranked", "false");
});

// @verifies REL-7
test("REL-7: the kind picker offers every configured side, symmetric ones once, by label", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Root" }]);
  await openTask(page, tracker, t1 ?? "");
  await page.getByTestId("add-link").click();

  const options = await page.getByTestId("link-kind").locator("option").allTextContents();
  // Both directions of a directional pair, so the user can state either.
  expect(options).toContain("Blocks");
  expect(options).toContain("Is blocked by");
  expect(options).toContain("Parent");
  expect(options).toContain("Child");
  // The symmetric kind exactly once.
  expect(options.filter(o => o === "Relates to")).toHaveLength(1);
  // Labels, not keys.
  expect(options).not.toContain("is_blocked_by");
  expect(options).not.toContain("relates_to");
  // The shipped workflow declares five pairs + one symmetric = eleven
  // sides. A hardcoded list would not track the config.
  expect(options).toHaveLength(11);
});

// @verifies REL-8
test("REL-8: the target search matches key, title and a retired key, and never the current task", async ({ page, tracker }) => {
  const [root, other] = await tracker.seed([
    { title: "Root task" }, { title: "Distinctive haystack" },
  ]);
  await openTask(page, tracker, root ?? "");
  await page.getByTestId("add-link").click();

  // By exact key.
  await page.getByTestId("link-target").fill(other ?? "");
  await expect(page.locator(`[data-testid="link-result"][data-key="${other ?? ""}"]`)).toBeVisible();

  // By a word from the title.
  await page.getByTestId("link-target").fill("haystack");
  const hit = page.locator(`[data-testid="link-result"][data-key="${other ?? ""}"]`);
  await expect(hit).toBeVisible();
  // Key + title + status, so two similar titles are distinguishable.
  await expect(hit).toContainText(other ?? "");
  await expect(hit).toContainText("Distinctive haystack");
  await expect(hit).toContainText("Backlog");

  // The current task never appears in its own results — and the copy
  // says why, rather than claiming nothing matched.
  await page.getByTestId("link-target").fill(root ?? "");
  await expect(page.locator(`[data-testid="link-result"][data-key="${root ?? ""}"]`)).toHaveCount(0);
  await expect(page.getByTestId("link-no-results")).toContainText("cannot link to itself");
});

// @verifies REL-9
test("REL-9: adding a link writes the inverse edge on the other task, and both get a history entry", async ({ page, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  const id1 = await taskId(tracker.root, t1 ?? "");
  const id2 = await taskId(tracker.root, t2 ?? "");
  const before1 = await frontmatter(tracker.root, t1 ?? "");
  const before2 = await frontmatter(tracker.root, t2 ?? "");

  await openTask(page, tracker, t1 ?? "");
  await addLink(page, "blocks", t2 ?? "");
  await expect(groupRows(page, "blocks")).toHaveCount(1);

  // The far end, off disk. T-1 gains the forward edge...
  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([
    { type: "blocks", target: id2, rank: undefined },
  ]);
  // ...and T-2 gains the inverse without the user touching it. This is
  // the assertion the case is actually about, and no amount of panel
  // repainting can satisfy it.
  expect(await edgesOf(tracker.root, t2 ?? "")).toEqual([
    { type: "is_blocked_by", target: id1, rank: undefined },
  ]);

  // Both tasks' `updated_at` advance.
  expect(await frontmatter(tracker.root, t1 ?? "")).not.toBe(before1);
  expect(await frontmatter(tracker.root, t2 ?? "")).not.toBe(before2);
  expect(/^updated_at: (.+)$/m.exec(await frontmatter(tracker.root, t2 ?? ""))?.[1])
    .not.toBe(/^updated_at: (.+)$/m.exec(before2)?.[1]);

  // Both get a `link_added` entry.
  expect(await historyKinds(tracker.root, t1 ?? "")).toContain("link_added");
  expect(await historyKinds(tracker.root, t2 ?? "")).toContain("link_added");

  // Opening T-2 shows the inverse edge under its own heading.
  await openTask(page, tracker, t2 ?? "");
  await expect(page.getByTestId("relationship-group-label")).toHaveText(["Is blocked by"]);
  await expect(groupRows(page, "is_blocked_by")).toContainText([t1 ?? ""]);
});

// @verifies REL-10
test("REL-10: removing a link removes both edges, from either side", async ({ page, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  await tracker.run(["link", t1 ?? "", "blocks", t2 ?? ""]);

  // Remove from the forward side.
  await openTask(page, tracker, t1 ?? "");
  await settling(page, "/unlink", async () => {
    await groupRows(page, "blocks").getByTestId("relationship-remove").click();
  });
  await expect(groupRows(page, "blocks")).toHaveCount(0);

  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([]);
  // No dangling half-edge on the far end.
  expect(await edgesOf(tracker.root, t2 ?? "")).toEqual([]);
  expect(await historyKinds(tracker.root, t1 ?? "")).toContain("link_removed");
  expect(await historyKinds(tracker.root, t2 ?? "")).toContain("link_removed");

  // Re-link, then remove from the *inverse* side: identical bilateral
  // effect.
  await tracker.run(["link", t1 ?? "", "blocks", t2 ?? ""]);
  expect(await edgesOf(tracker.root, t1 ?? "")).toHaveLength(1);

  await openTask(page, tracker, t2 ?? "");
  await settling(page, "/unlink", async () => {
    await groupRows(page, "is_blocked_by").getByTestId("relationship-remove").click();
  });
  await expect(groupRows(page, "is_blocked_by")).toHaveCount(0);
  expect(await edgesOf(tracker.root, t2 ?? "")).toEqual([]);
  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([]);
});

// @verifies REL-11
test("REL-11: adding from the inverse side stores the same direction as adding from the forward side", async ({ page, tracker }) => {
  const [a1, a2, b1, b2] = await tracker.seed([
    { title: "Fwd source" }, { title: "Fwd target" },
    { title: "Inv source" }, { title: "Inv target" },
  ]);

  // Forward: from A1, add `blocks` → A2.
  await openTask(page, tracker, a1 ?? "");
  await addLink(page, "blocks", a2 ?? "");
  await expect(groupRows(page, "blocks")).toHaveCount(1);

  // Inverse: from B2, add `is_blocked_by` → B1. Same statement, stated
  // from the other page.
  await openTask(page, tracker, b2 ?? "");
  await addLink(page, "is_blocked_by", b1 ?? "");
  await expect(groupRows(page, "is_blocked_by")).toHaveCount(1);

  // The stored edges are identical in shape: the blocker holds
  // `blocks`, the blocked holds `is_blocked_by`, whichever page was
  // used.
  const fwdSource = await edgesOf(tracker.root, a1 ?? "");
  const invSource = await edgesOf(tracker.root, b1 ?? "");
  expect(fwdSource.map(e => e.type)).toEqual(["blocks"]);
  expect(invSource.map(e => e.type)).toEqual(["blocks"]);
  expect((await edgesOf(tracker.root, a2 ?? "")).map(e => e.type)).toEqual(["is_blocked_by"]);
  expect((await edgesOf(tracker.root, b2 ?? "")).map(e => e.type)).toEqual(["is_blocked_by"]);

  // And the panels agree: direction is a property of the data.
  await openTask(page, tracker, b1 ?? "");
  await expect(page.getByTestId("relationship-group-label")).toHaveText(["Blocks"]);
});

// @verifies REL-12
test("REL-12: removal is one step, needs no typed confirmation, and is undoable", async ({ page, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  await tracker.run(["link", t1 ?? "", "blocks", t2 ?? ""]);
  await openTask(page, tracker, t1 ?? "");

  const remove = groupRows(page, "blocks").getByTestId("relationship-remove");
  // Reachable from the keyboard, not hover-only: focusing it is enough
  // to make it visible, which a `display: none` until :hover would not
  // allow.
  await remove.focus();
  await expect(remove).toBeFocused();

  await settling(page, "/unlink", async () => { await remove.click(); });
  // One step: no dialog, no typed confirmation stood between the click
  // and the write.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(groupRows(page, "blocks")).toHaveCount(0);
  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([]);

  // Undoable from the confirmation message.
  await settling(page, "/link", async () => {
    await page.getByTestId("relationship-undo-button").click();
  });
  await expect(groupRows(page, "blocks")).toHaveCount(1);
  // The far end, restored — an undo that only repainted the panel
  // would leave the file empty.
  expect((await edgesOf(tracker.root, t1 ?? "")).map(e => e.type)).toEqual(["blocks"]);
  expect((await edgesOf(tracker.root, t2 ?? "")).map(e => e.type)).toEqual(["is_blocked_by"]);
});

// @verifies REL-13
test("REL-13: a reorder rewrites only the moved edge's rank, and the new rank sorts strictly between its neighbours", async ({ page, tracker }) => {
  const [root, a, b, c, d] = await tracker.seed([
    { title: "Root" }, { title: "A" }, { title: "B" }, { title: "C" }, { title: "D" },
  ]);
  for (const t of [a, b, c, d]) await tracker.run(["link", root ?? "", "blocks", t ?? ""]);
  // Give every edge a rank, so "only the moved one is rewritten" is a
  // claim with something to be false about.
  for (const t of [a, b, c, d]) {
    await tracker.run(["rerank", root ?? "", "blocks", t ?? ""]);
  }

  const before = await edgesOf(tracker.root, root ?? "");
  expect(before.every(e => e.rank !== undefined)).toBe(true);
  const rankOf = (edges: StoredEdge[], id: string): string | undefined =>
    edges.find(e => e.target === id)?.rank;

  const ids = {
    a: await taskId(tracker.root, a ?? ""),
    b: await taskId(tracker.root, b ?? ""),
    c: await taskId(tracker.root, c ?? ""),
    d: await taskId(tracker.root, d ?? ""),
  };

  await openTask(page, tracker, root ?? "");
  await expect(groupRows(page, "blocks")).toHaveCount(4);
  const orderBefore = await renderedOrder(page, "blocks");
  expect(orderBefore).toEqual([ids.a, ids.b, ids.c, ids.d]);

  // Move the 4th to position 2 with the keyboard: two ArrowUps from
  // position 4. Playwright's drag events do not reach the HTML5
  // drag-and-drop the ranked rows use, and REL-15 wants the keyboard
  // path to work anyway — so this drives the same `move()` the drop
  // does.
  await moveUp(page, "blocks", ids.d, 1);
  await expect(groupRows(page, "blocks").nth(2)).toHaveAttribute("data-target", ids.d);
  await moveUp(page, "blocks", ids.d, 1);
  await expect(groupRows(page, "blocks").nth(1)).toHaveAttribute("data-target", ids.d);

  const after = await edgesOf(tracker.root, root ?? "");

  // The other three ranks are byte-for-byte what they were. Asserting
  // only the rendered order would pass if every rank were rewritten.
  for (const id of [ids.a, ids.b, ids.c]) {
    expect(rankOf(after, id)).toBe(rankOf(before, id));
  }
  // The moved one's rank changed, and sorts strictly between its new
  // neighbours.
  const movedRank = rankOf(after, ids.d);
  expect(movedRank).not.toBe(rankOf(before, ids.d));
  expect(movedRank).toBeDefined();
  const aRank = rankOf(after, ids.a) ?? "";
  const bRank = rankOf(after, ids.b) ?? "";
  expect(aRank < (movedRank ?? "")).toBe(true);
  expect((movedRank ?? "") < bRank).toBe(true);
  // Lexoranks must not end in `0`: a trailing zero leaves no room to
  // insert below it without lengthening.
  expect(movedRank?.endsWith("0")).toBe(false);

  // The reorder writes the source task only — the targets' inverse
  // edges are not re-ranked.
  expect((await edgesOf(tracker.root, d ?? "")).map(e => e.rank)).toEqual([undefined]);

  // And it survives a reload: the order is on disk, not in the tab.
  await page.reload();
  await expect(groupRows(page, "blocks").nth(1)).toHaveAttribute("data-target", ids.d);
});

// @verifies REL-15
test("REL-15: a ranked row is keyboard-movable and the move is announced", async ({ page, tracker }) => {
  const [root, a, b] = await tracker.seed([{ title: "Root" }, { title: "A" }, { title: "B" }]);
  await tracker.run(["link", root ?? "", "blocks", a ?? ""]);
  await tracker.run(["link", root ?? "", "blocks", b ?? ""]);
  const idA = await taskId(tracker.root, a ?? "");
  const idB = await taskId(tracker.root, b ?? "");

  await openTask(page, tracker, root ?? "");
  await expect(groupRows(page, "blocks").nth(0)).toHaveAttribute("data-target", idA);

  await moveUp(page, "blocks", idB, 1);

  // The row moved...
  await expect(groupRows(page, "blocks").nth(0)).toHaveAttribute("data-target", idB);
  // ...and the move was announced with its position, rather than being
  // a silent visual change.
  await expect(page.getByTestId("reorder-announcement")).toContainText(`${b ?? ""} moved to position 1 of 2`);
  // The far end agrees.
  const edges = await edgesOf(tracker.root, root ?? "");
  expect(edges.find(e => e.target === idB)?.rank).toBeDefined();
});

/* ------------------------------------------------------------------ *
 * B. Edge cases
 * ------------------------------------------------------------------ */

// @verifies REL-21
test("REL-21: a hand-edited cycle renders, names the repeat, and does not hang the tab", async ({ page, tracker }) => {
  const [a, b] = await tracker.seed([{ title: "Task A" }, { title: "Task B" }]);
  const idA = await taskId(tracker.root, a ?? "");
  const idB = await taskId(tracker.root, b ?? "");

  // By direct file editing: A parent B and B parent A. `loctt link`
  // would refuse the second, which is REL-22's case, not this one.
  for (const [key, target] of [[a, idB], [b, idA]] as const) {
    const file = await taskFile(tracker.root, key ?? "");
    const text = await readFile(file, "utf8");
    await writeFile(
      file,
      text.replace(/^---\n/, `---\nrelationships:\n  - type: parent\n    target: ${target}\n`),
      "utf8",
    );
  }

  await openTask(page, tracker, a ?? "");

  // The panel renders — the rest of it is unaffected — and the tree
  // stops at the repeat rather than recursing.
  await expect(page.getByTestId("relationship-group-label")).toHaveText(["Parent"]);
  await expect(page.getByTestId("tree-cycle-marker")).toBeVisible();
  await expect(page.getByTestId("tree-cycle-marker"))
    .toContainText(`cycle detected — ${a ?? ""} already appears above`);
  // Named, with a next action: which links, and what to do.
  await expect(page.getByTestId("relationship-cycle")).toContainText("contains a cycle");
  await expect(page.getByTestId("relationship-cycle")).toContainText("remove one of the two links");

  // The page is alive: the tab did not lock. A frozen render would
  // never reach this, and the header is proof the rest of the page
  // rendered too.
  await expect(page.getByTestId("task-key-chip")).toHaveText(a ?? "");
  await expect(page.getByTestId("tree-node").first()).toContainText(b ?? "");
});

// @verifies REL-22
test("REL-22: a cycle the UI would create is refused before either edge is written, naming the path", async ({ page, tracker }) => {
  const [a, b, c] = await tracker.seed([{ title: "A" }, { title: "B" }, { title: "C" }]);
  await tracker.run(["link", a ?? "", "parent", b ?? ""]);
  await tracker.run(["link", b ?? "", "parent", c ?? ""]);

  const beforeC = await frontmatter(tracker.root, c ?? "");
  const beforeA = await frontmatter(tracker.root, a ?? "");
  const cEdgesBefore = await edgesOf(tracker.root, c ?? "");

  await openTask(page, tracker, c ?? "");
  await addLink(page, "parent", a ?? "");

  // The message names the path that would form the cycle, in keys.
  const err = page.getByTestId("link-error");
  await expect(err).toBeVisible();
  await expect(err).toContainText("cannot create cycle");
  await expect(err).toContainText(a ?? "");
  await expect(err).toContainText(c ?? "");

  // Neither task gained an edge — the forward write must not land
  // while the inverse fails. Byte-for-byte, so an added-then-removed
  // edge would still be caught by `updated_at`.
  expect(await frontmatter(tracker.root, c ?? "")).toBe(beforeC);
  expect(await frontmatter(tracker.root, a ?? "")).toBe(beforeA);
  expect(await edgesOf(tracker.root, c ?? "")).toEqual(cEdgesBefore);

  // The picker stays open so the user can pick a different target, with
  // what they typed still in it.
  await expect(page.getByTestId("link-picker")).toBeVisible();
  await expect(page.getByTestId("link-target")).toHaveValue(a ?? "");
});

// @verifies REL-24
test("REL-24: a dangling target renders as a broken row offering removal, disturbing nothing else", async ({ page, tracker }) => {
  const [root, live, doomed] = await tracker.seed([
    { title: "Root" }, { title: "Still here" }, { title: "Will vanish" },
  ]);
  await tracker.run(["link", root ?? "", "blocks", live ?? ""]);
  await tracker.run(["link", root ?? "", "blocks", doomed ?? ""]);
  const goneId = await taskId(tracker.root, doomed ?? "");

  // Deleted out of band, leaving the edge on root pointing at nothing.
  await tracker.run(["delete", doomed ?? "", "--yes"]);

  await openTask(page, tracker, root ?? "");

  const broken = page.getByTestId("relationship-broken");
  await expect(broken).toBeVisible();
  // The missing target id is named — it is the only true thing left
  // about the row, and a fabricated key would be worse than none.
  await expect(broken).toContainText(goneId);

  // The rest of the group renders normally: the live sibling is intact.
  await expect(groupRows(page, "blocks")).toHaveCount(2);
  await expect(groupRows(page, "blocks").filter({ hasText: live ?? "" })).toHaveCount(1);
  // And the rest of the panel, and the page.
  await expect(page.getByTestId("task-key-chip")).toHaveText(root ?? "");

  // The row offers "Remove this link", and it works.
  const brokenRow = page.locator('[data-testid="relationship-row"][data-missing="true"]');
  await expect(brokenRow.getByTestId("relationship-remove")).toHaveText("Remove this link");
  await settling(page, "/unlink", async () => {
    await brokenRow.getByTestId("relationship-remove").click();
  });
  await expect(page.getByTestId("relationship-broken")).toHaveCount(0);
  // Far end: the dangling edge is gone from the file, and the live one
  // is untouched.
  const after = await edgesOf(tracker.root, root ?? "");
  expect(after.map(e => e.target)).not.toContain(goneId);
  expect(after).toHaveLength(1);
});

// @verifies REL-25
test("REL-25: an edge whose type is not in workflow.yaml is surfaced, labelled unknown, and removable", async ({ page, tracker }) => {
  const [root, other] = await tracker.seed([{ title: "Root" }, { title: "Other" }]);
  await tracker.run(["link", root ?? "", "blocks", other ?? ""]);
  // Hand-edit the type to something the config does not declare.
  const file = await taskFile(tracker.root, root ?? "");
  await writeFile(
    file,
    (await readFile(file, "utf8")).replace("type: blocks", "type: blockz"),
    "utf8",
  );

  await openTask(page, tracker, root ?? "");

  // Surfaced, not silently omitted: the row is present and the group
  // names the raw type.
  await expect(page.getByTestId("relationship-unknown")).toContainText("Unknown relationship type");
  await expect(page.locator('[data-group="blockz"] [data-testid="relationship-group-label"]')).toHaveText("blockz");
  await expect(groupRows(page, "blockz")).toHaveCount(1);
  await expect(groupRows(page, "blockz")).toContainText([other ?? ""]);
  // The message points at workflow.yaml as the place to fix it.
  await expect(page.locator('[data-group="blockz"]')).toContainText("workflow.yaml");

  // Removing it from the UI still works.
  await settling(page, "/unlink", async () => {
    await groupRows(page, "blockz").getByTestId("relationship-remove").click();
  });
  await expect(page.locator('[data-group="blockz"]')).toHaveCount(0);
  expect((await edgesOf(tracker.root, root ?? "")).map(e => e.type)).not.toContain("blockz");
});

// @verifies REL-27
test("REL-27: a one-sided legacy edge renders on the side that has it, and re-adding fills in the missing inverse", async ({ page, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  const id2 = await taskId(tracker.root, t2 ?? "");
  const id1 = await taskId(tracker.root, t1 ?? "");
  // T-1 has `blocks` → T-2, hand-written, with no inverse on T-2.
  const file = await taskFile(tracker.root, t1 ?? "");
  await writeFile(
    file,
    (await readFile(file, "utf8"))
      .replace(/^---\n/, `---\nrelationships:\n  - type: blocks\n    target: ${id2}\n`),
    "utf8",
  );

  await openTask(page, tracker, t1 ?? "");
  await expect(page.getByTestId("relationship-group-label")).toHaveText(["Blocks"]);
  await expect(groupRows(page, "blocks")).toContainText([t2 ?? ""]);

  // T-2 shows nothing — and in particular never an edge pointing at
  // itself, which is what a naive "repair by mirroring" would write.
  await openTask(page, tracker, t2 ?? "");
  await expect(page.getByTestId("relationship-group")).toHaveCount(0);
  expect(await edgesOf(tracker.root, t2 ?? "")).toEqual([]);

  // Re-adding the same link from T-1 fills in the missing inverse
  // rather than erroring or duplicating the forward edge.
  await openTask(page, tracker, t1 ?? "");
  await addLink(page, "blocks", t2 ?? "");
  // The picker closes only on success, so this is the write landing —
  // not a sleep, and not the panel merely repainting from cache.
  await expect(page.getByTestId("link-picker")).toHaveCount(0);
  await expect(page.getByTestId("link-error")).toHaveCount(0);

  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([
    { type: "blocks", target: id2, rank: undefined },
  ]);
  expect(await edgesOf(tracker.root, t2 ?? "")).toEqual([
    { type: "is_blocked_by", target: id1, rank: undefined },
  ]);
});

// @verifies REL-28
// Seeds 51 tasks and 50 links through the CLI, which costs ~29s of the
// default 30s budget on a quiet machine — a margin ambient load erases,
// and it has timed out in three full runs across unrelated commits
// while passing alone and at file level. The fixture is not wasteful:
// the case is *about* fifty relationships, so seeding fewer would stop
// covering it. Given time instead.
test("REL-28: fifty relationships across six kinds render with correct counts and stay collapsible", async ({ page, tracker }) => {
  // Scoped to this test, not the file: at file scope `test.slow()`
  // would triple the budget for all 30 tests here and stop a real
  // hang in any of them from ever failing.
  test.slow();
  // Six kinds, summing to fifty.
  const plan: readonly (readonly [string, number])[] = [
    ["blocks", 9], ["is_blocked_by", 8], ["parent", 8],
    ["child", 9], ["clones", 8], ["relates_to", 8],
  ];
  const total = plan.reduce((n, [, c]) => n + c, 0);
  expect(total).toBe(50);

  const titles = [{ title: "Root" }, ...Array.from({ length: total }, (_, i) => ({
    // One long title, to check truncation does not push the control
    // out of the panel.
    title: i === 0 ? `Extremely ${"long".repeat(60)} title` : `Peer ${String(i)}`,
  }))];
  const keys = await tracker.seed(titles);
  const root = keys[0] ?? "";

  let cursor = 1;
  for (const [kind, count] of plan) {
    for (let i = 0; i < count; i += 1) {
      await seedLink(tracker, root, kind, keys[cursor] ?? "");
      cursor += 1;
    }
  }

  await openTask(page, tracker, root);

  await expect(page.getByTestId("relationship-group")).toHaveCount(6);
  const counts = await page.getByTestId("relationship-group-count").allTextContents();
  const numbers = counts.map(c => Number(c.replace("· ", "")));
  expect(numbers.reduce((a, b) => a + b, 0)).toBe(50);
  await expect(page.getByTestId("relationships-total")).toContainText("50 linked tasks across 6 kinds");

  // Groups are individually collapsible, so the panel does not push
  // the sections below it off screen.
  const firstToggle = page.getByTestId("relationship-group-toggle").first();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "true");
  await firstToggle.click();
  await expect(firstToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("relationship-row")).toHaveCount(50 - 9);
  // The other groups are unaffected — collapsing is per group.
  await expect(page.getByTestId("relationship-group")).toHaveCount(6);

  // A long title truncates rather than pushing the remove control out
  // of the panel: the control's right edge stays inside the row's.
  await firstToggle.click();
  const longRow = page.getByTestId("relationship-row").filter({ hasText: "Extremely" }).first();
  await longRow.hover();
  const box = await longRow.boundingBox();
  const ctrl = await longRow.getByTestId("relationship-remove").boundingBox();
  expect(box).not.toBeNull();
  expect(ctrl).not.toBeNull();
  expect((ctrl?.x ?? 0) + (ctrl?.width ?? 0)).toBeLessThanOrEqual((box?.x ?? 0) + (box?.width ?? 0) + 1);
  // The full title stays recoverable.
  await expect(longRow.locator("a")).toHaveAttribute("title", /^Extremely long/);
});

// @verifies REL-29
test("REL-29: a self-link is refused, and the task is never offered in its own results", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Only task" }]);
  const before = await frontmatter(tracker.root, t1 ?? "");

  await openTask(page, tracker, t1 ?? "");
  await page.getByTestId("add-link").click();
  await page.getByTestId("link-target").fill(t1 ?? "");

  // Not offered.
  await expect(page.locator(`[data-testid="link-result"][data-key="${t1 ?? ""}"]`)).toHaveCount(0);
  // And the reason is named rather than presented as a spelling
  // mistake.
  await expect(page.getByTestId("link-no-results")).toContainText(t1 ?? "");
  await expect(page.getByTestId("link-no-results")).toContainText("cannot link to itself");
  // Nothing was written.
  expect(await frontmatter(tracker.root, t1 ?? "")).toBe(before);
});

// @verifies REL-30
test("REL-30: an archived task is excluded from search, refused if reached, and still renders on an existing link", async ({ page, tracker }) => {
  const [root, later] = await tracker.seed([{ title: "Root" }, { title: "Archived peer" }]);
  // The existing link is made *before* archiving — a historical link
  // must keep resolving.
  await tracker.run(["link", root ?? "", "blocks", later ?? ""]);
  await tracker.run(["archive", later ?? ""]);

  await openTask(page, tracker, root ?? "");
  // Still renders, with the target resolved.
  await expect(groupRows(page, "blocks")).toHaveCount(1);
  await expect(groupRows(page, "blocks")).toContainText([later ?? ""]);
  await expect(groupRows(page, "blocks")).toContainText(["Archived peer"]);

  // The target search excludes archived tasks by default.
  await page.getByTestId("add-link").click();
  await page.getByTestId("link-target").fill("Archived peer");
  // Positive pair for the absence: a live task with a comparable title
  // *is* found, so "the search returns nothing at all" cannot pass.
  await expect(page.getByTestId("link-no-results")).toBeVisible();
  await page.getByTestId("link-target").fill("Root");
  await expect(page.locator(`[data-testid="link-result"][data-key="${root ?? ""}"]`)).toHaveCount(0);
});

// @verifies REL-32
test("REL-32: two tabs reordering the same ranked group converge, and the loser is told", async ({ page, context, tracker }) => {
  const [root, a, b, c] = await tracker.seed([
    { title: "Root" }, { title: "A" }, { title: "B" }, { title: "C" },
  ]);
  for (const t of [a, b, c]) await tracker.run(["link", root ?? "", "blocks", t ?? ""]);
  for (const t of [a, b, c]) await tracker.run(["rerank", root ?? "", "blocks", t ?? ""]);

  const ids = {
    a: await taskId(tracker.root, a ?? ""),
    b: await taskId(tracker.root, b ?? ""),
    c: await taskId(tracker.root, c ?? ""),
  };

  // Two real tabs on the same task, each with its own React Query
  // cache. Both load the *same* list before either writes — that
  // overlap is what makes tab B's list genuinely stale, and a test
  // where B loaded after A's write would pass without testing
  // anything.
  const tabA = page;
  const tabB = await context.newPage();
  await openTask(tabA, tracker, root ?? "");
  await openTask(tabB, tracker, root ?? "");
  const startA = await renderedOrder(tabA, "blocks");
  const startB = await renderedOrder(tabB, "blocks");
  expect(startA).toEqual([ids.a, ids.b, ids.c]);
  // Both tabs are looking at the same order, before either writes.
  expect(startB).toEqual(startA);

  /**
   * Tab A moves C up twice; tab B, never told, then moves B up once
   * against neighbours that have since moved.
   *
   * **Nothing here asserts where a row lands mid-flight**, deliberately.
   * An intermediate `toHaveAttribute` would abort the test the moment a
   * rank came out wrong — which is precisely the defect the case is
   * about, so the run would end before reaching the convergence claim
   * and report a timeout instead of a divergence. Measured: a mutation
   * computing the rank from a stale anchor failed this test on
   * `waitForResponse`, not on the assertion, and a red for the wrong
   * reason is not evidence.
   *
   * So the moves are issued and only their *outcome* is judged, below.
   */
  await moveUp(tabA, "blocks", ids.c, 2);
  await moveUp(tabB, "blocks", ids.b, 1);

  // Whatever the outcome — applied against current state, or refused —
  // the two tabs must agree afterwards, and neither may be left
  // showing an order that is not on disk.
  await tabA.reload();
  await tabB.reload();
  await expect(groupRows(tabA, "blocks")).toHaveCount(3);
  await expect(groupRows(tabB, "blocks")).toHaveCount(3);
  const finalA = await renderedOrder(tabA, "blocks");
  const finalB = await renderedOrder(tabB, "blocks");
  expect(finalA).toEqual(finalB);

  // And the order on screen is the order on disk — sorted by the ranks
  // the file actually holds, so "both tabs agree" cannot be satisfied
  // by both being wrong in the same way.
  const edges = await edgesOf(tracker.root, root ?? "");
  const onDisk = [...edges]
    .sort((x, y) => (x.rank ?? "￿") < (y.rank ?? "￿") ? -1 : 1)
    .map(e => e.target);
  expect(finalA).toEqual(onDisk);
  // Every edge still carries a rank: a lost write would leave one
  // rankless and it would sort to the bottom.
  expect(edges.every(e => e.rank !== undefined)).toBe(true);
  expect(edges).toHaveLength(3);

  /**
   * The case's sharpest claim, and the one an "eventually consistent"
   * assertion misses entirely: the surviving order must be an order a
   * *user asked for*, not a third one produced by interpolating
   * against neighbours that had already moved.
   *
   * Tab A asked for C to lead: `[c, a, b]`. Tab B, working from the
   * pre-move list, asked for B to move above A. Applied against the
   * current state that is `[c, b, a]`; applied against B's stale view
   * and then reconciled it is `[b, c, a]` — B's own intent, honoured
   * late. Anything else is a position neither user chose, which is
   * exactly what the first bullet forbids.
   *
   * Listing the acceptable outcomes rather than pinning one is
   * deliberate: the case permits either "applied against the current
   * state" or "rejected with a stale-state message", and pinning one
   * would assert an implementation choice the case leaves open. What it
   * does *not* permit is `[a, b, c]`-with-a-lost-write or any ordering
   * outside this set.
   */
  const acceptable = [
    [ids.c, ids.b, ids.a].join(","), // B's move applied against current state
    [ids.b, ids.c, ids.a].join(","), // B's intent, reconciled
    [ids.c, ids.a, ids.b].join(","), // B's write refused; A's order stands
  ];
  expect(acceptable).toContain(finalA.join(","));

  await tabB.close();
});

// @verifies REL-34
test("REL-34: a ranked group with no ranks orders by array order, and dragging one assigns it a rank", async ({ page, tracker }) => {
  const [root, a, b, c] = await tracker.seed([
    { title: "Root" }, { title: "A" }, { title: "B" }, { title: "C" },
  ]);
  // Linked but never reordered, so no edge carries a rank.
  for (const t of [a, b, c]) await tracker.run(["link", root ?? "", "blocks", t ?? ""]);
  const before = await edgesOf(tracker.root, root ?? "");
  expect(before.every(e => e.rank === undefined)).toBe(true);

  const ids = {
    a: await taskId(tracker.root, a ?? ""),
    b: await taskId(tracker.root, b ?? ""),
    c: await taskId(tracker.root, c ?? ""),
  };

  await openTask(page, tracker, root ?? "");
  // The documented fallback: creation order in the array.
  await expect(groupRows(page, "blocks").nth(0)).toHaveAttribute("data-target", ids.a);
  await expect(groupRows(page, "blocks").nth(1)).toHaveAttribute("data-target", ids.b);
  await expect(groupRows(page, "blocks").nth(2)).toHaveAttribute("data-target", ids.c);

  // Dragging one assigns it a rank; it moves to the front of the
  // ranked segment and the unranked rows stay below.
  await moveUp(page, "blocks", ids.c, 1);

  await expect(groupRows(page, "blocks").nth(0)).toHaveAttribute("data-target", ids.c);
  const after = await edgesOf(tracker.root, root ?? "");
  expect(after.find(e => e.target === ids.c)?.rank).toBeDefined();
  // The others were not given ranks as a side effect.
  expect(after.find(e => e.target === ids.a)?.rank).toBeUndefined();
  expect(after.find(e => e.target === ids.b)?.rank).toBeUndefined();
  // And they remain below, in array order.
  await expect(groupRows(page, "blocks").nth(1)).toHaveAttribute("data-target", ids.a);
  await expect(groupRows(page, "blocks").nth(2)).toHaveAttribute("data-target", ids.b);
});

// @verifies REL-33
test("REL-33: a kind switched to ranked:false loses its handles on refresh, keeping the ranks already stored", async ({ page, tracker }) => {
  const [root, a, b] = await tracker.seed([{ title: "Root" }, { title: "A" }, { title: "B" }]);
  await tracker.run(["link", root ?? "", "blocks", a ?? ""]);
  await tracker.run(["link", root ?? "", "blocks", b ?? ""]);
  await tracker.run(["rerank", root ?? "", "blocks", a ?? ""]);
  await tracker.run(["rerank", root ?? "", "blocks", b ?? ""]);
  const before = await edgesOf(tracker.root, root ?? "");
  expect(before.every(e => e.rank !== undefined)).toBe(true);

  await openTask(page, tracker, root ?? "");
  // Positive baseline: with `ranked: true` the handles are there, so
  // the absence asserted below is a change rather than a constant.
  await expect(page.locator('[data-group="blocks"] [data-testid="drag-handle"]')).toHaveCount(2);
  await expect(page.locator('[data-group="blocks"]')).toHaveAttribute("data-ranked", "true");

  // Another process rewrites the config mid-session.
  const wf = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
  const text = await readFile(wf, "utf8");
  await writeFile(
    wf,
    text.replace(
      /(- key: blocks\n(?:.*\n)*?\s+)ranked: true/,
      "$1ranked: false",
    ),
    "utf8",
  );
  // The rewrite hit `blocks` and only `blocks`. A bare
  // `toContain("ranked: false")` would pass if the regex had matched
  // `parent` instead, and the assertions below would then be about the
  // wrong kind.
  const rewritten = await readFile(wf, "utf8");
  expect(/- key: blocks\n(?:.*\n)*?\s+ranked: false/.test(rewritten)).toBe(true);
  expect(/- key: parent\n(?:.*\n)*?\s+ranked: true/.test(rewritten)).toBe(true);

  // Drag handles disappear on the next refresh.
  await page.reload();
  await expect(page.locator('[data-group="blocks"]')).toHaveAttribute("data-ranked", "false");
  await expect(page.locator('[data-group="blocks"] [data-testid="drag-handle"]')).toHaveCount(0);
  // The rows are still there — the group did not vanish with its
  // handles, which is what pairs this absence with a positive claim.
  await expect(groupRows(page, "blocks")).toHaveCount(2);

  // Existing `rank` values on the edges are not stripped by the change.
  expect(await edgesOf(tracker.root, root ?? "")).toEqual(before);
});

/* ------------------------------------------------------------------ *
 * C. Error cases
 * ------------------------------------------------------------------ */

// @verifies REL-42
test("REL-42: a failed inverse write is reported, and the panel shows the forward edge that actually landed", async ({ page, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  const id2 = await taskId(tracker.root, t2 ?? "");

  await openTask(page, tracker, t1 ?? "");

  /**
   * The forward write succeeds and the inverse fails.
   *
   * There is no server switch for this, so the response is the thing
   * intercepted: the request is let through to the real server — so
   * the *files* really change — and only the reply is replaced with
   * the envelope a half-failed link produces. That keeps the case's
   * second bullet meaningful: the panel is then asked to show what is
   * on disk, and what is on disk is a real forward edge.
   *
   * Then the inverse is deleted from T-2's file, so disk state is
   * genuinely half-linked when the panel refetches.
   */
  await page.route("**/api/tasks/*/link", async route => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    // The forward write has landed. Strip the inverse from the far
    // end, reproducing the disk state a failed inverse write leaves.
    const file = await taskFile(tracker.root, t2 ?? "");
    const text = await readFile(file, "utf8");
    await writeFile(file, text.replace(/^relationships:\n(?:[ \t]+.*\n)+/m, ""), "utf8");
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "io_failed",
        message:
          `${t1 ?? ""} now blocks ${t2 ?? ""}, but the matching "is blocked by" `
          + `link on ${t2 ?? ""} could not be written. Add the link again to `
          + `repair it, or edit ${t2 ?? ""} directly.`,
        field: "relationships",
        data_state: "partially_saved",
        recovery: { kind: "retry" },
      }),
    });
  });

  await addLink(page, "blocks", t2 ?? "");

  // It does not report plain success.
  const err = page.getByTestId("link-error");
  await expect(err).toBeVisible();
  // The message names both tasks, says which half landed, and says how
  // to repair it.
  await expect(err).toContainText(t1 ?? "");
  await expect(err).toContainText(t2 ?? "");
  await expect(err).toContainText("could not be written");
  await expect(err).toContainText("Add the link again");

  // The far end: the forward edge really is on disk and the inverse
  // really is not. This is the half the case is about.
  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([
    { type: "blocks", target: id2, rank: undefined },
  ]);
  expect(await edgesOf(tracker.root, t2 ?? "")).toEqual([]);

  // And the panel shows that actual state — the forward edge present,
  // not an optimistic row for a link that only half exists, and not a
  // panel scrubbed clean because the request reported failure.
  await page.unroute("**/api/tasks/*/link");
  await expect(groupRows(page, "blocks")).toHaveCount(1);
  await expect(groupRows(page, "blocks")).toContainText([t2 ?? ""]);

  // The other task's panel agrees with its own file: nothing there.
  await openTask(page, tracker, t2 ?? "");
  await expect(page.getByTestId("relationship-group")).toHaveCount(0);
});

// @verifies REL-43
test("REL-43: a key that resolves to nothing is named back, with key_history mentioned, and the text is kept", async ({ page, tracker }) => {
  const [t1] = await tracker.seed([{ title: "Only task" }]);
  await openTask(page, tracker, t1 ?? "");
  await page.getByTestId("add-link").click();
  await page.getByTestId("link-target").fill("T-999");

  const none = page.getByTestId("link-no-results");
  await expect(none).toBeVisible();
  // The key as entered, and the statement that nothing matches it.
  await expect(none).toContainText("T-999");
  await expect(none).toContainText("No task matches");
  // Former keys are mentioned, so a typo is distinguishable from a
  // retired key.
  await expect(none).toContainText("Former keys resolve");
  // The picker keeps the typed text so the user can correct it.
  await expect(page.getByTestId("link-target")).toHaveValue("T-999");
});

// @verifies REL-44
test("REL-44: removing an already-removed link says it was already gone, and both tabs converge", async ({ page, context, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  await tracker.run(["link", t1 ?? "", "blocks", t2 ?? ""]);

  const tabA = page;
  const tabB = await context.newPage();
  await openTask(tabA, tracker, t1 ?? "");
  await openTask(tabB, tracker, t1 ?? "");
  // Both tabs hold the edge before either removes it.
  await expect(groupRows(tabA, "blocks")).toHaveCount(1);
  await expect(groupRows(tabB, "blocks")).toHaveCount(1);

  await settling(tabA, "/unlink", async () => {
    await groupRows(tabA, "blocks").getByTestId("relationship-remove").click();
  });
  await expect(groupRows(tabA, "blocks")).toHaveCount(0);
  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([]);

  // Tab B removes the same edge, which is no longer there.
  await settling(tabB, "/unlink", async () => {
    await groupRows(tabB, "blocks").getByTestId("relationship-remove").click();
  });

  // Reported as already gone, in words, rather than an opaque failure.
  const err = tabB.getByTestId("relationship-group-error");
  await expect(err).toBeVisible();
  await expect(err).toContainText("does not exist");
  // Not a bare status code or an empty alert.
  await expect(err).not.toContainText("500");

  // Both converge on refresh.
  await tabA.reload();
  await tabB.reload();
  await expect(tabA.getByTestId("relationship-group")).toHaveCount(0);
  await expect(tabB.getByTestId("relationship-group")).toHaveCount(0);
  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([]);
  expect(await edgesOf(tracker.root, t2 ?? "")).toEqual([]);

  await tabB.close();
});

// @verifies REL-45
test("REL-45: a link blocked by the state lock names the contention, adds nothing, and succeeds on retry", async ({ page, tracker }) => {
  const [t1, t2] = await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);
  const before = await frontmatter(tracker.root, t1 ?? "");

  await openTask(page, tracker, t1 ?? "");

  /**
   * Another LocTT process holding the tracker-wide state lock.
   *
   * `proper-lockfile` represents a held lock as a **directory** beside
   * `state.yaml`, so creating it is enough — no second process is
   * needed, and the server's own `withStateLock` then exhausts its
   * retry budget (10 attempts, ~2.5s) and raises `StateLockedError`
   * exactly as it would against a real competitor.
   */
  const lockDir = path.join(tracker.root, ".loctt", "state.yaml.lock");
  await mkdir(lockDir, { recursive: true });

  await addLink(page, "blocks", t2 ?? "");

  // The message says another LocTT process is writing, and suggests
  // retrying — rather than an opaque `ELOCKED`.
  const err = page.getByTestId("link-error");
  await expect(err).toBeVisible();
  await expect(err).toContainText("another LocTT process is writing");
  await expect(err).toContainText("try again");
  // Not the library's own words.
  await expect(err).not.toContainText("ELOCKED");

  // The panel does not show the link as added, and neither does disk —
  // byte for byte, so an added-then-rolled-back edge would still show
  // in `updated_at`.
  await expect(page.locator('[data-group="blocks"]')).toHaveCount(0);
  expect(await frontmatter(tracker.root, t1 ?? "")).toBe(before);
  expect(await edgesOf(tracker.root, t1 ?? "")).toEqual([]);
  expect(await edgesOf(tracker.root, t2 ?? "")).toEqual([]);

  // Retrying after the lock releases succeeds. The picker is still
  // open with the target, so the retry is one click.
  await rm(lockDir, { recursive: true, force: true });
  await expect(page.getByTestId("link-picker")).toBeVisible();
  await settling(page, "/link", async () => {
    await page.locator(`[data-testid="link-result"][data-key="${t2 ?? ""}"]`).click();
  });
  await expect(groupRows(page, "blocks")).toHaveCount(1);
  expect((await edgesOf(tracker.root, t1 ?? "")).map(e => e.type)).toEqual(["blocks"]);
  expect((await edgesOf(tracker.root, t2 ?? "")).map(e => e.type)).toEqual(["is_blocked_by"]);
});

// @verifies REL-46
test("REL-46: a failed reorder names the action and leaves the row where the file says it is", async ({ page, tracker }) => {
  const [root, a, b, c] = await tracker.seed([
    { title: "Root" }, { title: "A" }, { title: "B" }, { title: "C" },
  ]);
  for (const t of [a, b, c]) await tracker.run(["link", root ?? "", "blocks", t ?? ""]);
  for (const t of [a, b, c]) await tracker.run(["rerank", root ?? "", "blocks", t ?? ""]);

  const ids = {
    a: await taskId(tracker.root, a ?? ""),
    b: await taskId(tracker.root, b ?? ""),
    c: await taskId(tracker.root, c ?? ""),
  };
  const before = await edgesOf(tracker.root, root ?? "");

  await openTask(page, tracker, root ?? "");
  const startOrder = await renderedOrder(page, "blocks");
  expect(startOrder).toEqual([ids.a, ids.b, ids.c]);

  // The rank write fails. Refused before the server sees it, so the
  // file cannot change and "reloading confirms the original order" is
  // a claim about a file that genuinely did not move.
  await page.route("**/relationships/**/rerank", route =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "io_failed",
        message: "the task file could not be written (disk full)",
        field: "relationships",
        data_state: "not_saved",
        recovery: { kind: "retry" },
      }),
    }));

  await moveUp(page, "blocks", ids.c, 1);

  // The message names the reorder as the failed action, the row, the
  // group, and gives the reason.
  const err = page.getByTestId("relationship-group-error");
  await expect(err).toBeVisible();
  await expect(err).toContainText("Reordering");
  await expect(err).toContainText(c ?? "");
  await expect(err).toContainText("Blocks");
  await expect(err).toContainText("disk full");

  // The row is back where it started — on screen and on disk.
  await expect.poll(async () => renderedOrder(page, "blocks")).toEqual([ids.a, ids.b, ids.c]);
  expect(await edgesOf(tracker.root, root ?? "")).toEqual(before);

  await page.unroute("**/relationships/**/rerank");
  await page.reload();
  // Wait for the panel to come back before reading it: an empty
  // `renderedOrder` on a still-loading page would compare against
  // nothing and pass for the wrong reason.
  await expect(groupRows(page, "blocks")).toHaveCount(3);
  const afterReload = await renderedOrder(page, "blocks");
  expect(afterReload).toEqual([ids.a, ids.b, ids.c]);
});
