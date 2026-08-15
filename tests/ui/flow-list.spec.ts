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

    // The ten *data* columns the case names, in order. Sliced past the
    // selection column: LST-2 lists the columns the table shows for a
    // task, and BLK-3 requires a header select-all checkbox alongside
    // them. Asserting on every columnheader made this test forbid an
    // affordance LST-2 says nothing about.
    const allHeaders = page.getByRole("columnheader");
    // Eleven cells: the ten data columns plus the select-all checkbox
    // BLK-3 requires. The slice below asserts the ten by name.
    await expect(allHeaders).toHaveCount(11);
    const headers = page.locator("thead th").nth(0).locator("xpath=following-sibling::th");
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
    // nth(1), not first(): cell 0 is the selection checkbox (BLK-1).
    await expect(row.getByRole("cell").nth(1)).toHaveText(/^[A-Z][A-Z0-9]*-\d+$/);
    // The ULID appears nowhere in the row.
    await expect(row).not.toContainText(/[0-9A-HJKMNP-TV-Z]{26}/);

    // A task with no due_date renders an empty cell (the placeholder em
    // dash) — not "Invalid Date", and not today's date. Due is the 9th
    // of the ten columns.
    const undated = page.getByRole("row").filter({ hasText: "Undated task" });
    // Due is the 9th data column, shifted one by the selection cell.
    const dueCell = undated.getByRole("cell").nth(9);
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

test.describe("BLK — selection", () => {
  const THREE = [
    { title: "Alpha", fields: { status: "in_progress" } },
    { title: "Beta", fields: { status: "done" } },
    { title: "Gamma" },
  ];

  // @verifies BLK-1
  test("BLK-1: a row checkbox selects one task and does not navigate", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(THREE);
    await page.goto(`${tracker.baseURL}/list`);

    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    const alpha = rows.filter({ hasText: "Alpha" });
    const box = alpha.getByRole("checkbox");

    await box.click();

    // Exactly one selected, and no navigation away from /list.
    await expect(box).toBeChecked();
    await expect(rows.filter({ hasText: "Beta" }).getByRole("checkbox")).not.toBeChecked();
    await expect(page).toHaveURL(/\/list/);

    // Selected treatment is more than colour: aria-selected marks it
    // programmatically, and the box itself is checked.
    await expect(alpha).toHaveAttribute("aria-selected", "true");

    // Clicking again deselects, still without navigating.
    await box.click();
    await expect(box).not.toBeChecked();
    await expect(page).toHaveURL(/\/list/);

    // Clicking elsewhere in the row DOES navigate — the checkbox is the
    // only non-navigating hit area.
    await alpha.getByRole("cell").nth(2).click();
    await expect(page).toHaveURL(/\/tasks\//);
  });

  // @verifies BLK-1
  test("BLK-1: the checkbox is keyboard reachable and Space toggles it", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(THREE);
    await page.goto(`${tracker.baseURL}/list`);

    const box = page
      .getByRole("row")
      .filter({ hasText: "Alpha" })
      .getByRole("checkbox");

    await box.focus();
    await expect(box).toBeFocused();
    await page.keyboard.press("Space");

    await expect(box).toBeChecked();
    // Space must not also fire the row's navigation.
    await expect(page).toHaveURL(/\/list/);
  });

  // @verifies BLK-2
  test("BLK-2: the bar is absent at zero and counts selected rows", async ({ page, tracker }) => {
    await tracker.seed(THREE);
    await page.goto(`${tracker.baseURL}/list`);

    const bar = page.getByRole("region", { name: "Bulk actions" });
    // Absent from the DOM, not merely invisible — a hidden bar is still
    // tabbable and still announced.
    await expect(bar).toHaveCount(0);

    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await rows.filter({ hasText: "Alpha" }).getByRole("checkbox").click();
    await expect(bar).toContainText("1 task selected");

    await rows.filter({ hasText: "Beta" }).getByRole("checkbox").click();
    await expect(bar).toContainText("2 tasks selected");

    // The count is of selected rows — not the three on the page, and
    // not the filter total.
    await expect(bar).not.toContainText("3 tasks selected");
  });

  // @verifies BLK-3
  test("BLK-3: select-all takes the visible page and says so", async ({ page, tracker }) => {
    // 60 tasks, page size 50: select-all must claim 50, never 60.
    await tracker.seed(Array.from({ length: 60 }, (_, i) => ({ title: `Task ${i + 1}` })));
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–50 of 60")).toBeVisible();

    const header = page.getByRole("checkbox", { name: "Select all on this page" });
    await header.click();

    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("50 tasks selected");
    // Must not imply the whole match set.
    await expect(bar).not.toContainText("60 tasks selected");
    // Scope stated explicitly alongside the count.
    await expect(bar).toContainText("50 on this page selected");

    // Checked, not indeterminate, once every visible row is selected.
    await expect(header).toBeChecked();
    await expect(header).toHaveJSProperty("indeterminate", false);

    // Unchecking clears everything and removes the bar.
    await header.click();
    await expect(bar).toHaveCount(0);
  });

  // @verifies BLK-4
  test("BLK-4: nothing claims a scope wider than the visible page", async ({ page, tracker }) => {
    await tracker.seed(Array.from({ length: 60 }, (_, i) => ({ title: `Task ${i + 1}` })));
    await page.goto(`${tracker.baseURL}/list`);
    // Wait for the page to load before select-all: clicking the header
    // against an empty table selects nothing and the bar never appears.
    await expect(page.getByText("Showing 1–50 of 60")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).click();
    const barReady = page.getByRole("region", { name: "Bulk actions" });
    await expect(barReady).toContainText("50 tasks selected");

    // "Select all N matching" is not built. BLK-4 permits that — but
    // then no control may claim the larger scope.
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).not.toContainText("60 matching");
    await expect(bar).not.toContainText("All 60");
    await expect(page.getByRole("button", { name: /Select all 60/ })).toHaveCount(0);
  });

  // @verifies BLK-18
  test("BLK-18: changing a filter clears the selection", async ({ page, tracker }) => {
    await tracker.seed(THREE);
    await page.goto(`${tracker.baseURL}/list`);

    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await rows.filter({ hasText: "Alpha" }).getByRole("checkbox").click();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("1 task selected");

    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Done" }).click();

    // Cleared, not silently carried: a bar still claiming a selection
    // would be operating on a row the user can no longer see.
    await expect(bar).toHaveCount(0);

    // And going back does not resurrect it out of thin air.
    await page.goBack();
    await expect(page.getByRole("row").filter({ hasText: "Alpha" })).toBeVisible();
    await expect(bar).toHaveCount(0);
  });

  // @verifies BLK-3
  test("BLK-3: select-all covers the loaded rows, not a stale superset", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(Array.from({ length: 60 }, (_, i) => ({ title: `Task ${i + 1}` })));
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–50 of 60")).toBeVisible();

    const header = page.getByRole("checkbox", { name: "Select all on this page" });
    const bar = page.getByRole("region", { name: "Bulk actions" });

    // Select the first 50, then load the rest and select again. The
    // second select-all must describe the 60 now rendered — not 50, and
    // not 110 from unioning the two rounds.
    await header.click();
    await expect(bar).toContainText("50 tasks selected");

    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByText("Showing 1–60 of 60")).toBeVisible();

    // Now partial: 50 of 60 selected, so the header is indeterminate.
    await expect(header).toHaveJSProperty("indeterminate", true);

    await header.click();
    await expect(bar).toContainText("60 tasks selected");
    await expect(bar).not.toContainText("110");
  });

  // @verifies BLK-18
  test("BLK-18: loading another page keeps the selection", async ({ page, tracker }) => {
    await tracker.seed(Array.from({ length: 60 }, (_, i) => ({ title: `Task ${i + 1}` })));
    await page.goto(`${tracker.baseURL}/list`);

    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await rows.first().getByRole("checkbox").click();
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("1 task selected");

    await page.getByRole("button", { name: "Load more" }).click();
    await expect(page.getByText("Showing 1–60 of 60")).toBeVisible();

    // Paging is not a result-set change — clearing here would make the
    // selection unusable on any list longer than one page.
    await expect(bar).toContainText("1 task selected");
  });
});
