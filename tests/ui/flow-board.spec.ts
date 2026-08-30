/**
 * Transcribed from docs/dev/ui-test-cases/flow-board.md (plus ONB-11
 * from flow-onboarding.md and MSL-5 / MSL-20 from
 * flow-milestones-labels.md).
 *
 * M3.1 — the **static** board. Drag-and-drop is M3.2, so no case here
 * picks a card up; the ones that do (BRD-9..13, 25..32, 34..38, 41..44,
 * 49) are deliberately absent rather than half-asserted.
 *
 * One `test` per case, named by case ID, with a `@verifies` tag. The
 * prose is the specification: a spec asserting something the case does
 * not claim has drifted from it.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/**
 * Replaces the `statuses:` block of a tracker's workflow.yaml.
 *
 * Line-based rather than a YAML round-trip so the rest of the file —
 * priorities, task types, relationships and their comments — survives
 * untouched, matching what the fixture's own `applyFields` does for
 * task frontmatter.
 */
async function setStatuses(
  root: string,
  statuses: readonly { key: string; label: string; category?: string; default?: boolean }[],
): Promise<void> {
  const file = path.join(root, ".loctt", "config", "workflow.yaml");
  const text = await readFile(file, "utf8");
  const block = statuses
    .map(s =>
      [
        `  - key: ${s.key}`,
        `    label: ${JSON.stringify(s.label)}`,
        `    category: ${s.category ?? "pending"}`,
        ...(s.default === true ? ["    default: true"] : []),
      ].join("\n"),
    )
    .join("\n");
  // From `statuses:` up to the next top-level key.
  const next = text.replace(
    /^statuses:\n(?:[ \t#].*\n|\n)*?(?=^[a-z_]+:)/m,
    `statuses:\n${block}\n\n`,
  );
  if (next === text) throw new Error("statuses block not replaced");
  await writeFile(file, next, "utf8");
}

/** Appends a `boards:` block to workflow.yaml. */
async function setBoards(root: string, yaml: string): Promise<void> {
  const file = path.join(root, ".loctt", "config", "workflow.yaml");
  const text = await readFile(file, "utf8");
  await writeFile(file, `${text}\n${yaml}\n`, "utf8");
}

/** Reads the current user's settings.yaml, or "" if it does not exist. */
async function readUserSettings(root: string): Promise<string> {
  const usersDir = path.join(root, ".loctt", "users");
  const { readdir } = await import("node:fs/promises");
  const ids = await readdir(usersDir);
  for (const id of ids) {
    try {
      return await readFile(path.join(usersDir, id, "settings.yaml"), "utf8");
    } catch {
      continue;
    }
  }
  return "";
}

test.describe("BRD — board view", () => {
  // @verifies BRD-1
  test("BRD-1: /board renders one column per status in declaration order", async ({
    page,
    tracker,
  }) => {
    await setStatuses(tracker.root, [
      { key: "backlog", label: "Not started", default: true },
      { key: "in_progress", label: "In progress", category: "active" },
      { key: "in_review", label: "In review", category: "active" },
      { key: "blocked", label: "Blocked", category: "active" },
      { key: "done", label: "Done", category: "completed" },
      { key: "wont_do", label: "Won't do", category: "discarded" },
    ]);
    await tracker.seed([
      { title: "Alpha" },
      { title: "Beta", fields: { status: "in_progress" } },
      { title: "Gamma", fields: { status: "wont_do" } },
    ]);

    await page.goto(`${tracker.baseURL}/board`);

    const columns = page.locator("[data-testid^='board-column-']");
    await expect(columns).toHaveCount(6);

    // Declaration order, left to right — not alphabetical (which would
    // lead with "Blocked") and not grouped by category.
    await expect(columns.locator("header")).toHaveText([
      /Not started/,
      /In progress/,
      /In review/,
      /Blocked/,
      /Done/,
      /Won't do/,
    ]);

    // Headers show the label, never the stored key.
    await expect(page.locator("[data-testid='board']")).not.toContainText("wont_do");
    await expect(page.locator("[data-testid='board']")).not.toContainText("not_started");

    // Every task in exactly one column, matched on its stored key.
    await expect(page.getByTestId("board-card-T-1")).toHaveCount(1);
    await expect(
      page.getByTestId("board-column-backlog").getByTestId("board-card-T-1"),
    ).toBeVisible();
    await expect(
      page.getByTestId("board-column-in_progress").getByTestId("board-card-T-2"),
    ).toBeVisible();
    await expect(
      page.getByTestId("board-column-wont_do").getByTestId("board-card-T-3"),
    ).toBeVisible();

    // Reloading reproduces the same board.
    await page.reload();
    await expect(page.locator("[data-testid^='board-column-']")).toHaveCount(6);
  });

  // @verifies BRD-2
  test("BRD-2: configured columns collapse several statuses into one", async ({
    page,
    tracker,
  }) => {
    await setStatuses(tracker.root, [
      { key: "backlog", label: "Backlog", default: true },
      { key: "in_progress", label: "In progress", category: "active" },
      { key: "in_review", label: "In review", category: "active" },
      { key: "blocked", label: "Blocked", category: "active" },
      { key: "done", label: "Done", category: "completed" },
      { key: "wont_do", label: "Won't do", category: "discarded" },
    ]);
    await setBoards(
      tracker.root,
      [
        "boards:",
        "  columns:",
        "    - key: todo",
        "      label: To do",
        "      statuses: [backlog]",
        "    - key: doing",
        '      label: "In flight"',
        "      statuses: [in_progress, in_review, blocked]",
        "    - key: shipped",
        "      label: Shipped",
        "      statuses: [done, wont_do]",
      ].join("\n"),
    );
    await tracker.seed([
      { title: "Blocked one", fields: { status: "blocked" } },
      { title: "Progressing one", fields: { status: "in_progress" } },
    ]);

    await page.goto(`${tracker.baseURL}/board`);

    // Three columns, not six.
    await expect(page.locator("[data-testid^='board-column-']")).toHaveCount(3);

    // The column's own label, not any status label.
    const flight = page.getByTestId("board-column-doing");
    await expect(flight.locator("header")).toContainText("In flight");
    await expect(flight.locator("header")).not.toContainText("In progress");

    // A blocked task and an in_progress task both land in it.
    await expect(flight.getByTestId("board-card-T-1")).toBeVisible();
    await expect(flight.getByTestId("board-card-T-2")).toBeVisible();

    // Column order follows the array, not status declaration order.
    await expect(page.locator("[data-testid^='board-column-'] header")).toHaveText([
      /To do/,
      /In flight/,
      /Shipped/,
    ]);
  });

  // @verifies BRD-3
  test("BRD-3: chips list every column with its count and toggle visibility", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "One" },
      { title: "Two" },
      { title: "Shipped", fields: { status: "done" } },
    ]);

    await page.goto(`${tracker.baseURL}/board`);

    // One chip per column, labelled and counted.
    const chips = page.locator("[data-testid^='board-chip-']");
    await expect(chips).toHaveCount(4);
    await expect(page.getByTestId("board-chip-backlog")).toContainText("Backlog");
    await expect(page.getByTestId("board-chip-backlog")).toContainText("2");
    await expect(page.getByTestId("board-chip-done")).toContainText("1");

    await expect(page.getByTestId("board-column-backlog")).toBeVisible();

    // Clicking removes the column from the board…
    await page.getByTestId("board-chip-backlog").click();
    await expect(page.getByTestId("board-column-backlog")).toHaveCount(0);
    // …while the remaining columns stay.
    await expect(page.locator("[data-testid^='board-column-']")).toHaveCount(3);

    // The chip stays, in an "off" state, so the column can come back.
    await expect(page.getByTestId("board-chip-backlog")).toBeVisible();
    await expect(page.getByTestId("board-chip-backlog")).toHaveAttribute("aria-pressed", "false");

    // Toggling off changed no task's status: the same cards come back.
    await page.getByTestId("board-chip-backlog").click();
    await expect(page.getByTestId("board-chip-backlog")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("board-column-backlog").getByTestId("board-card-T-1")).toBeVisible();
    await expect(page.getByTestId("board-column-backlog").getByTestId("board-card-T-2")).toBeVisible();
  });

  // @verifies BRD-4
  test("BRD-4: chip visibility persists to settings.yaml across a reload", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);

    await page.goto(`${tracker.baseURL}/board`);
    await page.getByTestId("board-chip-backlog").click();
    await page.getByTestId("board-chip-done").click();
    await expect(page.getByTestId("board-column-backlog")).toHaveCount(0);
    await expect(page.getByTestId("board-column-done")).toHaveCount(0);

    // The state is on disk, in the user's settings — not localStorage.
    // Read the file rather than the screen: that is the difference the
    // case is actually about.
    await expect
      .poll(async () => await readUserSettings(tracker.root))
      .toContain("board_hidden_columns");
    const settings = await readUserSettings(tracker.root);
    expect(settings).toContain("backlog");
    expect(settings).toContain("done");

    // And it survives a hard reload.
    await page.reload();
    await expect(page.getByTestId("board-column-in_progress")).toBeVisible();
    await expect(page.getByTestId("board-column-backlog")).toHaveCount(0);
    await expect(page.getByTestId("board-column-done")).toHaveCount(0);
  });

  // @verifies BRD-5
  test("BRD-5: cards render exactly the card_layout fields, in order", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([
      { title: "Layout task", fields: { priority: "high", due_date: "2026-03-01" } },
    ]);
    expect(key).toBeDefined();

    await page.goto(`${tracker.baseURL}/board`);
    const card = page.getByTestId(`board-card-${String(key)}`);
    await expect(card).toBeVisible();

    // The default layout (no card_layout in settings) renders without
    // erroring on the missing key, and shows the priority.
    await expect(card.getByTestId("board-card-field-priority")).toBeVisible();

    // Now store a layout with due date on and priority off.
    await page.evaluate(async () => {
      await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "web" },
        body: JSON.stringify({ card_layout: ["key", "due_date"] }),
      });
    });
    await page.reload();

    const relaid = page.getByTestId(`board-card-${String(key)}`);
    await expect(relaid.getByTestId("board-card-field-due_date")).toBeVisible();
    // Absent from the array is hidden — one list carries both concerns.
    await expect(relaid.getByTestId("board-card-field-priority")).toHaveCount(0);
    await expect(relaid.getByTestId("board-card-field-labels")).toHaveCount(0);
    // The title is always shown; it is not a member of the layout.
    await expect(relaid).toContainText("Layout task");

    // Reordering the array reorders the rows on the card.
    await page.evaluate(async () => {
      await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "web" },
        body: JSON.stringify({ card_layout: ["due_date", "key"] }),
      });
    });
    await page.reload();
    const fields = page
      .getByTestId(`board-card-${String(key)}`)
      .locator("[data-testid^='board-card-field-']");
    // The *first* row is the one that moved: due date now precedes the
    // key, where a moment ago the key came first.
    await expect(fields.first()).toHaveAttribute("data-testid", "board-card-field-due_date");
    await expect(fields.nth(1)).toHaveAttribute("data-testid", "board-card-field-key");
  });

  // @verifies BRD-6
  test("BRD-6: a wip column shows count against cap; an uncapped one shows a plain count", async ({
    page,
    tracker,
  }) => {
    await setBoards(
      tracker.root,
      [
        "boards:",
        "  columns:",
        "    - key: todo",
        "      label: To do",
        "      statuses: [backlog]",
        "    - key: doing",
        '      label: "In flight"',
        "      statuses: [in_progress]",
        "      wip: 3",
        "    - key: shipped",
        "      label: Shipped",
        "      statuses: [done, wont_do]",
      ].join("\n"),
    );
    await tracker.seed([
      { title: "A", fields: { status: "in_progress" } },
      { title: "B", fields: { status: "in_progress" } },
      { title: "C", fields: { status: "in_progress" } },
      { title: "D", fields: { status: "backlog" } },
    ]);

    await page.goto(`${tracker.baseURL}/board`);

    // Both numbers, not just the card count.
    await expect(page.getByTestId("board-count-doing")).toHaveText("3 / 3");
    // A column with no `wip` key shows a plain count and no `/ n`.
    await expect(page.getByTestId("board-count-todo")).toHaveText("1");
    await expect(page.getByTestId("board-count-shipped")).toHaveText("0");
  });

  // @verifies BRD-7
  test("BRD-7: an empty column keeps its header and count and shows a placeholder", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Only one" }]);

    await page.goto(`${tracker.baseURL}/board`);

    const empty = page.getByTestId("board-column-in_progress");
    // Header and count survive.
    await expect(empty.locator("header")).toContainText("In progress");
    await expect(page.getByTestId("board-count-in_progress")).toHaveText("0");
    // An explicit placeholder, not a blank strip.
    await expect(page.getByTestId("board-placeholder-in_progress")).toContainText(
      "No tasks in In progress",
    );
  });

  // @verifies BRD-8
  test("BRD-8: clicking a card opens the task, and back returns to the board", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Clickable" }, { title: "Other" }]);

    await page.goto(`${tracker.baseURL}/board?assignee=nobody-at-all`);
    // Filtered to nothing, so re-establish an unfiltered board first.
    await page.goto(`${tracker.baseURL}/board`);

    await page.getByTestId(`board-card-${String(key)}`).click();

    await expect(page).toHaveURL(`${tracker.baseURL}/tasks/${String(key)}`);

    // Back returns to the board.
    await page.goBack();
    await expect(page).toHaveURL(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${String(key)}`)).toBeVisible();
  });

  // @verifies BRD-14
  test("BRD-14: the board respects filters and reflects them in the URL", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Backlog one" },
      { title: "Backlog two" },
      { title: "Shipped", fields: { status: "done" } },
    ]);

    // A status filter, in the list's own search vocabulary.
    await page.goto(`${tracker.baseURL}/board?status=done`);

    // Every column's card set and count shrinks to the filtered set.
    await expect(page.getByTestId("board-count-done")).toHaveText("1");
    await expect(page.getByTestId("board-count-backlog")).toHaveText("0");
    await expect(page.getByTestId("board-column-backlog").getByTestId("board-card-T-1")).toHaveCount(0);

    // The URL carries the filter, so pasting it reproduces the board.
    await expect(page).toHaveURL(/status=done/);
    await page.goto(`${tracker.baseURL}/board?status=done`);
    await expect(page.getByTestId("board-count-done")).toHaveText("1");
  });

  // @verifies BRD-15
  test("BRD-15: twenty statuses make twenty columns that scroll horizontally", async ({
    page,
    tracker,
  }) => {
    await setStatuses(
      tracker.root,
      Array.from({ length: 20 }, (_, i) => ({
        key: `s${String(i)}`,
        label: `Status number ${String(i)}`,
        ...(i === 0 ? { default: true } : {}),
      })),
    );
    await tracker.seed([{ title: "One" }]);

    await page.goto(`${tracker.baseURL}/board`);

    await expect(page.locator("[data-testid^='board-column-']")).toHaveCount(20);

    // Each column keeps a readable minimum width — titles are not
    // truncated to two characters.
    const width = await page
      .getByTestId("board-column-s0")
      .evaluate(el => el.getBoundingClientRect().width);
    expect(width).toBeGreaterThan(200);

    // The board region scrolls horizontally; the page body does not.
    const region = page.locator("[data-testid='board'] > div.overflow-x-auto");
    const scrollable = await region.evaluate(el => el.scrollWidth > el.clientWidth);
    expect(scrollable).toBe(true);

    // Twenty chips do not push the board below the fold: the chip bar
    // wraps, and the columns are still on screen.
    await expect(page.getByTestId("board-column-s0")).toBeInViewport();
  });

  // @verifies BRD-16
  test("BRD-16: one status makes one column that does not stretch edge to edge", async ({
    page,
    tracker,
  }) => {
    await setStatuses(tracker.root, [{ key: "only", label: "Only", default: true }]);
    await tracker.seed([{ title: "One" }]);

    await page.goto(`${tracker.baseURL}/board`);

    const columns = page.locator("[data-testid^='board-column-']");
    await expect(columns).toHaveCount(1);

    // Left-aligned at a sane maximum width, with the rest of the board
    // area empty — not one full-width slab of cards.
    const { colWidth, boardWidth } = await page.evaluate(() => {
      const col = document.querySelector("[data-testid^='board-column-']");
      const board = document.querySelector("[data-testid='board']");
      return {
        colWidth: col?.getBoundingClientRect().width ?? 0,
        boardWidth: board?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(colWidth).toBeLessThan(boardWidth / 2);
  });

  // @verifies BRD-17
  test("BRD-17: a column naming a deleted status renders and the gap is surfaced", async ({
    page,
    tracker,
  }) => {
    // `in_review` is referenced by the column but absent from statuses.
    await setBoards(
      tracker.root,
      [
        "boards:",
        "  columns:",
        "    - key: todo",
        "      label: To do",
        "      statuses: [backlog]",
        "    - key: doing",
        '      label: "In flight"',
        "      statuses: [in_progress, in_review]",
        "    - key: shipped",
        "      label: Shipped",
        "      statuses: [done, wont_do]",
      ].join("\n"),
    );
    await tracker.seed([{ title: "Working", fields: { status: "in_progress" } }]);

    await page.goto(`${tracker.baseURL}/board`);

    // The column still renders — it holds other, valid statuses — and
    // the board does not throw.
    await expect(page.getByTestId("board-column-doing")).toBeVisible();
    await expect(page.getByTestId("board-column-doing").getByTestId("board-card-T-1")).toBeVisible();

    // The stale reference is surfaced in the UI, naming the column and
    // the missing status key — not only a console warning.
    const drift = page.getByTestId("board-column-drift");
    await expect(drift).toBeVisible();
    await expect(drift).toContainText("In flight");
    await expect(drift).toContainText("in_review");

    // Other columns behave normally.
    await expect(page.getByTestId("board-column-todo")).toBeVisible();
    await expect(page.getByTestId("board-column-shipped")).toBeVisible();
  });

  // @verifies BRD-18
  test("BRD-18: tasks whose status was deleted are visible, named, and clickable", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Orphan one", fields: { status: "blocked" } },
      { title: "Orphan two", fields: { status: "blocked" } },
      { title: "Normal" },
    ]);
    // `blocked` was never declared in the default workflow, which is
    // the same condition as deleting it while tasks still carry it.

    await page.goto(`${tracker.baseURL}/board`);

    // Not silently dropped: a board showing fewer tasks than exist
    // with no explanation is the P7 failure.
    const orphanColumn = page.getByTestId("board-column-__orphan__");
    await expect(orphanColumn).toBeVisible();
    await expect(orphanColumn.getByTestId("board-card-T-1")).toBeVisible();
    await expect(orphanColumn.getByTestId("board-card-T-2")).toBeVisible();

    // The grouping names the orphan key verbatim.
    await expect(orphanColumn).toContainText("blocked");

    // The cards are still clickable through to detail.
    await orphanColumn.getByTestId("board-card-T-1").click();
    await expect(page).toHaveURL(`${tracker.baseURL}/tasks/T-1`);
  });

  // @verifies BRD-19
  test("BRD-19: two statuses sharing a label make two distinguishable columns", async ({
    page,
    tracker,
  }) => {
    await setStatuses(tracker.root, [
      { key: "review_a", label: "Review", default: true },
      { key: "review_b", label: "Review" },
    ]);
    await tracker.seed([
      { title: "In A", fields: { status: "review_a" } },
      { title: "In B", fields: { status: "review_b" } },
    ]);

    await page.goto(`${tracker.baseURL}/board`);

    // Two separate columns — keys are the identity.
    await expect(page.locator("[data-testid^='board-column-']")).toHaveCount(2);

    // Cards route to the column matching their stored key, not the
    // first label match.
    await expect(
      page.getByTestId("board-column-review_a").getByTestId("board-card-T-1"),
    ).toBeVisible();
    await expect(
      page.getByTestId("board-column-review_b").getByTestId("board-card-T-2"),
    ).toBeVisible();

    // The headers are disambiguated enough to tell which is which.
    await expect(page.getByTestId("board-column-review_a").locator("header")).toContainText("review_a");
    await expect(page.getByTestId("board-column-review_b").locator("header")).toContainText("review_b");
  });

  // @verifies BRD-20
  test("BRD-20: a long or emoji label truncates and keeps column widths uniform", async ({
    page,
    tracker,
  }) => {
    const long = "A sixty character status label for testing truncation ok!!";
    await setStatuses(tracker.root, [
      { key: "long", label: long, default: true },
      { key: "emoji", label: "🚀 Shipped" },
    ]);
    await tracker.seed([{ title: "One" }]);

    await page.goto(`${tracker.baseURL}/board`);

    // The full label is exposed on hover rather than wrapping to five
    // lines or pushing the count off-screen.
    const header = page.getByTestId("board-column-long").locator("header .truncate").first();
    await expect(header).toHaveAttribute("title", long);

    // Column widths stay uniform regardless of label length.
    const widths = await page
      .locator("[data-testid^='board-column-']")
      .evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().width)));
    expect(new Set(widths).size).toBe(1);

    // The count is still on screen next to the truncated title.
    await expect(page.getByTestId("board-count-long")).toBeVisible();
  });

  // @verifies BRD-21
  // The two drag bullets (dragging from a virtualized row, and
  // auto-scroll at a column edge) belong to M3.2 and are NOT asserted
  // here — this covers the three bullets a static board owns.
  test("BRD-21: a column of 900 cards counts honestly and scrolls on its own", async ({
    page,
    tracker,
  }) => {
    test.setTimeout(150_000);
    await tracker.seedBulk(900);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId("board-card-T-1")).toBeVisible({ timeout: 60_000 });

    // The header count reads the true total, not a page size. Measured
    // before the feed was made to exhaust itself: this read "200".
    await expect(page.getByTestId("board-count-backlog")).toHaveText("900", {
      timeout: 60_000,
    });

    // The board's total agrees with the list's for the same filter.
    const listTotal = await page.evaluate(async () => {
      const res = await fetch("/api/tasks?limit=1&offset=0", {
        headers: { "X-Loctt-Client": "web" },
      });
      return ((await res.json()) as { total: number }).total;
    });
    expect(listTotal).toBe(900);

    // The column scrolls independently of the board — its own body is
    // taller than its viewport, rather than the page growing.
    const scroll = await page.evaluate(() => {
      const col = document.querySelector("[data-testid='board-column-backlog']");
      const body = col?.querySelector(".overflow-y-auto");
      return {
        scrollH: body?.scrollHeight ?? 0,
        clientH: body?.clientHeight ?? 0,
      };
    });
    expect(scroll.scrollH).toBeGreaterThan(scroll.clientH);

    // Scrolling that column does not scroll its neighbour.
    const before = await page.evaluate(() => {
      const n = document.querySelector("[data-testid='board-column-in_progress'] .overflow-y-auto");
      return n?.scrollTop ?? 0;
    });
    await page.evaluate(() => {
      const b = document.querySelector("[data-testid='board-column-backlog'] .overflow-y-auto");
      if (b) b.scrollTop = 5000;
    });
    const after = await page.evaluate(() => {
      const n = document.querySelector("[data-testid='board-column-in_progress'] .overflow-y-auto");
      const b = document.querySelector("[data-testid='board-column-backlog'] .overflow-y-auto");
      return { neighbour: n?.scrollTop ?? 0, scrolled: b?.scrollTop ?? 0 };
    });
    expect(after.scrolled).toBeGreaterThan(0);
    expect(after.neighbour).toBe(before);

    // Cards render correctly far down the range, not only at the top.
    await expect(page.getByTestId("board-card-T-850")).toHaveCount(1);
  });

  // @verifies BRD-22
  test("BRD-22: a 300-character title and 20 labels do not break the column", async ({
    page,
    tracker,
  }) => {
    const title = "T".repeat(300);
    const names: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const name = `label-${String(i)}`;
      await tracker.run(["label", "create", name]);
      names.push(name);
    }
    // Twenty labels on the long-titled task; a plain neighbour after it.
    await tracker.run(["create", title, ...names.flatMap(n => ["--label", n])]);
    await tracker.run(["create", "Neighbour"]);

    await page.goto(`${tracker.baseURL}/board`);

    const card = page.getByTestId("board-card-T-1");
    await expect(card).toBeVisible();

    // The card does not grow past its column, and does not widen it.
    const { cardW, colW } = await page.evaluate(() => {
      const c = document.querySelector("[data-testid='board-card-T-1']");
      const col = document.querySelector("[data-testid^='board-column-']");
      return {
        cardW: c?.getBoundingClientRect().width ?? 0,
        colW: col?.getBoundingClientRect().width ?? 0,
      };
    });
    expect(cardW).toBeLessThanOrEqual(colW);

    // The title clamps rather than filling the column.
    const cardH = await card.evaluate(el => el.getBoundingClientRect().height);
    expect(cardH).toBeLessThan(400);

    // Neighbouring cards keep their normal height.
    const neighbourH = await page
      .getByTestId("board-card-T-2")
      .evaluate(el => el.getBoundingClientRect().height);
    expect(neighbourH).toBeLessThan(cardH);
  });

  // @verifies BRD-39
  test("BRD-39: the board shows a loading state, not empty columns with 0 counts", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }, { title: "Two" }]);

    // Hold the task read open so the loading state is observable.
    let release: (() => void) | undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/tasks?**", async route => {
      await held;
      await route.continue();
    });

    await page.goto(`${tracker.baseURL}/board`, { waitUntil: "commit" });

    // Skeletons appear, and the user never sees a "0" count or a
    // "No tasks" placeholder on a column that in fact has cards.
    await expect(page.getByTestId("board-skeleton").first()).toBeVisible();
    await expect(page.getByTestId("board-placeholder-backlog")).toHaveCount(0);
    await expect(page.getByTestId("board-count-backlog")).not.toHaveText("0");

    release?.();
    await expect(page.getByTestId("board-card-T-1")).toBeVisible();
    await expect(page.getByTestId("board-count-backlog")).toHaveText("2");
  });

  // @verifies BRD-40
  test("BRD-40: an empty tracker shows one board-level empty state, columns intact", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/board`);

    // One board-level empty state offering "+ Add task".
    const empty = page.getByTestId("board-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("No tasks yet");
    await expect(empty.getByRole("button", { name: /Add task/ })).toBeVisible();

    // Columns still render, so the workflow shape stays visible.
    await expect(page.locator("[data-testid^='board-column-']")).toHaveCount(4);
  });

  // @verifies ONB-11
  test("ONB-11: an empty tracker shows the configured columns, all empty", async ({
    page,
    tracker,
  }) => {
    await setStatuses(tracker.root, [
      { key: "s1", label: "One", default: true },
      { key: "s2", label: "Two" },
      { key: "s3", label: "Three" },
      { key: "s4", label: "Four" },
      { key: "s5", label: "Five" },
      { key: "s6", label: "Six" },
      { key: "s7", label: "Seven" },
    ]);

    await page.goto(`${tracker.baseURL}/board`);

    // A tracker configured with seven statuses shows seven empty
    // columns, labelled from workflow.yaml.
    await expect(page.locator("[data-testid^='board-column-']")).toHaveCount(7);
    await expect(page.locator("[data-testid^='board-column-'] header")).toHaveText([
      /One/, /Two/, /Three/, /Four/, /Five/, /Six/, /Seven/,
    ]);

    // Every column shows its placeholder — the board does not collapse
    // to a single message that hides the workflow shape.
    await expect(page.locator("[data-testid^='board-placeholder-']")).toHaveCount(7);
  });

  // @verifies BRD-23
  test("BRD-23: an all-projects board shows a project indicator on each card", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BACKEND-"]);
    await tracker.seed([{ title: "Web one" }]);

    await page.goto(`${tracker.baseURL}/board`);

    // The key field carries a project chip alongside the key, so two
    // projects' keys are not confusable.
    const keyField = page.getByTestId("board-card-T-1").getByTestId("board-card-field-key");
    await expect(keyField).toBeVisible();
    await expect(keyField).toContainText("T-1");
  });

  // @verifies BRD-24
  test("BRD-24: statuses no column covers are shown and counted, not omitted", async ({
    page,
    tracker,
  }) => {
    // Five of six statuses covered; `wont_do` is left out.
    await setBoards(
      tracker.root,
      [
        "boards:",
        "  columns:",
        "    - key: todo",
        "      label: To do",
        "      statuses: [backlog]",
        "    - key: doing",
        '      label: "In flight"',
        "      statuses: [in_progress]",
        "    - key: shipped",
        "      label: Shipped",
        "      statuses: [done]",
      ].join("\n"),
    );
    await tracker.seed([
      { title: "Dropped one", fields: { status: "wont_do" } },
      { title: "Dropped two", fields: { status: "wont_do" } },
      { title: "Normal" },
    ]);

    await page.goto(`${tracker.baseURL}/board`);

    // Shown in an explicit catch-all rather than silently omitted.
    const catchAll = page.getByTestId("board-column-__uncovered__");
    await expect(catchAll).toBeVisible();
    await expect(catchAll).toContainText("wont_do");
    await expect(page.getByTestId("board-count-__uncovered__")).toHaveText("2");

    // The board's total agrees with the list's for the same filter —
    // the two views must not disagree about how many tasks exist.
    await page.goto(`${tracker.baseURL}/list`);
    const rows = page.getByRole("row").filter({ hasNot: page.getByRole("columnheader") });
    await expect(rows).toHaveCount(3);
  });

  // @verifies BRD-33
  // One full staleness window (60s) has to elapse for the poll to fire,
  // so this case cannot fit the suite's 30s default. Measured: the
  // refetch lands at ~60s and the card moves on its own.
  test("BRD-33: a CLI status change lands on the board without a manual reload", async ({
    page,
    tracker,
  }) => {
    test.setTimeout(150_000);
    await tracker.seed([{ title: "Moving" }]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(
      page.getByTestId("board-column-backlog").getByTestId("board-card-T-1"),
    ).toBeVisible();

    // A write from another surface, while the board is open.
    await tracker.run(["set", "T-1", "status", "in_progress"]);

    // Within a refetch interval the card moves on its own — no reload.
    await expect(
      page.getByTestId("board-column-in_progress").getByTestId("board-card-T-1"),
    ).toBeVisible({ timeout: 90_000 });

    // Not duplicated in both columns during the transition.
    await expect(page.getByTestId("board-card-T-1")).toHaveCount(1);
    // Counts follow.
    await expect(page.getByTestId("board-count-backlog")).toHaveText("0");
    await expect(page.getByTestId("board-count-in_progress")).toHaveText("1");
  });

  // @verifies BRD-45
  test("BRD-45: a malformed boards block renders a configuration error, not a blank board", async ({
    page,
    tracker,
  }) => {
    // Two columns claim the same status — a schema violation.
    await setBoards(
      tracker.root,
      [
        "boards:",
        "  columns:",
        "    - key: doing",
        '      label: "In flight"',
        "      statuses: [in_progress, blocked]",
        "    - key: also",
        '      label: "Also doing"',
        "      statuses: [blocked]",
      ].join("\n"),
    );

    await page.goto(`${tracker.baseURL}/board`);

    // An explicit configuration-error state, not a white pane.
    const err = page.getByTestId("board-config-error");
    await expect(err).toBeVisible();

    // Naming the file, the offending column and the duplicated status.
    const message = page.getByTestId("board-config-error-message");
    await expect(message).toContainText("workflow.yaml");
    await expect(message).toContainText("blocked");
    await expect(message).toContainText("column index 0");

    // And how to fix it — including removing the boards block.
    await expect(err).toContainText("boards:");
    await expect(err).toContainText("one column per status");

    // It does not silently render 1:1 columns as though nothing were
    // wrong.
    await expect(page.locator("[data-testid^='board-column-']")).toHaveCount(0);
  });

  // @verifies BRD-46
  test("BRD-46: one corrupt task.md does not take down the board", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Good one" }, { title: "Good two" }, { title: "Broken" }]);

    // Corrupt exactly one task's frontmatter.
    const { readdir } = await import("node:fs/promises");
    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const file = path.join(tasksDir, id, "task.md");
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        continue;
      }
      if (!text.includes("Broken")) continue;
      await writeFile(file, text.replace(/^title:.*$/m, "title: [unclosed"), "utf8");
      break;
    }

    await page.goto(`${tracker.baseURL}/board`);

    // Every other card renders normally in its correct column.
    await expect(page.getByTestId("board-column-backlog").getByTestId("board-card-T-1")).toBeVisible();
    await expect(page.getByTestId("board-column-backlog").getByTestId("board-card-T-2")).toBeVisible();

    // The failure is surfaced once, naming the file and the problem,
    // rather than the task vanishing with an unexplainable count.
    const notice = page.getByTestId("board-unreadable");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("could not be read");
    await expect(notice).toContainText("task.md");

    // The count is honest about what could be read.
    await expect(page.getByTestId("board-count-backlog")).toHaveText("2");
  });

  // @verifies BRD-47
  test("BRD-47: a failed card-layout write leaves the last-known-good layout", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Layout task", fields: { priority: "high" } }]);

    // A saved preference the board is currently rendering.
    await page.goto(`${tracker.baseURL}/board`);
    await page.evaluate(async () => {
      await fetch("/api/user-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "web" },
        body: JSON.stringify({ card_layout: ["key", "priority"] }),
      });
    });
    await page.reload();
    await expect(
      page.getByTestId("board-card-T-1").getByTestId("board-card-field-priority"),
    ).toBeVisible();

    // Now the settings endpoint fails.
    await page.route("**/api/user-settings", async route => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            code: "io_failed",
            message: "The settings could not be saved.",
            data_state: "not_saved",
          }),
        });
        return;
      }
      await route.continue();
    });

    // A chip toggle is a settings write; it fails.
    await page.getByTestId("board-chip-done").click();

    // The board does not fall back to an empty or default layout as if
    // the user's saved preference were gone.
    await expect(
      page.getByTestId("board-card-T-1").getByTestId("board-card-field-priority"),
    ).toBeVisible();
    // And the failure is stated.
    await expect(page.getByTestId("board-chip-error")).toBeVisible();
  });

  // @verifies BRD-48
  test("BRD-48: a failed chip write is reported rather than silently lost", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "One" }]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId("board-column-backlog")).toBeVisible();

    await page.route("**/api/user-settings", async route => {
      if (route.request().method() === "PUT") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            code: "io_failed",
            message: "The settings could not be saved.",
            data_state: "not_saved",
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByTestId("board-chip-backlog").click();

    // Silently hiding it and losing the preference on reload with no
    // message is the failure this case names. An explanation appears…
    const alert = page.getByTestId("board-chip-error");
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("not saved");

    // …and the optimistic hide is rolled back, so the board and the
    // file agree rather than the browser presenting its own state as
    // fact.
    await expect(page.getByTestId("board-column-backlog")).toBeVisible();

    // Nothing was written.
    const settings = await readUserSettings(tracker.root);
    expect(settings).not.toContain("board_hidden_columns");
  });

  // @verifies MSL-5
  test("MSL-5: labels render as coloured pills on the board card", async ({ page, tracker }) => {
    await tracker.run(["label", "create", "urgent", "--color", "#c0392b"]);
    // `--label` on create resolves the name to the label's id; there is
    // no `set … labels` that accepts a string (measured: it rejects
    // anything but an array).
    await tracker.run(["create", "Labelled", "--label", "urgent"]);

    await page.goto(`${tracker.baseURL}/board`);

    const pill = page
      .getByTestId("board-card-T-1")
      .getByTestId("board-card-field-labels")
      .getByText("urgent");
    await expect(pill).toBeVisible();

    // The pill's background derives from the configured colour — the
    // board card and the list row share one colour source, so the
    // colour comes from labels.yaml rather than a per-surface palette.
    //
    // `#c0392b` at the pill's own alpha: the component renders
    // `${color}22`, which is rgb(192, 57, 43) at 13% — so asserting the
    // channels proves the *configured* colour reached the card, not
    // merely that something has a background.
    const background = await pill.evaluate(el => {
      const box = el.closest("[style]") ?? el;
      return getComputedStyle(box).backgroundColor;
    });
    expect(background).toMatch(/^rgba?\(192, 57, 43/);
  });

  // @verifies MSL-20
  test("MSL-20: a card with 20 labels overflows to +N and keeps its layout bounded", async ({
    page,
    tracker,
  }) => {
    const names: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const name = `label-${String(i)}`;
      await tracker.run(["label", "create", name]);
      names.push(name);
    }
    await tracker.run([
      "create",
      "Many labels",
      ...names.flatMap(n => ["--label", n]),
    ]);
    await tracker.run(["set", "T-1", "due_date", "2026-04-01"]);

    await page.goto(`${tracker.baseURL}/board`);

    const card = page.getByTestId("board-card-T-1");
    const labels = card.getByTestId("board-card-field-labels");
    await expect(labels).toBeVisible();

    // Pills overflow into a "+N" affordance rather than all twenty
    // widening the card.
    await expect(labels).toContainText(/\+\d+/);

    // The due date stays on screen — it is not pushed out of view.
    await expect(card.getByTestId("board-card-field-due_date")).toBeVisible();

    // Card height stays bounded: one task does not consume the column.
    const height = await card.evaluate(el => el.getBoundingClientRect().height);
    expect(height).toBeLessThan(300);

    // Each rendered pill remains individually clickable to filter.
    const firstPill = labels.getByRole("button").first();
    await expect(firstPill).toBeVisible();
    await firstPill.click();
    await expect(page).toHaveURL(/labels=/);
  });
});
