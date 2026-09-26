/**
 * Transcribed from tests/cases/ui-test-cases/flow-app-shell.md.
 *
 * The cases here are about *browser* behaviour — history, scroll
 * position, deep links — which a jsdom test cannot assert. A unit test
 * for scroll restoration would check the router's configuration and
 * call it covered; only a real browser proves the page actually
 * returns to where the user left it.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { execa } from "execa";

import {
  cliEntry,
  freePort,
  killAndWait,
  registerServerChild,
  waitForReady,
  workspaceRoot,
} from "./fixtures/server-harness.ts";
import { expect, test } from "./fixtures/tracker.ts";

/**
 * A second, independent tracker + server, for the one case that is
 * about two instances at once (SHL-31).
 *
 * The `tracker` fixture deliberately hands each test exactly one
 * tracker, and widening it to a pair would make every other spec pay
 * for a server it does not use. This spins the extra one up locally
 * instead; the caller stops it in a `finally`.
 */
async function spawnTracker(): Promise<{
  root: string;
  baseURL: string;
  run(args: readonly string[]): Promise<string>;
  stop(): Promise<void>;
}> {
  const root = await mkdtemp(path.join(workspaceRoot, "loctt-ui-second-"));
  const run = async (args: readonly string[]): Promise<string> => {
    const result = await execa(process.execPath, [cliEntry, ...args], {
      cwd: root,
      env: process.env,
      reject: false,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `loctt ${args.join(" ")} exited ${String(result.exitCode)}\n${result.stderr}`,
      );
    }
    return result.stdout;
  };

  await run(["init"]);
  const port = await freePort();
  const baseURL = `http://127.0.0.1:${String(port)}`;
  const child = execa(process.execPath, [cliEntry, "ui", "--port", String(port), "--no-open"], {
    cwd: root,
    env: process.env,
    reject: false,
  });
  const unregister = registerServerChild(child);

  const stop = async (): Promise<void> => {
    await killAndWait(child);
    unregister();
    await rm(root, { recursive: true, force: true }).catch((err: unknown) => {
      console.error(`second tracker: failed to remove ${root}: ${String(err)}`);
    });
  };

  try {
    await waitForReady(baseURL, 15_000);
  } catch (err) {
    await stop();
    throw err;
  }
  return { root, baseURL, run, stop };
}

test.describe("SHL — routing and history", () => {
  // @verifies SHL-15
  test("SHL-15: back and forward move between views without leaving the app", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Alpha task", fields: { status: "in_progress" } },
      { title: "Beta task" },
    ]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Alpha task")).toBeVisible();

    await page.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);

    await page.getByRole("link", { name: "List" }).click();
    await expect(page).toHaveURL(/\/list$/);

    // A filter change is a history step like any other.
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Beta task")).toBeHidden();

    // Amended (K125, Ken 2026-09-24): this assertion previously expected
    // the view switcher to CARRY `status=in_progress` across to
    // `/timeline` (the 2026-09-20 cross-view scope fix, TML-57) — that
    // is the exact carry-across K125 supersedes for the view switcher's
    // OWN links. Ken, told List/Board/Timeline carried the project/
    // filter scope and asked how to get back to all tasks, said "click
    // 'list'?" — so a view-link click now CLEARS the sidebar-driven and
    // toolbar scope instead of carrying it; "click a view" is now how
    // you reach the fully unscoped view. The status filter must NOT
    // ride along.
    await page.getByRole("link", { name: "Timeline" }).click();
    await expect(page).toHaveURL(/\/timeline$/);

    // Two steps back, in reverse order, one navigation each: the
    // /timeline entry (unscoped) and the /list?status=in_progress entry.
    await page.goBack();
    await expect(page).toHaveURL(/\/list\?status=in_progress$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/list$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/board$/);

    // No step landed on a blank route: the shell is still there.
    await expect(page.getByRole("link", { name: "List" })).toBeVisible();

    // Forward re-applies in order, filter state included.
    await page.goForward();
    await expect(page).toHaveURL(/\/list$/);
    await page.goForward();
    await expect(page).toHaveURL(/\/list\?status=in_progress$/);
    await expect(page.getByText("Alpha task")).toBeVisible();
    await expect(page.getByText("Beta task")).toBeHidden();
  });

  // @verifies SHL-16
  test("SHL-16: an unknown route renders a designed 404 inside the shell", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);

    await page.goto(`${tracker.baseURL}/nonsense`);

    // The problem, in the user's terms.
    await expect(page.getByText(/doesn.t exist/i)).toBeVisible();
    // The path that was asked for — a stale link and a typo are
    // indistinguishable without it.
    await expect(page.getByText("/nonsense")).toBeVisible();
    // Inside the shell: header and sidebar still present and working.
    // Scoped to the sidebar, because the 404's own "Go to the task
    // list" link matches a bare name lookup too.
    await expect(
      page.locator("aside").getByRole("link", { name: "List", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Toggle sidebar")).toBeVisible();

    // And a way back that works.
    await page.getByRole("link", { name: /task list/i }).click();
    await expect(page).toHaveURL(/\/list$/);
    await expect(page.getByText("Alpha task")).toBeVisible();
  });

  // @verifies SHL-30
  test("SHL-30: back from a 404 returns to the previous real view", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Alpha task")).toBeVisible();

    await page.goto(`${tracker.baseURL}/nonsense`);
    await expect(page.getByText(/doesn.t exist/i)).toBeVisible();

    // One press, not two: the 404 must not redirect, which would
    // consume a second entry and hide the dead link.
    await page.goBack();
    await expect(page).toHaveURL(/\/list$/);
    await expect(page.getByText("Alpha task")).toBeVisible();
  });

  // @verifies SHL-27
  test("SHL-27: a deep-linked filtered view reproduces exactly in a new tab", async ({
    page,
    context,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Alpha task", fields: { status: "in_progress" } },
      { title: "Beta task" },
    ]);

    const url = `${tracker.baseURL}/list?status=in_progress&sort=title&dir=desc`;
    await page.goto(url);
    await expect(page.getByText("Alpha task")).toBeVisible();
    await expect(page.getByText("Beta task")).toBeHidden();

    // A genuinely separate tab: no shared React state, only the URL.
    const second = await context.newPage();
    await second.goto(url);
    await expect(second.getByText("Alpha task")).toBeVisible();
    await expect(second.getByText("Beta task")).toBeHidden();
    await expect(second).toHaveURL(url);
    await second.close();
  });
});

test.describe("SHL — scroll", () => {
  /**
   * Scrolls the main pane the way a user does, and returns where it
   * ended up.
   *
   * A wheel event rather than assigning `scrollTop`: the router tracks
   * scroll positions from real scroll events, and driving the property
   * directly would test the assignment rather than the restoration.
   */
  async function scrollMain(page: import("@playwright/test").Page, by: number) {
    await page.locator("main").hover();
    await page.mouse.wheel(0, by);
    await expect
      .poll(() => page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0))
      .toBeGreaterThan(0);
    return page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);
  }

  // @verifies SHL-25
  test("SHL-25: scroll position is restored on Back", async ({ page, tracker }) => {
    await tracker.seedBulk(60);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText(/Showing 1–/)).toBeVisible();

    const offset = await scrollMain(page, 800);
    // Guard: if the pane cannot scroll, the rest asserts nothing.
    expect(offset).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/list$/);

    // Approximately, per the case — rows re-render before the
    // restoration lands, so an exact match would be flaky by design.
    // Approximately, per the case — rows re-render before the
    // restoration lands, so an exact match would be flaky by design.
    // Approximately, per the case — rows re-render before the
    // restoration lands, so an exact match would be flaky by design.
    //
    // "Restoration happens after rows render, not before, so it
    // doesn't land on a position that then collapses": on the frame
    // the route changes the pane holds only ~48px of scrollable
    // range, so an offset applied then clamps to that and the user
    // lands near the top. A tolerance loose enough to accept 48
    // would pass against exactly the bug the bullet describes.
    await expect
      .poll(() => page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0), {
        timeout: 5_000,
      })
      .toBeGreaterThan(offset * 0.9);
  });

  // @verifies SHL-26
  test("SHL-26: a fresh navigation starts at the top", async ({ page, tracker }) => {
    await tracker.seedBulk(60);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText(/Showing 1–/)).toBeVisible();
    expect(await scrollMain(page, 800)).toBeGreaterThan(0);

    // Clicking through is a fresh navigation, not a restoration. The
    // claim is that the board does not *inherit* the list's offset —
    // asserting an exact 0 would also fail on a few pixels of settle,
    // which is not what the case is about.
    await page.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);
    await expect
      .poll(() => page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0))
      .toBeLessThan(100);
  });

  // @verifies SHL-24
  test("SHL-24: collapsing the sidebar leaves the view's state untouched", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Alpha task", fields: { status: "in_progress" } },
      { title: "Beta task" },
    ]);

    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Alpha task")).toBeVisible();
    const before = page.url();

    // Count the task requests so a collapse-triggered refetch shows up.
    let taskRequests = 0;
    page.on("request", req => {
      if (req.url().includes("/api/tasks?")) taskRequests += 1;
    });

    await page.getByLabel("Toggle sidebar").click();
    await expect(page.locator("aside")).toHaveAttribute("data-collapsed", "true");
    await page.getByLabel("Toggle sidebar").click();
    await expect(page.locator("aside")).toHaveAttribute("data-collapsed", "false");

    // Collapsing is pure chrome: same URL, same rows, no refetch.
    expect(page.url()).toBe(before);
    await expect(page.getByText("Alpha task")).toBeVisible();
    await expect(page.getByText("Beta task")).toBeHidden();
    expect(taskRequests).toBe(0);
  });
});

test.describe("SHL — theme and motion", () => {
  // @verifies SHL-29
  test("SHL-29: dark theme paints on the first frame after a hard reload", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);

    await page.goto(`${tracker.baseURL}/list`);
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    // The check that matters: the class is on the element before any
    // paint, not applied a frame later by React. A deferred module
    // script cannot do this — the browser has already painted a light
    // page by the time it runs — so this fails against anything but a
    // blocking inline script.
    // Sample the class from the earliest moment a script can run —
    // before the app bundle has parsed. A deferred module script
    // cannot have run by then, so the class is only present if
    // something blocking put it there.
    await page.addInitScript(() => {
      (window as unknown as { __EARLY__?: boolean[] }).__EARLY__ = [];
      document.addEventListener("readystatechange", () => {
        (window as unknown as { __EARLY__: boolean[] }).__EARLY__.push(
          document.documentElement.classList.contains("dark"),
        );
      });
    });
    await page.reload();
    const samples = await page.evaluate(
      () => (window as unknown as { __EARLY__?: boolean[] }).__EARLY__ ?? [],
    );
    //  fires once the HTML is parsed — the head's inline
    // script has run, the deferred bundle has not.
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]).toBe(true);

    // And it is still there once the app has mounted.
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByText("Alpha task")).toBeVisible();
  });

  // @verifies SHL-29
  test("SHL-29: `system` follows a dark OS across a reload", async ({
    browser,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();

    await page.goto(`${tracker.baseURL}/list`);
    // Default preference is system, so a dark OS means a dark page.
    await expect(page.locator("html")).toHaveClass(/dark/);

    await page.addInitScript(() => {
      (window as unknown as { __EARLY__?: boolean[] }).__EARLY__ = [];
      document.addEventListener("readystatechange", () => {
        (window as unknown as { __EARLY__: boolean[] }).__EARLY__.push(
          document.documentElement.classList.contains("dark"),
        );
      });
    });
    await page.reload();
    const samples = await page.evaluate(
      () => (window as unknown as { __EARLY__?: boolean[] }).__EARLY__ ?? [],
    );
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]).toBe(true);

    await context.close();
  });

  // @verifies SHL-28
  test("SHL-28: reduced motion suppresses shell transitions without breaking them", async ({
    browser,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Alpha task")).toBeVisible();

    // The sidebar's width transition is suppressed...
    const duration = await page
      .locator("aside")
      .evaluate(el => getComputedStyle(el).transitionDuration);
    expect(Number.parseFloat(duration)).toBeLessThan(0.05);

    // ...but the state still changes, which is the case's other half.
    await page.getByLabel("Toggle sidebar").click();
    await expect(page.locator("aside")).toHaveAttribute("data-collapsed", "true");

    // And the theme still switches.
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    await context.close();
  });
});

test.describe("SHL — scale and isolation", () => {
  // @verifies SHL-11, SHL-31
  test("SHL-31: two trackers are distinguishable by their titles", async ({
    browser,
    tracker,
  }) => {
    // The case is about *two* instances, so it needs two of them. One
    // tracker cannot show that the titles differ — it can only show
    // that a title exists, which is the assertion this test used to
    // make while the case it names went unverified.
    const second = await spawnTracker();
    try {
      // Each tracker's project is renamed, which is exactly the
      // affordance Ken's ruling points at: "the user can rename the
      // projects themselves if they want to differentiate." Both
      // trackers start with a project named "Tasks", so without a
      // rename the two windows legitimately read the same.
      await tracker.run(["project", "edit", "Tasks", "--name", "Alpha Service"]);
      await second.run(["project", "edit", "Tasks", "--name", "Beta Service"]);

      const contextA = await browser.newContext();
      const contextB = await browser.newContext();
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();
      try {
        await pageA.goto(`${tracker.baseURL}/list`);
        await pageB.goto(`${second.baseURL}/list`);

        // The window title names the project, so the two windows are
        // tellable apart from the tab strip alone — no file path on
        // the page, and nothing added to the sidebar.
        await expect(pageA).toHaveTitle("LocTT · Alpha Service · List");
        await expect(pageB).toHaveTitle("LocTT · Beta Service · List");

        // The point of the case: the labels *differ*.
        expect(await pageA.title()).not.toBe(await pageB.title());

        // Sidebar contents reflect each tracker independently.
        const asideA = pageA.locator("aside");
        const asideB = pageB.locator("aside");
        await expect(asideA.getByText("Alpha Service")).toBeVisible();
        await expect(asideB.getByText("Beta Service")).toBeVisible();
        await expect(asideA.getByText("Beta Service")).toHaveCount(0);
      } finally {
        await contextA.close();
        await contextB.close();
      }
    } finally {
      await second.stop();
    }
  });
});

test.describe("SHL — render failures", () => {
  // @verifies SHL-42
  test("SHL-42: a render throw replaces the main pane, not the app", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);

    // A response that parses but whose rows are the wrong shape: the
    // client's error handling never fires (this is a 200 with valid
    // JSON), so the failure happens during render — which is what
    // this case is about, and what a 500 cannot reproduce.
    await page.route(/\/api\/tasks\?/, route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [null], total: 1, offset: 0, limit: 50 }),
      }));

    await page.goto(`${tracker.baseURL}/list`);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    // Says what was being displayed, in user terms rather than a
    // component name.
    await expect(alert).toContainText("the task list");
    await expect(alert).not.toContainText("ListView");
    // No reassurance line (K126).
    await expect(alert).not.toContainText(/affected/i);

    // The header and sidebar survive, so the user can navigate away.
    await expect(page.getByLabel("Toggle sidebar")).toBeVisible();
    await expect(
      page.locator("aside").getByRole("link", { name: "Board", exact: true }),
    ).toBeVisible();

    // No raw stack as the primary message: the detail is behind a
    // closed disclosure.
    await expect(page.locator("details")).not.toHaveAttribute("open", "");

    // And navigating away actually works — the boundary is not a trap.
    await page.locator("aside").getByRole("link", { name: "Board", exact: true }).click();
    await expect(page).toHaveURL(/\/board$/);
  });
});

test.describe("LST — list state and scale", () => {
  // @verifies LST-38
  test("LST-38: two tabs hold independent list state", async ({
    page,
    context,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Alpha task", fields: { status: "in_progress" } },
      { title: "Beta task" },
    ]);

    // Tab A: filtered.
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Alpha task")).toBeVisible();
    await expect(page.getByText("Beta task")).toBeHidden();

    // Tab B: unfiltered.
    const b = await context.newPage();
    await b.goto(`${tracker.baseURL}/list`);
    await expect(b.getByText("Alpha task")).toBeVisible();
    await expect(b.getByText("Beta task")).toBeVisible();

    // Changing A does not touch B. List state lives in the URL, so
    // this is a claim about *not* using shared storage — a filter
    // persisted to localStorage would fail here and nowhere else.
    await page.getByRole("button", { name: /Remove Status/ }).click();
    await expect(page.getByText("Beta task")).toBeVisible();

    await expect(b).toHaveURL(`${tracker.baseURL}/list`);
    await expect(b.getByText("Alpha task")).toBeVisible();
    await expect(b.getByText("Beta task")).toBeVisible();

    // And B's own filter does not leak back to A.
    await b.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(b.getByText("Beta task")).toBeHidden();
    await expect(page.getByText("Beta task")).toBeVisible();

    await b.close();
  });

  // @verifies ONB-25
  test("ONB-25: a tracker with exactly one task does not render as empty", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "The only task" }]);

    await page.goto(`${tracker.baseURL}/list`);

    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.getByText("The only task")).toBeVisible();
    // The count is reported rather than hidden for a single row.
    await expect(page.getByText(/Showing 1–1 of 1/)).toBeVisible();
    // And the empty state is nowhere near it.
    await expect(page.getByText(/No tasks/i)).toBeHidden();
  });

  // @verifies LST-18
  test("LST-18: 5,000 tasks stay responsive and count honestly", async ({
    page,
    tracker,
  }) => {
    test.slow();
    await tracker.seedBulk(5_000);

    const started = Date.now();
    await page.goto(`${tracker.baseURL}/list`);
    // The first page renders without materialising all 5,000 rows.
    await expect(page.locator("tbody tr")).toHaveCount(50, { timeout: 30_000 });
    const elapsed = Date.now() - started;

    // The true count, not a cap or an estimate — core's own
    // `listTasks` defaults to 30, which is exactly the number a
    // careless pass-through would show here.
    await expect(page.getByText(/Showing 1–50 of 5000/)).toBeVisible();
    // Generous, because this asserts "did not block", not a budget.
    expect(elapsed).toBeLessThan(30_000);

    // Sorting re-sorts the whole result set, not the loaded page: the
    // first row after sorting descending by key must not be one of
    // the fifty that happened to be on screen.
    const firstBefore = await page.locator("tbody tr").first().innerText();
    await page.getByRole("button", { name: /^Key/ }).click();
    await page.getByRole("button", { name: /^Key/ }).click();
    await expect
      .poll(() => page.locator("tbody tr").first().innerText(), { timeout: 15_000 })
      .not.toBe(firstBefore);
  });
});

test.describe("XS — the UI and the CLI mean the same things", () => {
  // @verifies XS-19
  test("XS-19: archive and delete mean the same thing in the UI as in the CLI", async ({
    page,
    tracker,
  }) => {
    const [keepKey, dropKey] = await tracker.seed([
      { title: "To be archived" },
      { title: "To be deleted" },
    ]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("To be archived")).toBeVisible();

    // Archive from the UI.
    await page
      .getByRole("row", { name: /To be archived/ })
      .getByRole("checkbox")
      .click();
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("To be archived")).toBeHidden();

    // The CLI agrees: the task still exists, flagged rather than gone.
    const shown = await tracker.run(["show", String(keepKey)]);
    expect(shown).toContain("To be archived");
    // And `unarchive` reverses it — the same verb pair, not a UI-only
    // notion of "hidden".
    await tracker.run(["unarchive", String(keepKey)]);
    const after = await tracker.run(["show", String(keepKey)]);
    expect(after).toContain("To be archived");

    // Delete from the UI. Below the large-batch threshold, so the
    // habitual word applies.
    await page.reload();
    await expect(page.getByText("To be deleted")).toBeVisible();
    await page
      .getByRole("row", { name: /To be deleted/ })
      .getByRole("checkbox")
      .click();
    await page.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Type DELETE to confirm").fill("DELETE");
    await dialog.getByRole("button", { name: /Delete 1 task/ }).click();
    await expect(page.getByText("To be deleted")).toBeHidden();

    // The CLI agrees again: permanently gone, not flagged.
    await expect
      .poll(async () => {
        try {
          await tracker.run(["show", String(dropKey)]);
          return "found";
        } catch {
          return "gone";
        }
      })
      .toBe("gone");

    // And the UI offers no third verb — no soft delete, no hard flag.
    await page.reload();
    await expect(page.getByText("To be archived")).toBeVisible();
    await page
      .getByRole("row", { name: /To be archived/ })
      .getByRole("checkbox")
      .click();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).not.toContainText(/soft/i);
    await expect(bar).not.toContainText(/permanent/i);
    await expect(bar).not.toContainText(/--hard/);
  });

  // @verifies XS-19
  test("XS-19: a task archived from the CLI shows as archived in the UI", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([
      { title: "Archived elsewhere" },
      { title: "Still open" },
    ]);
    await tracker.run(["archive", String(key)]);

    await page.goto(`${tracker.baseURL}/list`);

    // Hidden from the default view, exactly as in the CLI.
    await expect(page.getByText("Still open")).toBeVisible();
    await expect(page.getByText("Archived elsewhere")).toBeHidden();

    // K121 #1 (amended case): no URL reveals it in the list...
    await page.goto(`${tracker.baseURL}/list?archived=all`);
    await expect(page.getByText("Still open")).toBeVisible();
    await expect(page.getByText("Archived elsewhere")).toBeHidden();

    // ...it is listed in Settings → Archived...
    await page.goto(`${tracker.baseURL}/settings/archived`);
    await expect(page.getByTestId("archived-items")).toContainText("Archived elsewhere");

    // ...and its own page, reached by direct link, carries the badge.
    await page.goto(`${tracker.baseURL}/tasks/${String(key)}`);
    await expect(page.getByTestId("archived-badge")).toBeVisible();
  });

  // @verifies XS-6
  test("XS-6: a CLI bulk archive under a loaded list is reflected in full", async ({
    page,
    tracker,
  }) => {
    test.slow();
    const keys = await tracker.seed(
      Array.from({ length: 12 }, (_, i) => ({ title: `Task ${i + 1}` })),
    );

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–12 of 12")).toBeVisible();

    // Archive half of them from the CLI, under the loaded list.
    for (const key of keys.slice(0, 6)) {
      await tracker.run(["archive", String(key)]);
    }

    // The refetch reflects *all six*, not a subset — a page-1 refresh
    // stitched onto a stale page 2 is the failure this case names. There
    // is no manual refresh button (Q4); a browser reload is the force-
    // refresh path, and it must reflect the full CLI change (not a stale
    // page-1-over-page-2 stitch).
    await page.reload();
    await expect(page.getByText("Showing 1–6 of 6")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("tbody tr")).toHaveCount(6);

    // And the count agrees with what the CLI reports for the same
    // scope, which is the case's own cross-check. A bare `loctt list`
    // excludes archived tasks by default — the same default the UI
    // applies, which is XS-19's point restated.
    const listed = await tracker.run(["list"]);
    const cliRows = listed.split("\n").filter(l => /^T-\d+\s/.test(l)).length;
    expect(cliRows).toBe(6);
  });
});

test.describe("SHL — a config file broken by hand", () => {
  // @verifies SHL-43
  test("SHL-43: a malformed config names the file and does not read as empty", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Still listed" }]);
    await writeFile(
      path.join(tracker.root, ".loctt", "config", "labels.yaml"),
      "labels:\n  - name: [unclosed\n",
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Still listed")).toBeVisible();

    // "The error names the specific file … and includes the parse
    // error's location if the server provides one."
    const alert = page.locator("aside [role=alert]");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("labels.yaml");
    await expect(alert).toContainText(/could not be parsed/i);

    // "Offers the next action (fix the YAML, or run `loctt doctor`)."
    await expect(alert).toContainText("loctt doctor");

    // The parse position is available, but not in the headline — it is
    // machinery, and ERR-16 keeps machinery out of the first sentence.
    await alert.getByRole("button", { name: /Show details/ }).click();
    await expect(alert).toContainText(/line \d+/);

    // The M1 gate's F4 third strand: the filter presented a broken
    // config as an empty one, which is ERR-1's conflation one layer
    // down. An absence and a failure must not look alike.
    // Label is not in the default visible facet set (K97/A210), so it
    // has to be ADDED before its pill exists — without this, the
    // `name: "Label"` match landed on the sidebar's "Labels" section
    // toggle and merely collapsed it.
    await page.getByTestId("add-filter").click();
    await page.getByTestId("add-filter-labels").click();
    await page.getByRole("button", { name: "Filter Label", exact: true }).click();
    // K106 step 2: the facet panel is portalled to `document.body`, so
    // it is read from `page` rather than from the toolbar's subtree.
    const menu = page.getByRole("menu");
    await expect(menu).toContainText(/could not be loaded/i);
    await expect(menu).not.toContainText("No options");

    // "Features not dependent on that file continue working."
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });
});

test.describe("SHL — narrow viewports", () => {
  /**
   * @verifies SHL-5, XS-19
   *
   * Not a case's own scenario — the M1 gate raised it as F5, and its
   * PC-13 records that no case pins a sub-900px layout. What *is*
   * pinned is that the table scrolls in its own container rather than
   * panning the page (LST-19's neighbours assert the same shape), and
   * a header that overflows breaks that for the whole app: at 375px
   * its contents ran to x=561, so the theme toggle and avatar were
   * unreachable without scrolling the app sideways.
   */
  test("the page does not pan sideways at 375px, and every header control is reachable", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Alpha task")).toBeVisible();

    // The page itself must not scroll horizontally.
    const doc = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(
      doc.scrollWidth,
      `page scrollWidth ${String(doc.scrollWidth)} exceeds ${String(doc.clientWidth)}`,
    ).toBeLessThanOrEqual(doc.clientWidth);

    // Every header control is inside the viewport, not merely present
    // in the DOM — the failure mode was reachable-only-by-panning.
    for (const label of ["Theme", "New task", "User menu", "Toggle sidebar"]) {
      const box = await page.getByLabel(label).first().boundingBox();
      expect(box, `${label} has no box`).not.toBeNull();
      expect(
        Math.round(box?.x ?? 0) + Math.round(box?.width ?? 0),
        `${label} extends past the viewport`,
      ).toBeLessThanOrEqual(doc.clientWidth);
    }

    // The rows are still fully readable: the fix is a header that fits,
    // not content that was clipped. Below `sm` the table is replaced by
    // a stacked card per task (`abceb888`), so there is no table to
    // scroll — the content reflows instead, which is the stronger form
    // of the same requirement and is already implied by the
    // no-horizontal-pan assertion above.
    await expect(page.getByTestId("task-cards")).toBeVisible();
    await expect(page.locator('[data-testid^="task-card-"]').first()).toBeVisible();
  });

  test("the full header returns at desktop width", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Alpha task")).toBeVisible();

    // What narrow drops, wide keeps — the labels are hidden by a
    // breakpoint, not deleted.
    // The wordmark is "LocTT" since the brand pass (`d8268292`); it is
    // `hidden sm:inline`, so this asserts exactly what the case means —
    // the label is dropped by a breakpoint, not deleted.
    await expect(page.getByText("LocTT", { exact: true })).toBeVisible();
    await expect(page.getByLabel("New task")).toContainText("New task");
    await expect(page.getByLabel("Search tasks")).toBeVisible();
  });
});

test.describe("SHL — parameterised route stubs", () => {
  /**
   * @verifies SHL-16
   *
   * The M1 gate reported (F8) `/tasks/T1` rendering the literal
   * `Route stub: /tasks/$key`. It does not reproduce — the route
   * interpolates, and the gate measured a build that predated the fix.
   *
   * Pinned anyway. Printing a raw route pattern reads as a templating
   * bug rather than an unbuilt view, and the stub is going to sit here
   * until M2.1 replaces it.
   */
  test("a parameterised stub names the key, not the route pattern", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Alpha task" }]);

    await page.goto(`${tracker.baseURL}/tasks/${String(key)}`);
    const main = page.locator("main");
    await expect(main).toContainText(String(key));
    await expect(main).not.toContainText("$key");

    // The shell is up, so the stub is a page rather than a dead end.
    await expect(page.getByLabel("Toggle sidebar")).toBeVisible();

    // Same for the other parameterised route.
    await page.goto(`${tracker.baseURL}/sprints/S-1`);
    await expect(page.locator("main")).not.toContainText("$key");
  });
});

test.describe("LST — an unrecognised sort key", () => {
  /**
   * @verifies LST-29
   *
   * The M1 gate raised F6 asking for a 400 here, which contradicts
   * this case: LST-29 requires the list to render "rather than an
   * empty table or an error page". The first two bullets already
   * passed. The third did not — `sort=nonexistent_field` stayed in
   * the address bar as though it had applied, so copying that URL
   * propagated a sort that was never in effect.
   */
  test("LST-29: an unknown sort key is dropped from the URL, not obeyed", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }, { title: "Beta task" }]);

    await page.goto(`${tracker.baseURL}/list?sort=nonexistent_field&dir=asc`);

    // "The list renders with the default sort rather than an empty
    // table or an error page."
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByRole("alert")).toHaveCount(0);

    // "It does not silently persist as though it were applied."
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sort"), { timeout: 5_000 })
      .toBeNull();
    expect(new URL(page.url()).searchParams.get("dir")).toBeNull();

    // "No sort indicator is shown on a column that isn't actually
    // sorting, which would misreport the order."
    const claimed = await page.evaluate(() =>
      [...document.querySelectorAll("th")]
        .map(h => h.getAttribute("aria-sort"))
        .filter(v => v !== null && v !== "none"),
    );
    expect(claimed).toEqual([]);
  });

  test("LST-29: a sort key the list can honour is left alone", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }, { title: "Beta task" }]);

    await page.goto(`${tracker.baseURL}/list?sort=title&dir=desc`);
    await expect(page.locator("tbody tr")).toHaveCount(2);

    // Guards the fix from overreaching: dropping *every* sort would
    // pass the test above and break sorting entirely.
    await page.waitForTimeout(1_000);
    const url = new URL(page.url());
    expect(url.searchParams.get("sort")).toBe("title");
    expect(url.searchParams.get("dir")).toBe("desc");
  });

  /**
   * @verifies LST-29
   *
   * The regression this test exists for: the first cut of the fix used
   * the *client's* nine visible columns as the authority, so every
   * sort the server honours but the table does not show — `created_at`,
   * `reporter`, `start_date`, and any custom `fields.<key>` — was
   * stripped from the URL and its ordering silently lost. Testing only
   * `title` (as the spec above does) leaves that green.
   *
   * The predicate is now the server's own, shared through contracts.
   */
  for (const field of ["created_at", "reporter", "start_date"]) {
    test(`LST-29: ?sort=${field} is honoured by the server and kept in the URL`, async ({
      page,
      tracker,
    }) => {
      await tracker.seed([{ title: "Alpha task" }, { title: "Beta task" }]);

      // Bracket the claim: the server really does sort by this field,
      // so keeping it in the URL is honest rather than merely lenient.
      const res = await page.request.get(
        `${tracker.baseURL}/api/tasks?sort=${field}&dir=desc`,
      );
      expect(res.status(), `${field} should be a sortable field`).toBe(200);

      await page.goto(`${tracker.baseURL}/list?sort=${field}&dir=desc`);
      await expect(page.locator("tbody tr")).toHaveCount(2);

      await page.waitForTimeout(1_000);
      const kept = new URL(page.url());
      expect(kept.searchParams.get("sort")).toBe(field);
      expect(kept.searchParams.get("dir")).toBe("desc");
    });
  }
});

test.describe("LST-55 — the sidebar does not carry the ambient sort", () => {
  /**
   * @verifies LST-55
   *
   * UX-3: a sidebar link is a jump to a destination, not a re-sort of the
   * current table. With the list sorted ascending, clicking a saved
   * filter used to open it Low-first — the destination inherited a sort
   * it never asked for. The strip happens in the sidebar's own href
   * computation, so following any sidebar filter/nav link lands the URL
   * without `sort`/`dir` while the filter itself still applies.
   */
  test("LST-55: clicking a built-in filter drops sort and dir from the URL", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }, { title: "Beta task" }]);

    // Start on a validly-sorted list (LST-29 keeps this sort in the URL,
    // so any drop below is the sidebar's doing, not the list's).
    await page.goto(`${tracker.baseURL}/list?sort=title&dir=asc`);
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sort"))
      .toBe("title");

    // Follow a resolvable built-in filter from the sidebar. The link's
    // accessible name includes its count badge, so match by substring.
    await page.locator("aside").getByRole("link", { name: /Overdue/ }).click();

    // The ambient sort is gone; the destination renders in its natural
    // order. The filter itself still took effect (we left the sorted
    // list behind).
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sort"), { timeout: 5_000 })
      .toBeNull();
    expect(new URL(page.url()).searchParams.get("dir")).toBeNull();
  });
});

test.describe("SHL — the shell under a failing recovery attempt", () => {
  /**
   * @verifies SHL-41, ERR-1
   *
   * The fourth bug in `AppBootstrap`, and the one a Fable review
   * caught after the gate had passed everything else: query-core's
   * `fetchState` resets a data-less query to `status: "pending",
   * error: null` on **every** fetch. So each recovery attempt against
   * a still-dead server walks `["info"]` back through "pending", and
   * any branch reading live status acted on it.
   *
   * Measured before the fix: pressing "Try now" on the unreachable
   * banner destroyed the shell holding the banner, and a later cut
   * replaced it with "No tracker here yet" — telling a user with a
   * perfectly good tracker that they had none.
   *
   * SHL-41 wants the failure state *persistent*. A state that
   * dismantles itself every time the user asks it to retry is not.
   */
  test("retrying while the server is still down does not dismantle the shell", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Alpha task")).toBeVisible();

    // The server goes away and stays away.
    await page.route(/\/api\//, route => { void route.abort("connectionrefused"); });
    await page.reload();

    const banner = page.locator("[data-server-unreachable]");
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // The user does the one thing the banner invites.
    await banner.getByRole("button").click();

    // Sample hard across the whole failed attempt: a flash is still a
    // failure, and a single post-hoc assertion would miss it.
    let sawSpinner = false;
    let lostShell = false;
    let sawNoTracker = false;
    for (let i = 0; i < 40; i += 1) {
      const state = await page.evaluate(() => ({
        shell: document.querySelector('[aria-label="Toggle sidebar"]') !== null,
        text: document.body.innerText.trim(),
      }));
      if (state.text.startsWith("Loading")) sawSpinner = true;
      if (!state.shell) lostShell = true;
      if (/No tracker here/.test(state.text)) sawNoTracker = true;
      await page.waitForTimeout(60);
    }

    expect(sawSpinner, "the spinner reappeared during a retry").toBe(false);
    expect(lostShell, "the shell unmounted during a retry").toBe(false);
    expect(
      sawNoTracker,
      "the app claimed there was no tracker while one was on disk",
    ).toBe(false);

    // And the banner is still there afterwards, still offering retry.
    await expect(banner).toBeVisible();
  });
});

test.describe("SHL — the sidebar during a cold outage", () => {
  /**
   * @verifies SHL-39
   *
   * A cold load against a dead server used to spend a full second
   * telling the user their tracker was empty — "No projects yet",
   * "No labels yet", "No milestones yet" — while the unreachable
   * banner sat above saying the server was down. Two contradictory
   * claims on one screen, and the wrong one was about their data.
   *
   * Measured before the fix, phases kept apart: the empty text is on
   * screen from **1089ms to 2098ms**. The query has not failed yet
   * (the retry policy's one retry is still to come) so no
   * error-keyed guard can catch it — it has not *settled* at all.
   *
   * A ~1s window is wide enough for a 40ms poll to catch reliably,
   * which is why this is a real UI test where SHL-41's could not be
   * (see known-gaps.md).
   */
  test("SHL-39: a sidebar with no answer yet does not claim the tracker is empty", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.route(/\/api\//, route => { void route.abort("connectionrefused"); });

    // Poll from the first paint. The window is between navigation and
    // the query settling, so it has to be watched, not sampled once.
    let sawEmptyClaim = "";
    const poll = setInterval(() => {
      void page.locator("body").innerText().then(text => {
        const hit = /No projects yet|No labels yet|No milestones yet|No active sprints/
          .exec(text);
        if (hit !== null && sawEmptyClaim === "") sawEmptyClaim = hit[0];
      }).catch(() => undefined);
    }, 40);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("[data-server-unreachable]")).toBeVisible({
      timeout: 20_000,
    });
    // Past the retry, so the whole never-settled window has elapsed.
    await page.waitForTimeout(3_000);
    clearInterval(poll);

    expect(
      sawEmptyClaim,
      `the sidebar claimed "${sawEmptyClaim}" while the server was unreachable`,
    ).toBe("");
  });
});

test.describe("ERR — recovery when the server comes back", () => {
  /**
   * @verifies ERR-2
   *
   * The M1 gate's F2 claimed an errored query never runs its 5-second
   * recovery poll, so recovery waits on the 60-second staleness
   * interval. **It does not reproduce.** The poll runs, and the poll
   * is what recovers the app — traced to query-core's
   * `#updateRefetchInterval` timer, one frame under the `fetch` that
   * heals `["info"]`. The gate's mechanism claim was wrong for the
   * same reason: `onQueryUpdate()` calls `#updateTimers()`, so the
   * transition into `error` re-arms the interval rather than
   * cancelling it.
   *
   * **The quiesce below is the whole test.** Without it this passes
   * with the poll disabled entirely, and an earlier version shipped
   * exactly that way. When the server returns while retry backoff is
   * still sleeping, those pending retries wake and succeed — traced
   * to the retryer's own `sleep(delay).then(run)`, not to any
   * recovery policy. Thirteen requests inside 790ms, none of them
   * evidence of anything. Waiting past the backoff is what makes the
   * next request attributable to recovery.
   *
   * Mutation-checked both ways, against the built app:
   *
   * - poll disabled, quiesce 8s → **fails** (banner still up at 20s)
   * - poll disabled, no quiesce → passes, on backoff alone
   * - poll restored, quiesce 8s → passes, 6 requests, first one
   *   dispatched from the interval timer
   *
   * Pinned because a refutation nobody can re-run is just an
   * assertion, and this one contradicts a gate report.
   */
  test("ERR-2: the UI recovers on its own, without a reload or a click", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }, { title: "Beta task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr")).toHaveCount(2);

    // The server "goes away" behind a flag the handler reads on every
    // request. `page.unroute` is deliberately not used: it releases
    // requests that were already queued, so the page recovers from
    // that release rather than from any poll — a first cut of this
    // test passed with *every* recovery path disabled.
    let down = true;
    await page.route(/\/api\//, route => {
      if (down) void route.abort("connectionrefused");
      else void route.continue();
    });
    await page.reload();
    const banner = page.locator("[data-server-unreachable]");
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // Let every retry finish sleeping. Retries use a capped
    // exponential backoff and there is one attempt per query, so this
    // is far longer than needed — the cost is eight seconds, and what
    // it buys is that the next request cannot be a retry that was
    // already in flight when the server returned.
    await page.waitForTimeout(8_000);

    // The server comes back. Nothing is clicked, nothing is reloaded,
    // no queued request is released, and nothing is still retrying —
    // the app has to ask again entirely on its own.
    down = false;

    // Twenty seconds is four poll intervals and well inside the 60s
    // staleness window, so only the recovery poll can close this.
    await expect(banner).toBeHidden({ timeout: 20_000 });
    await expect(page.locator("tbody tr")).toHaveCount(2);
  });
});

/**
 * A workflow with ten statuses. Everything else is the minimum a valid
 * `workflow.yaml` needs — the case is only about status count.
 */
const TEN_STATUS_WORKFLOW = `key:
  prefix: "T-"

statuses:
  - key: intake
    label: Intake
    category: pending
    default: true
  - key: triage
    label: Triage
    category: pending
  - key: specced
    label: Specced
    category: pending
  - key: ready
    label: Ready
    category: pending
  - key: building
    label: Building
    category: active
  - key: in_review
    label: In review
    category: active
  - key: verifying
    label: Verifying
    category: active
  - key: staged
    label: Staged
    category: active
  - key: shipped
    label: Shipped
    category: completed
  - key: abandoned
    label: Abandoned
    category: discarded

priorities:
  - key: p0
    label: Now
    value: 3
  - key: p1
    label: Soon
    value: 2
  - key: p2
    label: Later
    value: 1

task_types:
  - key: chore
    label: Chore
  - key: defect
    label: Defect

relationships:
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
    graph: acyclic

custom_fields: []
`;

test.describe("SHL-33 — an unusual status count does not distort the shell", () => {
  // @verifies SHL-33
  /**
   * Transcribed from flow-app-shell.md SHL-33.
   *
   * The claim is negative — a ten-status workflow must leave the
   * sidebar and header exactly as a normal one, because status is a
   * main-pane concern with no sidebar group of its own. Negative
   * assertions need a positive control, so this measures the shell
   * with the default workflow first and then again with ten statuses,
   * and asserts they match: same sidebar group set, same sidebar
   * width, and no horizontal document overflow either time. Without
   * the baseline, "no overflow" could pass on a build that never lays
   * the shell out at all.
   *
   * Mutation shown to fail: give the sidebar a per-status group (e.g.
   * render one nav row per configured status inside `<aside>`) and the
   * `groupLabels` equality goes red — the ten-status shell grows four
   * extra rows the baseline never had. A width-unbounded variant
   * (drop the `w-60` cap) trips the `asideWidth` / overflow checks.
   */
  test("SHL-33: ten statuses leave the sidebar and header identical to the default, with no overflow", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // Which of the sidebar's fixed group headers are present. Status
    // has no group here, so this set must not grow with status count.
    // (The labels are plain styled divs, not ARIA headings, so they
    // are matched by their exact text within the sidebar.)
    // "Saved filters" was already stale before K125 (the sidebar has
    // said "Views" there since K102); K125 (amended, Ken 2026-09-24)
    // split that one section into two — "Filters" (the six built-ins)
    // and "Saved views" (saved views only) — so both now appear here.
    const KNOWN_GROUPS = [
      "Projects",
      "Filters",
      "Saved views",
      "Milestones",
      "Sprints",
      "Labels",
      "Recently viewed",
    ] as const;
    const groupLabels = async (): Promise<string[]> => {
      const present: string[] = [];
      for (const label of KNOWN_GROUPS) {
        if (await page.locator("aside").getByText(label, { exact: true }).count() > 0) {
          present.push(label);
        }
      }
      return present;
    };
    const asideWidth = async (): Promise<number> =>
      (await page.locator("aside").boundingBox())?.width ?? -1;
    const horizontallyOverflows = async (): Promise<boolean> =>
      page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const headerVisible = () => expect(page.getByTestId("header-new-task")).toBeVisible();

    // --- Baseline: the default single-status-category workflow.
    await page.goto(`${tracker.baseURL}/board`);
    await headerVisible();
    const baseGroups = await groupLabels();
    const baseWidth = await asideWidth();
    expect(baseGroups.length).toBeGreaterThan(0);
    expect(baseWidth).toBeGreaterThan(0);
    expect(await horizontallyOverflows()).toBe(false);

    // --- Ten statuses. The board's own columns are a main-pane
    // concern and may scroll inside their own container; the shell
    // around them must not change.
    await writeFile(
      path.join(tracker.root, ".loctt", "config", "workflow.yaml"),
      TEN_STATUS_WORKFLOW,
      "utf8",
    );
    await page.goto(`${tracker.baseURL}/board`);
    await headerVisible();

    // Confirm the ten statuses actually took effect in the main pane,
    // so this is not vacuously "nothing rendered, nothing overflowed".
    await expect(page.getByRole("region", { name: "Verifying" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Staged" })).toBeVisible();

    // The shell is unchanged: same groups, same width…
    expect(await groupLabels()).toEqual(baseGroups);
    expect(await asideWidth()).toBe(baseWidth);
    // …and the document itself does not scroll sideways (a header that
    // grew unbounded would push it past the viewport).
    expect(await horizontallyOverflows()).toBe(false);

    // The heart of "status count is a main-pane concern": not one of
    // the ten statuses leaks into the sidebar as its own entry. This
    // is the assertion a build that grew a per-status sidebar group
    // would fail — the width/overflow checks alone would not catch it,
    // because a scrolling `w-60` column absorbs extra rows without
    // changing width or overflowing.
    const aside = page.locator("aside");
    for (const status of ["Intake", "Triage", "Ready", "Verifying", "Staged", "Shipped"]) {
      await expect(aside.getByText(status, { exact: true })).toHaveCount(0);
    }

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});

test.describe("SHL — brand spinner geometry", () => {
  /**
   * @verifies SHL-47
   *
   * Approach: injected element against the app's real stylesheet, not a
   * rendered `LoadingState`/`Button` in-situ. A real spinner's animation
   * runs continuously and non-deterministically relative to when the
   * page loaded, so measuring its bounding box mid-flight would be
   * flaky regardless of the bug. The onboarding wizard's submit button
   * (`flow-onboarding.spec.ts`'s ONB busy-state test) is the one place a
   * real spinner appears deterministically, but it only exercises one
   * fixed size (`Button`'s `sm` token, 20px) — this case needs 21/24/64
   * specifically, matching the bug report's "app's 21-24px sizes" plus
   * the source's native 64px.
   *
   * So: navigate to a real page (pulling in the app's actual built
   * `index.css`, with its real `.loctt-spin` rule — nothing here
   * redefines the CSS under test), then inject `<svg class="loctt-spin">`
   * elements with the component's exact viewBox at each size. Freezing
   * the animation with `animation-play-state: paused` plus a fixed
   * negative `animation-delay` lands on a deterministic, arbitrary
   * mid-cycle frame (not 0%/100%, where translate/rotate are both
   * identity and would pass whether or not the pivot bug were present).
   */
  test("SHL-47: the loading mark spins about its own centre at every rendered size", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);

    const SIZES = [21, 24, 64] as const;
    const VIEW_BOX = "-19.255 -19.255 102.510 102.510";

    const centres = await page.evaluate(
      ({ sizes, viewBox }) => {
        const results: Record<number, { x: number; y: number; unrotatedX: number; unrotatedY: number }> = {};
        for (const size of sizes) {
          const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          svg.setAttribute("class", "loctt-spin");
          svg.setAttribute("viewBox", viewBox);
          svg.setAttribute("width", String(size));
          svg.setAttribute("height", String(size));
          // Frozen at an arbitrary mid-cycle point, not 0%/100% where the
          // keyframes are identity transforms and would mask the bug.
          svg.style.animationPlayState = "paused";
          svg.style.animationDelay = "-800ms";
          svg.style.position = "fixed";
          svg.style.left = "0px";
          svg.style.top = "0px";
          document.body.appendChild(svg);
          const rotated = svg.getBoundingClientRect();

          // The same element with the animation removed entirely: the
          // unrotated reference box for this size, to compare against.
          svg.style.animation = "none";
          svg.style.transform = "none";
          const unrotated = svg.getBoundingClientRect();

          document.body.removeChild(svg);
          results[size] = {
            x: rotated.x + rotated.width / 2,
            y: rotated.y + rotated.height / 2,
            unrotatedX: unrotated.x + unrotated.width / 2,
            unrotatedY: unrotated.y + unrotated.height / 2,
          };
        }
        return results;
      },
      { sizes: SIZES, viewBox: VIEW_BOX },
    );

    for (const size of SIZES) {
      const c = centres[size];
      if (c === undefined) throw new Error(`no measurement for size ${String(size)}px`);
      expect(
        Math.abs(c.x - c.unrotatedX),
        `size ${String(size)}px: bounding-box centre drifted horizontally by ${String(Math.abs(c.x - c.unrotatedX))}px while spinning`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(c.y - c.unrotatedY),
        `size ${String(size)}px: bounding-box centre drifted vertically by ${String(Math.abs(c.y - c.unrotatedY))}px while spinning`,
      ).toBeLessThanOrEqual(0.5);
    }
  });
});
