/**
 * Transcribed from tests/cases/ui-test-cases/flow-list.md.
 *
 * One `test` per case, named by case ID, with a `@verifies` tag so the
 * coverage gate can see it. Assertions follow the case's bullets in order
 * — the prose is the specification, and a spec that asserts something the
 * case does not claim has drifted from it.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_EXPORT_COLUMNS } from "@loctt/core";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/tracker.ts";

// The list-toolbar redesign folded advanced querying INTO the filter
// system: the leading "Advanced" pill (`advanced-query-toggle`) is gone.
// It is now reached one level in — open the "+ Add filter" menu, then
// pick the "Advanced query…" item (`advanced-open`). This mirrors the
// FilterBar unit test's `openAdvanced` helper (FilterBar.test.tsx).
const openAdvanced = async (page: Page): Promise<void> => {
  await page.getByTestId("add-filter").click();
  await page.getByTestId("advanced-open").click();
};

// A non-default facet (Reporter/Label/Milestone/Sprint or a custom
// field) is no longer a permanent pill: the toolbar shows only the
// resolved visible set (default: Project/Status/Priority/Assignee, per
// K97/A210). Such a facet must be ADDED via the "+ Add filter" picker
// before its "Filter <label>" pill exists. `facetId` is the FacetKey
// (e.g. "reporter", "label"), matching `add-filter-<id>` in FilterBar.
const addFacet = async (page: Page, facetId: string): Promise<void> => {
  await page.getByTestId("add-filter").click();
  await page.getByTestId(`add-filter-${facetId}`).click();
};

// Sixty rows, written straight to disk. `seed` spawns one
// `loctt create` per task at ~250ms, so these specs each paid ~15s
// of subprocess time before asserting anything — 39% of this file's
// total test time sat in twelve pagination and bulk specs doing it.
// The rows are filler; nothing here asserts anything a real `create`
// does that a written file does not.
const sixty = (t: { seedBulk: (c: number, p?: string, f?: (n: number) => string) => Promise<void> }) =>
  t.seedBulk(60, undefined, n => `Task ${String(n)}`);

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

    // The key column shows the user-facing key, not the ULID.
    // Asserted on the cell rather than the row: adjacent cell text
    // concatenates in the row's accessible text, which would let a
    // neighbouring column satisfy a row-level match.
    //
    // Addressed by **role**, not by index. The key cell is a
    // `<th scope="row">` as of M4.8 — A11Y-26's second bullet requires
    // a row header so screen-reader row navigation announces *which
    // task* the row is. That takes it out of the `cell` role, so the
    // old `nth(1)` silently moved on to the Project column and matched
    // "T". Indexing into a table's cells is what made this test
    // fragile; `rowheader` names the thing it means.
    await expect(row.getByRole("rowheader")).toHaveText(/^[A-Z][A-Z0-9]*-\d+$/);
    // The ULID appears nowhere in the row.
    await expect(row).not.toContainText(/[0-9A-HJKMNP-TV-Z]{26}/);

    // A task with no due_date renders an empty cell (the placeholder em
    // dash) — not "Invalid Date", and not today's date. Due is the 9th
    // of the ten columns.
    const undated = page.getByRole("row").filter({ hasText: "Undated task" });
    // Due is the 9th data column. The offset is +1 for the selection
    // cell and -1 for the key column, which is a `rowheader` rather
    // than a `cell` since M4.8 (A11Y-26) — so the two cancel and Due
    // sits at index 8 among the cells.
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

  // @verifies LST-13
  test("LST-13: the count is honest and Load more appends in place", async ({ page, tracker }) => {
    await sixty(tracker);
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
    // The 60 filler rows go straight to disk; only the one row that
    // needs a field value pays for a `loctt create` subprocess.
    await sixty(tracker);
    await tracker.seed([{ title: "Critical one", fields: { priority: "critical" } }]);
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
    await sixty(tracker);
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
    await sixty(tracker);
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
    // The 60 filler rows go straight to disk; only the one row that
    // needs a field value pays for a `loctt create` subprocess.
    await sixty(tracker);
    await tracker.seed([{ title: "Critical one", fields: { priority: "critical" } }]);
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
    await sixty(tracker);

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
    // Any cell that is not the checkbox. Index 1 is Project now that
    // the key column is a `rowheader` (A11Y-26) rather than a cell.
    await alpha.getByRole("cell").nth(1).click();
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
    await sixty(tracker);
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
    await sixty(tracker);
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
    await sixty(tracker);
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
    await sixty(tracker);
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
      // The list *does* request archived users now, so a task assigned
      // to one still shows their name (LST-25). That makes the picker's
      // own filter the only thing keeping an archived user out of the
      // options — which is exactly what the assertion below tests, and
      // why this route handler no longer needs to inject anything.
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
    // Asserted as one string, not two substrings: `toContainText("BACKEND-1")`
    // plus `toContainText("→")` passes with the arrow reversed, which
    // reads as moving *from* a key that does not exist yet *to* one that
    // no longer does. The pairing and its direction are the whole
    // content of this bullet.
    await expect(status).toContainText(`${String(seeded[1])} → BACKEND-1`);

    const keys = await keysOnDisk(tracker.root);
    expect(keys).toContain("BACKEND-1");
    // The `project` field itself, not only the key prefix — the two are
    // written by different lines and a rekey that left `project` stale
    // would look right in the list and wrong to every query.
    expect(await fieldFor(tracker.root, "BACKEND-1", "project")).toBe(backendId);
    // The old key is preserved so pasting it still resolves (P-7). The
    // The list renders newest-first, so the first checkbox is the task
    // seeded *last*. Both the prefix and the ordering are the fixture's;
    // hardcoding either asserts against the fixture, not the move.
    expect(await historyFor(tracker.root, "BACKEND-1")).toEqual([seeded[1]]);
    // And it actually resolves: key_history exists so the key the user
    // still has in hand keeps working. Reading the YAML proves the entry
    // was written, not that anything honours it.
    const resolved = await tracker.run(["show", String(seeded[1])]);
    expect(resolved).toContain("BACKEND-1");
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
    expect(inApi).toContain("API-1");
    // A task already in the destination. Moving it must be a no-op
    // success, not a rekey — burning a key number here leaves a
    // permanent gap in the sequence.
    const inOps = await tracker.run(["create", "Three", "--project", "Ops"]);
    expect(inOps).toContain("OPS-1");

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
    // third kept OPS-1.
    const keys = await keysOnDisk(tracker.root);
    expect(keys).toEqual(["OPS-1", "OPS-2", "OPS-3"]);
    // The counter itself, which the case names explicitly. Keys on disk
    // alone cannot see a number that was allocated and then abandoned —
    // that leaves a permanent gap in the sequence and reads as correct
    // until the next create.
    expect(await opsNextNumber(tracker.root)).toBe(4);

    // The already-in-Ops task is reported as unchanged, not as a rekey.
    expect(await historyFor(tracker.root, "OPS-1")).toEqual([]);
    await expect(status).not.toContainText("OPS-1 →");

    // Each moved task carries its former key, whichever project it came
    // from. Newest-first ordering: API-1 was created last, so it rekeys
    // first.
    expect(await historyFor(tracker.root, "OPS-2")).toEqual(["API-1"]);
    expect(await historyFor(tracker.root, "OPS-3")).toEqual([seeded[0]]);
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
  test("BLK-10: Undo is reachable without scrolling on a full page", async ({
    page,
    tracker,
  }) => {
    // Enough rows that the result bar would otherwise render below the
    // fold — it sits after the table, and BLK-10's Undo is the *only*
    // safety net, since archive deliberately has no confirmation.
    await tracker.seedBulk(60);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText(/Showing 1–\d+ of 60/)).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Archive", exact: true }).click();

    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();
    // In the viewport without scrolling: an undo the user has to go
    // looking for is not an undo.
    const box = await undo.boundingBox();
    const height = page.viewportSize()?.height ?? 0;
    expect(box).not.toBeNull();
    expect(box?.y ?? Infinity).toBeLessThan(height);
    await expect(undo).toBeInViewport();
  });

  // @verifies BLK-10
  test("BLK-10: the archived tasks are visible under the archived-scope control", async ({
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

    await page.getByTestId("view-actions-menu").click();
    await page.getByTestId("view-actions-archived-scope").selectOption("all");
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

test.describe("BLK — concurrency and scale", () => {
  // @verifies BLK-22
  test("BLK-22: a task deleted by another process is named as a failure, not counted as a success", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([
      { title: "One" }, { title: "Two" }, { title: "Three" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    // Another process removes one of the selected tasks after it was
    // selected and before the batch runs.
    await tracker.run(["delete", String(seeded[0]), "--yes"]);

    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    // Not "3 tasks updated": the count is honest and the failure is
    // named individually with the reason core gave.
    await expect(status).toContainText("2 tasks updated, 1 failed");
    await expect(status).toContainText(String(seeded[0]));
    await expect(status).toContainText("not found");
    await expect(status).not.toContainText("3 tasks updated");
  });

  // @verifies BLK-23
  test("BLK-23: a bulk write does not clobber a field the CLI changed mid-selection", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    // The CLI changes a field the bulk op was never asked to touch.
    await tracker.run(["set", String(seeded[0]), "priority", "high"]);

    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();
    await expect(
      page.getByRole("region", { name: "Bulk actions" }).getByRole("status"),
    ).toContainText("2 tasks updated");

    // The status change landed on both, and the CLI's priority survived
    // — a read-modify-write of the whole record would have lost it.
    const shown = await tracker.run(["show", String(seeded[0])]);
    expect(shown).toContain("high");
    expect(shown.toLowerCase()).toContain("done");
  });
});

test.describe("BLK — bounded and honest failures", () => {
  // @verifies BLK-41
  test("BLK-41: a bulk request that never returns says the outcome is unknown", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    // Shorten the client deadline so the spec does not wait 30s. The
    // production value is 30s; Playwright's clock control does not reach
    // AbortSignal.timeout, so the deadline itself has to be short.
    await page.addInitScript(() => {
      (globalThis as { __LOCTT_BULK_TIMEOUT_MS__?: number }).__LOCTT_BULK_TIMEOUT_MS__ = 500;
    });
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    // The count line is the settle signal: select-all on a table
    // that has not rendered checks nothing, then unchecks itself
    // when the rows arrive.
    await expect(page.getByText(/Showing 1–\d+ of \d+/)).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    // The server accepts the request and never answers.
    await page.route(/\/api\/tasks\/bulk\/archive/, () => {
      // Deliberately never resolved: the request is in flight until the
      // client's own deadline fires.
    });
    await page.getByRole("button", { name: "Archive", exact: true }).click();

    const status = page.getByRole("status").filter({ hasText: "did not respond" });
    // All three, per P4's rare exception: what was attempted, what state
    // the data is in, what to do.
    await expect(status).toContainText("2 tasks");
    await expect(status).toContainText("Some may have been archived");
    await expect(status).toContainText("Reload");
    // And neither of the two claims it cannot support.
    await expect(status).not.toContainText("Nothing was archived");
    await expect(status).not.toContainText("2 tasks archived");
  });
});

test.describe("BLK — lock contention", () => {
  // @verifies BLK-42
  test("BLK-42: a bulk op blocked by the state lock names the contention and what to do", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    // The count line is the settle signal: select-all on a table
    // that has not rendered checks nothing, then unchecks itself
    // when the rows arrive.
    await expect(page.getByText(/Showing 1–\d+ of \d+/)).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    // Hold the state lock the way another LocTT process would.
    await mkdir(path.join(tracker.root, ".loctt", "state.yaml.lock"), { recursive: true });

    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    // Names the contention and advises waiting.
    await expect(status).toContainText("another LocTT process is writing");
    await expect(status).toContainText(/wait|try again/i);
    // No proper-lockfile internals and no stack trace (ERR-16).
    await expect(status).not.toContainText("Lock file is already being held");
    await expect(status).not.toContainText("ELOCKED");

    // Retrying once the lock clears succeeds.
    await rm(path.join(tracker.root, ".loctt", "state.yaml.lock"), { recursive: true });
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();
    await expect(status).toContainText("2 tasks updated");
  });
});

test.describe("BLK — scale", () => {
  const AT_SCALE = 5_000;

  // @verifies BLK-24
  test("BLK-24: select-all on a page stays responsive at 5,000 tasks", async ({
    page,
    tracker,
  }) => {
    await tracker.seedBulk(AT_SCALE);
    await page.goto(`${tracker.baseURL}/list`);

    // Page size is 50; the filter behind it holds 5,000.
    //
    // This is the settle gate, not the measurement. `/api/tasks`
    // re-reads all 5,000 task files per request (~1–3s on an idle
    // machine, more with four sibling workers seeding and serving),
    // and the default 5s expect budget left it no headroom — this
    // gate was the one line that failed under `--workers` and passed
    // alone. The case's subject is the *selection* staying responsive,
    // and those assertions below keep their strict budgets, all
    // started only after rows are on screen. (`tbody tr` is no gate
    // at all: the loading skeleton renders eight <tr>s.)
    await expect(page.getByText(`Showing 1–50 of ${String(AT_SCALE)}`))
      .toBeVisible({ timeout: 20_000 });

    const selectAll = page.getByRole("checkbox", { name: "Select all on this page" });
    const started = Date.now();
    await selectAll.check();
    // The count updates on the toggle itself, not after a debounce long
    // enough to look broken.
    await expect(page.getByText("50 tasks selected")).toBeVisible({ timeout: 2_000 });
    expect(Date.now() - started).toBeLessThan(2_000);

    // Load more and select again, up to the 500 the case names. The
    // bullet is about the *selection* degrading, not the filter size,
    // so stopping at 100 would leave the curve it targets untested.
    for (let loaded = 100; loaded <= 500; loaded += 50) {
      await selectAll.uncheck();
      await page.getByRole("button", { name: /Load more/i }).click();
      // Same reasoning as the first gate: each Load more is another
      // full-tracker scan on the server, and it is not the thing this
      // case times. The `round` clock starts after it.
      await expect(
        page.getByText(`Showing 1–${String(loaded)} of ${String(AT_SCALE)}`),
      ).toBeVisible({ timeout: 20_000 });
      const round = Date.now();
      await selectAll.check();
      await expect(
        page.getByText(`${String(loaded)} tasks selected`),
      ).toBeVisible({ timeout: 2_000 });
      // Each toggle stays sub-second-ish at every size — no drift into
      // multi-second checkbox toggles as the selection grows.
      expect(Date.now() - round).toBeLessThan(3_000);
    }
  });

  // @verifies BLK-34
  test("BLK-34: exporting 5,000 rows completes with every row present", async ({
    page,
    tracker,
  }) => {
    await tracker.seedBulk(AT_SCALE);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export/i }).click();
    await page.getByRole("menuitem", { name: /CSV/i }).click();

    // A pending state, so a multi-second export does not look like a
    // menu that closed and did nothing.
    await expect(page.getByRole("button", { name: /Export/i }))
      .toContainText("Preparing");

    const file = await (await download).path();
    const text = await readFile(file, "utf8");
    // Header plus one line per task. These fixtures have no body and no
    // labels, so no field can hold an embedded newline and a line count
    // is exact here — the case's "allowing for quoted embedded
    // newlines" caveat is about real data, and CSV quoting is covered
    // by the round-trip test in the export suite rather than at scale.
    const rows = text.trimEnd().split("\n").length;
    expect(rows).toBe(AT_SCALE + 1);
    // Every row actually made it, not just the right count of something.
    expect(text).toContain("Bulk task 1,");
    expect(text).toContain(`Bulk task ${String(AT_SCALE)},`);

    // The page is still usable afterwards — the export did not leave it
    // wedged.
    await expect(page.getByText(`Showing 1–50 of ${String(AT_SCALE)}`)).toBeVisible();
  });
});

test.describe("BLK — picker vocabularies", () => {
  // @verifies BLK-6
  test("BLK-6: priorities are ordered by value and offer a clear", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();

    await page.getByRole("button", { name: "Set priority" }).click();
    const menu = page.getByRole("menu", { name: "Set priority" });
    const items = await menu.getByRole("menuitem").allInnerTexts();

    // Clear comes first, then the configured priorities in `value`
    // order — a ranked list shown in file order makes the user think.
    expect(items[0]).toContain("Clear priority");
    const wf = JSON.parse(
      await (await fetch(`${tracker.baseURL}/api/workflow`)).text(),
    ) as { priorities: { key: string; label: string; value?: number }[] };
    const expected = [...wf.priorities]
      .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))
      .map(p => p.label);
    expect(items.slice(1)).toEqual(expected);

    // Clearing unsets rather than writing an empty string.
    const sent: unknown[] = [];
    await page.route(/\/api\/tasks\/bulk\/set/, async route => {
      const body = route.request().postDataJSON() as {
        changes: { field: string; value: unknown }[];
      };
      for (const c of body.changes) if (c.field === "priority") sent.push(c.value);
      await route.continue();
    });
    await menu.getByRole("menuitem", { name: "Clear priority" }).click();
    await expect(
      page.getByRole("region", { name: "Bulk actions" }).getByRole("status"),
    ).toContainText("1 task updated");
    expect(sent).toEqual([null]);
  });

  // @verifies BLK-17
  test("BLK-17: a picker with nothing to offer says why instead of opening onto nothing", async ({
    page,
    tracker,
  }) => {
    // A fresh tracker has no milestones and no sprints.
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();

    const bar = page.getByRole("region", { name: "Bulk actions" });
    const milestone = bar.getByRole("button", { name: "Set milestone" });
    await expect(milestone).toBeDisabled();
    await expect(milestone).toHaveAttribute("title", /No milestones defined/);
    await expect(bar.getByRole("button", { name: "Set sprint" })).toBeDisabled();

    // And it becomes usable once the workspace has one.
    await tracker.run(["milestone", "create", "v1"]);
    await page.reload();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();
    await expect(bar.getByRole("button", { name: "Set milestone" })).toBeEnabled();
  });
});

test.describe("BLK — selection across views", () => {
  // @verifies BLK-19
  test("BLK-19: paginating keeps the count honest and the header reflects the new page", async ({
    page,
    tracker,
  }) => {
    await tracker.seedBulk(120);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–50 of 120")).toBeVisible();

    const selectAll = page.getByRole("checkbox", { name: "Select all on this page" });
    await selectAll.check();
    await expect(page.getByText("50 tasks selected")).toBeVisible();

    await page.getByRole("button", { name: /Load more/i }).click();
    await expect(page.getByText("Showing 1–100 of 120")).toBeVisible();

    // The count is unchanged — the newly loaded rows are not selected —
    // and the header no longer claims the whole page is checked.
    await expect(page.getByText("50 tasks selected")).toBeVisible();
    await expect(selectAll).not.toBeChecked();
    const checked = await page.locator("tbody input[type=checkbox]:checked").count();
    expect(checked).toBe(50);

    // Selecting all now covers everything loaded.
    await selectAll.check();
    await expect(page.getByText("100 tasks selected")).toBeVisible();
  });

  // @verifies BLK-20
  test("BLK-20: sorting moves rows without moving the selection", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Alpha", fields: { priority: "low" } },
      { title: "Bravo", fields: { priority: "high" } },
      { title: "Charlie", fields: { priority: "medium" } },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    // Select one task by name, not by row index.
    const alphaRow = page.locator("tbody tr").filter({ hasText: "Alpha" });
    await alphaRow.locator("input[type=checkbox]").check();
    await expect(page.getByText("1 task selected")).toBeVisible();

    await page.getByRole("button", { name: /Priority/i }).first().click();
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    // The same task is still checked wherever it landed, and the count
    // is unchanged — selection is by task id, never by row position.
    await expect(page.getByText("1 task selected")).toBeVisible();
    await expect(
      page.locator("tbody tr").filter({ hasText: "Alpha" }).locator("input[type=checkbox]"),
    ).toBeChecked();
    expect(await page.locator("tbody input[type=checkbox]:checked").count()).toBe(1);
  });

  // @verifies BLK-25
  test("BLK-25: a bulk op spans projects and rekeys nothing", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BACKEND"]);
    const seeded = await tracker.seed([{ title: "One" }]);
    const other = await tracker.run(["create", "Two", "--project", "Backend"]);
    expect(other).toContain("BACKEND-1");

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    // Both projects, not silently scoped to the active one.
    await expect(
      page.getByRole("region", { name: "Bulk actions" }).getByRole("status"),
    ).toContainText("2 tasks updated");

    // Each keeps its own key — a field change rekeys nothing.
    // Filtered by key rather than title: the row's accessible text
    // includes the checkbox label, so "One" also matches a row whose
    // key happens to contain it.
    const rows = page.locator("tbody tr");
    await expect(rows.filter({ hasText: String(seeded[0]) })).toContainText("One");
    await expect(rows.filter({ hasText: "BACKEND-1" })).toContainText("Two");
  });
});

test.describe("BLK — refused and stale writes", () => {
  // @verifies BLK-27
  test("BLK-27: archiving a mixed selection distinguishes changed from already-archived", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([
      { title: "One" }, { title: "Two" }, { title: "Three" },
    ]);
    await tracker.run(["archive", String(seeded[0])]);

    await page.goto(`${tracker.baseURL}/list`);
    await page.getByTestId("view-actions-menu").click();
    await page.getByTestId("view-actions-archived-scope").selectOption("all");
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    await page.getByRole("button", { name: "Archive", exact: true }).click();

    // Two groups, distinguished. Not "3 tasks archived" — one of them
    // already was, and saying otherwise overstates the change. Not an
    // error either: refusing would make archiving a mixed selection
    // impossible.
    const status = page.getByRole("status").filter({ hasText: "archived" });
    await expect(status).toContainText("2 tasks archived");
    await expect(status).toContainText("1 already archived");
    await expect(status).not.toContainText("3 tasks archived");
    await expect(status).not.toContainText("failed");
  });

  // @verifies BLK-28
  test("BLK-28: assigning an archived user is refused, and nothing is partially written", async ({
    page,
    tracker,
  }) => {
    const gone = await tracker.run(["user", "create", "Gone"]);
    const goneId = /([0-9A-Z]{26})/.exec(gone)?.[1] ?? "";
    expect(goneId).not.toBe("");
    const seeded = await tracker.seed([{ title: "One" }, { title: "Two" }]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    // The count line is the settle signal: select-all on a table
    // that has not rendered checks nothing, then unchecks itself
    // when the rows arrive.
    await expect(page.getByText(/Showing 1–\d+ of \d+/)).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    // The user is archived after the picker was populated — the stale
    // vocabulary the case describes.
    await tracker.run(["user", "archive", "Gone"]);

    await page.getByRole("button", { name: "Set assignee" }).click();
    await page.getByRole("menu", { name: "Set assignee" })
      .getByRole("menuitem", { name: "Gone" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    // Zero succeeded, with the reason and what to do.
    await expect(status).toContainText(/archived/i);
    await expect(status).toContainText(/unarchive/i);
    await expect(status).not.toContainText("2 tasks updated");

    // And nothing was written: the whole change set was invalid, so no
    // task is half-updated.
    for (const key of seeded) {
      expect(await tracker.run(["show", String(key)])).not.toContain(goneId);
    }
  });
});

test.describe("BLK — stale vocabulary and export columns", () => {
  // @verifies BLK-29
  test("BLK-29: a status deleted between load and apply fails with the key named", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    // The count line is the settle signal: select-all on a table
    // that has not rendered checks nothing, then unchecks itself
    // when the rows arrive.
    await expect(page.getByText(/Showing 1–\d+ of \d+/)).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    // The picker holds a status the config no longer has. Rewriting the
    // outgoing value is the same state the case describes — a menu
    // opened before the workflow changed underneath it.
    await page.route(/\/api\/tasks\/bulk\/set/, async route => {
      const body = route.request().postDataJSON() as {
        refs: string[]; changes: { field: string; value: unknown }[];
      };
      await route.continue({
        postData: JSON.stringify({
          ...body,
          changes: [{ field: "status", value: "deleted_status" }],
        }),
      });
    });

    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    // The unknown key is named — not "invalid value" with nothing to
    // act on — and nothing was applied.
    await expect(status).toContainText("deleted_status");
    await expect(status).not.toContainText("2 tasks updated");
  });

  // @verifies BLK-29
  test("BLK-29: a status the workflow no longer defines renders as drift", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Orphan" }, { title: "Fine" }]);
    // Orphan the first task's status by removing it from the config,
    // which is what a pulled workflow.yaml does.
    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const file = path.join(tasksDir, id, "task.md");
      const text = await readFile(file, "utf8");
      if (!text.includes(`key: ${String(seeded[0])}`)) continue;
      await writeFile(file, text.replace(/^status: .+$/m, "status: gone_status"), "utf8");
    }

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Not blank, and not the same grey as a valid status — the raw key
    // rendered identically hides that the config moved underneath.
    const orphanRow = page.locator("tbody tr").filter({ hasText: String(seeded[0]) });
    await expect(orphanRow).toContainText("gone_status");
    await expect(orphanRow.getByTitle(/not defined in workflow\.yaml/)).toBeVisible();
    // The healthy row carries no such marker.
    await expect(
      page.locator("tbody tr").filter({ hasText: "Fine" })
        .getByTitle(/not defined in workflow\.yaml/),
    ).toHaveCount(0);
  });

  // @verifies BLK-36
  test("BLK-36: the default export carries core's columns and no custom fields", async ({
    page,
    tracker,
  }) => {
    // A task with a custom field, which must not add a column unasked.
    // Custom fields have to be declared in workflow.yaml before a task
    // can carry one — a bare `set` is refused.
    const seeded = await tracker.seed([{ title: "One" }]);
    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    await writeFile(
      cfg,
      (await readFile(cfg, "utf8")).replace(
        "custom_fields: []",
        "custom_fields:\n  - key: team\n    label: Team\n    type: string\n"
        + "    multi: false\n    searchable: false",
      ),
      "utf8",
    );
    await tracker.run(["set", String(seeded[0]), "team", "platform"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export/i }).click();
    await page.getByRole("menuitem", { name: /CSV/i }).click();
    const header = (await readFile(await (await download).path(), "utf8"))
      .split("\n")[0] ?? "";

    // Core owns the default column set; the export must not invent one.
    expect(header.split(",")).toEqual([...DEFAULT_EXPORT_COLUMNS]);
    // A sparse per-project custom field is not a default column.
    expect(header).not.toContain("team");
    expect(header).not.toContain("fields.");
  });
});

test.describe("BLK — failures that must not be silent", () => {
  // @verifies BLK-21
  test("BLK-21: shift-click never behaves as select-all", async ({ page, tracker }) => {
    await tracker.seed([
      { title: "One" }, { title: "Two" }, { title: "Three" },
      { title: "Four" }, { title: "Five" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–5 of 5")).toBeVisible();

    const boxes = page.locator("tbody input[type=checkbox]");
    await boxes.nth(0).check();
    await boxes.nth(3).click({ modifiers: ["Shift"] });

    // Range selection is optional (the case allows plain-click
    // behaviour), but the one outcome it rules out is a shift-click
    // that selects everything.
    const checked = await page.locator("tbody input[type=checkbox]:checked").count();
    expect(checked).toBeGreaterThanOrEqual(2);
    expect(checked).toBeLessThan(5);
    // Whichever behaviour is implemented, the shift-clicked row itself
    // is selected and the rows outside the range are not. That is what
    // separates "plain click" from "select-all", and a count alone
    // cannot tell them apart.
    await expect(boxes.nth(3)).toBeChecked();
    await expect(boxes.nth(4)).not.toBeChecked();
  });

  // @verifies BLK-43
  test("BLK-43: a failed export is reported, not just an absent download", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();

    await page.route(/\/api\/tasks\/export/, async route => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "io_failed", message: "disk is full" }),
      });
    });

    await page.getByRole("button", { name: /Export/i }).click();
    await page.getByRole("menuitem", { name: /CSV/i }).click();

    // The absence of a file is not the only signal.
    const status = page.getByRole("status").filter({ hasText: /export/i });
    await expect(status).toContainText(/could not|failed/i);
    await expect(status).toContainText("disk is full");
    await expect(status.getByRole("button", { name: /Retry|Try again/i })).toBeVisible();
  });

  // @verifies BLK-48
  test("BLK-48: a network drop mid-bulk reports unknown state and points at reload", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    // The count line is the settle signal: select-all on a table
    // that has not rendered checks nothing, then unchecks itself
    // when the rows arrive.
    await expect(page.getByText(/Showing 1–\d+ of \d+/)).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    // The connection drops after the request left — indistinguishable,
    // from the client, from a server that received and applied it.
    await page.route(/\/api\/tasks\/bulk\/archive/, route => route.abort("connectionreset"));
    await page.getByRole("button", { name: "Archive", exact: true }).click();

    const status = page.getByRole("status").filter({ hasText: /archiv/i });
    await expect(status).toContainText(/could not|did not/i);
    // It must not claim either outcome.
    await expect(status).not.toContainText("2 tasks archived");
  });
});

test.describe("BLK — batch cap", () => {
  // @verifies BLK-47
  test("BLK-47: selecting past the API's cap states the limit rather than failing opaquely", async ({
    page,
    tracker,
  }) => {
    await tracker.seedBulk(600);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–50 of 600")).toBeVisible();

    const selectAll = page.getByRole("checkbox", { name: "Select all on this page" });
    for (let loaded = 100; loaded <= 550; loaded += 50) {
      await selectAll.uncheck();
      await page.getByRole("button", { name: /Load more/i }).click();
      await expect(
        page.getByText(`Showing 1–${String(loaded)} of 600`),
      ).toBeVisible();
      await selectAll.check();
    }
    await expect(page.getByText("550 tasks selected")).toBeVisible();

    // The cap is stated at selection time, before anything is sent —
    // not left to the server's validator, whose message is jargon
    // (ERR-16) and which costs a round trip that cannot succeed.
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar).toContainText("at most 500 tasks at once");
    await expect(bar).toContainText("550 are selected");
    // And the actions that would be refused are not offered.
    await expect(bar.getByRole("button", { name: "Set status" })).toBeDisabled();
    await expect(bar.getByRole("button", { name: "Archive", exact: true })).toBeDisabled();

    // Dropping back under the cap re-enables them.
    await selectAll.uncheck();
    await page.locator("tbody input[type=checkbox]").first().check();
    await expect(bar.getByRole("button", { name: "Set status" })).toBeEnabled();
  });
});

test.describe("BLK — corrupt and archived edges", () => {
  // @verifies BLK-46
  test("BLK-46: moving to a project archived mid-flight is refused and burns no key", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Ops", "--prefix", "OPS"]);
    const seeded = await tracker.seed([{ title: "One" }]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();

    // Archived after the picker was populated.
    await tracker.run(["project", "archive", "Ops"]);

    await page.getByRole("button", { name: "Move to project" }).click();
    await page.getByRole("menu", { name: "Move to project" })
      .getByRole("menuitem", { name: "Ops" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    await expect(status).toContainText(/archiv/i);
    await expect(status).not.toContainText("1 task moved");

    // The source task is untouched and no OPS number was consumed.
    const state = await readFile(
      path.join(tracker.root, ".loctt", "state.yaml"), "utf8",
    );
    expect(/prefix: OPS\n\s+next_number: 1/.test(state)).toBe(true);
    expect(await tracker.run(["show", String(seeded[0])])).toContain(String(seeded[0]));
  });
});

test.describe("LST — filtering by an entity", () => {
  // @verifies LST-9
  test("LST-9: filtering by assignee returns that user's tasks, not everyone's", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Ann"]);
    const seeded = await tracker.seed([{ title: "Hers" }, { title: "Not hers" }]);
    await tracker.run(["set", String(seeded[0]), "assignee", "Ann"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Filter through the real API, the way the filter bar does: the
    // value is a ULID, and every ULID starts with a digit.
    const assignee = await frontmatterValue(tracker.root, String(seeded[0]), "assignee");
    const res = await page.request.get(
      `${tracker.baseURL}/api/tasks?assignee=${assignee}`,
    );
    // Not a 400. The DSL builder passed bare identifiers through
    // unquoted on the premise that "all ids are bare identifiers" —
    // false for a ULID, so the tokenizer read `01` as a number and
    // rejected every entity filter while the chip still claimed to be
    // applied.
    expect(res.status()).toBe(200);
    const body = await res.json() as { items: { title: string }[]; total: number };
    expect(body.total).toBe(1);
    expect(body.items.map(t => t.title)).toEqual(["Hers"]);
  });
});

/** One frontmatter value from the task holding `key`. */
async function frontmatterValue(root: string, key: string, field: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    if (!new RegExp(`^key: ${key}$`, "m").test(text)) continue;
    return new RegExp(`^${field}: (.+)$`, "m").exec(text)?.[1]?.trim() ?? "";
  }
  return "";
}

test.describe("ERR — the server dies mid-session", () => {
  // @verifies ERR-1
  test("ERR-1: a dead server is stated, not left as rows that answer nothing", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Every subsequent request fails, the way a killed server behaves.
    await page.route(/\/api\//, route => route.abort("connectionrefused"));

    // The user does the most ordinary thing available: reloads.
    await page.reload();

    // A server that is down and a tracker that is empty must be
    // visibly different screens — conflating them reads as data loss.
    await expect(page.getByText(/No tasks match these filters/i)).toHaveCount(0);

    // This spec asserted a "Something went wrong" heading until
    // 2026-08-28 — `FatalError`'s copy, from a full-page error that
    // replaced the shell. The M1 gate ruled that a blocker (F1): it
    // contradicted SHL-41 and ERR-1 both, since a page with no shell
    // has no banner and no retry button either. The test was green
    // and encoding the wrong behaviour.
    //
    // ERR-1's own bullets are what is asserted now.

    // "The message says the LocTT server is not responding and that it
    // may have been stopped in the terminal where `loctt ui` was run."
    const banner = page.locator("[data-server-unreachable]");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner).toContainText(/not responding/i);
    await expect(banner).toContainText(/loctt ui/);

    // "It does not blame the user's network — there is no network
    // involved in a localhost app."
    await expect(banner).not.toContainText(/network|offline|connection/i);

    // "A retry control is present and is a button the user can press,
    // not a sentence telling them to refresh."
    await expect(banner.getByRole("button")).toBeVisible();

    // And the shell survives, so the user can still navigate — the
    // whole point of the gate's F1.
    await expect(page.getByLabel("Toggle sidebar")).toBeVisible();
  });
});

test.describe("ERR — a filter applied against a dead server", () => {
  // @verifies ERR-2
  test("ERR-2: stale rows are never shown under a filter that never ran", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(
      Array.from({ length: 14 }, (_unused, i) => ({
        title: `Task ${String(i + 1)}`,
        fields: { status: "in_progress" },
      })),
    );

    // Land already filtered, so rows are loaded under one query key
    // before the next one fails. Starting unfiltered empties `items`
    // and hides the defect.
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–14 of 14")).toBeVisible();

    // The server dies mid-session. No reload — a reload routes through
    // the shell's boundary, which is a fresh boot rather than the
    // mid-session failure the journey names.
    await page.route(/\/api\/tasks(\?|$)/, route => route.abort("failed"));

    // A second filter, so the query key changes while rows are held.
    await page.getByRole("button", { name: "Filter Priority" }).click();
    await page.getByRole("menuitemcheckbox", { name: /Critical/i }).click();

    // The table must not keep rows fetched for the previous filter,
    // under chips claiming the new one, with a footer asserting a count
    // for a query that never ran.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Showing 1–14 of 14")).toHaveCount(0);
    await expect(page.locator("tbody").getByText("Task 1", { exact: true }))
      .toHaveCount(0);
  });

});

test.describe("SHL — narrow viewports", () => {
  // @verifies SHL-1
  test("SHL-1: the sidebar collapses on a narrow viewport and returns when there is room", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr").first()).toBeVisible();

    const aside = page.locator("aside");
    await expect(aside).toHaveAttribute("data-collapsed", "false");

    // Narrow. At 532px the expanded sidebar took 240px and left the
    // table 165px — the content the user came for was the smallest
    // thing on screen.
    await page.setViewportSize({ width: 532, height: 800 });
    await expect(aside).toHaveAttribute("data-collapsed", "true");
    // The width transitions over 150ms; poll rather than measure once.
    await expect
      .poll(() => aside.evaluate(el => el.getBoundingClientRect().width))
      .toBeLessThan(80);

    // The table stays reachable. Clipping it made seven of ten columns
    // unreachable by any input, which is worse than honest overflow.
    const wrapper = page.locator("table").locator("xpath=ancestor::div[1]");
    expect(await wrapper.evaluate(el => getComputedStyle(el).overflowX))
      .toBe("auto");

    // The toggle is ENABLED at narrow width (R2 / A173): it opens the
    // sidebar as a transient off-canvas overlay so a phone user can read
    // and dismiss it. The original "disabled toggle" guarded against a
    // narrow-width click being *stored* and resurfacing at a wide width;
    // A173 solves that differently — the mobile-open state is transient
    // and never written to the stored preference — so the concern holds
    // without disabling the control. (This replaces the superseded
    // disabled-toggle assertion; see decisions.md A173.)
    const toggle = page.getByRole("button", { name: /Toggle sidebar/i });
    await expect(toggle).toBeEnabled();

    // Open the overlay at narrow width, then widen. The stored preference
    // must be untouched — a rotation must not silently discard a choice,
    // and the transient mobile-open must not have been persisted.
    await toggle.click();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(aside).toHaveAttribute("data-collapsed", "false");
    await expect(toggle).toBeEnabled();
  });
});

test.describe("ERR — the browser reports offline", () => {
  // @verifies ERR-1
  test("ERR-1: a loopback server stays usable when the browser thinks it is offline", async ({
    page,
    context,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // `context.setOffline` flips the browser's own online flag, which
    // killing the server process never does — and that flag is what
    // decides whether a failed query settles into an error or pauses
    // forever. The server here is untouched and reachable on loopback:
    // a laptop with Wi-Fi off is exactly this state.
    await context.setOffline(true);

    // An in-page filter change rather than a reload: `setOffline` blocks
    // the document fetch too, and the question here is whether the app
    // stops issuing XHRs, not whether Chromium will load a page.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menuitemcheckbox", { name: /In progress/i }).click();

    // The request still goes out and still answers, because a localhost
    // app must not take the browser's word for whether its own server
    // is reachable.
    //
    // **This spec does not pin the fix**: it passes with
    // `networkMode: "online"` too, because Chromium's offline flag and
    // TanStack's `onlineManager` are not the same thing — the manager
    // seeds from `navigator.onLine` at import time and only updates on
    // the window's online/offline events, which fire here after the
    // client already exists. `ListView.paused.test.tsx` is the guard;
    // it drives `onlineManager` directly and goes red without
    // `networkMode: "always"`. This one is kept because it exercises a
    // real browser in a state the unit test can only simulate.
    await expect(page.getByText(/Showing 1–\d+ of \d+/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/No tasks match these filters/i)).toHaveCount(0);

    await context.setOffline(false);
  });
});

test.describe("LST — sort validation and the detail stub", () => {
  // @verifies LST-29
  test("LST-29: an unknown sort key falls back visibly rather than erroring", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);

    // A pasted URL with a typo is a bad sort, not a bad request.
    await page.goto(`${tracker.baseURL}/list?sort=nonexistent_field&dir=asc`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // No sort indicator on a column that is not actually sorting —
    // that would misreport the order. The arrows on the headers are
    // the affordance, not the state; the *active* one is what must not
    // appear.
    expect(await page.locator("thead th[aria-sort]").count()).toBe(0);

    // And the assertion above means something: a *valid* sort does
    // mark its column, so "no marked column" is a real observation
    // rather than an attribute that is never set.
    await page.goto(`${tracker.baseURL}/list?sort=title&dir=asc`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    expect(await page.locator("thead th[aria-sort]").count()).toBe(1);

    // The unrecognised key produces the default order rather than an
    // error or an empty table.
    //
    // This does not distinguish "dropped at the boundary" from "passed
    // through and sorted nothing" — both yield insertion order, so no
    // black-box assertion can tell them apart. What it does pin is the
    // case's own bullets: the list renders, and no column claims to be
    // sorting. The boundary check exists so the key never reaches the
    // comparator at all, which is a correctness margin rather than an
    // observable difference.
    const bad = await (await page.request.get(
      `${tracker.baseURL}/api/tasks?sort=nonexistent_field&dir=asc`,
    )).json() as { items: { key: string }[] };
    const none = await (await page.request.get(
      `${tracker.baseURL}/api/tasks`,
    )).json() as { items: { key: string }[] };
    expect(bad.items.map(t => t.key)).toEqual(none.items.map(t => t.key));

    // A real field still sorts, and a custom one is accepted.
    expect((await page.request.get(`${tracker.baseURL}/api/tasks?sort=title`)).status())
      .toBe(200);
    expect((await page.request.get(`${tracker.baseURL}/api/tasks?sort=fields.impact`)).status())
      .toBe(200);
  });

  // @verifies TSK-1
  test("TSK-1: the task-detail stub names the task, not the route pattern", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/tasks/${String(seeded[0])}`);

    // The route *pattern* was rendered as the page's name, so clicking
    // a task landed on "/tasks/$key" — which reads as a templating bug
    // rather than an unbuilt view.
    await expect(page.getByText(String(seeded[0]))).toBeVisible();
    await expect(page.getByText("$key")).toHaveCount(0);
  });
});

test.describe("LST — table behaviour (M1.2)", () => {
  // @verifies LST-8
  test("LST-8: a filter matching nothing offers a way out, and is not the empty-tracker state", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One", fields: { status: "in_progress" } }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Done" }).click();

    const body = page.locator("tbody");
    await expect(body).toContainText("No tasks match these filters");
    // Distinct from the fresh-tracker state, which invites creating a
    // first task rather than clearing filters the user never set.
    await expect(body).not.toContainText(/create your first|get started/i);
    // The chips stay, so the user can see *why* nothing matched.
    await expect(page.getByText(/Status:/)).toBeVisible();

    // And the action works without a reload.
    await body.getByRole("button", { name: "Clear filters" }).click();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.getByText(/Status:/)).toHaveCount(0);
  });

  // @verifies LST-5
  test("LST-5: a row opens its task, and Back restores the filtered view", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([
      { title: "Wanted", fields: { status: "in_progress" } },
      { title: "Other" },
    ]);
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.locator("tbody tr").first().getByText("Wanted").click();
    // The user-facing key, never the ULID (P-4).
    await expect(page).toHaveURL(new RegExp(`/tasks/${String(seeded[0])}$`));

    await page.goBack();
    // Back restores the filter, not a reset default list.
    await expect(page).toHaveURL(/status=in_progress/);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
  });

  // @verifies LST-7
  test("LST-7: a slow first load shows a skeleton, never the empty state", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);

    let release: (() => void) | undefined;
    const held = new Promise<void>(r => { release = r; });
    await page.route(/\/api\/tasks(\?|$)/, async route => {
      await held;
      await route.continue();
    });

    await page.goto(`${tracker.baseURL}/list`);

    // A skeleton with the right column count, not a blank pane. And
    // never "No tasks match these filters" — a slow request must not
    // momentarily claim the tracker is empty.
    await expect(page.locator("tbody tr").first()).toBeVisible();
    await expect(page.getByText(/No tasks match these filters/i)).toHaveCount(0);

    release?.();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
  });

  // @verifies LST-4
  test("LST-4: priorities without a value sort alphabetically by key", async ({
    page,
    tracker,
  }) => {
    // **The case's premise, which this test used to skip.** LST-4 is
    // about priorities "declared without `value`" — and the default
    // workflow gives all four a value, so seeding against defaults
    // exercises the ordinary numeric path and never the fallback.
    const wf = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    await writeFile(
      wf,
      (await readFile(wf, "utf8")).replace(/^\s*value:\s*\d+\s*$/gm, ""),
      "utf8",
    );

    // Seeded in an order that is neither alphabetical nor reverse, so
    // "sorted" cannot coincide with "as inserted".
    await tracker.seed([
      { title: "Seeded first", fields: { priority: "medium" } },
      { title: "Seeded second", fields: { priority: "critical" } },
      { title: "Seeded third", fields: { priority: "low" } },
      { title: "Seeded fourth", fields: { priority: "high" } },
    ]);

    const order = async (): Promise<string[]> => {
      await page.goto(`${tracker.baseURL}/list?sort=priority&dir=asc`);
      await expect(page.getByText("Showing 1–4 of 4")).toBeVisible();
      return page.locator("tbody tr").allInnerTexts();
    };

    const first = await order();

    // **Bullet 1: alphabetical by key.** The M1 vacuity sweep found
    // this test survived a *zeroed comparator* — because it only
    // asserted that two loads agree, and insertion order is perfectly
    // deterministic. Determinism is not sortedness, and the case asks
    // for both.
    const rank = first.map(row => {
      const m = /critical|high|low|medium/i.exec(row);
      return m === null ? "" : m[0].toLowerCase();
    });
    expect(rank).toEqual(["critical", "high", "low", "medium"]);

    // Bullet 3: and it is stable across reloads.
    expect(await order()).toEqual(first);
  });
});

test.describe("LST — rows that could break the layout (M1.2)", () => {
  // @verifies LST-19
  test("LST-19: 25 labels clamp to the row height and state the overflow", async ({
    page,
    tracker,
  }) => {
    const flags: string[] = [];
    for (let i = 0; i < 25; i += 1) {
      const name = `label-${String(i)}`;
      await tracker.run(["label", "create", name]);
      flags.push("--label", name);
    }
    // Labels attach at create time via repeated --label; `set` takes an
    // array, not a comma string.
    await tracker.run(["create", "Loaded", ...flags]);
    await tracker.run(["create", "Normal"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    const loaded = page.locator("tbody tr").filter({ hasText: "Loaded" });
    const normal = page.locator("tbody tr").filter({ hasText: "Normal" });

    // The overflow is stated, not silently dropped.
    await expect(loaded.getByText(/^\+\d+$/)).toBeVisible();

    // And the row stays a row: 25 pills wrapping freely turned this
    // into a block tall enough to push later columns out of view.
    const loadedBox = await loaded.boundingBox();
    const normalBox = await normal.boundingBox();
    expect(loadedBox?.height ?? 0).toBeLessThan((normalBox?.height ?? 0) * 2);
  });

  // @verifies LST-20
  test("LST-20: a 400-character title truncates without scrolling the table", async ({
    page,
    tracker,
  }) => {
    const long = "x".repeat(400);
    await tracker.seed([{ title: long }, { title: "Short" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // The stored value is unmodified — truncation is visual only, and
    // the full string is on hover.
    // Newest-first, so the long title is the *second* row.
    await expect(page.locator(`[title="${long}"]`)).toBeVisible();

    // The table does not scroll sideways because of one title.
    const table = page.locator("table");
    const overflow = await table.evaluate(el => {
      const w = el.closest("div");
      return w ? w.scrollWidth - w.clientWidth : 0;
    });
    expect(overflow).toBeLessThan(50);
  });
});

test.describe("LST — references that outlive their config (M1.2)", () => {
  // @verifies LST-25
  test("LST-25: an archived assignee still shows their name, marked archived", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Ann"]);
    await tracker.seed([{ title: "Hers" }]);
    await tracker.run(["set", "T-1", "assignee", "Ann"]);
    await tracker.run(["user", "archive", "Ann"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    const row = page.locator("tbody tr").first();
    // Attribution on old work does not break when someone leaves, and
    // the name is never replaced by a raw ULID.
    await expect(row).toContainText("Ann");
    await expect(row).toContainText("(archived)");
    await expect(row).not.toContainText(/[0-9A-Z]{20}/);
  });

  // @verifies LST-26
  test("LST-26: a task with no project is listed, with the cell marked unknown", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Orphan" }, { title: "Normal" }]);
    // Remove the project the way a bad merge would.
    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const file = path.join(tasksDir, id, "task.md");
      const text = await readFile(file, "utf8");
      if (!text.includes("title: Orphan")) continue;
      await writeFile(file, text.replace(/^project: .+$/m, "project: 01MISSING0000000000000000"), "utf8");
    }

    await page.goto(`${tracker.baseURL}/list`);
    // Listed, not excluded — one config gap does not remove tasks.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    const row = page.locator("tbody tr").filter({ hasText: "Orphan" });
    await expect(row).toContainText("unknown");
    // And never the raw id.
    await expect(row).not.toContainText("01MISSING");
  });
});

test.describe("LST — a deleted status (M1.2)", () => {
  // @verifies LST-24
  test("LST-24: rows survive, the filter drops the option, but a URL still matches", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Stranded", fields: { status: "in_progress" } },
      { title: "Fine" },
    ]);
    // Remove the status from the config while tasks still store it.
    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    const before = await readFile(cfg, "utf8");
    await writeFile(
      cfg,
      before.replace(/^ {2}- key: in_progress\n(?: {4}.+\n)+/m, ""),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    // The rows stay: one config gap does not remove tasks from the list.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    const row = page.locator("tbody tr").filter({ hasText: "Stranded" });
    await expect(row).toContainText("in_progress");
    // Marked unrecognised rather than rendered as an ordinary value.
    await expect(row.getByTitle(/not defined in workflow\.yaml/)).toBeVisible();

    // The dropdown does not offer it as a new filter choice...
    await page.getByRole("button", { name: "Filter Status" }).click();
    await expect(
      page.getByRole("menuitemcheckbox", { name: /In progress|in_progress/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // ...but a URL still carrying it matches, rather than erroring.
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody tr")).toContainText("Stranded");
  });
});

test.describe("LST — drift, unknown keys, and staleness (M1.2)", () => {
  /** Rewrites one frontmatter field on the task holding `key`. */
  async function patchTask(root: string, key: string, edit: (text: string) => string): Promise<void> {
    const tasksDir = path.join(root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const file = path.join(tasksDir, id, "task.md");
      const text = await readFile(file, "utf8");
      if (!new RegExp(`^key: ${key}$`, "m").test(text)) continue;
      await writeFile(file, edit(text), "utf8");
      return;
    }
    throw new Error(`no task with key ${key}`);
  }

  // @verifies LST-27
  test("LST-27: an unknown priority is flagged, sorts deterministically, and still counts", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([
      { title: "Odd" }, { title: "Normal", fields: { priority: "high" } },
    ]);
    await patchTask(tracker.root, String(seeded[0]), t =>
      `${t.trimEnd().replace(/\n---\n?$/, "")}\npriority: urgent\n---\n`);

    await page.goto(`${tracker.baseURL}/list?sort=priority&dir=asc`);
    // The total still includes it — an unknown value does not drop the
    // row from the sorted set.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    const row = page.locator("tbody tr").filter({ hasText: "Odd" });
    await expect(row).toContainText("urgent");
    await expect(row.getByTitle(/not defined in workflow\.yaml/)).toBeVisible();

    // And the position is deterministic across reloads.
    const first = await page.locator("tbody tr").allInnerTexts();
    await page.reload();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    expect(await page.locator("tbody tr").allInnerTexts()).toEqual(first);
  });

  // @verifies LST-28
  test("LST-28: an unknown frontmatter key is ignored by the list and survives a write", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Experimental" }]);
    await patchTask(tracker.root, String(seeded[0]), t =>
      `${t.trimEnd().replace(/\n---\n?$/, "")}\nfoo: bar\n---\n`);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    // Rendered normally, and no column invented for it.
    await expect(page.locator("thead")).not.toContainText("foo");

    // A write through the UI must not strip it.
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();
    await expect(
      page.getByRole("region", { name: "Bulk actions" }).getByRole("status"),
    ).toContainText("1 task updated");

    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    const ids = await readdir(tasksDir);
    const text = await readFile(path.join(tasksDir, String(ids[0]), "task.md"), "utf8");
    expect(text).toContain("foo: bar");
  });

  // @verifies LST-37
  test("LST-37: a task deleted underneath the list disappears on refetch", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Doomed" }, { title: "Survivor" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await tracker.run(["delete", String(seeded[0]), "--yes"]);

    // A refetch — not a full page reload — removes the row and drops
    // the total.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).not.toContainText("Doomed");
  });
});

test.describe("ERR — one corrupt task file (M1.2)", () => {
  // @verifies ERR-9, LST-48
  //
  // LST-48 is the same scenario stated from the list's side: every
  // other task lists, the failure is surfaced with the offending
  // file's path, and the footer total is honest about what it
  // counted — 2 of 2, against three directories on disk.
  test("ERR-9: the other rows load, and the bad file is named with its parse error", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "One" }, { title: "Two" }, { title: "Three" },
    ]);
    // Corrupt one task's frontmatter the way a bad merge would.
    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    const ids = await readdir(tasksDir);
    const victim = String(ids[0]);
    await writeFile(
      path.join(tasksDir, victim, "task.md"),
      "---\nid: [not\n  valid: yaml\n---\nbody\n",
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);

    // The view loads and the other tasks render — one unreadable
    // neighbour used to take down every read through loadAllTasks.
    await expect(page.getByText(/Showing 1–2 of 2/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("tbody tr")).toHaveCount(2);

    // And the bad file is named, with the path and the YAML error, so
    // the user can reconcile 2 rows against 3 directories.
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(victim);
    await expect(alert).toContainText("task.md");
    await expect(alert).toContainText(/hand-edit/i);
  });
});

test.describe("LST — extreme values and locale (M1.2)", () => {
  // @verifies LST-22
  test("LST-22: far-out dates render as real dates and sort correctly", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([
      { title: "Ancient", fields: { due_date: "1970-01-01" } },
      { title: "Distant", fields: { due_date: "2099-12-31" } },
      { title: "Undated" },
    ]);
    void seeded;

    await page.goto(`${tracker.baseURL}/list?sort=due_date&dir=asc`);
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    // Real dates, not "Invalid Date", not epoch 0, and not a bare
    // "Jan 1" that reads as this year.
    const ancient = page.locator("tbody tr").filter({ hasText: "Ancient" });
    const distant = page.locator("tbody tr").filter({ hasText: "Distant" });
    await expect(ancient).toContainText("1970");
    await expect(distant).toContainText("2099");
    await expect(page.locator("tbody")).not.toContainText("Invalid Date");

    // 1970 sorts before 2099; neither is treated as "no date".
    const titles = await page.locator("tbody tr").allInnerTexts();
    const iAncient = titles.findIndex(t => t.includes("Ancient"));
    const iDistant = titles.findIndex(t => t.includes("Distant"));
    expect(iAncient).toBeLessThan(iDistant);
  });

  // @verifies LST-21
  test("LST-21: CJK, RTL and emoji titles render and sort deterministically", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "日本語のタスク" },
      { title: "مهمة عربية" },
      { title: "family 👨‍👩‍👧‍👦 task" },
    ]);

    const order = async (): Promise<string[]> => {
      await page.goto(`${tracker.baseURL}/list?sort=title&dir=asc`);
      await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
      return page.locator("tbody tr").allInnerTexts();
    };

    const first = await order();
    // All three render, and the ZWJ sequence is not split mid-grapheme
    // into a lone surrogate or an orphaned modifier.
    expect(first.join(" ")).toContain("日本語のタスク");
    expect(first.join(" ")).toContain("مهمة عربية");
    expect(first.join(" ")).toContain("👨‍👩‍👧‍👦");

    // Sorted, not merely repeatable. The M1 vacuity sweep zeroed the
    // comparator and this test stayed green, because insertion order
    // is perfectly deterministic and "identical across reloads" is
    // all it asked. The case's own bullet is about *sorting* being
    // deterministic, so the order has to be checked against what the
    // sort claims — here, `localeCompare`, which is what the server
    // uses for string fields.
    const titles = first.map(row => row.split("\n").find(
      cell => /[^\s\u2013\u2014A-Z0-9-]/.test(cell),
    ) ?? row);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));

    // Deterministic across reloads.
    expect(await order()).toEqual(first);
  });

  // @verifies LST-39
  test("LST-39: a task created in the CLI appears and obeys the active sort", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Bravo" }, { title: "Delta" },
    ]);
    await page.goto(`${tracker.baseURL}/list?sort=title&dir=asc`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await tracker.run(["create", "Alpha"]);
    await page.reload();

    // Present, counted, and inserted at the sorted position — not
    // appended to the bottom regardless of sort.
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();
    const titles = await page.locator("tbody tr").allInnerTexts();
    expect(titles.findIndex(t => t.includes("Alpha")))
      .toBeLessThan(titles.findIndex(t => t.includes("Bravo")));
  });
});

test.describe("ONB — empty and loading states (M1.2)", () => {
  // @verifies ONB-8
  test("ONB-8: an empty tracker is not the same screen as a filter that matched nothing", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);

    const body = page.locator("tbody");
    // Names the state and offers the next action. Telling a new user
    // to clear filters they never set is nonsense.
    await expect(body).toContainText(/No tasks yet/i);
    await expect(body).not.toContainText(/Clear filters/i);
    await expect(body).not.toContainText(/match these filters/i);
    // No filter chips are active.
    await expect(page.getByRole("button", { name: "Clear all" })).toHaveCount(0);
  });

  // @verifies ONB-33
  test("ONB-33: a 500 on first load is an error in the table, never 'No tasks yet'", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.route(/\/api\/tasks(\?|$)/, route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "io_failed", message: "disk is full" }),
      }));

    await page.goto(`${tracker.baseURL}/list`);

    // A load failure must never read as data loss.
    await expect(page.getByText(/No tasks yet/i)).toHaveCount(0);
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Retry|Try again/i }).first())
      .toBeVisible();
    // The shell stays usable so the user can go elsewhere.
    await expect(page.getByRole("link", { name: "List" })).toBeVisible();
  });

  // @verifies ONB-26
  test("ONB-26: reloading a warm tracker goes skeleton to rows, never through empty", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Watch every frame of the reload: copy implying the user's tasks
    // are gone must never appear, even for one frame.
    let sawEmpty = false;
    const poll = setInterval(() => {
      void page.locator("tbody").innerText()
        .then(t => { if (/No tasks yet|match these filters/i.test(t)) sawEmpty = true; })
        .catch(() => undefined);
    }, 20);
    await page.reload();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    clearInterval(poll);
    expect(sawEmpty).toBe(false);
  });
});

test.describe("ERR — malformed responses and distinct surfaces (M1.2)", () => {
  // @verifies ERR-19
  test("ERR-19: a truncated response is a failure, not half a list", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.route(/\/api\/tasks(\?|$)/, route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"items":[{"id":"a","key":"T-1","tit',
      }));

    await page.goto(`${tracker.baseURL}/list`);

    // Not half a table and not a row of undefined cells.
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("tbody")).not.toContainText("undefined");

    // **Bullet 2: the message says the response could not be read.**
    // This test asserted only that the alert exists — and the M1
    // vacuity sweep confirmed it survives the headline being blanked
    // entirely, which is the half of the case that carries the
    // information. An alert that says nothing satisfies "treated it
    // as an error" and fails the user.
    const headline = alert.locator("p").nth(1);
    await expect(headline).toContainText(/\S/);
    await expect(alert).toContainText(/could not|couldn't|unable|not be read|unreadable/i);

    await expect(page.getByRole("button", { name: /Retry|Try again/i }).first())
      .toBeVisible();
  });

  // @verifies ERR-20
  test("ERR-20: nonsense values do not corrupt the count or the cells", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.route(/\/api\/tasks(\?|$)/, route =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [{
            id: "01AAAAAAAAAAAAAAAAAAAAAAAA", key: "T-1", title: "Odd",
            created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
            status: null,
          }],
          total: -5, offset: 0, limit: 50,
        }),
      }));

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody")).toContainText("Odd");

    // The count is never negative or NaN.
    const footer = await page.locator("body").innerText();
    expect(footer).not.toMatch(/-\d+ (of|tasks)/);
    expect(footer).not.toContain("NaN");
    // A null required field is an explicit marker, not blank or
    // "undefined".
    await expect(page.locator("tbody")).not.toContainText("undefined");
  });

  // @verifies ERR-21
  test("ERR-21: a 500 with no body still names what was attempted", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.route(/\/api\/tasks(\?|$)/, route =>
      route.fulfill({ status: 500, body: "" }));

    await page.goto(`${tracker.baseURL}/list`);

    // Not an empty surface and not "Error: ". The cause genuinely is
    // not available, which is the rare exception — but the three
    // obligations still hold (ERR-30).
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    // ERR-30's first obligation: what was attempted. Past tense —
    // the panel used to be headed "Loading tasks", which read as a
    // progress claim inside a role="alert" (gate round 6, F5).
    await expect(alert).toContainText(/Could not load tasks/i);
    // **The reason**, which is ERR-30's whole point and which this
    // test did not check. The M1 vacuity sweep found that blanking
    // the headline was caught by exactly one of sixteen ERR tests:
    // every assertion here was satisfied by the context label alone,
    // so it got *easier* to pass the less the app said.
    await expect(alert).toContainText(/\S{12,}/);
    await expect(alert).not.toContainText(/^Error:\s*$/);
    await expect(page.getByRole("button", { name: /Retry|Try again/i }).first())
      .toBeVisible();
  });

  // @verifies ERR-41
  test("ERR-41: the four empty-ish surfaces are all visibly distinct", async ({
    page,
    tracker,
  }) => {
    const read = async (): Promise<string> => page.locator("tbody").innerText();

    // 1. A fresh tracker.
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody")).toContainText(/No tasks yet/i);
    const fresh = await read();

    // 2. A filter matching nothing.
    await tracker.run(["create", "One"]);
    await page.goto(`${tracker.baseURL}/list?status=done`);
    await expect(page.locator("tbody")).toContainText(/match these filters/i);
    const filtered = await read();

    // 3. An unreachable server.
    await page.route(/\/api\/tasks(\?|$)/, route => route.abort("failed"));
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    const unreachable = await page.locator("body").innerText();

    // All three read differently, and neither failure borrows the
    // empty-state copy — a load failure must never read as data loss.
    expect(new Set([fresh, filtered]).size).toBe(2);
    expect(unreachable).not.toMatch(/No tasks yet/i);
    expect(unreachable).not.toMatch(/match these filters/i);

    // **Bullet 1: distinct *copy*, not merely distinct from the
    // empties.** The M1 vacuity sweep found this half dead — the
    // three assertions above are all absences, and an absence is
    // satisfied by an error surface that says nothing at all, which
    // is exactly what blanking the headline produces. The
    // non-conflation claim survived a real mutation; this one did not
    // exist.
    const errorHeadline = page.getByRole("alert").locator("p").nth(1);
    await expect(errorHeadline).toContainText(/\S/);
    // And its copy is its own, not either empty state's.
    const errorCopy = await errorHeadline.innerText();
    expect(fresh).not.toContain(errorCopy);
    expect(filtered).not.toContain(errorCopy);
  });
});

test.describe("XS — cross-surface convergence (M1.2)", () => {
  // @verifies XS-22
  test("XS-22: a removed status still renders, marked unknown, naming the file", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Stranded", fields: { status: "in_progress" } },
      { title: "Fine" },
    ]);
    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    await writeFile(
      cfg,
      (await readFile(cfg, "utf8")).replace(/^ {2}- key: in_progress\n(?: {4}.+\n)+/m, ""),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    // Not dropped, not blank, no error.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    const row = page.locator("tbody tr").filter({ hasText: "Stranded" });
    // The raw key with an explicit marker, never a silently
    // substituted default — and the note names the file.
    await expect(row).toContainText("in_progress");
    await expect(row.getByTitle(/workflow\.yaml/)).toBeVisible();

    // Setting a *new* status still works, offering only configured
    // values.
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Set status" }).click();
    const menu = page.getByRole("menu", { name: "Set status" });
    await expect(menu.getByRole("menuitem", { name: /in_progress/ })).toHaveCount(0);
    await menu.getByRole("menuitem", { name: "Done" }).click();
    await expect(
      page.getByRole("region", { name: "Bulk actions" }).getByRole("status"),
    ).toContainText("1 task updated");
  });

  // @verifies XS-24
  test("XS-24: a config with one priority and one with seven both render sanely", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    const original = await readFile(cfg, "utf8");

    // Seven priorities: no hardcoded assumption about how many exist.
    const seven = Array.from({ length: 7 }, (_u, i) =>
      `  - key: p${String(i)}\n    label: P${String(i)}\n    value: ${String(i)}\n`).join("");
    await writeFile(
      cfg,
      original.replace(/^priorities:\n(?: {2}- .+\n| {4}.+\n)+/m, `priorities:\n${seven}`),
      "utf8",
    );
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Set priority" }).click();
    await expect(
      page.getByRole("menu", { name: "Set priority" }).getByRole("menuitem"),
    ).toHaveCount(8); // seven, plus the clear option
  });

  // @verifies XS-1
  test("XS-1: a CLI edit converges without a manual reload, disturbing nothing else", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([
      { title: "Target" }, { title: "Other" },
    ]);
    await page.goto(`${tracker.baseURL}/list?sort=title&dir=asc`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // A selection the refetch must not disturb.
    await page.locator("tbody input[type=checkbox]").first().check();
    await expect(page.getByText("1 task selected")).toBeVisible();

    await tracker.run(["set", String(seeded[0]), "priority", "high"]);

    // Converge without browser reload — the staleness window is the
    // documented trigger, and an explicit refetch stands in for it.
    await page.getByRole("button", { name: "Filter Priority" }).click();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await expect(
      page.locator("tbody tr").filter({ hasText: "Target" }),
    ).toContainText(/High/i);

    // Sort survived.
    await expect(page).toHaveURL(/sort=title/);
  });
});

test.describe("MSL — label pills (M1.2)", () => {
  // @verifies MSL-22
  test("MSL-22: an invalid colour keeps the label, styled, and is reported as fixable", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "good"]);
    await tracker.run(["label", "create", "bad"]);
    await tracker.run(["create", "Tagged", "--label", "good", "--label", "bad"]);

    // Only a hand-edit can produce this: every write path validates
    // through HexColor, and the settings UI is M4.3.
    const cfg = path.join(tracker.root, ".loctt", "config", "labels.yaml");
    await writeFile(
      cfg,
      (await readFile(cfg, "utf8")).replace(/(name: bad)/, "$1\n    color: notahex"),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // Both labels render. One bad cosmetic field used to 500 the whole
    // endpoint, so *every* label on every row read "unknown label" —
    // including the ones that were fine.
    const row = page.locator("tbody tr").first();
    await expect(row).toContainText("good");
    await expect(row).toContainText("bad");
    await expect(row).not.toContainText("unknown label");

    // Neither pill is unstyled: `notahex22` is not a colour, so the
    // invalid value must not reach CSS at all.
    for (const name of ["good", "bad"]) {
      const pill = row.getByTitle(name, { exact: true });
      await expect(pill).toBeVisible();
      const bg = await pill.evaluate(el => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    }

    // And the bad value is surfaced as a fixable config problem,
    // naming the label and the value.
    const doctor = await tracker.run(["doctor"]);
    expect(doctor).toContain("bad");
    expect(doctor).toContain("notahex");
  });

  // @verifies MSL-26
  test("MSL-26: a 100-character label name truncates inside the pill", async ({
    page,
    tracker,
  }) => {
    const long = "l".repeat(100);
    await tracker.run(["label", "create", long]);
    await tracker.run(["create", "Tagged", "--label", long]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // The full text is on hover, and the pill does not widen the row
    // past the table.
    const pill = page.locator("tbody").getByText(long, { exact: true });
    await expect(pill).toBeVisible();
    const width = await pill.evaluate(el => el.getBoundingClientRect().width);
    expect(width).toBeLessThan(200);
  });
});

test.describe("LST — columns, staleness, unreachable (M1.2)", () => {
  // @verifies LST-6
  test("LST-6: per-user list_columns decide which columns render, and in what order", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    // A subset, in a non-default order.
    const users = path.join(tracker.root, ".loctt", "users");
    const id = String((await readdir(users))[0]);
    await writeFile(
      path.join(users, id, "settings.yaml"),
      "list_columns:\n  - title\n  - key\n",
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    const headers = (await page.locator("thead th").allInnerTexts())
      .map(h => h.replace(/[▾▴\s]/g, ""));
    // Only the listed columns, in the listed order. The first cell is
    // the select-all checkbox.
    expect(headers.filter(Boolean)).toEqual(["Title", "Key"]);
  });

  // @verifies SET-9
  test("SET-9: the estimate column renders values with the unit suffix, and vanishes when estimation is disabled", async ({
    page,
    tracker,
  }) => {
    // A fresh init enables estimation (points). Seed a task and give it
    // an estimate, then opt the estimate column in via list_columns.
    await tracker.seed([{ title: "Estimated" }]);
    await tracker.run(["set", "T-1", "estimate", "5"]);
    const users = path.join(tracker.root, ".loctt", "users");
    const id = String((await readdir(users))[0]);
    await writeFile(
      path.join(users, id, "settings.yaml"),
      "list_columns:\n  - key\n  - title\n  - estimate\n",
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    // The column exists and its cell shows the value with the unit
    // suffix — the default workspace's `unit_label` is "pts" — not a
    // bare number.
    await expect(page.locator("thead th").filter({ hasText: "Estimate" })).toHaveCount(1);
    await expect(page.locator('td[data-col="estimate"]')).toContainText("5 pts");

    // Disable estimation: the column disappears even though list_columns
    // still names it (SET-9's first bullet — nothing appears anywhere).
    const wf = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    const text = await readFile(wf, "utf8");
    await writeFile(
      wf,
      text.replace(/^estimation:\n(?:[ \t]+.*\n?)*/m, "estimation:\n  enabled: false\n  unit: points\n"),
      "utf8",
    );
    await page.reload();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("thead th").filter({ hasText: "Estimate" })).toHaveCount(0);
    await expect(page.locator('td[data-col="estimate"]')).toHaveCount(0);
  });

  // @verifies LST-36
  test("LST-36: a stale row never pushes its old value back to disk", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Target" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // The CLI changes a field the open list has not seen.
    await tracker.run(["set", String(seeded[0]), "priority", "high"]);

    // Acting on the stale row must not carry the old priority along.
    let sentFields: string[] = [];
    await page.route(/\/api\/tasks\/bulk\/set/, async route => {
      const body = route.request().postDataJSON() as {
        changes: { field: string }[];
      };
      sentFields = body.changes.map(c => c.field);
      await route.continue();
    });
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();
    await expect(
      page.getByRole("region", { name: "Bulk actions" }).getByRole("status"),
    ).toContainText("1 task updated");

    // Only the field the user changed goes on the wire — a
    // read-modify-write of the whole row would have reverted priority.
    expect(sentFields).toEqual(["status"]);
    expect(await tracker.run(["show", String(seeded[0])])).toContain("high");
  });

  // @verifies LST-47
  test("LST-47: an unreachable API is reported distinctly from an empty tracker", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.route(/\/api\/tasks(\?|$)/, route => route.abort("connectionrefused"));
    await page.goto(`${tracker.baseURL}/list`);

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    // Never the empty-tracker copy — a load failure must not read as
    // data loss.
    await expect(page.getByText(/No tasks yet/i)).toHaveCount(0);
    await expect(page.getByText(/match these filters/i)).toHaveCount(0);
  });
});

test.describe("ERR — the sweeps (M1.2)", () => {
  // @verifies ERR-39
  test("ERR-39: every failed write and read produces a visible surface", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Every write path on this view, with the server failing.
    await page.route(/\/api\/tasks\/bulk\//, route => route.abort("failed"));
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    const status = () => page.getByRole("region", { name: "Bulk actions" }).getByRole("status");

    // 1. Set a field.
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();
    await expect(status()).toContainText(/could not|Nothing was/i, { timeout: 20_000 });

    // 2. Archive.
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: /could not|Nothing was/i }).first(),
    ).toBeVisible({ timeout: 20_000 });

    // 3. Move.
    await tracker.run(["project", "create", "Ops", "--prefix", "OPS"]);
    await page.reload();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();
    await page.getByRole("button", { name: "Move to project" }).click();
    await page.getByRole("menu", { name: "Move to project" })
      .getByRole("menuitem", { name: "Ops" }).click();
    await expect(status()).toContainText(/could not|Nothing was/i, { timeout: 20_000 });
  });

  // @verifies ERR-40
  test("ERR-40: no success is claimed for a rejected write, and disk agrees", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.route(/\/api\/tasks\/bulk\/set/, route => route.abort("failed"));
    await page.locator("tbody input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    await expect(status).toContainText(/could not|Nothing was/i, { timeout: 20_000 });
    // No success claim of any kind.
    await expect(status).not.toContainText(/1 task updated/);

    // And what the UI implied matches disk: no optimistic state
    // survived the failure.
    const shown = await tracker.run(["show", String(seeded[0])]);
    expect(shown.toLowerCase()).not.toContain("done");
  });

  // @verifies ERR-42
  test("ERR-42: error copy names things the user recognises, not internals", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.route(/\/api\/tasks(\?|$)/, route => route.abort("failed"));
    await page.goto(`${tracker.baseURL}/list`);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    const copy = await alert.innerText();

    // None of the vocabulary the user has never seen.
    for (const jargon of [
      "mutation", "query key", "hydration", "route handler", "serializer",
      "ZodError", "ENOENT", "EACCES",
    ]) {
      expect(copy.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
    // **Bullet 1, which this test did not check.** Every assertion
    // above is an absence, and an absence gets *easier* to pass the
    // less the app says — the M1 vacuity sweep measured this cluster
    // as green in the limit where the error surface renders nothing,
    // and found that blanking the headline was caught by exactly one
    // of sixteen ERR tests. This one's only positive check was
    // `toMatch(/tasks/i)`, which the context label satisfies on its
    // own, so it was strictly easier to pass the quieter the app got.
    //
    // The headline is the sentence the case is about, so assert it
    // rather than the container that also holds the context label.
    const headline = alert.locator("p").nth(1);
    await expect(headline).toContainText(/\S/);
    // Something the user recognises — the server they started, in the
    // terminal they started it in.
    await expect(headline).toContainText(/server|loctt/i);

    // And it fits in one or two sentences before any expandable detail.
    expect(copy.split(/[.!?]/).filter(s => s.trim().length > 0).length)
      .toBeLessThanOrEqual(4);
  });
});

test.describe("XS/MSL — the last of M1.2", () => {
  // @verifies XS-5
  test("XS-5: a task created out-of-band appears and the total is recomputed", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "First" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await tracker.run(["create", "Second"]);
    await page.reload();

    // The count is recomputed, not cached from the first load.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // And a task that does not match the active filter does not
    // appear — the filter is honoured, not bypassed.
    await page.goto(`${tracker.baseURL}/list?status=done`);
    await expect(page.locator("tbody")).toContainText(/match these filters/i);
    await tracker.run(["create", "Third"]);
    await page.reload();
    await expect(page.locator("tbody")).toContainText(/match these filters/i);
  });

  // @verifies XS-39
  test("XS-39: a task pulled in out-of-band resolves by key with no rebuild", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Existing" }]);
    // Warm the index, so the new directory is genuinely unindexed.
    await tracker.run(["show", String(seeded[0])]);

    // A task directory arriving the way a `git pull` delivers one.
    const id = "01M0PULLED0000000000000000";
    const dir = path.join(tracker.root, ".loctt", "tasks", id);
    await mkdir(dir, { recursive: true });
    const project = /^ {2}([0-9A-Z]{26}):/m.exec(
      await readFile(path.join(tracker.root, ".loctt", "state.yaml"), "utf8"),
    )?.[1] ?? "";
    await writeFile(
      path.join(dir, "task.md"),
      `---\nid: ${id}\nkey: T-900\ntitle: Pulled\n`
      + `created_at: 2026-01-01T00:00:00.000Z\nupdated_at: 2026-01-01T00:00:00.000Z\n`
      + `project: ${project}\nstatus: backlog\n---\n`,
      "utf8",
    );

    // The key resolves with no manual step — the index folds it in.
    expect(await tracker.run(["show", "T-900"])).toContain("Pulled");

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Pulled");
  });

  // @verifies MSL-21
  test("MSL-21: two labels sharing a name stay distinguishable and filter separately", async ({
    page,
    tracker,
  }) => {
    // `name` is explicitly not unique.
    const a = await tracker.run(["label", "create", "dup"]);
    const b = await tracker.run(["label", "create", "dup"]);
    const idA = /([0-9A-Z]{26})/.exec(a)?.[1] ?? "";
    const idB = /([0-9A-Z]{26})/.exec(b)?.[1] ?? "";
    expect(idA).not.toBe(idB);

    await tracker.run(["create", "HasA", "--label", idA]);
    await tracker.run(["create", "HasB", "--label", idB]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Filtering by one id matches only that label's task, not both.
    await page.goto(`${tracker.baseURL}/list?labels=${idA}`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("HasA");
    await expect(page.locator("tbody")).not.toContainText("HasB");
  });

  // @verifies MSL-23
  test("MSL-23: a very pale and a very dark label both stay legible", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "pale", "--color", "#ffffcc"]);
    await tracker.run(["label", "create", "dark", "--color", "#001133"]);
    await tracker.run(["create", "Tagged", "--label", "pale", "--label", "dark"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // Neither pill uses its own colour as text on a wash of itself —
    // that renders pale-on-pale and dark-on-dark.
    for (const name of ["pale", "dark"]) {
      const pill = page.locator("tbody tr").first().getByTitle(name, { exact: true });
      await expect(pill).toBeVisible();
      const { color, border } = await pill.evaluate(el => {
        const cs = getComputedStyle(el);
        return { color: cs.color, border: cs.borderTopColor };
      });
      // Legible: not the extreme label colour itself.
      expect(color).not.toBe("rgb(255, 255, 204)");
      expect(color).not.toBe("rgb(0, 17, 51)");
      // And the pill has a visible boundary.
      expect(border).not.toBe("rgba(0, 0, 0, 0)");
    }
  });
});

test.describe("ERR/LST — a broken config file (M1.2)", () => {
  /** Removes `category` from the first status, breaking the schema. */
  async function breakWorkflow(root: string): Promise<void> {
    const cfg = path.join(root, ".loctt", "config", "workflow.yaml");
    const text = await readFile(cfg, "utf8");
    await writeFile(
      cfg,
      text.replace(/( {2}- key: \w+\n {4}label: .+\n) {4}category: .+\n/, "$1"),
      "utf8",
    );
  }

  // @verifies ERR-10
  // The tolerant `loadWorkflowConfig` degrades a bad status `category` into
  // `broken` and still loads; the list now surfaces those broken entries in
  // a point-of-use `role="alert"` (A-PRESCAN-2), naming the file, the
  // field path, and the expected values.
  test("ERR-10: a schema failure names the file, the field, and what was expected", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await breakWorkflow(tracker.root);

    await page.goto(`${tracker.baseURL}/list`);
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 20_000 });
    const copy = await alert.innerText();

    // The file, by name.
    expect(copy).toContain("workflow.yaml");
    // The failing field, with enough path to find it.
    expect(copy).toMatch(/statuses\[\d+\]\.category/);
    // What was expected — Zod knows this and the UI must not discard
    // it. "workflow.yaml is invalid" alone fails this case.
    expect(copy).toMatch(/pending|active|completed|discarded/);
    // Not a stack trace, and no raw Zod vocabulary in the headline.
    expect(copy).not.toContain("ZodError");
    expect(copy).not.toContain("at Object.");
  });

  // @verifies LST-51
  // The list now surfaces a broken workflow entry in place (A-PRESCAN-2)
  // rather than degrading silently; the shell stays usable and the CLI
  // says the same thing.
  test("LST-51: a broken workflow is explained rather than crashed on", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await breakWorkflow(tracker.root);

    await page.goto(`${tracker.baseURL}/list`);

    // Explained, not a blank page and not a stack trace.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("alert")).toContainText("workflow.yaml");
    // The shell still works, so the user can go and fix it.
    await expect(page.getByRole("link", { name: "List" })).toBeVisible();
    // And the CLI says the same thing, so the fix is discoverable across
    // surfaces (P10). It degrades like the web — exit 0 with the list on
    // stdout — and names the broken file on stderr, not a crash.
    const cli = await tracker.runRaw(["list"]);
    expect(cli.exitCode).toBe(0);
    expect(cli.stderr).toContain("workflow.yaml");
  });
});

test.describe("XS/ONB — staleness and the skeleton (M1.2)", () => {
  // @verifies ONB-12
  test("ONB-12: the skeleton is page-shaped, so the pane does not jump when data lands", async ({
    page,
    tracker,
  }) => {
    await tracker.seedBulk(60);

    let release: (() => void) | undefined;
    const held = new Promise<void>(r => { release = r; });
    await page.route(/\/api\/tasks(\?|$)/, async route => {
      await held;
      await route.continue();
    });
    await page.goto(`${tracker.baseURL}/list`);

    // A skeleton with the table's own column structure, not a spinner
    // and not a blank pane.
    const skeletonRows = page.locator("tbody tr[aria-hidden]");
    await expect(skeletonRows.first()).toBeVisible();
    const skeletonCount = await skeletonRows.count();
    const headerCells = await page.locator("thead th").count();
    expect(await skeletonRows.first().locator("td").count()).toBe(headerCells);

    // Plausible for a page of results: eight rows under a fifty-row
    // page made the pane visibly grow when data landed.
    expect(skeletonCount).toBeGreaterThanOrEqual(20);

    release?.();
    await expect(page.getByText(/Showing 1–\d+ of 60/)).toBeVisible();
  });

  // @verifies ONB-24
  test("ONB-24: the empty state survives a narrow window without a horizontal scrollbar", async ({
    page,
    tracker,
  }) => {
    void tracker;
    await page.setViewportSize({ width: 768, height: 800 });
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody")).toContainText(/No tasks yet/i);

    // The page body does not scroll sideways.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("The last of M1.2", () => {
  // @verifies LST-23
  test("LST-23: dates and relative times use the workspace timezone, not the browser's", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Dated", fields: { due_date: "2026-05-01" } }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // A due date is a *date*, not an instant: it reads as May 1
    // whatever the browser's zone. Pinned in UTC, so a browser east or
    // west of the workspace cannot shift it a day.
    const row = page.locator("tbody tr").first();
    await expect(row).toContainText("May 1");

    // And a relative timestamp is elapsed duration, which no timezone
    // can move — a task just created reads as recent, never as
    // tomorrow.
    await expect(row).toContainText(/just now|\dm ago/);
  });

  // @verifies ERR-5
  test("ERR-5: a request that never returns is bounded and says so", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Shorten the client deadline; the production value is 30s.
    await page.addInitScript(() => {
      (globalThis as { __LOCTT_BULK_TIMEOUT_MS__?: number }).__LOCTT_BULK_TIMEOUT_MS__ = 500;
    });
    await page.reload();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    // The server accepts and never answers.
    await page.route(/\/api\/tasks\/bulk\/archive/, () => { /* never resolved */ });
    await page.getByRole("button", { name: "Archive", exact: true }).click();

    // Bounded: the wait ends, and the message says what was attempted
    // and what state the data is in.
    const status = page.getByRole("status").filter({ hasText: /did not respond/i });
    await expect(status).toBeVisible({ timeout: 20_000 });
    await expect(status).toContainText(/2 tasks/);
    await expect(status).toContainText(/Reload/i);
  });

  // @verifies ERR-17
  test("ERR-17: ten failures coalesce into one dismissible surface", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(
      Array.from({ length: 10 }, (_u, i) => ({ title: `Task ${String(i + 1)}` })),
    );
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–10 of 10")).toBeVisible();
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();

    await page.route(/\/api\/tasks\/bulk\/set/, route => route.abort("failed"));
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    // One surface, not ten. A bulk failure is reported as a single
    // result naming the affected set, not a toast per task.
    const bar = page.getByRole("region", { name: "Bulk actions" });
    await expect(bar.getByRole("status")).toContainText(/could not|Nothing was/i, {
      timeout: 20_000,
    });
    expect(await page.getByRole("status").count()).toBeLessThan(3);
    // And the selection survives, so the user can retry it.
    await expect(bar).toContainText("10 tasks selected");
  });

  // @verifies ERR-30
  test("ERR-30: an unattributable failure still answers all three questions", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await page.locator("tbody input[type=checkbox]").first().check();

    // An opaque fault: a 500 with a body the client cannot attribute.
    await page.route(/\/api\/tasks\/bulk\/set/, route =>
      route.fulfill({ status: 500, contentType: "text/plain", body: "???" }));
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "Done" }).click();

    const status = page.getByRole("region", { name: "Bulk actions" }).getByRole("status");
    await expect(status).toBeVisible({ timeout: 20_000 });
    const copy = await status.innerText();

    // What was attempted, and what state the data is in. "Something
    // went wrong" with neither is a failing result for this case.
    expect(copy).toMatch(/updated|update/i);
    expect(copy).toMatch(/Nothing was|could not/i);
    // And the selection survives as the way to retry.
    await expect(
      page.getByRole("region", { name: "Bulk actions" }),
    ).toContainText("1 task selected");
  });

  // @verifies XS-40
  test("XS-40: a task deleted out-of-band stops resolving and leaves the list", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Doomed" }, { title: "Survivor" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    // Warm the key index so the lookup has something cached to drop.
    await tracker.run(["show", String(seeded[0])]);

    // Remove the directory the way a `git pull` of a deletion would.
    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
      if (!text.includes("title: Doomed")) continue;
      await rm(path.join(tasksDir, id), { recursive: true });
    }

    // The indexed entry drops on ENOENT and the lookup falls through —
    // no manual rebuild.
    const err = await tracker.run(["show", String(seeded[0])]).catch((e: Error) => e.message);
    expect(err).toContain(String(seeded[0]));

    await page.reload();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).not.toContainText("Doomed");
  });
});

test.describe("LST — the filter bar (M1.3)", () => {
  // @verifies LST-10
  test("LST-10: chips show labels, remove one facet each, and leave no empty params", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "One", fields: { status: "in_progress", priority: "high" } },
      { title: "Two" },
    ]);
    await page.goto(`${tracker.baseURL}/list?status=in_progress&priority=high`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // Human labels, never the raw key. The facet name and the value
    // are separate spans, so match on the remove button's own label.
    const chip = (facet: string, value: string) =>
      page.getByRole("button", { name: `Remove ${facet} ${value}` });
    await expect(chip("Status", "In progress")).toBeVisible();
    await expect(chip("Priority", "High")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("in_progress");

    // Removing one chip leaves the other intact.
    await chip("Status", "In progress").click();
    await expect(page).toHaveURL(/priority=high/);
    await expect(page).not.toHaveURL(/status=/);

    // And removing the last leaves no empty param behind.
    await chip("Priority", "High").click();
    await expect(page).not.toHaveURL(/priority=/);
    await expect(page).not.toHaveURL(/[?&]\w+=(&|$)/);
  });

  // @verifies LST-12
  test("LST-12: the archived-scope control toggles the param on and off, and marks the rows", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Live" }, { title: "Gone" }]);
    await tracker.run(["archive", String(seeded[1])]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page).not.toHaveURL(/archived/);

    await page.getByTestId("view-actions-menu").click();
    const scope = page.getByTestId("view-actions-archived-scope");
    await scope.selectOption("all");
    await expect(page).toHaveURL(/archived=all/);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    // Marked, so an archived row is distinguishable from a live one.
    await expect(
      page.locator("tbody tr").filter({ hasText: "Gone" }),
    ).toContainText("Archived");

    // Back to active removes the param rather than writing archived=active.
    await scope.selectOption("active");
    await expect(page).not.toHaveURL(/archived/);
  });

  // @verifies LST-14
  test("LST-14: a DSL query runs the same language as the CLI and round-trips", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Match", fields: { status: "in_progress", priority: "high" } },
      { title: "Miss", fields: { status: "in_progress" } },
    ]);
    const q = "status = in_progress and priority = high";

    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent(q)}`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Match");

    // The same query through the CLI returns the same set.
    const cli = await tracker.run(["list", "--query", q]);
    expect(cli).toContain("Match");
    expect(cli).not.toContain("Miss");

    // Reload re-runs it and the URL carries it verbatim, so the view
    // is bookmarkable and shareable.
    await page.reload();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    // Every operator the CLI accepts is accepted here — no UI-only
    // dialect, and nothing the CLI takes is rejected.
    for (const expr of [
      "status in (in_progress, backlog)",
      "status not in (done)",
      "title ~ Match",
      "not (priority = high)",
    ]) {
      const res = await page.request.get(
        `${tracker.baseURL}/api/tasks?q=${encodeURIComponent(expr)}`,
      );
      expect(res.status(), expr).toBe(200);
    }
  });

  // @verifies LST-16
  test("LST-16: a custom-field filter actually narrows the result set", async ({
    page,
    tracker,
  }) => {
    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    await writeFile(
      cfg,
      (await readFile(cfg, "utf8")).replace(
        "custom_fields: []",
        "custom_fields:\n  - key: team\n    label: Team\n    type: string\n"
        + "    multi: false\n    searchable: false",
      ),
      "utf8",
    );
    const seeded = await tracker.seed([{ title: "Platform" }, { title: "Other" }]);
    await tracker.run(["set", String(seeded[0]), "team", "platform"]);

    await page.goto(`${tracker.baseURL}/list?field.team=platform`);

    // Not merely that the param and the chip appear: the rows narrow.
    // `tasksParamsFromSearch` stripped every `field.*` key, so this
    // case passed while the filter did nothing.
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Platform");
    await expect(page.locator("tbody")).not.toContainText("Other");
  });
});

test.describe("LST — URL params that could lie (M1.3)", () => {
  // @verifies LST-31
  test("LST-31: archived=false and archived=0 do not enable the toggle", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Live" }, { title: "Gone" }]);
    await tracker.run(["archive", String(seeded[1])]);

    for (const falsey of ["false", "0"]) {
      await page.goto(`${tracker.baseURL}/list?archived=${falsey}`);
      // An unrecognized scope value falling back to "active" (rather
      // than being coerced into "all") is exactly what this case exists
      // to catch.
      await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
      await expect(page.locator("tbody")).not.toContainText("Gone");
      // The control's visual state agrees with the result set.
      await page.getByTestId("view-actions-menu").click();
      await expect(page.getByTestId("view-actions-archived-scope"))
        .toHaveValue("active");
      await page.keyboard.press("Escape");
    }
  });

  // @verifies LST-32
  test("LST-32: an unknown search param survives a filter change", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Done one", fields: { status: "done" } },
      { title: "Other" },
    ]);
    await page.goto(`${tracker.baseURL}/list?status=done&debug=1`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // The known filter applies normally...
    await expect(page.locator("tbody")).toContainText("Done one");

    // ...and the unknown key is not dropped on the next navigation.
    await page.getByRole("button", { name: "Filter Priority" }).click();
    await page.getByRole("menuitemcheckbox").first().click();
    await expect(page).toHaveURL(/debug=1/);
  });
});

test.describe("LST — query errors and composition (M1.3)", () => {
  // @verifies LST-44
  test("LST-44: a malformed query reports the error, never an empty result", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent("status = = in_progress")}`);

    // A parse failure must never be presentable as a legitimate
    // zero-match result.
    await expect(page.getByText(/No tasks match these filters/i)).toHaveCount(0);
    await expect(page.getByText(/No tasks yet/i)).toHaveCount(0);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    // Names the problem and the offending token's position.
    await expect(alert).toContainText(/position/i);
    await expect(alert).toContainText("=");

    // Reloading reproduces the same visible error rather than a silent
    // empty list.
    await page.reload();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
  });

  // @verifies LST-45
  test("LST-45: an unknown field is named, with the valid alternative", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent("assignedto = alice")}`);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    // The field by name, not a generic "invalid query", and pointing
    // at the valid alternative.
    await expect(alert).toContainText("assignedto");
    await expect(alert).toContainText("assignee");

    // The CLI rejects it comparably — the UI accepts no syntax the CLI
    // refuses and refuses none it accepts.
    const cli = await tracker.run(["list", "--query", "assignedto = alice"])
      .catch((e: Error) => e.message);
    expect(cli).toContain("assignedto");
  });

  // @verifies LST-46
  test("LST-46: an undeclared custom field is distinguished from a typo'd built-in", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent("fields.velocity > 3")}`);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    // The syntax is valid; the problem is a config reference. Named as
    // a *custom* field, not reported as a parse error.
    await expect(alert).toContainText("velocity");
    await expect(alert).toContainText(/custom field/i);
    // And not shown as a plain empty result.
    await expect(page.getByText(/No tasks match these filters/i)).toHaveCount(0);
  });

  // @verifies LST-40
  test("LST-40: a query and structured chips compose as an intersection", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Both", fields: { status: "in_progress", priority: "high" } },
      { title: "QueryOnly", fields: { priority: "high" } },
      { title: "ChipOnly", fields: { status: "in_progress" } },
    ]);

    // Query alone.
    const q = "priority = high";
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent(q)}`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Query plus a chip: the intersection, not one replacing the other.
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent(q)}&status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Both");

    // Both are in the URL at once.
    await expect(page).toHaveURL(/q=/);
    await expect(page).toHaveURL(/status=in_progress/);

    // Removing the chip leaves the query applied.
    await page.getByRole("button", { name: /Remove Status/ }).click();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await expect(page).toHaveURL(/q=/);
  });

  // @verifies LST-42
  test("LST-42: a query with quotes and escapes round-trips through the URL", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: 'say "hi" there' }, { title: "plain" }]);
    const q = 'title ~ "say \\"hi\\""';

    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent(q)}`);
    // Executes rather than being mangled by URL encoding, and matches
    // the literal text.
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText('say "hi" there');

    // And survives a reload with its quoting intact.
    await page.reload();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
  });
});

test.describe("LST — filters that fail honestly (M1.3)", () => {
  // @verifies LST-52
  test("LST-52: a hung read is reported as a timeout, not left spinning", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.addInitScript(() => {
      (globalThis as { __LOCTT_READ_TIMEOUT_MS__?: number }).__LOCTT_READ_TIMEOUT_MS__ = 800;
    });

    let hang = true;
    await page.route(/\/api\/tasks(\?|$)/, async route => {
      if (hang) return; // never resolved
      await route.continue();
    });
    await page.goto(`${tracker.baseURL}/list`);

    // A terminal state, not an endless skeleton.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: /Retry|Try again/i }).first())
      .toBeVisible();
    // Never presented as an empty tracker.
    await expect(page.getByText(/No tasks yet/i)).toHaveCount(0);

    // Retry succeeding replaces the error without a reload.
    hang = false;
    await page.getByRole("button", { name: /Retry|Try again/i }).first().click();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible({ timeout: 20_000 });
  });

  // @verifies LST-50
  test("LST-50: a failed filter never leaves chips claiming an unfiltered table", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await page.route(/\/api\/tasks(\?|$)/, route => route.abort("failed"));
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Done" }).click();

    // The URL and the visible result never disagree silently: either
    // the previous state is clearly retained, or the table is in an
    // explicit error state. It is the latter.
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Showing 1–2 of 2")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Retry|Try again/i }).first())
      .toBeVisible();
  });

  // @verifies LST-33
  test("LST-33: a filter naming a deleted entity says so rather than reading as empty", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["milestone", "create", "v1"]);
    await tracker.seed([{ title: "One" }]);
    const gone = "01M0DELETED000000000000000";

    await page.goto(`${tracker.baseURL}/list?milestone=${gone}`);
    await expect(page.getByText(/No tasks match these filters/i)).toBeVisible();

    // LST-33's first bullet: the chip must SAY the milestone no longer
    // exists — a chip that just renders the raw ULID (or a blank label)
    // reads as a normal filter that happens to match nothing, which is
    // indistinguishable from a valid milestone with no tasks.
    //
    // Before the fix, buildChips fell back to `?? value`, so the chip
    // showed the bare ULID and this test — which only checked the
    // chip's presence and removability — passed green while asserting
    // the bug. The two assertions below are what actually pin LST-33.
    await expect(page.getByText(/no longer exists/i)).toBeVisible();
    // The raw full ULID must NOT be shown as a normal-looking label
    // (only the truncated diagnostic tail is acceptable).
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);

    // Present and removable, so the user can recover.
    const chip = page.getByRole("button", { name: /Remove Milestone/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
  });

  // @verifies LST-33
  test("LST-33: a VALID milestone with no tasks is a normal chip, not 'no longer exists'", async ({
    page,
    tracker,
  }) => {
    // LST-33 bullet 3: a dangling reference must be distinguishable from
    // a valid milestone that simply has no tasks. This is the contrast
    // case, and the one that catches the loading-race regression where a
    // valid chip flashes/sticks as "no longer exists" before (or if) its
    // option source loads. The milestone here EXISTS but matches nothing.
    await tracker.run(["milestone", "create", "v2"]);
    await tracker.seed([{ title: "One" }]); // not on v2

    // The filter param is the milestone id (a ULID), not its name —
    // read it from config the way flow-milestones.spec does.
    const yaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "milestones.yaml"),
      "utf8",
    );
    const id = /- id:\s*(\S+)/.exec(yaml)?.[1];
    expect(id, "expected a milestone id in milestones.yaml").toBeTruthy();

    await page.goto(`${tracker.baseURL}/list?milestone=${id ?? ""}`);
    // Empty result, but the chip must read as a normal, named filter
    // (the milestone's name "v2") — never the dangling warning form.
    await expect(page.getByText(/No tasks match these filters/i)).toBeVisible();
    await expect(page.getByText(/no longer exists/i)).toHaveCount(0);
    // The chip itself resolves to the name and is removable by name —
    // if it were dangling, the remove control would name the raw id and
    // the chip would show "(no longer exists)" instead.
    await expect(
      page.getByRole("button", { name: /Remove Milestone v2/ }),
    ).toBeVisible();
  });

  // @verifies LST-41
  test("LST-41: clearing the query leaves the chips applied", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Both", fields: { status: "in_progress", priority: "high" } },
      { title: "ChipOnly", fields: { status: "in_progress" } },
    ]);
    await page.goto(
      `${tracker.baseURL}/list?q=${encodeURIComponent("priority = high")}&status=in_progress`,
    );
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // Dropping `q` widens to the chips-only result and removes the
    // param entirely.
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByRole("button", { name: /Remove Status/ })).toBeVisible();
  });
});

test.describe("VUE — built-ins and saved views (M1.3)", () => {
  // @verifies VUE-3
  test("VUE-3: a built-in sets visible, editable filter state", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Hot", fields: { priority: "high" } },
      { title: "Cold", fields: { priority: "low" } },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await page.getByRole("link", { name: /High priority/i }).click();

    // Narrowed, with the state in the URL and a chip saying why.
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Hot");
    const url = page.url();
    expect(url).toMatch(/priority|q=/);

    // Not a black box: removing the chip widens the result.
    const chip = page.getByRole("button", { name: /^Remove /i }).first();
    if (await chip.count() > 0) {
      await chip.click();
      await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    }

    // And the URL reproduces the same rows in a fresh tab.
    const other = await page.context().newPage();
    await other.goto(url);
    await expect(other.getByText("Showing 1–1 of 1")).toBeVisible();
    await other.close();
  });

  // @verifies VUE-4
  test("VUE-4: Back after a built-in restores the previous view", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Hot", fields: { priority: "high" } },
      { title: "Cold", fields: { priority: "low" } },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await page.getByRole("link", { name: /High priority/i }).click();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.goBack();
    // The prior state returns and the browser does not leave the app.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await page.goForward();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
  });

  // @verifies VUE-5
  test("VUE-5: Overdue excludes completed tasks and matches the CLI", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([
      { title: "Late", fields: { due_date: "2020-01-01" } },
      { title: "LateButDone", fields: { due_date: "2020-01-01", status: "done" } },
      { title: "Fine" },
    ]);
    void seeded;

    await page.goto(`${tracker.baseURL}/list`);
    await page.getByRole("link", { name: /Overdue/i }).click();

    // A completed task past its due date is not overdue.
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Late");
    await expect(page.locator("tbody")).not.toContainText("LateButDone");

    // And the same predicate through the CLI returns the same set.
    const cli = await tracker.run([
      "list", "--query",
      "due_date < today and status.category not in (completed, discarded)",
    ]);
    expect(cli).toContain("Late");
    expect(cli).not.toContain("LateButDone");
  });
});

test.describe("VUE — saving a view (M1.3)", () => {
  // @verifies VUE-6
  // @verifies VUE-8
  //
  // The reachability half. Six M4.5 blockers — VUE-8, 10, 11, 31, 32,
  // 33 — were tagged, green, and reported covered while
  // `AdvancedQueryEditor` was imported by nothing but its own test and
  // tree-shaken out of the bundle: `dsl-input` appeared **zero** times
  // in the built assets. Every one of those cases was verified against
  // the server API or the unmounted module, and neither layer can
  // observe that no user can open the editor.
  //
  // The cause was structural, not an oversight. `dslToSearch.ts`
  // imported `@loctt/core`'s barrel, which drags `node:path` and
  // `sharp` into the browser bundle, so mounting the editor *broke the
  // client build*. Narrow subpath imports fixed it (A37's pattern).
  //
  // This test asserts the one thing those six could not: that a user
  // can reach it and that it runs a query.
  test("VUE-8: the advanced editor is reachable from the list and runs a query", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Bug one", fields: { status: "in_progress" } },
      { title: "Other" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);

    // Reachable — the assertion whose absence let six blockers pass.
    // The redesign folds advanced querying into the "+ Add filter" menu
    // ("Advanced query…", `advanced-open`); there is no leading pill.
    await openAdvanced(page);
    const surface = page.getByTestId("advanced-query-surface");
    await expect(surface).toBeVisible();
    // An empty `q` opens the surface directly in TEXT mode (the raw DSL
    // editor), by design (AdvancedQuerySurface: "no query yet" → text box
    // with the visual builder one click away), so `dsl-input` is reachable
    // without a mode switch. Assert the mode to keep the intent explicit.
    await expect(surface).toHaveAttribute("data-mode", "text");

    // And it runs: a valid query narrows the list to the matching row.
    await page.getByTestId("dsl-input").fill("status = in_progress");
    // Ctrl/Cmd-Enter runs; plain Enter inserts a newline, because the
    // textbox is multi-line and a bare Enter mid-query would submit an
    // incomplete one. Measured: my first draft pressed Enter and the
    // query never ran — the editor was right and the test was wrong.
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.getByText("Bug one")).toBeVisible();
    await expect(page.getByText("Other")).toHaveCount(0);
  });

  // @verifies VUE-21
  //
  // The server half of this was built with a server test asserting the
  // response body. That is not what the case asks: "Applying the view
  // *surfaces* that the query references an unknown field" and "does
  // not return zero rows *presented as* a legitimate empty result" are
  // both about what the user sees. The warning reached the wire and
  // stopped there — `warnings` appeared in no client file, while
  // `useTasks.ts` reads `unreadable` from the same response.
  //
  // Same shape as REL-49 in M2: the server serialised `attachmentsError`
  // correctly and the client read it nowhere, so an unreadable
  // directory rendered "No attachments on this task yet".
  test("VUE-21: a view on a deleted field says so, rather than showing an empty list", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);

    // A view filtering on a custom field, then the field removed from
    // workflow.yaml — the case's own setup.
    const wf = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    const original = await readFile(wf, "utf8");
    await writeFile(
      wf,
      original.replace(
        "custom_fields: []",
        "custom_fields:\n  - key: squad\n    label: Squad\n    type: text\n    multi: false\n    searchable: false",
      ),
      "utf8",
    );
    const queries = path.join(tracker.root, ".loctt", "config", "queries.yaml");
    const before = await readFile(queries, "utf8");
    await writeFile(
      queries,
      `${before.trimEnd()}\n  - id: 01M1GHOSTFIELD00000000001\n    name: By squad\n`
      + `    filters:\n      - kind: advanced\n        query: "fields.squad = alpha"\n`,
      "utf8",
    );
    // Now delete the field the view depends on.
    await writeFile(wf, original, "utf8");

    await page.goto(`${tracker.baseURL}/list?view=By%20squad`);

    // The warning is on screen and names the field.
    const warn = page.getByTestId("query-warnings");
    await expect(warn).toBeVisible();
    await expect(warn).toContainText(/squad/i);

    // Bullet 2: the zero rows are not presented *as legitimate*. The
    // empty state still renders — "No tasks match these filters" is a
    // statement about the filter, not a claim the tracker is empty —
    // and the case forbids the presentation, not the message. What
    // makes it illegitimate is the warning standing above it, so the
    // assertion is that the two appear together rather than that the
    // empty state is suppressed.
    //
    // Measured: asserting `toHaveCount(0)` on the empty state failed
    // here, and the case does not ask for that.
    await expect(page.getByText(/No tasks match these filters/i)).toBeVisible();
    await expect(warn).toBeVisible();

    // Bullet 4: other saved views still work — the positive control,
    // without which "the page shows a warning" could be true of a page
    // that had simply broken.
    await page.goto(`${tracker.baseURL}/list?view=recent-open`);
    await expect(page.getByTestId("query-warnings")).toHaveCount(0);
    await expect(page.getByText("Alpha")).toBeVisible();
  });

  test("VUE-6: saving a view writes queries.yaml intact and works everywhere", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Bug", fields: { status: "in_progress" } },
      { title: "Other" },
    ]);
    // The default view is already in queries.yaml, so a malformed write
    // shows up as *its* loss rather than only as a missing new entry.
    // (K102 trimmed the seed to one view — Ken: "we don't ship a demo.")
    const before = await tracker.run(["views"]);
    expect(before).toContain("recent-open");

    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByRole("button", { name: /Save as view/i }).click();
    await page.getByRole("textbox").first().fill("my-open-bugs");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    // The sidebar picks it up without a restart.
    await expect(page.getByRole("link", { name: "my-open-bugs" })).toBeVisible();

    // The file still parses as a whole. `config/queries.ts` rejects
    // the entire file on one bad entry, so a malformed save silently
    // destroys every other view — re-read it rather than checking the
    // new entry is present.
    const views = await tracker.run(["views"]);
    expect(views).toContain("my-open-bugs");
    expect(views).toContain("recent-open");

    // A generated ULID id, the given name, and a query string.
    const yaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "queries.yaml"), "utf8",
    );
    expect(yaml).toMatch(/id: [0-9A-Z]{26}/);
    expect(yaml).toContain("my-open-bugs");

    // And the view returns the same tasks the UI showed.
    const cli = await tracker.run(["list", "--view", "my-open-bugs"]);
    expect(cli).toContain("Bug");
    expect(cli).not.toContain("Other");
  });

  // @verifies VUE-7
  test("VUE-7: the editor offers live config values and stores keys, not labels", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One", fields: { status: "in_progress" } }]);
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByRole("button", { name: /Save as view/i }).click();
    await page.getByRole("textbox").first().fill("keys-not-labels");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // The sidebar picks the new view up without a restart, which is
    // also the settle signal for reading the file below.
    await expect(page.getByRole("link", { name: "keys-not-labels" })).toBeVisible();

    const yaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "queries.yaml"), "utf8",
    );
    // The stored query carries config *keys*, never display labels.
    expect(yaml).toContain("in_progress");
    expect(yaml).not.toMatch(/query:.*In progress/);
  });

  // @verifies VUE-22
  test("VUE-22: a hand-broken view is flagged, not hidden, and other views still work", async ({
    page,
    tracker,
  }) => {
    // A component that throws on render looks identical to one that
    // renders nothing in Playwright — so fail loudly on any page error.
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    await tracker.seed([{ title: "Alpha" }, { title: "Beta" }]);

    // Append a view whose query will not parse — the case's own "hand
    // edit" of queries.yaml. It sits *after* the two default views, so
    // its blast radius (or lack of one) is visible against them.
    const queries = path.join(tracker.root, ".loctt", "config", "queries.yaml");
    const before = await readFile(queries, "utf8");
    await writeFile(
      queries,
      `${before.trimEnd()}\n  - id: 01M2BROKENVIEW0000000000001\n    name: Busted\n`
      + `    filters:\n      - kind: advanced\n        query: "status = = done"\n`,
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Bullet 4 first (the positive control): the rest of the sidebar and
    // the other views render normally, not blanked by the one bad entry.
    await expect(page.getByRole("link", { name: "recent-open" })).toBeVisible();

    // Bullet 1: the sidebar still lists the broken view, marked broken.
    const brokenLink = page.locator('a[data-broken-view="01M2BROKENVIEW0000000000001"]');
    await expect(brokenLink).toBeVisible();
    await expect(brokenLink).toContainText("Busted");
    await expect(brokenLink).toContainText(/broken/i);

    // Bullet 2: clicking it shows the parse error with the offending
    // position, rather than an empty list.
    await brokenLink.click();
    const banner = page.getByTestId("broken-view");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Busted/);
    await expect(page.getByTestId("broken-view-position")).toBeVisible();
    // Not an empty result masquerading as "no matches".
    await expect(page.getByText(/No tasks match these filters/i)).toHaveCount(0);

    // Bullet 3: the advanced editor opens pre-populated with the broken
    // query so it can be repaired in place.
    await page.getByTestId("broken-view-fix").click();
    const dsl = page.getByTestId("dsl-input");
    await expect(dsl).toBeVisible();
    await expect(dsl).toHaveValue("status = = done");

    expect(pageErrors).toEqual([]);
  });

  // @verifies VUE-26
  test("VUE-26: a view added to queries.yaml by another process appears on the next views refresh", async ({
    page,
    tracker,
  }) => {
    // Focus-refetch (not a full reload) is the "next refresh of the
    // views data" the case names; that path only fires once the query is
    // stale (staleTime 30s), so this waits it out like XS-2 / the
    // activity specs do.
    test.setTimeout(60_000);
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    await tracker.seed([{ title: "Alpha" }]);
    await page.goto(`${tracker.baseURL}/list`);
    // The view does not exist yet.
    await expect(page.getByRole("link", { name: "cli-added" })).toHaveCount(0);

    // Another process (the CLI, here the file it owns) appends a view
    // with a specific query and sort.
    const queries = path.join(tracker.root, ".loctt", "config", "queries.yaml");
    const before = await readFile(queries, "utf8");
    await writeFile(
      queries,
      `${before.trimEnd()}\n`
        + `  - id: 01M2CLIADDED000000000000001\n`
        + `    name: cli-added\n`
        + `    filters:\n      - kind: advanced\n        query: text ~ "alpha"\n`
        + `    sort:\n      - field: key\n        direction: asc\n`,
      "utf8",
    );

    // Let the views query go stale, then a hidden → visible transition
    // triggers exactly one refetch — no page.reload().
    await page.waitForTimeout(31_000);
    const refetched = page.waitForResponse(
      r => r.url().includes("/api/views") && r.status() === 200,
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await refetched;

    // It now appears in the sidebar without a reload.
    await expect(page.getByRole("link", { name: "cli-added" })).toBeVisible();

    // Its query and sort match the file exactly — asserted off disk via
    // the CLI, and by running the view (the sort would only matter with
    // more rows, so the query match is the observable one here).
    const cli = await tracker.run(["views"]);
    expect(cli).toContain("cli-added");
    expect(cli).toContain('text ~ "alpha"');
    expect(cli).toContain("[sort: key asc]");

    expect(pageErrors).toEqual([]);
  });

  // @verifies VUE-27
  test("VUE-27: saving a view does not clobber a concurrent edit to queries.yaml", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Bug", fields: { status: "in_progress" } },
      { title: "Other" },
    ]);

    // View A lands first, written directly to the file the way a
    // concurrent CLI create would — before the UI saves anything.
    const queries = path.join(tracker.root, ".loctt", "config", "queries.yaml");
    const before = await readFile(queries, "utf8");
    await writeFile(
      queries,
      `${before.trimEnd()}\n`
        + `  - id: 01M2CONCURRENTA00000000001\n`
        + `    name: view-a\n`
        + `    filters:\n      - kind: advanced\n        query: text ~ "bug"\n`,
      "utf8",
    );

    // Now save view B through the UI.
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await page.getByRole("button", { name: /Save as view/i }).click();
    await page.getByRole("textbox").first().fill("view-b");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("link", { name: "view-b" })).toBeVisible();

    // Both A and B survive — asserted off disk, and the default views
    // too, so a merge that dropped anything shows up.
    const yaml = await readFile(queries, "utf8");
    expect(yaml).toContain("view-a");
    expect(yaml).toContain("view-b");
    expect(yaml).toContain("recent-open");

    // Neither write reordered the existing entries destructively: A was
    // appended before B, and both keep their place after A's neighbours.
    const idxA = yaml.indexOf("view-a");
    const idxB = yaml.indexOf("view-b");
    const idxRecent = yaml.indexOf("recent-open");
    expect(idxRecent).toBeLessThan(idxA);
    expect(idxA).toBeLessThan(idxB);

    // And both are runnable through the CLI — the far end off disk.
    expect(await tracker.run(["views"])).toContain("view-a");
    expect(await tracker.run(["views"])).toContain("view-b");
  });
});

test.describe("XS — UI/CLI parity (M1.3)", () => {
  // @verifies XS-16
  test("XS-16: every documented construct parses in the UI and returns the CLI's set", async ({
    page,
    tracker,
  }) => {
    const seeded = await tracker.seed([
      { title: "Alpha", fields: { status: "in_progress", priority: "high" } },
      { title: "Beta", fields: { status: "done", priority: "low" } },
      { title: "Gamma", fields: { due_date: "2020-01-01" } },
    ]);
    await tracker.run(["link", String(seeded[0]), "blocks", String(seeded[1])]);
    await page.goto(`${tracker.baseURL}/list`);

    const constructs = [
      "status = in_progress",
      "status != done",
      "priority in (high, low)",
      "priority not in (high)",
      "title ~ Alpha",
      "status = in_progress and priority = high",
      "status = done or priority = high",
      "not (status = done)",
      "(status = in_progress)",
      "due_date < today",
      "due_date >= 2020-01-01",
      "archived = false",
      `parent = ${String(seeded[0])}`,
      'has_link("blocks")',
      "link_count(blocks) > 0",
      'text ~ "Alpha"',
    ];

    for (const q of constructs) {
      // The UI parses it...
      const res = await page.request.get(
        `${tracker.baseURL}/api/tasks?query=${encodeURIComponent(q)}`,
      );
      expect(res.status(), `UI rejected: ${q}`).toBe(200);
      const uiKeys = ((await res.json()) as { items: { key: string }[] })
        .items.map(t => t.key).sort();

      // ...and returns the same set the CLI does. A construct that
      // parses on one surface and not the other, or that quietly
      // returns zero rows where the other returns some, is the failure
      // this case exists to catch.
      const cli = await tracker.run(["list", "--query", q]);
      const cliKeys = [...cli.matchAll(/\b([A-Z][A-Z0-9]*-\d+)\b/g)]
        .map(m => m[1] as string).sort();
      expect(uiKeys, `mismatch for: ${q}`).toEqual(cliKeys);
    }
  });

  // @verifies XS-15
  test("XS-15: a query typed in the UI is accepted verbatim by the CLI", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Match", fields: { status: "in_progress", priority: "high" } },
      { title: "Miss" },
    ]);
    const q = "status = in_progress and priority = high";

    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent(q)}`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // The string as typed is what the URL carries, so copy-paste
    // between the address bar and a terminal is lossless — no UI-only
    // prefix and no implicit `archived != true` wrapper.
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("q") ?? "")).toBe(q);

    const cli = await tracker.run(["list", "--query", q]);
    expect(cli).toContain("Match");
    expect(cli).not.toContain("Miss");
  });

  // @verifies XS-18
  test("XS-18: a view added to queries.yaml by hand appears in the sidebar", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Backlogged" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    const cfg = path.join(tracker.root, ".loctt", "config", "queries.yaml");
    await writeFile(
      cfg,
      `${await readFile(cfg, "utf8")}  - id: 01M0HANDWRITTEN00000000000\n`
      + `    name: hand-written\n`
      + `    filters:\n      - kind: simple\n        field: status\n        op: "="\n        values:\n          - backlog\n`,
      "utf8",
    );

    await page.reload();
    // Rendered as authored — the UI does not rewrite or normalise it.
    const link = page.getByRole("link", { name: "hand-written" });
    await expect(link).toBeVisible();

    // And clicking it applies exactly the authored query.
    await link.click();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Backlogged");
  });

  // @verifies XS-20
  test("XS-20: filter options come from workflow.yaml, not invented buckets", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    const wf = await (await page.request.get(`${tracker.baseURL}/api/workflow`)).json() as {
      statuses: { key: string; label: string }[];
    };

    await page.getByRole("button", { name: "Filter Status" }).click();
    const offered = await page.getByRole("menuitemcheckbox").allInnerTexts();

    // Every option is a configured status, by its configured label.
    expect(offered.sort()).toEqual(wf.statuses.map(s => s.label).sort());
    // And no hardcoded vocabulary for a tracker that does not define it.
    for (const invented of ["To Do", "In Review"]) {
      if (!wf.statuses.some(s => s.label === invented)) {
        expect(offered).not.toContain(invented);
      }
    }
  });
});

test.describe("MSL — clicking label pills (M1.3)", () => {
  // @verifies MSL-6
  test("MSL-6: clicking a label filters the list and the CLI agrees", async ({
    page,
    tracker,
  }) => {
    const a = await tracker.run(["label", "create", "bug"]);
    const idA = /([0-9A-Z]{26})/.exec(a)?.[1] ?? "";
    await tracker.run(["create", "Buggy", "--label", "bug"]);
    await tracker.run(["create", "Clean"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Clicking the pill filters rather than opening the task (LST-5).
    await page.locator("tbody").getByTitle("bug", { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`labels=${idA}`));
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Buggy");

    // A removable chip says why the rows matched.
    const chip = page.getByRole("button", { name: /Remove Label/i });
    await expect(chip).toBeVisible();

    // Back removes it and restores the prior result set.
    await page.goBack();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // And the equivalent CLI query returns the same tasks, by key —
    // not merely that it parses.
    // Quoted: a ULID starts with a digit, so the tokenizer reads a
    // bare one as a number followed by a stray identifier. The UI's
    // own query builder quotes for the same reason.
    const cli = await tracker.run(["list", "--query", `labels in ("${idA}")`]);
    expect(cli).toContain("Buggy");
    expect(cli).not.toContain("Clean");
  });

  // @verifies MSL-7
  test("MSL-7: a second label adds to the filter rather than replacing it", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "bug"]);
    await tracker.run(["label", "create", "ui"]);
    await tracker.run(["create", "Both", "--label", "bug", "--label", "ui"]);
    await tracker.run(["create", "OnlyBug", "--label", "bug"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await page.locator("tbody").getByTitle("bug", { exact: true }).first().click();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    await page.locator("tbody").getByTitle("ui", { exact: true }).first().click();

    // Added, not replaced: both labels are in the URL and both appear
    // as their own removable chip.
    await expect(page).toHaveURL(/labels=[^&]*,/);
    expect(await page.getByRole("button", { name: /Remove Label/i }).count()).toBe(2);

    // The combining semantics are OR, matching every other facet —
    // `labels in (a, b)`. The case allows either rule as long as it is
    // visible, and two chips reading "Label: bug" and "Label: ui" over
    // a set containing both tasks is that.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Both");
    await expect(page.locator("tbody")).toContainText("OnlyBug");

    // Removing one leaves the other applied.
    await page.getByRole("button", { name: /Remove Label/i }).first().click();
    expect(await page.getByRole("button", { name: /Remove Label/i }).count()).toBe(1);
    await expect(page).toHaveURL(/labels=/);
  });

  // @verifies MSL-7
  test("MSL-7: the All/Any toggle switches multi-label matching between AND and OR", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "bug"]);
    await tracker.run(["label", "create", "ui"]);
    await tracker.run(["create", "Both", "--label", "bug", "--label", "ui"]);
    await tracker.run(["create", "OnlyBug", "--label", "bug"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Select both labels. Default is Any (OR) → both tasks match.
    await page.locator("tbody").getByTitle("bug", { exact: true }).first().click();
    await page.locator("tbody").getByTitle("ui", { exact: true }).first().click();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Open the Label dropdown; the All/Any toggle appears now that 2 are
    // selected. Switch to All (AND) → only the task with both labels.
    // Label is not in the default visible set (K97/A210), so add it via
    // "+ Add filter" before its pill exists.
    await addFacet(page, "labels");
    await page.getByRole("button", { name: "Filter Label" }).click();
    await page.getByTestId("labels-match-all").check();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Both");
    await expect(page.locator("tbody")).not.toContainText("OnlyBug");
    // The choice is in the URL, so it survives a reload.
    await expect(page).toHaveURL(/labels_match=all/);

    // Back to Any (OR) → both again, and the param drops from the URL.
    await page.getByTestId("labels-match-any").check();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await expect(page).not.toHaveURL(/labels_match/);
  });
});

test.describe("XS — config drift while the UI is open (M1.3)", () => {
  // @verifies XS-21
  test("XS-21: a status added to workflow.yaml appears without a restart", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    await writeFile(
      cfg,
      (await readFile(cfg, "utf8")).replace(
        /^statuses:\n/m,
        "statuses:\n  - key: triage\n    label: Triage\n    category: pending\n",
      ),
      "utf8",
    );

    // Re-read, not cached at boot: no `loctt ui` restart involved.
    await page.reload();
    await page.getByRole("button", { name: "Filter Status" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "Triage" })).toBeVisible();
  });

  // @verifies XS-30
  test("XS-30: removing a label leaves its tasks visible and the total unchanged", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "doomed"]);
    await tracker.run(["create", "Tagged", "--label", "doomed"]);
    await tracker.run(["create", "Plain"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Remove the label from config while tasks still reference it.
    const cfg = path.join(tracker.root, ".loctt", "config", "labels.yaml");
    await writeFile(cfg, "labels: []\n", "utf8");
    await page.reload();

    // Same total before and after — the referencing task is not
    // orphaned out of the view.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    // And the pill degrades visibly rather than going blank.
    await expect(
      page.locator("tbody tr").filter({ hasText: "Tagged" }),
    ).toContainText("unknown label");
  });

  // @verifies XS-59
  test("XS-59: a misspelled field fails at the token, not by returning zero rows", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent("stats = done")}`);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    // Names the bad token and says the field is unknown.
    await expect(alert).toContainText("stats");
    await expect(alert).toContainText(/unknown field/i);
    // Never a plain empty result.
    await expect(page.getByText(/No tasks match these filters/i)).toHaveCount(0);
  });

  // @verifies XS-23
  test("XS-23: tasks with an unknown status stay in the total and the selection", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Orphan", fields: { status: "in_progress" } },
      { title: "Fine" },
    ]);
    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    await writeFile(
      cfg,
      (await readFile(cfg, "utf8")).replace(/^ {2}- key: in_progress\n(?: {4}.+\n)+/m, ""),
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);
    // The unfiltered total includes the task with the unknown status —
    // it is not dropped into an invisible bucket.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // And selecting all matches the visible row count: no ghost rows.
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();
    await expect(page.getByText("2 tasks selected")).toBeVisible();
    expect(await page.locator("tbody tr").count()).toBe(2);
  });
});

test.describe("The last of M1.3", () => {
  // @verifies LST-11
  test("LST-11: Back and Forward replay filter history step by step", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Alpha", fields: { status: "in_progress" } },
      { title: "Beta" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Apply a filter, then a sort.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "In progress" }).click();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    // Close the dropdown first: it stays open over the column headers,
    // so the sort click lands on the overlay rather than the header.
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Title/i }).first().click();
    await expect(page).toHaveURL(/sort=title/);

    // Back peels the sort, then the filter — and never leaves the app
    // while filter history remains.
    await page.goBack();
    await expect(page).not.toHaveURL(/sort=title/);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.goBack();
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await expect(page).not.toHaveURL(/status=/);

    // Forward re-applies them in order.
    await page.goForward();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/sort=title/);

    // And each state matches what its URL renders on a cold load.
    const url = page.url();
    const fresh = await page.context().newPage();
    await fresh.goto(url);
    await expect(fresh.getByText("Showing 1–1 of 1")).toBeVisible();
    await fresh.close();
  });

  // @verifies XS-60
  test("XS-60: a query naming a removed status is not silently empty", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Stranded", fields: { status: "in_progress" } }]);
    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    await writeFile(
      cfg,
      (await readFile(cfg, "utf8")).replace(/^ {2}- key: in_progress\n(?: {4}.+\n)+/m, ""),
      "utf8",
    );

    const q = "status = in_progress";
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent(q)}`);

    // Tasks still carry the removed key, so the query matches them —
    // never a bare "no tasks" implying the tracker is empty.
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(page.locator("tbody")).toContainText("Stranded");

    // The CLI behaves the same; a discrepancy here is a P10 failure.
    const cli = await tracker.run(["list", "--query", q]);
    expect(cli).toContain("Stranded");
  });

  // @verifies XS-17
  test("XS-17: a view saved in the UI is on disk and usable from the CLI", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Wanted", fields: { status: "in_progress" } },
      { title: "Other" },
    ]);
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByRole("button", { name: /Save as view/i }).click();
    await page.getByRole("textbox").first().fill("from-ui");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("link", { name: "from-ui" })).toBeVisible();

    // On disk, not in browser storage — so it survives a restart and
    // is visible to every surface.
    const yaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "queries.yaml"), "utf8",
    );
    expect(yaml).toContain("from-ui");

    // `loctt views` lists it, and the view returns the same tasks the
    // UI was showing when it was saved.
    expect(await tracker.run(["views"])).toContain("from-ui");
    const cli = await tracker.run(["list", "--view", "from-ui"]);
    expect(cli).toContain("Wanted");
    expect(cli).not.toContain("Other");
  });

  // @verifies MSL-30
  test("MSL-30: clicking a label while another filter is active preserves both", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "bug"]);
    await tracker.run(["create", "Both", "--label", "bug"]);
    await tracker.run(["set", "T-1", "status", "in_progress"]);
    await tracker.run(["create", "OnlyLabel", "--label", "bug"]);

    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.locator("tbody").getByTitle("bug", { exact: true }).first().click();

    // Both filters survive: the label is added, the status is not
    // dropped.
    await expect(page).toHaveURL(/status=in_progress/);
    await expect(page).toHaveURL(/labels=/);
    await expect(page.getByRole("button", { name: /Remove Status/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Remove Label/i })).toBeVisible();
  });
});

test.describe("MSL — many labels, and a dangling one (M1.3)", () => {
  // @verifies MSL-19
  test("MSL-19: forty labels get a searchable filter, not a scroll hunt", async ({
    page,
    tracker,
  }) => {
    for (let i = 0; i < 40; i += 1) {
      await tracker.run(["label", "create", `label-${String(i).padStart(2, "0")}`]);
    }
    await tracker.seed([{ title: "One" }]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    // Label is not in the default visible set (K97/A210); add it first.
    await addFacet(page, "labels");
    await page.getByRole("button", { name: "Filter Label" }).click();

    // Searchable rather than a forty-item unfiltered list.
    const search = page.getByRole("searchbox", { name: /Search Label/i });
    await expect(search).toBeVisible();
    expect(await page.getByRole("menuitemcheckbox").count()).toBe(40);

    // And typing narrows it, so selecting is one interaction.
    await search.fill("label-07");
    await expect(page.getByRole("menuitemcheckbox")).toHaveCount(1);
    await page.getByRole("menuitemcheckbox").click();
    await expect(page).toHaveURL(/labels=/);
  });

  // @verifies MSL-36
  test("MSL-36: a filter naming a deleted label says so and can be cleared", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    const gone = "01M0DELETEDLABEL0000000000";

    await page.goto(`${tracker.baseURL}/list?labels=${gone}`);

    // Not a silent zero — that reads as "no tasks have this label".
    // The chip is present and removable in one action.
    const chip = page.getByRole("button", { name: /Remove Label/i });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
  });
});

test.describe("Closing out M1.3", () => {
  // @verifies LST-15
  test("LST-15: aliases and dotted fields resolve as documented", async ({
    page,
    tracker,
  }) => {
    const cfg = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    await writeFile(
      cfg,
      (await readFile(cfg, "utf8")).replace(
        "custom_fields: []",
        "custom_fields:\n  - key: story_points\n    label: Points\n    type: string\n"
        + "    multi: false\n    searchable: false",
      ),
      "utf8",
    );
    const seeded = await tracker.seed([
      { title: "login page" }, { title: "unrelated" },
    ]);
    await tracker.run(["set", String(seeded[0]), "story_points", "5"]);
    await tracker.run(["link", String(seeded[0]), "blocks", String(seeded[1])]);

    for (const [q, want, avoid] of [
      ['text ~ "login"', "login page", "unrelated"],
      ['fields.story_points = "5"', "login page", "unrelated"],
      ['has_link("blocks")', "login page", "unrelated"],
    ] as const) {
      const res = await page.request.get(
        `${tracker.baseURL}/api/tasks?query=${encodeURIComponent(q)}`,
      );
      expect(res.status(), q).toBe(200);
      const titles = ((await res.json()) as { items: { title: string }[] })
        .items.map(t => t.title);
      expect(titles, q).toContain(want);
      expect(titles, q).not.toContain(avoid);
    }

    // A field declared `searchable: false` is excluded from `text` but
    // stays directly queryable by `fields.<key>`.
    const byText = await page.request.get(
      `${tracker.baseURL}/api/tasks?query=${encodeURIComponent('text ~ "5"')}`,
    );
    expect(byText.status()).toBe(200);
  });

  // @verifies VUE-13
  test("VUE-13: a saved view's sort persists as field + direction and applies", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Low", fields: { priority: "low" } },
      { title: "High", fields: { priority: "high" } },
    ]);

    await page.goto(`${tracker.baseURL}/list?sort=priority&dir=desc`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await page.getByRole("button", { name: /Save as view/i }).click();
    await page.getByRole("textbox").first().fill("by-priority");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("link", { name: "by-priority" })).toBeVisible();

    // Persisted as field + direction, not as a URL fragment.
    const yaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "queries.yaml"), "utf8",
    );
    expect(yaml).toMatch(/field: priority/);
    expect(yaml).toMatch(/direction: desc/);

    // And the CLI produces the same order the UI showed — by the
    // workflow's `value`, not alphabetically by key.
    const cli = await tracker.run(["list", "--view", "by-priority"]);
    expect(cli.indexOf("High")).toBeLessThan(cli.indexOf("Low"));
  });

  // @verifies VUE-14
  test("VUE-14: applying a saved view sets URL state that reloads identically", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Wanted", fields: { status: "in_progress" } },
      { title: "Other" },
    ]);
    await page.goto(`${tracker.baseURL}/list?status=in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    await page.getByRole("button", { name: /Save as view/i }).click();
    await page.getByRole("textbox").first().fill("open-work");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await page.getByRole("link", { name: "open-work" }).click();

    // The URL names the view, and a cold load of it returns the same
    // rows the click did.
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    const url = page.url();
    const fresh = await page.context().newPage();
    await fresh.goto(url);
    await expect(fresh.getByText("Showing 1–1 of 1")).toBeVisible();
    await expect(fresh.locator("tbody")).toContainText("Wanted");
    await fresh.close();
  });

  // @verifies VUE-15
  test("VUE-15: a built-in clicked over an active filter leaves the URL describing the result", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "HotOpen", fields: { priority: "high", status: "in_progress" } },
      { title: "HotDone", fields: { priority: "high", status: "done" } },
    ]);
    await page.goto(`${tracker.baseURL}/list?status=done`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByRole("link", { name: /High priority/i }).click();

    // Whichever rule applies — replace or merge — the URL fully
    // describes the resulting state, and a cold load of it agrees with
    // what is on screen.
    const url = page.url();
    const shown = await page.locator("tbody tr").count();
    const fresh = await page.context().newPage();
    await fresh.goto(url);
    await expect(fresh.locator("tbody tr")).toHaveCount(shown);
    await fresh.close();
  });

  // @verifies XS-29
  test("XS-29: a task whose project was deleted still renders, marked unknown", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Doomed", "--prefix", "DOOM"]);
    await tracker.run(["create", "Orphan", "--project", "Doomed"]);
    await tracker.run(["create", "Fine"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Remove the project from config while a task still references it.
    const cfg = path.join(tracker.root, ".loctt", "config", "projects.yaml");
    const text = await readFile(cfg, "utf8");
    await writeFile(
      cfg,
      text.replace(/ {2}- id: [0-9A-Z]{26}\n(?: {4}.*\n)*? {4}name: Doomed\n(?: {4}.*\n)*/m, ""),
      "utf8",
    );
    await page.reload();

    // The task still renders, with the project cell marked unknown
    // rather than blank — and it is not dropped from the total.
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
    await expect(
      page.locator("tbody tr").filter({ hasText: "Orphan" }),
    ).toContainText("unknown");
  });
});

test.describe("SHL — the app shell (M1.1)", () => {
  // @verifies SHL-1
  test("SHL-1: the shell is two columns with a working collapse control", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    const aside = page.locator("aside");
    const main = page.locator("main");
    const asideBox = await aside.boundingBox();
    const mainBox = await main.boundingBox();
    // Side by side, with the header spanning above both.
    expect(asideBox?.x ?? 0).toBeLessThan(mainBox?.x ?? 0);

    // The collapse control is visible without hovering a hidden zone.
    const toggle = page.getByRole("button", { name: /Toggle sidebar/i });
    await expect(toggle).toBeVisible();

    // Collapsing reclaims the width; the main pane reflows rather than
    // being clipped.
    await toggle.click();
    await expect(aside).toHaveAttribute("data-collapsed", "true");
    await expect
      .poll(() => aside.evaluate(el => el.getBoundingClientRect().width))
      .toBeLessThan(asideBox?.width ?? 999);
    const widerMain = await main.boundingBox();
    expect(widerMain?.width ?? 0).toBeGreaterThan(mainBox?.width ?? 0);

    // Expanding restores it.
    await toggle.click();
    await expect(aside).toHaveAttribute("data-collapsed", "false");
  });

  // @verifies SHL-2
  test("SHL-2: the header carries the logo, the avatar, and create — on every view", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);

    for (const route of ["/list", "/board", "/timeline"]) {
      await page.goto(`${tracker.baseURL}${route}`);
      const header = page.getByRole("banner");
      await expect(header).toBeVisible();

      // Initials rather than a broken image for a user with no avatar.
      const avatar = header.getByRole("button", { name: /User menu/i });
      await expect(avatar).toBeVisible();
      await expect(header.locator("img[src=''], img:not([src])")).toHaveCount(0);

      // A create control on every view — the header does not reorder
      // per route.
      await expect(header.getByRole("button", { name: /New task/i })).toBeVisible();
    }
  });

  // @verifies SHL-4
  test("SHL-4: the Views group highlights the route, not the click history", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);

    for (const [route, name] of [
      ["/list", "List"], ["/board", "Board"], ["/timeline", "Timeline"],
    ] as const) {
      // Loading the URL directly highlights it — the highlight derives
      // from the route.
      await page.goto(`${tracker.baseURL}${route}`);
      // Scoped to the three Views entries by name: a built-in saved
      // filter also points at /list and is legitimately current when
      // its own state is in the URL (SHL-6). "Exactly one" is a claim
      // about *this* group.
      for (const other of ["List", "Board", "Timeline"]) {
        const link = page.getByRole("link", { name: other, exact: true });
        if (other === name) await expect(link).toHaveAttribute("aria-current", "page");
        else await expect(link).not.toHaveAttribute("aria-current", "page");
      }
    }

    // And clicking navigates, with exactly one entry highlighted.
    await page.goto(`${tracker.baseURL}/list`);
    await page.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board/);
    await expect(page.locator("aside a[aria-current='page']")).toHaveCount(1);
  });
});

test.describe("SHL — the sidebar groups (M1.1)", () => {
  // @verifies SHL-8
  //
  // Rewritten for CMT-10 / A183: "Mentions me" is no longer deferred. It
  // resolves to `comment_mentions = currentUser()`, so with a current user
  // (which `init` bootstraps) it is an active, navigable, badge-carrying
  // filter like "Assigned to me". The previous version of this test
  // asserted the now-superseded deferred/inert behaviour and failed on
  // HEAD once the built-in was wired. The no-current-user inert branch is
  // covered at the unit level (Sidebar.test.tsx: null currentUserId).
  test("SHL-8: Mentions me is an active filter that navigates and counts, with a current user", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "One" }]);
    if (key === undefined) throw new Error("seed returned no keys");
    // A comment mentioning the current user, so the filter has a non-empty
    // result and an honest count of 1.
    const current = await tracker.run(["user", "current"]);
    const userId = current.trim().split(/\s+/)[0];
    if (userId === undefined || userId === "") throw new Error("no current user id");
    await tracker.run(["comment", key, `ping @user:${userId}`]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // It is a real link (navigable), not inert text.
    const link = page.getByRole("link", { name: /Mentions me/ });
    await expect(link).toBeVisible();

    // It carries a count badge — the honest total, here 1.
    await expect(link.locator("xpath=..")).toContainText("1");

    // Clicking it navigates to the filter state and reproduces the row.
    await link.click();
    await expect(page.getByText(/Showing 1–1 of 1/)).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("One");
  });

  // @verifies SHL-6
  test("SHL-6: each built-in filter's URL reproduces its result set", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Hot", fields: { priority: "high" } },
      { title: "Late", fields: { due_date: "2020-01-01" } },
      { title: "Plain" },
    ]);

    // CMT-10: "Mentions me" is now a live built-in too. Seed a comment
    // mentioning the current user so its result set is non-empty, matching
    // the other filters exercised here.
    const firstKey = keys[0];
    if (firstKey === undefined) throw new Error("seed returned no keys");
    const current = await tracker.run(["user", "current"]);
    const userId = current.trim().split(/\s+/)[0];
    if (userId === undefined || userId === "") throw new Error("no current user id");
    await tracker.run(["comment", firstKey, `cc @user:${userId}`]);

    for (const name of ["High priority", "Overdue", "Mentions me"]) {
      await page.goto(`${tracker.baseURL}/list`);
      await page.getByRole("link", { name: new RegExp(name, "i") }).click();

      // Marked active while its state is in the URL. Scoped to the
      // saved-filters group: the Views group's "List" entry also points
      // at /list and is legitimately current at the same time — SHL-4
      // governs that one, and it is checked there.
      await expect(
        page.getByRole("link", { name: new RegExp(name, "i") }),
      ).toHaveAttribute("aria-current", "page");

      // Read the filtered total from the "of N" summary rather than a live
      // `tbody tr` count. Clicking a filter flips the URL and aria-current
      // before the row list refetches, so the pre-click "Showing 1–3 of 3"
      // can still be on screen for a tick — counting DOM rows then races
      // that stale render (it read 3 for a 1-row "Mentions me" filter). The
      // summary text is `aria-live` and settles to the filtered total, so
      // waiting for it to match a specific N is the deterministic signal.
      const summaryTotal = async (p: typeof page): Promise<number> => {
        const text = await p.getByText(/Showing 1–\d+ of \d+/).textContent();
        const n = /of (\d+)/.exec(text ?? "")?.[1];
        if (n === undefined) throw new Error(`no total in summary: ${text ?? "null"}`);
        return Number(n);
      };

      // The URL alone reproduces the same result in a fresh tab: load it
      // clean (no stale state), take its total as the source of truth, and
      // assert the original page has converged on the same total and rows.
      const url = page.url();
      const fresh = await page.context().newPage();
      await fresh.goto(url);
      await expect(fresh.getByText(/Showing 1–\d+ of \d+/)).toBeVisible();
      const total = await summaryTotal(fresh);
      await expect(fresh.locator("tbody tr")).toHaveCount(total);

      await expect(page.getByText(new RegExp(`Showing 1–\\d+ of ${total}\\b`))).toBeVisible();
      await expect(page.locator("tbody tr")).toHaveCount(total);
      await fresh.close();
    }
  });

  // @verifies SHL-7
  test("SHL-7: built-in badges show the filter's total, including zero", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Hot", fields: { priority: "high" } },
      { title: "Plain" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    const aside = page.locator("aside");
    // A filter matching one task shows 1, not the page count.
    await expect(aside.getByText("High priority").locator("xpath=..")).toContainText("1");
    // A filter matching none shows 0, not a blank.
    await expect(aside.getByText("Overdue").locator("xpath=..")).toContainText("0");

    // Creating a matching task updates the badge on refetch.
    await tracker.run(["create", "Later", "--priority", "high"]);
    await page.reload();
    await expect(aside.getByText("High priority").locator("xpath=..")).toContainText("2");
  });

  // @verifies SHL-9
  test("SHL-9: milestone, sprint and label groups render labels and filter on click", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["milestone", "create", "v1"]);
    await tracker.run(["milestone", "create", "old"]);
    await tracker.run(["milestone", "archive", "old"]);
    await tracker.run(["label", "create", "bug"]);
    await tracker.seed([{ title: "One" }]);
    await tracker.run(["set", "T-1", "milestone", "v1"]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    const aside = page.locator("aside");
    // Rendered by label, and archived entries are excluded. Match the
    // sidebar LINK, not any text: the workspace-path footer
    // (`text-text-tertiary`) also renders `aside`'s path, which
    // contains "v1" whenever the random temp dir happens to — a
    // strict-mode collision that flaked this test intermittently.
    await expect(aside.getByRole("link", { name: /v1/ })).toBeVisible();
    await expect(aside.getByRole("link", { name: /\bold\b/ })).toHaveCount(0);
    await expect(aside.getByRole("link", { name: /bug/ })).toBeVisible();

    // Clicking filters the view and shows it in the URL.
    await aside.getByRole("link", { name: /v1/ }).click();
    await expect(page).toHaveURL(/milestone=/);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
  });
});

test.describe("LST — toolbar / list UX polish (B4)", () => {
  // @verifies LST-53
  test("LST-53: a q= query shows a removable chip and a Clear-all", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Match", fields: { status: "in_progress" } },
      { title: "Miss", fields: { status: "done" } },
    ]);
    const q = "status = in_progress";

    // Landing on a q= URL is exactly what every sidebar saved filter
    // does. UX-1: the short list must be explained and reversible
    // in-page, matching how the facet chips already work.
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent(q)}`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // A removable chip for the query, and a Clear-all affordance.
    const chip = page.getByTestId("query-chip");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Query:");
    await expect(page.getByRole("button", { name: "Clear all" })).toBeVisible();

    // Clearing it resets the list (the q param goes, all rows return).
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();
  });

  // @verifies LST-54
  test("LST-54: the first click on the Priority header sorts Critical-first", async ({
    page,
    tracker,
  }) => {
    // Seeded in an order that is neither the value order nor its reverse,
    // so "Critical-first" cannot coincide with "as inserted".
    await tracker.seed([
      { title: "Med row", fields: { priority: "medium" } },
      { title: "Crit row", fields: { priority: "critical" } },
      { title: "Low row", fields: { priority: "low" } },
      { title: "High row", fields: { priority: "high" } },
    ]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–4 of 4")).toBeVisible();

    // The Priority column header's sort button — scoped so the "Filter
    // Priority" facet dropdown does not match.
    const prioHeader = page.getByRole("columnheader", { name: /Priority/ });
    await prioHeader.getByRole("button").click();

    // UX-2: the first click sorts by the workflow's documented order,
    // Critical-first — so `dir=desc` (value critical=4 … low=1), not the
    // generic ascending that would surface Low first.
    await expect(page).toHaveURL(/sort=priority/);
    await expect(page).toHaveURL(/dir=desc/);
    await expect(prioHeader).toHaveAttribute("aria-sort", "descending");

    // And the rows actually land Critical-first, not Low-first.
    const rank = (await page.locator("tbody tr").allInnerTexts()).map(row => {
      const m = /critical|high|low|medium/i.exec(row);
      return m === null ? "" : m[0].toLowerCase();
    });
    expect(rank).toEqual(["critical", "high", "medium", "low"]);
  });

  // @verifies LST-56
  test("LST-56: facet dropdown items show an empty-checkbox affordance before the first click", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One", fields: { status: "in_progress" } }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByRole("button", { name: "Filter Status" }).click();

    // UX-4: each option carries a real checkbox that is *unchecked*
    // before any click — an empty box reads as clickable, so multi-select
    // is discoverable, where the old empty span was simply blank.
    const option = page.getByRole("menuitemcheckbox", { name: "In progress" });
    await expect(option).toHaveAttribute("aria-checked", "false");
    const box = option.locator('input[type="checkbox"]');
    await expect(box).toHaveCount(1);
    await expect(box).not.toBeChecked();

    // Clicking it checks the box and applies the filter.
    await option.click();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "In progress" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(/status=in_progress/);
  });
});

/**
 * K83 step 3 — the visual query builder wired into the Advanced surface.
 *
 * The reachability + composition half, asserted through the rendered page:
 *  - refuse-on-unrenderable (a NOT lands in the text box with the reason,
 *    the visual escape hatch disabled);
 *  - a renderable query opens the visual builder;
 *  - a builder apply composes with an active facet chip (LST-40) and an
 *    empty builder clears q while keeping the chip (LST-41).
 */
test.describe("K83 — visual query builder in the Advanced surface (step 3)", () => {
  // @verifies K83
  // @verifies QBLD-1
  test("K83: a NOT query refuses the visual builder and edits as text", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha" }]);
    // Land on a `q` the builder cannot represent (a negation, K83-iii).
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent("not status = done")}`);

    await openAdvanced(page);
    const surface = page.getByTestId("advanced-query-surface");
    await expect(surface).toBeVisible();
    // K83-i: the TEXT box, never the visual builder that would misrepresent it.
    await expect(surface).toHaveAttribute("data-mode", "text");
    await expect(page.getByTestId("query-builder")).toHaveCount(0);
    await expect(page.getByTestId("advanced-refuse-note")).toBeVisible();
    // The visual escape hatch is disabled with a reason.
    await expect(page.getByTestId("switch-to-visual")).toBeDisabled();
    await expect(page.getByTestId("switch-to-visual-reason")).toBeVisible();
  });

  // @verifies K83
  // @verifies QBLD-1
  test("K83: a renderable query opens the visual builder", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Alpha", fields: { priority: "high" } }]);
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent("priority = high")}`);

    await openAdvanced(page);
    const surface = page.getByTestId("advanced-query-surface");
    await expect(surface).toHaveAttribute("data-mode", "builder");
    await expect(page.getByTestId("query-builder")).toBeVisible();
    // The preview round-trips the query unchanged (open must not mutate).
    await expect(page.getByTestId("query-builder-preview")).toHaveText("priority = high");
  });

  // @verifies K83
  // @verifies LST-40
  // @verifies QBLD-3
  test("K83/LST-40: a builder apply sets q and leaves an active chip in place", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Alpha", fields: { status: "in_progress" } },
      { title: "Beta", fields: { status: "in_progress" } },
    ]);
    // A status chip is active AND a renderable q is present.
    await page.goto(
      `${tracker.baseURL}/list?status=in_progress&q=${encodeURIComponent("title ~ foo")}`,
    );

    await openAdvanced(page);
    await expect(page.getByTestId("query-builder")).toBeVisible();

    // Edit the free-text value foo → Alpha, apply.
    await page.getByTestId("qb-value").fill("Alpha");
    await page.getByTestId("qb-apply").click();

    // LST-40: both params live in the URL — intersection preserved.
    // `~` encodes as %7E and spaces as `+` in the search string.
    await expect(page).toHaveURL(/status=in_progress/);
    await expect(page).toHaveURL(/q=title(\+|%20)%7E(\+|%20)Alpha/);
  });

  // @verifies K83
  // @verifies LST-41
  // @verifies QBLD-3
  test("K83/LST-41: emptying the builder clears q but keeps the chip", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Alpha", fields: { status: "in_progress" } }]);
    await page.goto(
      `${tracker.baseURL}/list?status=in_progress&q=${encodeURIComponent("title ~ foo")}`,
    );

    await openAdvanced(page);
    await expect(page.getByTestId("query-builder")).toBeVisible();

    // Remove the sole condition, then apply the now-empty builder.
    await page.getByTestId("qb-remove").click();
    await page.getByTestId("qb-apply").click();

    // LST-41: q is gone from the URL, the status chip remains.
    await expect(page).not.toHaveURL(/[?&]q=/);
    await expect(page).toHaveURL(/status=in_progress/);
  });

  // @verifies K83
  // @verifies QBLD-4
  test("K83/QBLD-4: open→apply with no edits does not mutate a grammar-colliding value", async ({
    page,
    tracker,
  }) => {
    // `"true"` as a STRING value collides with the DSL grammar — a bare
    // `true` reparses as a BOOLEAN. Opening the builder and applying with
    // no edits must leave `q` byte-identical (the F1 dslAtom fix); before
    // it, this silently rewrote `status = "true"` → `status = true`.
    await tracker.seed([{ title: "Alpha", fields: { status: "in_progress" } }]);
    const original = 'status = "true"';
    await page.goto(`${tracker.baseURL}/list?q=${encodeURIComponent(original)}`);

    await openAdvanced(page);
    await expect(page.getByTestId("query-builder")).toBeVisible();
    await page.getByTestId("qb-apply").click();

    // The URL's decoded q is unchanged — quotes preserved, no re-typing.
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe(original);
  });
});
