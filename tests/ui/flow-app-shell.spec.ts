/**
 * Transcribed from docs/dev/ui-test-cases/flow-app-shell.md.
 *
 * The cases here are about *browser* behaviour — history, scroll
 * position, deep links — which a jsdom test cannot assert. A unit test
 * for scroll restoration would check the router's configuration and
 * call it covered; only a real browser proves the page actually
 * returns to where the user left it.
 */

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
