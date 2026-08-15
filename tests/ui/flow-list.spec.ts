/**
 * Transcribed from docs/dev/ui-test-cases/flow-list.md.
 *
 * One `test` per case, named by case ID, with a `@verifies` tag so the
 * coverage gate can see it. Assertions follow the case's bullets in order
 * — the prose is the specification, and a spec that asserts something the
 * case does not claim has drifted from it.
 */

import { expect, test } from "./fixtures/tracker.ts";

test.describe("LST — list view", () => {
  // @verifies LST-1
  test("LST-1: / redirects to /list and lands on a populated table", async ({ page, tracker }) => {
    await tracker.seed([{ title: "First task" }, { title: "Second task" }]);

    await page.goto(`${tracker.baseURL}/`);

    // The address bar reads /list, with no search params appended: a
    // bookmarked landing URL must give the default view, not one
    // session's filters frozen in.
    await expect(page).toHaveURL(`${tracker.baseURL}/list`);

    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await expect(rows).toHaveCount(2);

    // The redirect is a replace, not a push — Back must leave the app
    // rather than bouncing between / and /list.
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(`^${tracker.baseURL}/list`));
  });

  // @verifies LST-2
  test("LST-2: the table renders all ten columns with configured vocabulary", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "First task", fields: { status: "in_progress", priority: "high" } },
      { title: "Undated task" },
    ]);

    await page.goto(`${tracker.baseURL}/list`);

    const headers = page.getByRole("columnheader");
    await expect(headers).toHaveText([
      /Key/,
      /Project/,
      /Title/,
      /Status/,
      /Priority/,
      /Type/,
      /Assignee/,
      /Labels/,
      /Due/,
      /Updated/,
    ]);

    const row = page.getByRole("row").filter({ hasText: "First task" });

    // Enum cells show the workflow.yaml label, never the stored key.
    await expect(row).toContainText("In progress");
    await expect(row).not.toContainText("in_progress");
    await expect(row).toContainText("High");

    // The key column (first cell) shows the user-facing key, not the ULID.
    // Asserted on the cell rather than the row: adjacent cell text
    // concatenates in the row's accessible text, which would let a
    // neighbouring column satisfy a row-level match.
    await expect(row.getByRole("cell").first()).toHaveText(/^[A-Z][A-Z0-9]*-\d+$/);
    // The ULID appears nowhere in the row.
    await expect(row).not.toContainText(/[0-9A-HJKMNP-TV-Z]{26}/);

    // A task with no due_date renders an empty cell (the placeholder em
    // dash) — not "Invalid Date", and not today's date. Due is the 9th
    // of the ten columns.
    const undated = page.getByRole("row").filter({ hasText: "Undated task" });
    const dueCell = undated.getByRole("cell").nth(8);
    await expect(dueCell).toHaveText("—");
    await expect(undated).not.toContainText("Invalid Date");
  });
});

test.describe("LST — filter URL format", () => {
  // @verifies LST-9
  test("LST-9: a filter writes stored keys, comma separated", async ({ page, tracker }) => {
    await tracker.seed([
      { title: "Doing it", fields: { status: "in_progress" } },
      { title: "Finished", fields: { status: "done" } },
      { title: "Waiting" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);

    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menuitemcheckbox", { name: /In progress/ }).click();
    await page.getByRole("menuitemcheckbox", { name: "Done" }).click();

    // Stored keys, comma separated — not a JSON array, and not labels.
    await expect(page).toHaveURL(/[?&]status=in_progress,done(&|$)/);

    // And the filter actually narrows the set.
    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await expect(rows).toHaveCount(2);
  });

  // @verifies LST-34
  test("LST-34: duplicates in a CSV param are de-duplicated", async ({ page, tracker }) => {
    await tracker.seed([
      { title: "Done one", fields: { status: "done" } },
      { title: "Doing it", fields: { status: "in_progress" } },
      { title: "Waiting" },
    ]);

    await page.goto(`${tracker.baseURL}/list?status=done,done,in_progress`);

    // The chip row shows two statuses, not three. This is the client's
    // own job: the server de-duplicates naturally (`status in (done,
    // done, ...)` matches each task once), so a row-count assertion
    // alone would pass even with the duplicate still in the URL state.
    await expect(page.getByRole("button", { name: /^Remove Status/ })).toHaveCount(2);

    // Each matching task appears once, not twice.
    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await expect(rows).toHaveCount(2);

    // Interacting with the dropdown must not re-append the duplicate.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menuitemcheckbox", { name: /Backlog/ }).click();
    await expect(page).not.toHaveURL(/done,done/);
  });
});

test.describe("LST — pagination", () => {
  /**
   * 60 tasks against a page size of 50: enough for exactly two pages,
   * so exhaustion is reachable without seeding 128 through the CLI.
   */
  const SIXTY = Array.from({ length: 60 }, (_, i) => ({ title: `Task ${i + 1}` }));

  // @verifies LST-13
  test("LST-13: the count is honest and Load more appends in place", async ({ page, tracker }) => {
    await tracker.seed(SIXTY);
    await page.goto(`${tracker.baseURL}/list`);

    // The total matches the filtered set, and only a page is rendered.
    await expect(page.getByText("Showing 1–50 of 60")).toBeVisible();
    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await expect(rows).toHaveCount(50);

    await page.getByRole("button", { name: "Load more" }).click();

    // Appended, not replaced: the label advances and page 1's first row
    // is still on screen.
    await expect(page.getByText("Showing 1–60 of 60")).toBeVisible();
    await expect(rows).toHaveCount(60);
    await expect(page.getByRole("cell", { name: "Task 1", exact: true })).toBeVisible();

    // On genuine exhaustion the control goes away — the signal LST-49
    // requires it *not* to give on failure.
    await expect(page.getByRole("button", { name: "Load more" })).toHaveCount(0);
  });

  // @verifies LST-13
  test("LST-13: applying a filter recomputes the total rather than keeping the old one", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      ...SIXTY,
      { title: "Critical one", fields: { priority: "critical" } },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–50 of 61")).toBeVisible();

    // Load a second page *first*. A full reload would leave one page in
    // the cache, where reading the total off the wrong page is
    // indistinguishable from reading it off the right one — the bug
    // only shows once more than one page is held.
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByText("Showing 1–61 of 61")).toBeVisible();

    // Now filter in-place, without a reload. The total must recompute
    // against the new result set rather than keep claiming 61.
    await page.getByRole("button", { name: "Filter Priority" }).click();
    await page.getByRole("menuitemcheckbox", { name: /Critical/ }).click();

    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
  });

  // @verifies LST-17
  test("LST-17: a loaded second page is reproducible from the URL", async ({ page, tracker }) => {
    await tracker.seed(SIXTY);
    await page.goto(`${tracker.baseURL}/list`);
    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByText("Showing 1–60 of 60")).toBeVisible();

    // The URL carries how far the user paged...
    await expect(page).toHaveURL(/page=2/);
    const url = page.url();

    // ...and a fresh load of it reproduces the same rows, compared by
    // key rather than by count — two filters can share a count.
    const before = await page.getByRole("cell", { name: /^Task \d+$/ }).allTextContents();
    await page.goto(url);
    await expect(page.getByText("Showing 1–60 of 60")).toBeVisible();
    const after = await page.getByRole("cell", { name: /^Task \d+$/ }).allTextContents();
    expect(after).toEqual(before);
  });

  // @verifies LST-49
  test("LST-49: a failed Load more does not look like the end of the list", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(SIXTY);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–50 of 60")).toBeVisible();

    // Fail only the second page. Routing at the network layer (rather
    // than patching window.fetch from a console) is what makes this
    // reach the app's own request.
    await page.route(/\/api\/tasks\?.*offset=(?!0\b)\d+/, route => route.abort("failed"));

    await page.getByRole("button", { name: "Load more" }).click();

    // The error names the failure...
    await expect(page.getByRole("alert")).toBeVisible();
    // ...the count does not advance to imply rows arrived...
    await expect(page.getByText("Showing 1–50 of 60")).toBeVisible();
    // ...already-loaded rows survive...
    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await expect(rows).toHaveCount(50);
    // ...and the control stays, offering retry rather than vanishing as
    // it does on genuine exhaustion.
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  // @verifies LST-35
  test("LST-35: filtering mid-load does not mix the two result sets", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      ...SIXTY,
      { title: "Critical one", fields: { priority: "critical" } },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–50 of 61")).toBeVisible();

    // Hold page 2 open, then filter while it is still in flight.
    let releasePageTwo: (() => void) | undefined;
    const held = new Promise<void>(resolve => { releasePageTwo = resolve; });
    await page.route(/\/api\/tasks\?.*offset=(?!0\b)\d+/, async route => {
      await held;
      await route.continue();
    });

    await page.getByRole("button", { name: "Load more" }).click();
    await page.getByRole("button", { name: "Filter Priority" }).click();
    await page.getByRole("menuitemcheckbox", { name: /Critical/ }).click();

    // Let the superseded page-2 response land now.
    releasePageTwo?.();

    // Only the filtered task, and the total is the filtered one — rows
    // from the stale response never append.
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await expect(rows).toHaveCount(1);
    await expect(page.getByRole("cell", { name: "Critical one" })).toBeVisible();
  });

  // @verifies LST-30
  test("LST-30: malformed pagination params are clamped, not obeyed", async ({ page, tracker }) => {
    await tracker.seed(SIXTY);

    // Each of these threw in the route's validateSearch before the
    // schema was fixed, taking down /list rather than just pagination.
    for (const bad of ["?page=0", "?page=-3", "?limit=abc", "?limit=99999"]) {
      await page.goto(`${tracker.baseURL}/list${bad}`);
      // The route renders at all rather than erroring out...
      await expect(page.getByRole("table")).toBeVisible();

      // ...and the footer agrees with what is actually displayed. Wait
      // for the footer before counting: reading row count mid-load
      // compares the label against a table that has not rendered yet.
      const footer = page.getByText(/^Showing 1–\d+ of 60$/);
      await expect(footer).toBeVisible();
      const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
      const count = await rows.count();
      await expect(footer).toHaveText(`Showing 1–${String(count)} of 60`);
    }
  });
});
