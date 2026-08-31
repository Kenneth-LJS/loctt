/**
 * Transcribed from docs/dev/ui-test-cases/flow-tasks.md — M2.1, the
 * task detail read shell.
 *
 * These are browser specs because what they assert is browser
 * behaviour: a pasted cold URL, a header that must not produce a
 * horizontal scrollbar, a clipboard, a typed confirmation, a 404 that
 * has to render *inside* the shell rather than as a crash. A jsdom
 * test can check a component's props; it cannot tell you the page
 * scrolls sideways.
 *
 * Where a case asserts a write, the far end is asserted — the file on
 * disk or a read-back through the CLI. Asserting that the UI sent a
 * request is not asserting that anything happened.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** Reads the frontmatter block of the task with the given key. */
async function frontmatterOf(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) return text;
  }
  throw new Error(`no task on disk with key ${key}`);
}

/**
 * The key of the task on disk with the given title.
 *
 * A move allocates a new key, and hard-coding the expected one would
 * assert the test's guess about key allocation rather than the app's
 * behaviour. The title survives the move; the key is what changed, so
 * the title is what identifies the task across it.
 */
async function movedKeyOf(root: string, title: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (!new RegExp(`^title:\\s*.*${title}`, "m").test(text)) continue;
    const key = /^key:\s*(\S+)\s*$/m.exec(text)?.[1];
    if (key !== undefined) return key;
  }
  throw new Error(`no task on disk titled ${title}`);
}

/** Whether any task.md on disk carries this key. */
async function existsOnDisk(root: string, key: string): Promise<boolean> {
  try {
    await frontmatterOf(root, key);
    return true;
  } catch {
    return false;
  }
}

/**
 * A row in the list table.
 *
 * `page.getByText(title)` is not good enough: the sidebar's Recently
 * viewed group renders the same title, so an archived task that has
 * correctly left the table still "appears" on the page and a
 * `toBeHidden()` on the bare text fails against a working app. Scoping
 * to a table row is what makes the list assertions about the list.
 */
function listRow(page: import("@playwright/test").Page, title: string) {
  return page
    .getByRole("row")
    .filter({ hasNot: page.getByRole("columnheader") })
    .filter({ hasText: title });
}

/**
 * The sidebar's Recently viewed group, as its own scope.
 *
 * Anchored to the group's own label rather than to a class or a
 * position: the group is a plain `div` with no landmark role, and the
 * only stable thing about it is that it is the sidebar subtree
 * containing that heading. `:has()` keeps the scope to the innermost
 * such div, so a match cannot leak into the whole sidebar and count
 * project links as recents.
 */
function recentsGroup(page: import("@playwright/test").Page) {
  return page.locator(
    "aside div:has(> div:text-is('Recently viewed'))",
  );
}

test.describe("TSK — task detail read shell", () => {
  // @verifies TSK-1
  test("TSK-1: the route resolves a task by its key and renders the read shell", async ({
    page,
    tracker,
  }) => {
    // Two projects, so "the breadcrumb shows the project label" is a
    // claim that can fail. With one project the breadcrumb would be
    // right by accident whatever it read from.
    await tracker.run(["project", "create", "Web App", "--prefix", "WEB"]);
    const [alpha] = await tracker.seed([
      { title: "Alpha task" },
      { title: "Beta task" },
    ]);
    if (alpha === undefined) throw new Error("seed returned no key");
    const moved = await tracker.run(["move", alpha, "Web App"]);
    const webKey = /→\s*(\S+)/.exec(moved)?.[1];
    if (webKey === undefined) throw new Error(`no key in: ${moved}`);

    // A cold load of the URL — nothing navigated here from the list,
    // so nothing can be carried in memory from it.
    await page.goto(`${tracker.baseURL}/tasks/${webKey}`);

    await expect(page.getByRole("heading", { name: "Alpha task", level: 1 })).toBeVisible();
    await expect(page.getByTestId("task-key-chip")).toHaveText(webKey);

    // The breadcrumb names the project by its *label*. "Web App" is
    // the name; "WEB" is its prefix and "WEB-1" its key shape, so a
    // breadcrumb rendering either of those passes a bare visibility
    // check and still fails the case.
    const crumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumb.getByRole("link", { name: "All tasks" })).toBeVisible();
    await expect(crumb.getByRole("link", { name: "Web App", exact: true })).toBeVisible();

    // No ULID anywhere in the header (P-4). Positive assertion first —
    // an absence check alone is green on a header that renders
    // nothing at all.
    const header = page.locator("header").filter({ hasText: webKey });
    await expect(header).toContainText("Alpha task");
    expect(await header.innerText()).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);

    // Two columns: the left content and the right meta panel are both
    // present, and the meta panel is to the *right* of the content —
    // a stacked layout renders both and is not two columns.
    const meta = page.getByTestId("meta-panel");
    await expect(meta).toBeVisible();
    await expect(page.getByRole("heading", { name: "Description" })).toBeVisible();
    const metaBox = await meta.boundingBox();
    const descBox = await page.getByRole("heading", { name: "Description" }).boundingBox();
    if (metaBox === null || descBox === null) throw new Error("no layout box");
    expect(metaBox.x).toBeGreaterThan(descBox.x);

    // The breadcrumb's project link filters the list to that project:
    // the moved task is there, the one still in the default project
    // is not. Seeding both is what makes this discriminate — if every
    // row were in Web App the filtered and unfiltered lists would be
    // identical and the assertion would hold either way.
    await crumb.getByRole("link", { name: "Web App", exact: true }).click();
    await expect(page).toHaveURL(/\/list\?.*project=/);
    await expect(listRow(page, "Alpha task")).toHaveCount(1);
    await expect(listRow(page, "Beta task")).toHaveCount(0);
  });

  // @verifies TSK-2
  test("TSK-2: a task reached by a retired key resolves, and the chip shows the live key", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web App", "--prefix", "WEB"]);
    const [original] = await tracker.seed([{ title: "Rekeyed task" }]);
    if (original === undefined) throw new Error("seed returned no key");
    const moved = await tracker.run(["move", original, "Web App"]);
    const liveKey = /→\s*(\S+)/.exec(moved)?.[1];
    if (liveKey === undefined) throw new Error(`no key in: ${moved}`);
    expect(liveKey).not.toBe(original);

    // Navigate by the *retired* key. The old link keeps working.
    await page.goto(`${tracker.baseURL}/tasks/${original}`);
    await expect(page.getByRole("heading", { name: "Rekeyed task", level: 1 })).toBeVisible();

    // The chip carries the live key, not the one navigated by. Both
    // halves matter: showing the retired key would imply it is
    // current, which is the failure the case names.
    await expect(page.getByTestId("task-key-chip")).toHaveText(liveKey);
    await expect(page.getByTestId("task-key-chip")).not.toHaveText(original);

    // Either the URL normalizes or the page says the key was retired.
    // This build does the latter, so the user can tell which is live
    // without the address bar changing under them.
    const header = page.locator("header").filter({ hasText: liveKey });
    await expect(header).toContainText(original);
    await expect(header).toContainText(/retired key/i);
    await expect(header).toContainText(new RegExp(`current key is\\s*${liveKey}`, "i"));
  });

  // @verifies TSK-3
  test("TSK-3: opening a task records it in Recently viewed, once, re-ordering on return", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Recent one" },
      { title: "Recent two" },
    ]);
    const [first, second] = keys;
    if (first === undefined || second === undefined) throw new Error("seed keys");

    await page.goto(`${tracker.baseURL}/list`);
    const recents = recentsGroup(page);
    // Positive baseline: the group exists and holds neither task yet,
    // so the appearance below is a change rather than a coincidence.
    await expect(recents).toContainText("Recently viewed");
    await expect(recents.getByRole("link", { name: /Recent one/ })).toHaveCount(0);

    // Click through from the list — no page load, so the sidebar
    // updating is the client converging rather than a fresh render.
    await page.getByText("Recent one").click();
    await expect(page.getByRole("heading", { name: "Recent one", level: 1 })).toBeVisible();
    await expect(recents.getByRole("link", { name: /Recent one/ })).toHaveCount(1);

    // Which half of this test is real, plainly.
    //
    // The count assertions below CANNOT fail on a client that pushes a
    // recent on every render. `pushRecent`
    // (packages/core/src/users/recents.ts:63) filters the list by id
    // and then unshifts, so a duplicate push is idempotent by
    // construction: two pushes of the same id produce one row, not
    // two. `toHaveCount(1)` therefore holds against the exact defect
    // the case's "once per mount" bullet is about. That bullet is
    // structurally unfalsifiable at this layer — it is asserted here
    // only in the sense that the row exists and is singular, which the
    // data structure guarantees regardless of the client.
    //
    // The re-ordering assertion at the end of this test IS real: it
    // reads index order out of the rendered list, which a build that
    // appended rather than moved-to-front would fail.
    //
    // Interacting within the same task must not push a duplicate. The
    // More menu opens and closes without leaving the task.
    await page.getByRole("button", { name: "More" }).click();
    await page.keyboard.press("Escape");
    await expect(recents.getByRole("link", { name: /Recent one/ })).toHaveCount(1);

    // A second task, then back to the first: still one row each, and
    // the returned-to task is at the top rather than duplicated.
    await page.goto(`${tracker.baseURL}/tasks/${second}`);
    await expect(page.getByRole("heading", { name: "Recent two", level: 1 })).toBeVisible();
    await expect(recents.getByRole("link", { name: /Recent two/ })).toHaveCount(1);

    await page.goto(`${tracker.baseURL}/tasks/${first}`);
    await expect(page.getByRole("heading", { name: "Recent one", level: 1 })).toBeVisible();
    await expect(recents.getByRole("link", { name: /Recent one/ })).toHaveCount(1);
    await expect(recents.getByRole("link", { name: /Recent two/ })).toHaveCount(1);

    // Re-ordered to the top, not appended. Asserting only the count
    // would pass on a list that never re-orders.
    const rows = await recents.getByRole("link").allInnerTexts();
    const iFirst = rows.findIndex(t => t.includes("Recent one"));
    const iSecond = rows.findIndex(t => t.includes("Recent two"));
    expect(iFirst).toBeGreaterThanOrEqual(0);
    expect(iSecond).toBeGreaterThanOrEqual(0);
    expect(iFirst).toBeLessThan(iSecond);
  });

  // @verifies TSK-19
  test("TSK-19: Copy key and Copy link put the right things on the clipboard", async ({
    page,
    context,
    tracker,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const [key] = await tracker.seed([{ title: "Copyable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByRole("heading", { name: "Copyable task", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Copy key" }).click();

    // The bare key, exactly — no URL, no whitespace. `toBe` rather
    // than a contains: "http://…/tasks/T-1" contains "T-1" and is
    // precisely what the case rules out.
    const copiedKey = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedKey).toBe(key);
    await expect(page.getByRole("status")).toContainText(/copied/i);

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Copy link" }).click();
    const copiedLink = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedLink).toMatch(/^https?:\/\//);
    await expect(page.getByRole("status")).toContainText(/copied/i);

    // The link is asserted by *using* it: pasted into a fresh page it
    // opens this task. Asserting the string's shape would pass on a
    // URL that 404s.
    const fresh = await context.newPage();
    await fresh.goto(copiedLink);
    await expect(fresh.getByRole("heading", { name: "Copyable task", level: 1 })).toBeVisible();
    await fresh.close();
  });

  // @verifies TSK-20
  test("TSK-20: Duplicate creates a copy under a fresh key and navigates to it", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Duplicable task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    // A body, so the copy has something to carry over that the
    // frontmatter alone would not prove. Written through the CLI so
    // the UI is not asserting against its own earlier write.
    await tracker.run(["body", key, "--set", "Body that must survive the copy."]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByRole("heading", { name: "Duplicable task", level: 1 })).toBeVisible();
    const sourceBefore = await frontmatterOf(tracker.root, key);

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();

    // Duplicating destroys nothing, so no typed confirmation stands
    // between the click and the write (the Archive-not-Delete side of
    // TSK-23's proportionality).
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The app navigated: the header key chip now reads something
    // other than the source's, and the URL followed it. Both, because
    // a chip that changed while the address bar did not would leave a
    // copy nobody can link to.
    await expect(page.getByTestId("task-key-chip")).not.toHaveText(key);
    const copyKey = await page.getByTestId("task-key-chip").innerText();
    expect(copyKey).not.toBe(key);
    expect(page.url()).toContain(`/tasks/${copyKey}`);

    // The copy on disk carries the title and the body. Read off the
    // file, not the page: a header rendered from a stale cache would
    // satisfy a screen-only assertion.
    const copyFile = await frontmatterOf(tracker.root, copyKey);
    expect(copyFile).toMatch(/^title:\s*Duplicable task \(copy\)\s*$/m);
    expect(copyFile).toContain("Body that must survive the copy.");
    // `key_history` empty on the copy — paired with the positive
    // assertion that it does carry the new key, so an unreadable or
    // empty file cannot satisfy the absence alone.
    expect(copyFile).not.toMatch(/^key_history:/m);
    expect(copyFile).toMatch(new RegExp(`^key:\\s*${copyKey}\\s*$`, "m"));

    // TSK-20's fourth bullet, both ways. Off disk: the source file is
    // byte-identical to before the duplicate — nothing on screen
    // signals this, so nothing else catches a route that touched it.
    expect(await frontmatterOf(tracker.root, key)).toBe(sourceBefore);
    // And by returning to it, which is what the case actually asks
    // for: the original still resolves at its own key, under its own
    // unsuffixed title.
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);
    await expect(page.getByRole("heading", { name: "Duplicable task", level: 1 })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Duplicable task (copy)", level: 1 }),
    ).toHaveCount(0);

    // Both rows are in the list — the copy was created, and the
    // original was not consumed making it. Two rows total, and the
    // copy is exactly one of them: "Duplicable task" is a substring of
    // "Duplicable task (copy)", so a bare count of the former would be
    // satisfied by the copy alone.
    await page.goto(`${tracker.baseURL}/list`);
    await expect(listRow(page, "Duplicable task")).toHaveCount(2);
    await expect(listRow(page, "Duplicable task (copy)")).toHaveCount(1);
    await expect(listRow(page, key)).toHaveCount(1);
    await expect(listRow(page, copyKey)).toHaveCount(1);
  });

  // @verifies TSK-20
  test("TSK-20: a refused duplicate names the failure and does not navigate", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Uncopyable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.route(/\/api\/tasks\/[^/]+\/duplicate$/, route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal_error",
          message: "The copy could not be written.",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        }),
      }));

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByRole("heading", { name: "Uncopyable task", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();

    await expect(page.getByRole("alert")).toContainText(/could not be written/i);

    // Still on the source. Navigating on a failed duplicate would put
    // the user on a task that does not exist, or read as a success.
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);
    expect(page.url()).toContain(`/tasks/${key}`);

    // Nothing was created: the list has the one row it started with,
    // and no `(copy)` row beside it.
    await page.unroute(/\/api\/tasks\/[^/]+\/duplicate$/);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(listRow(page, "Uncopyable task")).toHaveCount(1);
    await expect(listRow(page, "Uncopyable task (copy)")).toHaveCount(0);

    // The menu item is still a live control, not a spent one — retry
    // works once the write can land, which is what makes the offered
    // Duplicate a real recovery (ERR-3).
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(page.getByTestId("task-key-chip")).not.toHaveText(key);
  });

  // @verifies TSK-22
  test("TSK-22: delete requires typing the key and removes the task from disk", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Doomed task" },
      { title: "Surviving task" },
    ]);
    const [doomed] = keys;
    if (doomed === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${doomed}`);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();

    const dialog = page.getByRole("dialog");
    // States the key, that it is permanent, and names archive as the
    // reversible alternative — the three things that keep it from
    // reading like an archive prompt.
    await expect(dialog).toContainText(doomed);
    await expect(dialog).toContainText(/permanent/i);
    await expect(dialog).toContainText(/cannot be undone/i);
    await expect(dialog).toContainText(/archive/i);

    const confirmButton = dialog.getByRole("button", { name: new RegExp(`^Delete ${doomed}$`) });
    const input = dialog.getByRole("textbox");
    await expect(confirmButton).toBeDisabled();

    // Default focus is the input, so a stray Enter cannot delete.
    await expect(input).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    expect(await existsOnDisk(tracker.root, doomed)).toBe(true);

    // Near-misses: wrong case, trailing space, the title instead of
    // the key. Each must leave the button disabled.
    for (const nearMiss of [doomed.toLowerCase(), `${doomed} `, "Doomed task"]) {
      await input.fill(nearMiss);
      await expect(confirmButton).toBeDisabled();
    }

    // Esc cancels with nothing deleted.
    await input.fill(doomed);
    await expect(confirmButton).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(await existsOnDisk(tracker.root, doomed)).toBe(true);

    // Reopen, confirm for real.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill(doomed);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(`^Delete ${doomed}$`) })
      .click();

    // Navigated away to the list, and gone from disk — not merely
    // hidden. The disk check is the far end; the list check is what
    // the user sees.
    await expect(page).toHaveURL(/\/list$/);
    await expect(listRow(page, "Surviving task")).toHaveCount(1);
    await expect(listRow(page, "Doomed task")).toHaveCount(0);
    expect(await existsOnDisk(tracker.root, doomed)).toBe(false);
  });

  // @verifies TSK-23
  test("TSK-23: archive is immediate, reversible, and keeps the files on disk", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Archivable task" },
      { title: "Untouched task" },
    ]);
    const [target] = keys;
    if (target === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${target}`);
    await expect(page.getByTestId("archived-badge")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Archivable task", level: 1 })).toBeVisible();

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();

    // No typed confirmation stood between the click and the write —
    // the badge is the next thing that happens.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("archived-badge")).toBeVisible();

    // The far end: the flag is on the file, and the directory is
    // still there. Archiving must never remove it from disk.
    expect(await frontmatterOf(tracker.root, target)).toMatch(/^archived:\s*true\s*$/m);

    // Gone from the default list, present with archived shown. The
    // second task is the control — if it vanished too, the filter
    // would be hiding everything rather than the archived row.
    await page.goto(`${tracker.baseURL}/list`);
    await expect(listRow(page, "Untouched task")).toHaveCount(1);
    await expect(listRow(page, "Archivable task")).toHaveCount(0);
    await page.goto(`${tracker.baseURL}/list?archived=true`);
    await expect(listRow(page, "Archivable task")).toHaveCount(1);

    // Unarchive from the same menu restores it in place.
    await page.goto(`${tracker.baseURL}/tasks/${target}`);
    await expect(page.getByTestId("archived-badge")).toBeVisible();
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Unarchive" }).click();
    await expect(page.getByTestId("archived-badge")).toHaveCount(0);
    expect(await frontmatterOf(tracker.root, target)).not.toMatch(/^archived:\s*true\s*$/m);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(listRow(page, "Archivable task")).toHaveCount(1);
  });

  // @verifies TSK-24
  test("TSK-24: a 400-character unbroken title does not break the header or scroll the page", async ({
    page,
    tracker,
  }) => {
    const longTitle = "x".repeat(400);
    const [key] = await tracker.seed([{ title: longTitle }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);

    // No horizontal scrollbar on the page body.
    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.body).toBeLessThanOrEqual(0);

    // The two-column layout keeps its widths: the meta panel is still
    // to the right of the content and still inside the viewport. A
    // title that blew the layout out would push it off-screen.
    const meta = page.getByTestId("meta-panel");
    const metaBox = await meta.boundingBox();
    const descBox = await page.getByRole("heading", { name: "Description" }).boundingBox();
    if (metaBox === null || descBox === null) throw new Error("no layout box");
    expect(metaBox.x).toBeGreaterThan(descBox.x);
    expect(metaBox.x + metaBox.width).toBeLessThanOrEqual(1281);
    expect(metaBox.width).toBeGreaterThan(150);

    // The title wrapped inside the header rather than running out of
    // it: its box is no wider than the viewport.
    const titleBox = await page.getByRole("heading", { level: 1 }).boundingBox();
    if (titleBox === null) throw new Error("no title box");
    expect(titleBox.width).toBeLessThanOrEqual(1280);

    // The full string is recoverable — the case's third bullet.
    await expect(page.getByRole("heading", { level: 1 })).toHaveAttribute("title", longTitle);
  });

  // @verifies TSK-44
  test("TSK-44: cancelling Delete or Move changes nothing and does not retain the typed key", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web App", "--prefix", "WEB"]);
    const [key] = await tracker.seed([{ title: "Untouched by dialogs" }]);
    if (key === undefined) throw new Error("seed returned no key");
    const before = await frontmatterOf(tracker.root, key);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // Delete: type the confirmation, then Cancel.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill(key);
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await frontmatterOf(tracker.root, key)).toBe(before);

    // Reopening starts fresh — the typed key is not retained, so the
    // confirm button is disabled again. This is the bullet a
    // "dialog is visible" check would miss entirely.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue("");
    await expect(
      page.getByRole("dialog").getByRole("button", { name: new RegExp(`^Delete ${key}$`) }),
    ).toBeDisabled();

    // Esc dismisses too.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await frontmatterOf(tracker.root, key)).toBe(before);

    // Move: choose a destination, then dismiss both ways.
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Move to project…" }).click();
    await page.getByRole("dialog").getByLabel("Destination project").selectOption({ label: "Web App" });
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await frontmatterOf(tracker.root, key)).toBe(before);

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Move to project…" }).click();
    // Fresh: the previous selection is gone, so Move is disabled.
    await expect(page.getByRole("dialog").getByLabel("Destination project")).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await frontmatterOf(tracker.root, key)).toBe(before);

    // The task is still on the page, unchanged, after all four
    // dismissals — the positive half of the assertion.
    await expect(page.getByRole("heading", { name: "Untouched by dialogs", level: 1 })).toBeVisible();
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);
  });

  // @verifies TSK-45
  // @verifies ERR-8
  // @verifies SHL-44
  test("TSK-45/ERR-8/SHL-44: an unknown key 404s inside the shell, naming the key", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "A real task" }]);

    await page.goto(`${tracker.baseURL}/tasks/WEB-99999`);

    // Names the key that was not found, and says nothing matches it —
    // neither a current key nor a retired one, which is the "no such
    // key" vs "not loaded" distinction SHL-44 asks for.
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("WEB-99999");
    await expect(alert).toContainText(/no task with the key/i);
    await expect(alert).toContainText(/retired/i);

    // Not a redirect: the URL still names the dead link, so the person
    // who was sent it can see it is dead.
    await expect(page).toHaveURL(/\/tasks\/WEB-99999$/);

    // Inside the shell. The sidebar and header are intact, and this is
    // not the route error boundary — which would say something went
    // wrong rather than naming a missing task.
    await expect(page.getByRole("link", { name: "List", exact: true })).toBeVisible();
    await expect(alert).not.toContainText(/went wrong|unexpected error/i);

    // Neither the breadcrumb nor the meta panel is rendered empty as
    // though a task had loaded (TSK-45's last bullet).
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toHaveCount(0);
    await expect(page.getByTestId("meta-panel")).toHaveCount(0);

    // A way back, and navigation elsewhere still works from here.
    await alert.getByRole("link", { name: /task list/i }).click();
    await expect(page).toHaveURL(/\/list$/);
    await expect(listRow(page, "A real task")).toHaveCount(1);
  });

  // @verifies TSK-50
  test("TSK-50: a failed delete leaves the task intact and says it was not deleted", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Undeletable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByRole("heading", { name: "Undeletable task", level: 1 })).toBeVisible();

    // Fail the delete *after* confirmation. The route intercepts only
    // the DELETE, so the read that renders the page still succeeds —
    // otherwise the page would fail to load and the test would pass
    // for the wrong reason.
    await page.route(/\/api\/tasks\/[^/]+\?confirm=true/, route => {
      if (route.request().method() !== "DELETE") {
        void route.fallback();
        return;
      }
      void route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal_error",
          message: "The task directory could not be removed.",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        }),
      });
    });

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await page.getByRole("dialog").getByRole("textbox").fill(key);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(`^Delete ${key}$`) })
      .click();

    // The message states the task was NOT deleted, and why.
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText(new RegExp(`${key} was not deleted`));
    await expect(alert).toContainText(/could not be removed/i);

    // Not navigated away: still on the task, which is the difference
    // between a failed delete and a successful one.
    await expect(page).toHaveURL(new RegExp(`/tasks/${key}$`));
    await expect(page.getByRole("dialog")).toBeVisible();

    // The task is still on disk and still in the list.
    expect(await existsOnDisk(tracker.root, key)).toBe(true);
    await page.unroute(/\/api\/tasks\/[^/]+\?confirm=true/);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(listRow(page, "Undeletable task")).toHaveCount(1);
  });

  // @verifies TSK-52
  test("TSK-52: a failed archive shows no badge and still offers Archive", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Unarchivable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.route(/\/api\/tasks\/[^/]+\/archive$/, route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal_error",
          message: "The archive flag could not be written.",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        }),
      }));

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByRole("heading", { name: "Unarchivable task", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();

    // The failure is named.
    await expect(page.getByRole("alert")).toContainText(/could not be written/i);

    // No badge, and the menu still offers Archive rather than
    // Unarchive — the pair is what makes this discriminate. A badge
    // check alone passes on a page that renders no header at all.
    await expect(page.getByTestId("archived-badge")).toHaveCount(0);
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menuitem", { name: "Archive" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Unarchive" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Nothing was written: the flag is not on the file, and the task
    // is still in the default list view.
    expect(await frontmatterOf(tracker.root, key)).not.toMatch(/^archived:\s*true\s*$/m);
    await page.unroute(/\/api\/tasks\/[^/]+\/archive$/);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(listRow(page, "Unarchivable task")).toHaveCount(1);

    // Retry works once the write can land — which is what makes the
    // offered Archive a real recovery rather than a dead control.
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Archive" }).click();
    await expect(page.getByTestId("archived-badge")).toBeVisible();
  });

  // @verifies TSK-53
  test("TSK-53: an unreachable server is distinct from a missing task, and retry recovers", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Unreachable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    let down = true;
    await page.route(/\/api\/tasks\/[^/]+$/, route => {
      if (down) {
        void route.abort("connectionrefused");
        return;
      }
      void route.fallback();
    });

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // Names the cause and the process to check. This is what
    // distinguishes it from "task not found" — which would falsely
    // imply the task had been deleted.
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/not responding/i);
    await expect(alert).toContainText(/loctt ui/i);
    await expect(alert).not.toContainText(/not found/i);
    await expect(alert).not.toContainText(new RegExp(`No task with the key`, "i"));

    // Retry re-issues the request and renders the task, with no
    // manual page reload. A `page.reload()` here would refetch
    // everything regardless of whether Retry does anything at all.
    down = false;
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByRole("heading", { name: "Unreachable task", level: 1 })).toBeVisible();
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);
  });

  // @verifies XS-58
  // @verifies ERR-7
  test("XS-58/ERR-7: a task deleted in the CLI degrades to not-found and leaves no dead sidebar row", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Deleted underneath" },
      { title: "Still here" },
    ]);
    const [doomed] = keys;
    if (doomed === undefined) throw new Error("seed returned no key");

    // Open it, so it is in Recently viewed and rendered with live
    // fields before anything happens to it.
    await page.goto(`${tracker.baseURL}/tasks/${doomed}`);
    await expect(page.getByRole("heading", { name: "Deleted underneath", level: 1 })).toBeVisible();
    const recents = recentsGroup(page);
    await expect(recents.getByRole("link", { name: /Deleted underneath/ })).toHaveCount(1);

    // Delete it out from under the UI.
    await tracker.run(["delete", doomed, "--yes"]);
    expect(await existsOnDisk(tracker.root, doomed)).toBe(false);

    // **Everything below happens without a page load.**
    //
    // `page.goto` and `page.reload()` are both ruled out here, and not
    // only because the case says "let the UI refetch": a full load
    // throws away the entire client cache, so a build that happily
    // renders a stale cached task on a 404 would still show the
    // not-found state and the test could not tell. That is exactly
    // what happened to the first cut of this test — a cache-serving
    // mutation left it green.
    //
    // ERR-7 describes the real flow anyway: the row is still rendered
    // in the list, and the user clicks it. So: navigate in-app to the
    // list, click the stale row, and let the client discover the 404
    // with its cache still warm.
    // Away to the list, then back at the dead task through the
    // sidebar's own link — a router navigation, so the SPA never
    // unloads and its cache stays warm across the whole sequence.
    //
    // The recents link rather than a list row: the list refetches on
    // mount and drops the dead row before it can be clicked, which is
    // correct behaviour but leaves nothing to click. The sidebar
    // entry is the stale-link case in its own right, and it is the
    // one the case's third bullet is about.
    await page.getByRole("link", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/\/list$/);
    await expect(listRow(page, "Still here")).toHaveCount(1);

    await recents.getByRole("link", { name: /Deleted underneath/ }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${doomed}$`));

    // An explicit not-found naming the key — not a page of stale
    // fields. The meta panel is gone with it, so nothing looks live.
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(doomed);
    await expect(alert).toContainText(/no task with the key/i);
    await expect(page.getByTestId("meta-panel")).toHaveCount(0);
    // ERR-7: named by key, never by ULID.
    expect(await alert.innerText()).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);

    // The sidebar does not keep a row that 404s forever. Paired with a
    // positive: the group is still rendering (it says so, in its empty
    // copy) rather than having failed and shown nothing — an absence
    // assertion alone is green on a sidebar that renders no group at
    // all.
    await expect(recents).toContainText("Recently viewed");
    await expect(recents.getByRole("link", { name: /Deleted underneath/ })).toHaveCount(0);

    // A way out — the user is not stranded on a dead route. The stale
    // row is gone from the list on this read, which is what stops it
    // being a permanently-404ing entry (ERR-7's last bullet).
    await alert.getByRole("link", { name: /task list/i }).click();
    await expect(page).toHaveURL(/\/list$/);
    await expect(listRow(page, "Still here")).toHaveCount(1);
    await expect(listRow(page, "Deleted underneath")).toHaveCount(0);
  });
  // @verifies TSK-21
  //
  // Bullet 1, which nothing asserted until now: "The picker lists
  // non-archived projects, excluding the current one." Both halves were
  // built and correct; the M2 gate proved they were unchecked by
  // listing archived projects AND making the current one selectable,
  // after which all 18 tests in this file still passed.
  //
  // The current-project half asserts the DOM property, not
  // `toBeDisabled()`. Playwright retargets an element inside a <label>
  // to that label's control unless it is itself a control-ish tag, and
  // <option> is not on that list — so `toBeDisabled()` here evaluates
  // the parent <select>, which is enabled, and reports "enabled" while
  // its own call log shows it resolved to `<option disabled ...>`.
  // Measured in isolation: the same markup without the <label> wrapper
  // returns disabled=true.
  test("TSK-21: the move picker omits archived projects and cannot re-pick the current one", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web App", "--prefix", "WEB"]);
    await tracker.run(["project", "create", "Retired", "--prefix", "RET"]);
    await tracker.run(["project", "archive", "Retired"]);
    const [key] = await tracker.seed([{ title: "Movable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Move to project…" }).click();
    const select = page.getByRole("dialog").getByLabel("Destination project");
    await expect(select).toBeVisible();

    // The archived project is not offered at all.
    await expect(select.getByRole("option", { name: /Retired/ })).toHaveCount(0);
    // A live one is — the positive control, so the assertion above
    // cannot pass merely because the picker is empty or unrendered.
    await expect(select.getByRole("option", { name: /Web App/ })).toHaveCount(1);

    // The current project is present but not selectable, and says so.
    const current = select.getByRole("option", { name: /current/ });
    await expect(current).toHaveCount(1);
    await expect(current).toHaveJSProperty("disabled", true);
  });

  // @verifies TSK-51
  //
  // The Move *failure* path. A9 records why this needs its own test:
  // there is no single-task move endpoint, so a move goes through
  // `POST /api/tasks/bulk/move`, which answers **200 with a `failed`
  // array** rather than a non-2xx. `useMoveTask` inspects `failed[0]`
  // and throws, because nothing else would — react-query calls a 200
  // a success. Delete that check and this test is the only thing in
  // the suite that notices: the dialog closes, nothing is shown, and
  // the user believes a task moved that did not.
  //
  // The fulfilled body matches `handleBulkMove` in server.ts:
  // `{ bulk_op_id, succeeded, failed: [{ taskId, error }], moved }`.
  // Inventing a shape here would make the test pass against a client
  // reading a field the server never sends.
  test("TSK-51: a move the server reports as failed keeps the dialog open and names it", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web App", "--prefix", "WEB"]);
    const [key] = await tracker.seed([{ title: "Unmovable task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    const before = await frontmatterOf(tracker.root, key);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByRole("heading", { name: "Unmovable task", level: 1 })).toBeVisible();

    // Only the move is intercepted, so the read that renders the page
    // still hits the real server — otherwise the page would never
    // load and the test would pass for the wrong reason.
    await page.route("**/api/tasks/bulk/move", route => {
      void route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          bulk_op_id: "01J000000000000000000MOVE",
          succeeded: [],
          failed: [{ taskId: key, error: "the destination project is archived" }],
          moved: [],
        }),
      });
    });

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Move to project…" }).click();
    await page.getByRole("dialog").getByLabel("Destination project").selectOption({ label: "Web App" });
    await page.getByRole("dialog").getByRole("button", { name: "Move task" }).click();

    // Named, not generic. The reason the server gave is what tells the
    // user whether to retry or to fix something first, so a
    // "something went wrong" would satisfy a `toBeVisible` and fail
    // the case.
    const alert = page.getByRole("dialog").getByRole("alert");
    await expect(alert).toContainText(/not moved/i);
    await expect(alert).toContainText("the destination project is archived");

    // The dialog stays open — this is the assertion the deleted
    // `failed[0]` check makes fail. On the broken build `onSuccess`
    // runs, `setConfirming(null)` closes the dialog, and the user is
    // left on a page that looks like a completed move.
    await expect(page.getByRole("dialog")).toBeVisible();

    // And nothing moved: same key on the page, same bytes on disk.
    await expect(page).toHaveURL(new RegExp(`/tasks/${key}$`));
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);
    expect(await frontmatterOf(tracker.root, key)).toBe(before);
  });

  // @verifies TSK-21
  //
  // The Move *success* path, against the real server — no
  // interception, so the rekey is the tracker's own.
  //
  // What this owes beyond "the request went out" is the navigation. A
  // move rekeys the task, so the URL the user is standing on names a
  // key that is now retired. `useMoveTask` returns `moved[0].new_key`
  // for exactly that, and without the navigate the address bar keeps
  // a stale key while the page re-resolves it by history — which
  // looks correct and is not.
  test("TSK-21: a successful move rekeys the task and follows it to the new key", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web App", "--prefix", "WEB"]);
    const [key] = await tracker.seed([{ title: "Movable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByRole("heading", { name: "Movable task", level: 1 })).toBeVisible();
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);

    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Move to project…" }).click();
    await page.getByRole("dialog").getByLabel("Destination project").selectOption({ label: "Web App" });
    await page.getByRole("dialog").getByRole("button", { name: "Move task" }).click();

    await expect(page.getByRole("dialog")).toHaveCount(0);

    // The new key is read off disk rather than guessed, so this does
    // not quietly encode an assumption about prefix allocation.
    const newKey = await movedKeyOf(tracker.root, "Movable task");
    expect(newKey).not.toBe(key);
    // Rekeyed into the destination's prefix. Written without a
    // separator because that is what this tracker allocates — asserting
    // "WEB-" here passed nothing and only encoded a guess.
    expect(newKey).toMatch(/^WEB/);

    // Both halves of "followed it": the URL, and the chip. The chip
    // alone would pass on a page that re-resolved the old key through
    // `key_history` without ever navigating.
    await expect(page).toHaveURL(new RegExp(`/tasks/${newKey}$`));
    await expect(page.getByTestId("task-key-chip")).toHaveText(newKey);

    // And it is a live key, not a retired one being displayed — the
    // retired-key notice TSK-2 asserts must be absent here.
    const taskHeader = page.locator("header").filter({ hasText: newKey });
    await expect(taskHeader).not.toContainText(/retired key/i);
    await expect(page.getByRole("heading", { name: "Movable task", level: 1 })).toBeVisible();
  });
  // @verifies TSK-3
  //
  // TSK-3's last bullet: "The entry is stored per-user; switching users
  // shows that user's own recents." Nothing else in the spec switches
  // users, so without this the bullet rests on an unverified claim
  // about the server.
  //
  // The switch is driven through the header's own user menu rather
  // than by a CLI call, so what is asserted is the path a user
  // actually takes — a `loctt user switch` would change the file
  // without the client invalidating anything, and the test would then
  // be measuring a page reload.
  test("TSK-3: recents are per-user — switching users shows that user's own", async ({
    page,
    tracker,
  }) => {
    // Both users are created and named, and the first is switched to
    // explicitly: `loctt init` bootstraps a default user whose name
    // comes from the environment, and a test that switched "back" to
    // whatever happened to be first would not know which user it had
    // landed on.
    await tracker.run(["user", "create", "Ashgrove", "--switch"]);
    await tracker.run(["user", "create", "Bramble"]);
    const [mine] = await tracker.seed([{ title: "Seen by one user only" }]);
    if (mine === undefined) throw new Error("seed returned no key");

    // Ashgrove opens the task, so it lands in Ashgrove's recents and
    // nobody else's.
    await page.goto(`${tracker.baseURL}/tasks/${mine}`);
    await expect(page.getByRole("heading", { name: "Seen by one user only", level: 1 })).toBeVisible();
    const recents = recentsGroup(page);
    await expect(recents.getByRole("link", { name: /Seen by one user only/ })).toHaveCount(1);

    // Switch to the other user from the header menu.
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: /Bramble/ }).click();

    // Bramble has never opened it. The group must still be rendering —
    // paired with the positive so a sidebar that failed to render at
    // all cannot pass this as an absence.
    await expect(recents).toContainText("Recently viewed");
    await expect(recents.getByRole("link", { name: /Seen by one user only/ })).toHaveCount(0);

    // The task itself is untouched by the switch: recents are per-user,
    // tasks are not. Without this the test would also pass on a build
    // that hid the task from Bramble entirely.
    await expect(page.getByRole("heading", { name: "Seen by one user only", level: 1 })).toBeVisible();

    // Switching back restores the first user's own recents, which is
    // what makes this storage rather than a cleared list.
    await page.getByRole("button", { name: "User menu" }).click();
    await page.getByRole("menuitem", { name: /Ashgrove/ }).click();
    await expect(recents.getByRole("link", { name: /Seen by one user only/ })).toHaveCount(1);
  });
});
