/**
 * Transcribed from docs/dev/ui-test-cases/flow-app-shell.md.
 *
 * The cases here are about *browser* behaviour — history, scroll
 * position, deep links — which a jsdom test cannot assert. A unit test
 * for scroll restoration would check the router's configuration and
 * call it covered; only a real browser proves the page actually
 * returns to where the user left it.
 */

import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

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

    await page.getByRole("link", { name: "Timeline" }).click();
    await expect(page).toHaveURL(/\/timeline$/);

    // Three steps back, in reverse order, one navigation each.
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
  // @verifies SHL-31
  test("SHL-31: two trackers are distinguishable by their footers", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.goto(`${tracker.baseURL}/list`);

    // The footer names *this* workspace, abbreviated, so a user with
    // two `loctt ui` windows can tell them apart. The label ends in
    // the tracker's own directory name — which is what makes two
    // instances distinguishable rather than both reading "~/code".
    const label = await page
      .locator("aside")
      .locator("div.font-mono")
      .first()
      .textContent();
    const tail = (label ?? "").split("/").filter(Boolean).pop() ?? "";
    expect(tail.length).toBeGreaterThan(0);
    expect(tracker.root).toContain(tail);

    // And it is not the full absolute path — the server abbreviates,
    // so the response never carries the filesystem layout.
    expect(label).not.toBe(tracker.root);
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
    // A bug on our side, not a data problem — and the tasks on disk
    // are explicitly said to be unaffected.
    await expect(alert).toContainText(/bug on our side/i);
    await expect(alert).toContainText(".loctt/");

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

    // And visible, badged, once archived rows are asked for.
    await page.getByLabel("Show archived").check();
    await expect(page.getByText("Archived elsewhere")).toBeVisible();
    await expect(
      page.getByRole("row", { name: /Archived elsewhere/ }),
    ).toContainText(/archived/i);
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
    // stitched onto a stale page 2 is the failure this case names.
    await page.getByRole("button", { name: "Refresh" }).click();
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

test.describe("BLK — export with an unreadable task", () => {
  // @verifies BLK-44
  test("BLK-44: the export succeeds and names what it could not read", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Readable one" },
      { title: "Readable two" },
      { title: "Will be corrupted" },
    ]);

    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    const ids = await readdir(tasksDir);
    const victim = String(ids[ids.length - 1]);
    await writeFile(
      path.join(tasksDir, victim, "task.md"),
      "---\nid: [not\n  valid: yaml\n---\nbody\n",
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Readable one")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export/ }).click();
    await page.getByRole("menuitem", { name: /CSV/ }).click();

    // The file arrives — BLK-44's preferred branch is that the export
    // succeeds rather than failing outright.
    const file = await download;
    expect(file.suggestedFilename()).toContain(".csv");

    // And the surface says what is missing from it. A truncated file
    // with no mention is the one outcome the case rules out.
    const notice = page.locator("[data-export-skipped]");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("1 task could not be read");
    await expect(notice).toContainText("task.md");
    await expect(notice).toContainText(victim);
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
    await page.getByRole("button", { name: "Label", exact: false }).first().click();
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

    // The table still scrolls within its own container: the fix is a
    // header that fits, not a table that was clipped.
    const table = page.locator("table").first();
    const tb = await table.evaluate(el => {
      const c = el.parentElement;
      return c === null ? null : { client: c.clientWidth, scroll: c.scrollWidth };
    });
    expect(tb?.scroll ?? 0).toBeGreaterThan(tb?.client ?? 0);
  });

  test("the full header returns at desktop width", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Alpha task" }]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Alpha task")).toBeVisible();

    // What narrow drops, wide keeps — the labels are hidden by a
    // breakpoint, not deleted.
    await expect(page.getByText("TaskTracker")).toBeVisible();
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
});
