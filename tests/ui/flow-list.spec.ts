/**
 * Transcribed from docs/dev/ui-test-cases/flow-list.md.
 *
 * One `test` per case, named by case ID, with a `@verifies` tag so the
 * coverage gate can see it. Assertions follow the case's bullets in order
 * — the prose is the specification, and a spec that asserts something the
 * case does not claim has drifted from it.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

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

test.describe("BLK — entity pickers", () => {
  async function selectOne(page: import("@playwright/test").Page): Promise<void> {
    await page.locator("tbody input[type=checkbox]").first().check();
  }

  /**
   * Reads a frontmatter field straight off disk.
   *
   * `loctt show` renders the *resolved* name, so it prints "v1" whether
   * the file stores the ULID or the literal string — exactly the
   * distinction BLK-7 and BLK-8 turn on. P1: the files are the truth.
   */
  async function frontmatter(root: string, field: string): Promise<string | undefined> {
    const tasksDir = path.join(root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
      const m = new RegExp(`^${field}: (.+)$`, "m").exec(text);
      if (m?.[1] !== undefined) return m[1].trim();
    }
    return undefined;
  }

  // @verifies BLK-7
  test("BLK-7: the assignee picker lists active users, stores the ULID, and offers Unassign", async ({
    page,
    tracker,
  }) => {
    const ann = await tracker.run(["user", "create", "Ann"]);
    await tracker.run(["user", "create", "Gone"]);
    // Archiving hides an entity from *new* assignments; it does not
    // break tasks already pointing at it.
    await tracker.run(["user", "archive", "Gone"]);
    const annId = /([0-9A-Z]{26})/.exec(ann)?.[1] ?? "";
    expect(annId).not.toBe("");

    await tracker.seed([{ title: "One" }]);

    // Hand the client the archived user anyway (see the comment on the
    // assertion below).
    await page.route(/\/api\/users(\?|$)/, async route => {
      const res = await route.fetch();
      const body = await res.json() as { items: { name: string }[] };
      expect(body.items.map(u => u.name)).not.toContain("Gone");
      await route.fulfill({
        response: res,
        json: {
          ...body,
          items: [...body.items, { id: "01ARCHIVED0000000000000000", name: "Gone", archived: true }],
        },
      });
    });

    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await selectOne(page);

    await page.getByRole("button", { name: "Set assignee" }).click();
    const menu = page.getByRole("menu", { name: "Set assignee" });
    // Listed by display name, never the ULID.
    await expect(menu.getByRole("menuitem", { name: "Ann" })).toBeVisible();
    // The archived user is not offered: the archived-reference guard
    // would refuse it, so offering it produces a rejection the user
    // cannot act on.
    //
    // `/api/users` already excludes archived by default, so asserting
    // against the live response proves nothing about this component —
    // it passes whether the client filters or not. Forcing the archived
    // user into the payload is what makes the assertion real: the
    // picker must drop it even when the server hands it over, which is
    // also the honest contract, since ?include_archived=true is one
    // query-param away.
    await expect(menu.getByRole("menuitem", { name: "Gone" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Unassign" })).toBeVisible();

    // Capture what the client sends. Disk alone cannot decide this:
    // core resolves a name to its ULID on write (resolveEntityRef), so
    // frontmatter reads identically whether the picker sent "Ann" or
    // the id. The case constrains the *stored value*, and the only part
    // of that this component owns is the value it puts on the wire.
    const sent: unknown[] = [];
    await page.route(/\/api\/tasks\/bulk\/set/, async route => {
      const body = route.request().postDataJSON() as {
        changes: { field: string; value: unknown }[];
      };
      for (const c of body.changes) if (c.field === "assignee") sent.push(c.value);
      await route.continue();
    });

    await menu.getByRole("menuitem", { name: "Ann" }).click();
    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    await expect(status).toContainText("1 task updated");
    expect(sent).toEqual([annId]);
    expect(await frontmatter(tracker.root, "assignee")).toBe(annId);

    // Unassign clears it rather than writing an empty string.
    await selectOne(page);
    await page.getByRole("button", { name: "Set assignee" }).click();
    await page.getByRole("menu", { name: "Set assignee" })
      .getByRole("menuitem", { name: "Unassign" }).click();
    await expect(status).toContainText("1 task updated");
    // `null`, not "": the endpoint maps null to core's "clear this
    // field", while an empty string is a value core would try to
    // resolve.
    expect(sent).toEqual([annId, null]);
    expect(await frontmatter(tracker.root, "assignee")).toBeUndefined();
  });

  // @verifies BLK-8
  test("BLK-8: milestone and sprint pickers exclude archived, offer a clear, and show sprint state", async ({
    page,
    tracker,
  }) => {
    const v1 = await tracker.run(["milestone", "create", "v1"]);
    await tracker.run(["milestone", "create", "old"]);
    await tracker.run(["milestone", "archive", "old"]);
    const v1Id = /([0-9A-Z]{26})/.exec(v1)?.[1] ?? "";
    expect(v1Id).not.toBe("");

    const s1 = await tracker.run([
      "sprint", "create", "S1",
      "--start", "2026-01-01", "--end", "2026-01-14", "--state", "active",
    ]);
    await tracker.run([
      "sprint", "create", "S0",
      "--start", "2025-01-01", "--end", "2025-01-14", "--state", "completed",
    ]);
    // An archived sprint, distinct from a completed one. `/api/sprints`
    // does not filter archived server-side the way `/api/users` does,
    // so the picker's own filter is the only thing keeping this out —
    // and without a fixture for it, nothing pins that.
    await tracker.run([
      "sprint", "create", "Sold",
      "--start", "2024-01-01", "--end", "2024-01-14", "--state", "completed",
    ]);
    await tracker.run(["sprint", "archive", "Sold"]);

    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await selectOne(page);

    await page.getByRole("button", { name: "Set milestone" }).click();
    const mMenu = page.getByRole("menu", { name: "Set milestone" });
    await expect(mMenu.getByRole("menuitem", { name: "v1" })).toBeVisible();
    await expect(mMenu.getByRole("menuitem", { name: "old" })).toHaveCount(0);
    await expect(mMenu.getByRole("menuitem", { name: "No milestone" })).toBeVisible();
    // See BLK-7 on why the wire value is asserted and not just disk.
    const sent: Record<string, unknown[]> = { milestone: [], sprint: [] };
    await page.route(/\/api\/tasks\/bulk\/set/, async route => {
      const body = route.request().postDataJSON() as {
        changes: { field: string; value: unknown }[];
      };
      for (const c of body.changes) sent[c.field]?.push(c.value);
      await route.continue();
    });

    await mMenu.getByRole("menuitem", { name: "v1" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    await expect(status).toContainText("1 task updated");
    // The id, not the name — MSL-C1 moved identity to the ULID because
    // storing the name broke milestone progress.
    expect(sent["milestone"]).toEqual([v1Id]);
    expect(await frontmatter(tracker.root, "milestone")).toBe(v1Id);

    // Sprint options carry their state, so nobody assigns work to a
    // sprint that already finished without seeing it.
    await selectOne(page);
    await page.getByRole("button", { name: "Set sprint" }).click();
    const sMenu = page.getByRole("menu", { name: "Set sprint" });
    await expect(sMenu.getByRole("menuitem", { name: /S1.*active/ })).toBeVisible();
    await expect(sMenu.getByRole("menuitem", { name: /S0.*completed/ })).toBeVisible();
    await expect(sMenu.getByRole("menuitem", { name: "No sprint" })).toBeVisible();
    // Archived is not the same as completed: S0 is completed and offered,
    // Sold is archived and must not be.
    await expect(sMenu.getByRole("menuitem", { name: /Sold/ })).toHaveCount(0);
    const s1Id = /([0-9A-Z]{26})/.exec(s1)?.[1] ?? "";
    expect(s1Id).not.toBe("");
    await sMenu.getByRole("menuitem", { name: /S1/ }).click();
    await expect(status).toContainText("1 task updated");
    // The id on the wire, for the same reason as milestone above.
    expect(sent["sprint"]).toEqual([s1Id]);
    expect(await frontmatter(tracker.root, "sprint")).toBe(s1Id);

    // The clear option actually clears.
    await selectOne(page);
    await page.getByRole("button", { name: "Set milestone" }).click();
    await page.getByRole("menu", { name: "Set milestone" })
      .getByRole("menuitem", { name: "No milestone" }).click();
    await expect(status).toContainText("1 task updated");
    expect(await frontmatter(tracker.root, "milestone")).toBeUndefined();
  });
});

test.describe("BLK — move to project", () => {
  /** Every task's key, newest-first order as the list renders them. */
  async function keysOnDisk(root: string): Promise<string[]> {
    const tasksDir = path.join(root, ".loctt", "tasks");
    const out: string[] = [];
    for (const id of await readdir(tasksDir)) {
      const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
      const m = /^key: (.+)$/m.exec(text);
      if (m?.[1] !== undefined) out.push(m[1].trim());
    }
    return out.sort();
  }

  /** `state.yaml`'s next key number for the OPS-prefixed project. */
  async function opsNextNumber(root: string): Promise<number> {
    const text = await readFile(path.join(root, ".loctt", "state.yaml"), "utf8");
    const m = /prefix: OPS\n\s+next_number: (\d+)/.exec(text);
    return m?.[1] === undefined ? -1 : Number(m[1]);
  }

  /** One frontmatter field from the task holding `key`. */
  async function fieldFor(root: string, key: string, field: string): Promise<string | undefined> {
    const tasksDir = path.join(root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
      if (!new RegExp(`^key: ${key}$`, "m").test(text)) continue;
      return new RegExp(`^${field}: (.+)$`, "m").exec(text)?.[1]?.trim();
    }
    return undefined;
  }

  async function historyFor(root: string, key: string): Promise<string[]> {
    const tasksDir = path.join(root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
      if (!new RegExp(`^key: ${key}$`, "m").test(text)) continue;
      const block = /^key_history:\n((?:\s+- .+\n)+)/m.exec(text);
      return block?.[1] === undefined
        ? []
        : block[1].split("\n").map(l => l.replace(/^\s*- /, "").trim()).filter(Boolean);
    }
    return [];
  }

  // @verifies BLK-9
  test("BLK-9: moving rekeys, keeps the old key resolvable, and names the new keys", async ({
    page,
    tracker,
  }) => {
    const backend = await tracker.run(["project", "create", "Backend", "--prefix", "BACKEND"]);
    const backendId = /([0-9A-Z]{26})/.exec(backend)?.[1] ?? "";
    expect(backendId).not.toBe("");
    await tracker.run(["project", "create", "Old", "--prefix", "OLD"]);
    await tracker.run(["project", "archive", "Old"]);
    // `seed` returns the assigned keys; the prefix and numbering are the
    // fixture's, so hardcoding either asserts against the fixture rather
    // than the move.
    const seeded = await tracker.seed([{ title: "One" }, { title: "Two" }]);

    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();

    await page.getByRole("button", { name: "Move to project" }).click();
    const menu = page.getByRole("menu", { name: "Move to project" });
    // Non-archived projects only, by label.
    await expect(menu.getByRole("menuitem", { name: "Backend" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Old" })).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Backend" }).click();

    // The bar unmounts once the selection clears (BLK-18), so the
    // outcome is read from the standalone status, not from inside it.
    const status = page.getByRole("status").filter({ hasText: "moved" });
    // The result names the new key. "1 task moved" alone is unusable:
    // the key the user knew no longer exists and nothing says what
    // replaced it.
    //
    // Asserted as one string, not two substrings: `toContainText("BACKEND1")`
    // plus `toContainText("→")` passes with the arrow reversed, which
    // reads as moving *from* a key that does not exist yet *to* one that
    // no longer does. The pairing and its direction are the whole
    // content of this bullet.
    await expect(status).toContainText(`${String(seeded[1])} → BACKEND1`);

    const keys = await keysOnDisk(tracker.root);
    expect(keys).toContain("BACKEND1");
    // The `project` field itself, not only the key prefix — the two are
    // written by different lines and a rekey that left `project` stale
    // would look right in the list and wrong to every query.
    expect(await fieldFor(tracker.root, "BACKEND1", "project")).toBe(backendId);
    // The old key is preserved so pasting it still resolves (P-7). The
    // The list renders newest-first, so the first checkbox is the task
    // seeded *last*. Both the prefix and the ordering are the fixture's;
    // hardcoding either asserts against the fixture, not the move.
    expect(await historyFor(tracker.root, "BACKEND1")).toEqual([seeded[1]]);
    // And it actually resolves: key_history exists so the key the user
    // still has in hand keeps working. Reading the YAML proves the entry
    // was written, not that anything honours it.
    const resolved = await tracker.run(["show", String(seeded[1])]);
    expect(resolved).toContain("BACKEND1");
  });

  // @verifies BLK-31
  test("BLK-31: a move in flight disables the bar, so a second click cannot issue a second batch", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BACKEND"]);
    await tracker.seed([{ title: "One" }]);

    // Hold the move open so the in-flight window is observable, and
    // count how many batches actually reach the server.
    let calls = 0;
    let release: (() => void) | undefined;
    const held = new Promise<void>(r => { release = r; });
    await page.route(/\/api\/tasks\/bulk\/move/, async route => {
      calls += 1;
      await held;
      await route.continue();
    });

    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Move to project" }).click();
    await page.getByRole("menu", { name: "Move to project" })
      .getByRole("menuitem", { name: "Backend" }).click();

    // Every control is disabled while the batch is in flight, so a
    // second click cannot start a second one with its own bulk_op_id.
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar.getByRole("button", { name: "Move to project" })).toBeDisabled();
    await expect(bar.getByRole("button", { name: "Archive" })).toBeDisabled();

    release?.();
    await expect(page.getByRole("status").filter({ hasText: "moved" })).toBeVisible();
    expect(calls).toBe(1);
  });

  // @verifies BLK-26
  test("BLK-26: mixed sources rekey from the destination counter, and a same-project move burns nothing", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Ops", "--prefix", "OPS"]);
    await tracker.run(["project", "create", "Api", "--prefix", "API"]);
    // Mixed sources, which is what the case is about: one task in the
    // default project and one in API, both moving to OPS. A batch that
    // read the counter from the *source* would produce two different
    // prefixes here and look correct with a single source.
    const seeded = await tracker.seed([{ title: "One" }]);
    const inApi = await tracker.run(["create", "Two", "--project", "Api"]);
    expect(inApi).toContain("API1");
    // A task already in the destination. Moving it must be a no-op
    // success, not a rekey — burning a key number here leaves a
    // permanent gap in the sequence.
    const inOps = await tracker.run(["create", "Three", "--project", "Ops"]);
    expect(inOps).toContain("OPS1");

    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    // Wait for the rows before selecting. Select-all on a table that has
    // not rendered yet checks nothing and then unchecks itself when the
    // rows arrive — which surfaces as "Clicking the checkbox did not
    // change its state", intermittently and only under load.
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    await page.getByRole("button", { name: "Move to project" }).click();
    await page.getByRole("menu", { name: "Move to project" })
      .getByRole("menuitem", { name: "Ops" }).click();

    const status = page.getByRole("status").filter({ hasText: "moved" });
    await expect(status).toContainText("3 tasks moved");

    // Two rekeyed from the OPS counter with no gap and no reuse; the
    // third kept OPS1.
    const keys = await keysOnDisk(tracker.root);
    expect(keys).toEqual(["OPS1", "OPS2", "OPS3"]);
    // The counter itself, which the case names explicitly. Keys on disk
    // alone cannot see a number that was allocated and then abandoned —
    // that leaves a permanent gap in the sequence and reads as correct
    // until the next create.
    expect(await opsNextNumber(tracker.root)).toBe(4);

    // The already-in-Ops task is reported as unchanged, not as a rekey.
    expect(await historyFor(tracker.root, "OPS1")).toEqual([]);
    await expect(status).not.toContainText("OPS1 →");

    // Each moved task carries its former key, whichever project it came
    // from. Newest-first ordering: API1 was created last, so it rekeys
    // first.
    expect(await historyFor(tracker.root, "OPS2")).toEqual(["API1"]);
    expect(await historyFor(tracker.root, "OPS3")).toEqual([seeded[0]]);
  });
});

test.describe("BLK — archive undo", () => {
  // @verifies BLK-10
  test("BLK-10: archive offers an Undo that restores every task it archived", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "One" }, { title: "Two" }, { title: "Three" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.locator("tbody input[type=checkbox]").nth(1).check();

    await page.getByRole("button", { name: "Archive", exact: true }).click();

    // Still no typed confirm — archive is reversible, so demanding one
    // is itself the violation.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The rows leave the default view and the total drops.
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // Undo is offered in the success message, where the user is already
    // looking.
    const status = page.getByRole("status").filter({ hasText: "archived" });
    await expect(status).toContainText("2 tasks archived");
    const undo = status.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();

    // And it restores all of them, not just the last.
    await undo.click();
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "restored" }),
    ).toContainText("2 tasks restored");
  });

  // @verifies BLK-10
  test("BLK-10: a partial archive undoes only what it archived", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.locator("tbody input[type=checkbox]").nth(1).check();

    // Fail one of the two selected tasks rather than injecting a ref
    // the client never held: the bug is the client undoing what it
    // *sent* instead of what succeeded, and an injected ref is absent
    // from both sets, so it cannot tell them apart.
    const unarchived: string[][] = [];
    await page.route(/\/api\/tasks\/bulk\/archive/, async route => {
      const body = route.request().postDataJSON() as { refs: string[]; archive: boolean };
      if (!body.archive) {
        unarchived.push(body.refs);
        await route.continue();
        return;
      }
      // Report the second ref as failed while archiving the first.
      const res = await route.fetch({
        postData: JSON.stringify({ ...body, refs: body.refs.slice(0, 1) }),
      });
      const json = await res.json() as { succeeded: string[]; failed: unknown[] };
      await route.fulfill({
        response: res,
        json: {
          ...json,
          failed: [{ taskId: body.refs[1], error: "task not found" }],
        },
      });
    });

    await page.getByRole("button", { name: "Archive", exact: true }).click();
    const status = page.getByRole("status").filter({ hasText: "archived" });
    await expect(status).toContainText("1 task archived, 1 failed");

    // Undo restores the one that was archived — not the one that
    // failed. Restoring the failure would un-archive a task this batch
    // never touched, which the user may have archived deliberately.
    await status.getByRole("button", { name: "Undo" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "restored" }),
    ).toContainText("1 task restored");
    // Exactly the archived one went back on the wire. Sending both
    // would un-archive a task this batch never touched — one the user
    // may have archived deliberately earlier.
    expect(unarchived).toHaveLength(1);
    expect(unarchived[0]).toHaveLength(1);
    // And the undo is spent: offering it twice would restore nothing
    // while claiming to have worked.
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });

  // @verifies BLK-10
  test("BLK-10: the archived tasks are visible under Show archived", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByRole("checkbox", { name: "Show archived" }).check();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    // With a badge, not a dimmed row: opacity alone is invisible to a
    // screen reader and to anyone the contrast drop does not reach.
    //
    // Asserted against the row that carries it, not a page-wide count:
    // "one Archived badge exists" is also true when the badge is on the
    // wrong row.
    // The list renders newest-first, so the first checkbox archived
    // "Two", not "One".
    const rows = page.locator("tbody tr");
    await expect(rows.filter({ hasText: "Two" })).toContainText("Archived");
    await expect(rows.filter({ hasText: "One" })).not.toContainText("Archived");
  });

  // @verifies BLK-10
  test("BLK-10: a later action supersedes the undo rather than leaving it stale", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    // Rows first: a click before the table renders lands on nothing.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "archived" })
        .getByRole("button", { name: "Undo" }),
    ).toBeVisible();

    // A different action runs. Offering the old Undo afterwards would
    // restore tasks the user has since acted on.
    //
    // Set status is used deliberately: it does *not* clear the
    // selection, so the result region stays mounted and the Undo has to
    // be absent because it was superseded — not because its container
    // vanished. An action that clears the selection would make this
    // pass with the supersede logic deleted.
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar.getByRole("status")).toContainText("1 task updated");
    await expect(bar).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  });
});
