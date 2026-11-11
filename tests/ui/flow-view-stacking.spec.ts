/**
 * Filters stacking on an open view (issues #7, #9; K162), the task-row
 * checkbox size (issue #8; K163) and ctrl/cmd-clicking a row (K164), in a
 * real browser against the built `loctt ui`.
 *
 * The far end is asserted wherever there is one: the rows the server
 * returned (the "Showing" count plus which titles are present), the view
 * `loctt list --view` runs after a save, and the measured box.
 */
import { expect, test } from "./fixtures/tracker.ts";

/** Creates a saved view through the CLI and returns its id. */
async function createView(
  tracker: { run(args: readonly string[]): Promise<string> },
  name: string,
  ...filterArgs: string[]
): Promise<string> {
  const out = await tracker.run(["views", "create", name, ...filterArgs]);
  const id = /id (\S+)\)/.exec(out)?.[1];
  if (id === undefined) throw new Error(`no view id in: ${out}`);
  return id;
}

/**
 * Discriminating seed: the view (`priority = high`) matches three tasks,
 * the status facet keeps one of them, and "Low backlog" matches the facet
 * but not the view.
 */
async function seed(tracker: { run(args: readonly string[]): Promise<string> }): Promise<string> {
  await tracker.run(["create", "High backlog", "--priority", "high", "--status", "backlog"]);
  await tracker.run(["create", "High done", "--priority", "high", "--status", "done"]);
  await tracker.run(["create", "High wont", "--priority", "high", "--status", "wont_do"]);
  await tracker.run(["create", "Low backlog", "--priority", "low", "--status", "backlog"]);
  return createView(tracker, "highs", "--query", "priority = high");
}

test.describe("VUE-44 — toolbar filters narrow an open view", () => {
  // @verifies VUE-44
  test("VUE-44: a status facet on an open view hides the other statuses, on list and board", async ({
    page,
    tracker,
  }) => {
    const id = await seed(tracker);

    await page.goto(`${tracker.baseURL}/list?view=${id}`);
    await expect(page.getByText("Showing 1–3 of 3")).toBeVisible();

    await page.goto(`${tracker.baseURL}/list?view=${id}&status=backlog,in_progress`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();
    const table = page.getByRole("table", { name: "Tasks" });
    await expect(table.getByText("High backlog")).toBeVisible();
    await expect(table.getByText("High done")).toHaveCount(0);
    await expect(table.getByText("Low backlog")).toHaveCount(0);

    // The board shares the task query (issue #9: "across all task lists").
    await page.goto(`${tracker.baseURL}/board?view=${id}&status=backlog`);
    await expect(page.getByText("High backlog")).toBeVisible();
    await expect(page.getByText("High done")).toHaveCount(0);
    await expect(page.getByText("Low backlog")).toHaveCount(0);
  });
});

test.describe("VUE-43 — saving from an open view keeps its filters", () => {
  // @verifies VUE-43
  test("VUE-43: Save as view on view + facet stores both, and the CLI runs it the same", async ({
    page,
    tracker,
  }) => {
    const id = await seed(tracker);

    await page.goto(`${tracker.baseURL}/list?view=${id}&status=backlog`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    await page.getByTestId("view-actions-save-view").click();
    await page.getByRole("textbox").first().fill("high-backlog");
    // Both the view's filter and the facet are previewed.
    await expect(page.getByTestId("save-view-filter-row")).toHaveCount(2);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("link", { name: "high-backlog" })).toBeVisible();

    // Saving B alone would also return "Low backlog".
    const cli = await tracker.run(["list", "--view", "high-backlog"]);
    expect(cli).toContain("High backlog");
    expect(cli).not.toContain("Low backlog");
    expect(cli).not.toContain("High done");
  });
});

test.describe("LST-59 — task-row checkboxes are 16px", () => {
  // @verifies LST-59
  test("LST-59: row and select-all checkboxes measure 16px; a Settings checkbox keeps 24px", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["create", "A task"]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    for (const name of ["Select T-1", "Select all on this page"]) {
      const box = await page.getByRole("checkbox", { name }).boundingBox();
      expect(box?.width).toBeCloseTo(16, 0);
      expect(box?.height).toBeCloseTo(16, 0);
    }

    // Positive control: the primitive's default is untouched elsewhere.
    await page.goto(`${tracker.baseURL}/settings/calendar`);
    const settingsBox = await page.getByRole("checkbox").first().boundingBox();
    expect(settingsBox?.width ?? 0).toBeGreaterThanOrEqual(24);
  });
});

test.describe("LST-58 — ctrl/cmd-click a row opens a new tab", () => {
  // @verifies LST-58
  test("LST-58: a ctrl/cmd-click on the row body opens the task in a new tab and the list stays", async ({
    page,
    context,
    tracker,
  }) => {
    await tracker.run(["create", "Open me"]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    const row = page.getByRole("table", { name: "Tasks" }).locator("tbody tr").first();
    const [tab] = await Promise.all([
      context.waitForEvent("page"),
      row.getByText("Open me").click({ modifiers: ["ControlOrMeta"] }),
    ]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname).toBe("/tasks/T-1");
    expect(new URL(page.url()).pathname).toBe("/list");
    await tab.close();
  });
});
