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

test.describe("BLK — bulk actions", () => {
  const FIVE = Array.from({ length: 5 }, (_, i) => ({ title: `Task ${i + 1}` }));

  async function selectFirst(page: import("@playwright/test").Page, n: number): Promise<void> {
    const boxes = page.locator("tbody input[type=checkbox]");
    for (let i = 0; i < n; i += 1) await boxes.nth(i).check();
  }

  // @verifies BLK-5
  test("BLK-5: Set status offers configured labels and applies to all selected", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(FIVE);
    await page.goto(`${tracker.baseURL}/list`);
    await selectFirst(page, 3);

    await page.getByRole("button", { name: "Set status" }).click();
    const menu = page.getByRole("menu", { name: "Set status" });
    // Config order, config labels — not a hardcoded triple.
    await expect(menu.getByRole("menuitem")).toHaveText([
      "Backlog", "In progress", "Done", "Won't do",
    ]);

    await menu.getByRole("menuitem", { name: "In progress" }).click();

    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar.getByRole("status")).toHaveText("3 tasks updated");

    // Rows show the new label without a reload.
    await expect(page.getByRole("cell", { name: "In progress" })).toHaveCount(3);
  });

  // @verifies BLK-5
  test("BLK-5: the stored value is the key, not the label", async ({ page, tracker }) => {
    await tracker.seed(FIVE);
    await page.goto(`${tracker.baseURL}/list`);
    await selectFirst(page, 1);

    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "In progress" }).click();
    await expect(page.getByRole("region", { name: "Bulk actions" }).getByRole("status"))
      .toHaveText("1 task updated");

    // Read it back through the API rather than the DOM: the label is
    // what the table renders, the key is what must be on disk.
    const res = await page.request.get(`${tracker.baseURL}/api/tasks?limit=50`);
    const body = await res.json() as { items: { status: string }[] };
    expect(body.items.filter(t => t.status === "in_progress")).toHaveLength(1);
  });

  // @verifies BLK-10
  test("BLK-10: Archive is one click with no typed confirmation", async ({ page, tracker }) => {
    await tracker.seed(FIVE);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–5 of 5")).toBeVisible();
    await selectFirst(page, 2);

    await page.getByRole("button", { name: "Archive", exact: true }).click();

    // Demanding a typed confirm for a reversible action is itself the
    // violation — no dialog may appear.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Rows leave the default view and the total drops.
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
  });

  // @verifies BLK-11
  test("BLK-11: Delete demands an exact typed confirmation", async ({ page, tracker }) => {
    await tracker.seed(FIVE);
    await page.goto(`${tracker.baseURL}/list`);
    await selectFirst(page, 2);

    await page.getByRole("button", { name: "Delete", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Permanently delete 2 tasks");
    await expect(dialog).toContainText("cannot be undone");
    // Archive named as the reversible alternative, at the moment of
    // the decision.
    await expect(dialog).toContainText("archive");

    // Focus is the input, never the destructive button.
    const input = dialog.getByLabel("Type DELETE to confirm");
    await expect(input).toBeFocused();

    const confirmBtn = dialog.getByRole("button", { name: /^Delete 2 tasks$/ });
    await expect(confirmBtn).toBeDisabled();

    // Near-misses do not enable it.
    await input.fill("delete");
    await expect(confirmBtn).toBeDisabled();
    await input.fill("DELETE");
    await expect(confirmBtn).toBeEnabled();
  });

  // @verifies BLK-11
  test("BLK-11: Esc closes the dialog with nothing deleted", async ({ page, tracker }) => {
    await tracker.seed(FIVE);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–5 of 5")).toBeVisible();
    await selectFirst(page, 2);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Nothing removed, and the selection survives so the user can retry.
    await expect(page.getByText("Showing 1–5 of 5")).toBeVisible();
    await expect(page.getByRole("region", { name: "Bulk actions" }))
      .toContainText("2 tasks selected");
  });

  // @verifies BLK-12
  test("BLK-12: a confirmed delete removes the tasks and reports honestly", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(FIVE);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–5 of 5")).toBeVisible();
    await selectFirst(page, 2);

    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Type DELETE to confirm").fill("DELETE");
    await page.getByRole("dialog").getByRole("button", { name: /^Delete 2 tasks$/ }).click();

    // Total drops by exactly the number deleted...
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
    // ...the selection is cleared and the bar goes...
    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
    // ...and no Undo is offered for an irreversible action.
    await expect(page.getByRole("button", { name: /Undo/i })).toHaveCount(0);
  });

  // @verifies BLK-13
  test("BLK-13: Clear empties the selection without mutating anything", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(FIVE);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–5 of 5")).toBeVisible();
    await selectFirst(page, 2);

    await page.getByRole("button", { name: "Clear selection" }).click();

    await expect(page.getByRole("region", { name: "Bulk actions" })).toHaveCount(0);
    // Header returns to unchecked, and nothing changed on disk.
    await expect(page.getByRole("checkbox", { name: "Select all on this page" }))
      .not.toBeChecked();
    await expect(page.getByText("Showing 1–5 of 5")).toBeVisible();
  });

  // @verifies BLK-38, BLK-39
  test("BLK-38/39: a partial failure names each failure and is not called success", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(FIVE);
    await page.goto(`${tracker.baseURL}/list`);
    await selectFirst(page, 2);

    // Rewrite the outgoing batch to include a ref that cannot resolve,
    // so the server returns 200 with a populated `failed`.
    await page.route(/\/api\/tasks\/bulk\/set/, async route => {
      const body = route.request().postDataJSON() as { refs: string[] };
      await route.continue({
        postData: JSON.stringify({ ...body, refs: [...body.refs, "T-99999"] }),
      });
    });

    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    // Not "3 tasks updated": the count of successes is stated with the
    // failures alongside, and the failure is named individually.
    await expect(status).toContainText("2 tasks updated, 1 failed");
    await expect(status).toContainText("T-99999");
  });
});

test.describe("BLK — refused bulk op", () => {
  // @verifies BLK-40
  test("BLK-40: a refused bulk set names the field and keeps the selection", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();

    // Rewrite the outgoing change to an auto-managed field, which core
    // refuses for the whole batch rather than per task.
    await page.route(/\/api\/tasks\/bulk\/set/, async route => {
      const body = route.request().postDataJSON() as { refs: string[] };
      await route.continue({
        postData: JSON.stringify({
          refs: body.refs,
          changes: [{ field: "updated_at", value: "2020-01-01T00:00:00Z" }],
        }),
      });
    });

    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    const bar = page.getByRole("region", { name: "Bulk actions" });
    const status = bar.getByRole("status");
    // Names the field and why it cannot be set.
    await expect(status).toContainText("updated_at");
    await expect(status).toContainText(/stamped on every write/);
    // Nothing was applied, and the selection survives so the user can
    // choose a different action.
    await expect(status).toContainText(/Nothing was updated/);
    await expect(bar).toContainText("1 task selected");
  });
});

test.describe("BLK — export", () => {
  const MIXED = [
    { title: 'Fix "quoted", comma', fields: { priority: "high" } },
    { title: "High two", fields: { priority: "high" } },
    { title: "Low one", fields: { priority: "low" } },
  ];

  // @verifies BLK-16
  test("BLK-16: the menu states the count and offers both formats", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(MIXED);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    const menu = page.getByRole("menu", { name: "Export" });

    // The filter total, stated before committing.
    await expect(menu).toContainText("Export 3 tasks");
    await expect(menu.getByRole("menuitem", { name: "CSV" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "JSON" })).toBeVisible();
  });

  // @verifies BLK-16
  test("BLK-16: the count follows the filter, not the page", async ({ page, tracker }) => {
    await tracker.seed(MIXED);
    await page.goto(`${tracker.baseURL}/list?priority=high`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("menu", { name: "Export" })).toContainText("Export 2 tasks");
  });

  // @verifies BLK-14
  test("BLK-14: CSV carries the filter and the same rows as the screen", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(MIXED);
    await page.goto(`${tracker.baseURL}/list?priority=high`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // The keys on screen, to compare against — not merely the count.
    const onScreen = await page.getByRole("cell", { name: /^[A-Z]+-\d+$/ }).allTextContents();

    await page.getByRole("button", { name: "Export" }).click();
    const href = await page.getByRole("menuitem", { name: "CSV" }).getAttribute("href");
    expect(href).toContain("priority=high");

    const res = await page.request.get(`${tracker.baseURL}${href ?? ""}`);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");

    const csv = await res.text();
    const lines = csv.trimEnd().split("\n");
    // Stable header order, then one row per matching task.
    expect(lines[0]?.startsWith("key,id,title")).toBe(true);
    for (const key of onScreen) {
      expect(csv).toContain(key);
    }
  });

  // @verifies BLK-14
  test("BLK-14: export follows the filter, not the selection", async ({ page, tracker }) => {
    await tracker.seed(MIXED);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    // Select one row; the export must still carry all three.
    await page.locator("tbody input[type=checkbox]").first().check();

    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("menu", { name: "Export" })).toContainText("Export 3 tasks");
    const href = await page.getByRole("menuitem", { name: "CSV" }).getAttribute("href");
    const res = await page.request.get(`${tracker.baseURL}${href ?? ""}`);
    const lines = (await res.text()).trimEnd().split("\n");
    // Header + 3 data rows, not header + 1.
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  // @verifies BLK-15
  test("BLK-15: JSON is native-typed and uses stored keys", async ({ page, tracker }) => {
    await tracker.seed(MIXED);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    const href = await page.getByRole("menuitem", { name: "JSON" }).getAttribute("href");

    const res = await page.request.get(`${tracker.baseURL}${href ?? ""}`);
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(res.headers()["content-disposition"]).toContain("attachment");

    const body = await res.json() as { priority?: string; labels?: unknown }[];
    expect(Array.isArray(body)).toBe(true);
    // Stored keys, not rendered labels — the JSON is data.
    const priorities = body.map(t => t.priority).filter(Boolean);
    expect(priorities).toContain("high");
    expect(priorities).not.toContain("High");
  });

  // @verifies BLK-33
  test("BLK-33: CSV escapes quotes and commas in a title", async ({ page, tracker }) => {
    await tracker.seed(MIXED);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    const href = await page.getByRole("menuitem", { name: "CSV" }).getAttribute("href");
    const csv = await (await page.request.get(`${tracker.baseURL}${href ?? ""}`)).text();

    // Doubled quotes, whole cell wrapped — and the row is not split.
    expect(csv).toContain('"Fix ""quoted"", comma"');
    expect(csv.trimEnd().split("\n")).toHaveLength(4);
  });

  // @verifies BLK-35
  test("BLK-35: zero matches disables export rather than promising a file", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(MIXED);
    await page.goto(`${tracker.baseURL}/list?priority=critical`);
    await expect(page.getByText("No tasks match these filters.")).toBeVisible();

    // Either an empty file or a disabled control — never a "0 tasks
    // exported" success next to a file the user did not get.
    await expect(page.getByRole("button", { name: "Export" })).toBeDisabled();
  });

  // @verifies BLK-37
  test("BLK-37: the export URL reproduces the identical file", async ({ page, tracker }) => {
    await tracker.seed(MIXED);
    await page.goto(`${tracker.baseURL}/list?priority=high`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await page.getByRole("button", { name: "Export" }).click();
    const href = await page.getByRole("menuitem", { name: "CSV" }).getAttribute("href");

    // Byte-for-byte, not row counts: a filter dropped server-side gives
    // a same-sized file with different rows.
    const first = await (await page.request.get(`${tracker.baseURL}${href ?? ""}`)).text();
    const second = await (await page.request.get(`${tracker.baseURL}${href ?? ""}`)).text();
    expect(second).toBe(first);

    // And the filter really is in the URL, not only in React state.
    expect(href).toContain("priority=high");
    const unfiltered = await (await page.request.get(
      `${tracker.baseURL}/api/tasks/export?format=csv`,
    )).text();
    expect(unfiltered).not.toBe(first);
  });
});
