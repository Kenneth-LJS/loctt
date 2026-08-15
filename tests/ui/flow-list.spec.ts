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
