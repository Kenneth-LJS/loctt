/**
 * Transcribed from docs/dev/ui-test-cases/flow-board.md (plus ONB-11
 * from flow-onboarding.md and MSL-5 / MSL-20 from
 * flow-milestones-labels.md).
 *
 * M3.1 built the static board; M3.2 adds the drag layer, so the cases
 * that pick a card up now live here too.
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


/**
 * Reads one task's `task.md` from disk by key.
 *
 * Every drag case asserts the *file*, not the screen. A board that
 * moved a card optimistically and never landed the write looks
 * identical to one that saved — which is exactly the failure BRD-43
 * and P1 are about, so the screen cannot be the evidence.
 */
async function readTaskFile(root: string, key: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    try {
      const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
      if (new RegExp(`^key: ${key}$`, "m").test(text)) return text;
    } catch {
      continue;
    }
  }
  throw new Error(`no task.md for ${key}`);
}

/** One frontmatter scalar, or undefined when the key is absent. */
function frontmatterValue(text: string, field: string): string | undefined {
  return new RegExp(`^${field}: (.*)$`, "m").exec(text)?.[1]?.trim();
}

/** A task's `_history.yaml`, or "" when it has none. */
async function readTaskHistory(root: string, key: string): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    const dir = path.join(tasksDir, id);
    try {
      const text = await readFile(path.join(dir, "task.md"), "utf8");
      if (!new RegExp(`^key: ${key}$`, "m").test(text)) continue;
      try {
        return await readFile(path.join(dir, "_history.yaml"), "utf8");
      } catch {
        return "";
      }
    } catch {
      continue;
    }
  }
  return "";
}

/**
 * Drags a card onto a target, in steps, with the pointer events the
 * board actually listens for.
 *
 * `steps` matters: the drag only starts once the pointer passes
 * `DRAG_THRESHOLD_PX`, and the drop indicator is computed on move — a
 * single jump from source to target would arm the drag and release in
 * the same frame, testing nothing about the gesture.
 */
async function dragCard(
  page: import("@playwright/test").Page,
  sourceKey: string,
  target: { readonly x: number; readonly y: number },
): Promise<void> {
  const card = page.getByTestId(`board-card-${sourceKey}`);
  const box = await card.boundingBox();
  if (box === null) throw new Error(`no box for ${sourceKey}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Past the threshold first, so the drag is armed before we aim.
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
}

/** The point at the vertical centre of a column's card area. */
async function columnPoint(
  page: import("@playwright/test").Page,
  columnId: string,
  position: "top" | "bottom" | "middle" = "middle",
): Promise<{ x: number; y: number }> {
  const col = page.getByTestId(`board-column-${columnId}`);
  const box = await col.boundingBox();
  if (box === null) throw new Error(`no box for column ${columnId}`);
  const x = box.x + box.width / 2;
  const y =
    position === "top" ? box.y + 90
    : position === "bottom" ? box.y + box.height - 30
    : box.y + box.height / 2;
  return { x, y };
}

/** The point just above a given card, i.e. the slot before it. */
async function pointAboveCard(
  page: import("@playwright/test").Page,
  key: string,
): Promise<{ x: number; y: number }> {
  const box = await page.getByTestId(`board-card-${key}`).boundingBox();
  if (box === null) throw new Error(`no box for ${key}`);
  return { x: box.x + box.width / 2, y: box.y + 4 };
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

    // Bullet 2's over-cap half, and bullet 4's "never renders an
    // over-cap state" for an uncapped column. Neither was asserted:
    // the M3 gate forced `over` to false permanently and all 51 board
    // tests stayed green, because the state lived only in a Tailwind
    // class. It is now a data attribute so the distinction the case
    // turns on can be read.
    await expect(page.getByTestId("board-count-doing"))
      .toHaveAttribute("data-wip-state", "at-cap");
    await expect(page.getByTestId("board-count-todo"))
      .toHaveAttribute("data-wip-state", "under");

    // A fourth card in the capped column: the drop is allowed (wip is
    // a passive indicator, bullet 3) and the state becomes over-cap.
    const [extra] = await tracker.seed([{ title: "Fourth" }]);
    await tracker.run(["set", extra ?? "", "status", "in_progress"]);
    await page.reload();
    await expect(page.getByTestId("board-count-doing")).toHaveText("4 / 3");
    await expect(page.getByTestId("board-count-doing"))
      .toHaveAttribute("data-wip-state", "over");
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
    // A task in the SECOND project. Without it the case's premise —
    // two projects' cards on one board — never existed: the fixture
    // created Backend and seeded nothing into it, and the assertion
    // only read the key text, so deleting the project chip entirely
    // left this test green (the M3 gate measured it; BRD-4 caught the
    // deletion, this case did not).
    await tracker.run(["create", "Backend one", "--project", "Backend"]);

    await page.goto(`${tracker.baseURL}/board`);

    // Bullet 1: every card shows a project indicator, and the two
    // projects are named distinctly rather than left to key prefixes.
    const webChip = page.getByTestId("board-card-T-1")
      .getByTestId("project-chip");
    const backendChip = page.getByTestId("board-card-BACKEND-1")
      .getByTestId("project-chip");
    await expect(webChip).toBeVisible();
    await expect(backendChip).toBeVisible();
    await expect(webChip).not.toHaveText(await backendChip.innerText());

    // The keys stay distinguishable too.
    await expect(page.getByTestId("board-card-T-1")
      .getByTestId("board-card-field-key")).toContainText("T-1");
    await expect(page.getByTestId("board-card-BACKEND-1")
      .getByTestId("board-card-field-key")).toContainText("BACKEND-1");
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

  // ===== M3.2 — drag and drop =====

  // @verifies BRD-9
  // @verifies XS-9
  test("BRD-9: a cross-column drag writes status and board_rank in one call", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Mover" },
      { title: "Upper", fields: { status: "in_progress" } },
      { title: "Lower", fields: { status: "in_progress" } },
    ]);
    const [mover, upper, lower] = keys as [string, string, string];
    // Give the destination pair real ranks so the drop lands between
    // two known values rather than at an end.
    await tracker.run(["board-rerank", upper]);
    await tracker.run(["board-rerank", lower, "--after", upper]);

    // XS-9: a concurrent edit on another field must survive the drag.
    await tracker.run(["set", mover, "priority", "high"]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${mover}`)).toBeVisible();

    // Record every write the drop makes. Two requests here is the
    // failure the case names, so the count is the assertion.
    const writes: { url: string; body: unknown }[] = [];
    page.on("request", req => {
      if (req.method() !== "POST") return;
      if (!/\/api\/tasks\//.test(req.url())) return;
      writes.push({ url: req.url(), body: req.postDataJSON() as unknown });
    });

    // Drop between the two in_progress cards.
    await dragCard(page, mover, await pointAboveCard(page, lower));

    await expect(
      page.getByTestId("board-column-in_progress").getByTestId(`board-card-${mover}`),
    ).toBeVisible();

    // Exactly one request, carrying BOTH fields.
    expect(writes).toHaveLength(1);
    const sent = writes[0]?.body as { status?: string; before?: string; after?: string };
    // The config KEY, not the label.
    expect(sent.status).toBe("in_progress");

    // The far end: both fields on disk, and the rank strictly between
    // the two neighbours it was dropped between.
    await expect(async () => {
      const text = await readTaskFile(tracker.root, mover);
      expect(frontmatterValue(text, "status")).toBe("in_progress");
      const rank = frontmatterValue(text, "board_rank");
      expect(rank).toBeDefined();
      const upperRank = frontmatterValue(await readTaskFile(tracker.root, upper), "board_rank");
      const lowerRank = frontmatterValue(await readTaskFile(tracker.root, lower), "board_rank");
      expect(upperRank).toBeDefined();
      expect(lowerRank).toBeDefined();
      expect(rank! > upperRank!).toBe(true);
      expect(rank! < lowerRank!).toBe(true);
      // XS-9: nothing else was written.
      expect(frontmatterValue(text, "priority")).toBe("high");
    }).toPass({ timeout: 5000 });

    // The change is on the record.
    const history = await readTaskHistory(tracker.root, mover);
    expect(history).toContain("board_rank");
    expect(history).toContain("in_progress");
  });

  // @verifies BRD-10
  // @verifies XS-9
  test("BRD-10: an intra-column drag writes board_rank only", async ({ page, tracker }) => {
    const keys = await tracker.seed([
      { title: "First" },
      { title: "Second" },
      { title: "Third" },
    ]);
    const [first, second, third] = keys as [string, string, string];
    await tracker.run(["board-rerank", first]);
    await tracker.run(["board-rerank", second, "--after", first]);
    await tracker.run(["board-rerank", third, "--after", second]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${third}`)).toBeVisible();

    const writes: { url: string; body: Record<string, unknown> }[] = [];
    page.on("request", req => {
      if (req.method() !== "POST") return;
      if (!/\/api\/tasks\//.test(req.url())) return;
      writes.push({ url: req.url(), body: req.postDataJSON() as Record<string, unknown> });
    });

    // Bottom card to the top of its own column.
    await dragCard(page, third, await pointAboveCard(page, first));

    expect(writes).toHaveLength(1);
    // `status` is ABSENT from the payload — not resent at its current
    // value. That is the bullet, and the reason this hits the rerank
    // endpoint rather than the move one.
    expect(writes[0]?.body).not.toHaveProperty("status");
    expect(writes[0]?.url).toContain("/board-rerank");

    // Re-read from disk: rank changed, status untouched.
    await expect(async () => {
      const text = await readTaskFile(tracker.root, third);
      const rank = frontmatterValue(text, "board_rank");
      const firstRank = frontmatterValue(await readTaskFile(tracker.root, first), "board_rank");
      expect(rank).toBeDefined();
      expect(rank! < firstRank!).toBe(true);
      expect(frontmatterValue(text, "status")).toBe("backlog");
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-31
  test("BRD-31: dropping a card where it already is writes nothing", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "One" }, { title: "Two" }, { title: "Three" }]);
    const [one, two, three] = keys as [string, string, string];
    await tracker.run(["board-rerank", one]);
    await tracker.run(["board-rerank", two, "--after", one]);
    await tracker.run(["board-rerank", three, "--after", two]);

    const before = await readTaskFile(tracker.root, two);
    const beforeRank = frontmatterValue(before, "board_rank");
    const beforeUpdated = frontmatterValue(before, "updated_at");
    const beforeHistory = await readTaskHistory(tracker.root, two);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${two}`)).toBeVisible();

    const writes: string[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/tasks\//.test(req.url())) writes.push(req.url());
    });

    // Pick the middle card up and put it back between the same two.
    const box = await page.getByTestId(`board-card-${two}`).boundingBox();
    if (box === null) throw new Error("no box");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy + 15, { steps: 6 });
    await page.mouse.move(cx, cy, { steps: 6 });
    await page.mouse.up();

    // No request is issued.
    await page.waitForTimeout(500);
    expect(writes).toHaveLength(0);

    // And nothing on disk moved: rank, updated_at, history all as they
    // were. Asserting only that the card did not move would pass even
    // if a history entry had been written.
    const after = await readTaskFile(tracker.root, two);
    expect(frontmatterValue(after, "board_rank")).toBe(beforeRank);
    expect(frontmatterValue(after, "updated_at")).toBe(beforeUpdated);
    expect(await readTaskHistory(tracker.root, two)).toBe(beforeHistory);
  });

  // @verifies BRD-11
  test("BRD-11: drop targets are visible and a drop outside cancels", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Dragged" },
      { title: "Other" },
      { title: "Elsewhere", fields: { status: "in_progress" } },
    ]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId("board-card-T-1")).toBeVisible();

    const writes: string[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/tasks\//.test(req.url())) writes.push(req.url());
    });

    const box = await page.getByTestId("board-card-T-1").boundingBox();
    if (box === null) throw new Error("no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });

    // Hovering a column distinguishes it from the others.
    const target = await columnPoint(page, "in_progress");
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await expect(page.getByTestId("board-column-in_progress")).toHaveAttribute(
      "data-drop-active",
      "true",
    );
    // A gap opens at the insertion point.
    await expect(
      page.getByTestId("board-column-in_progress")
        .getByTestId("board-drop-indicator")
        .filter({ has: page.locator("[data-active='true']") })
        .or(page.locator("[data-testid='board-drop-indicator'][data-active='true']"))
        .first(),
    ).toBeVisible();

    // The card being dragged follows the cursor.
    await expect(page.getByTestId("board-drag-preview")).toBeVisible();

    // Released outside any column: cancelled, and no request.
    await page.mouse.move(5, 5, { steps: 8 });
    await expect(page.getByTestId("board-column-in_progress")).not.toHaveAttribute(
      "data-drop-active",
      "true",
    );
    await page.mouse.up();

    await page.waitForTimeout(400);
    expect(writes).toHaveLength(0);
    await expect(page.getByTestId("board-column-backlog").getByTestId("board-card-T-1"))
      .toBeVisible();
  });

  // @verifies BRD-37
  test("BRD-37: a 2px press is a click, and Esc cancels a drag", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Clickable" }]);
    await page.goto(`${tracker.baseURL}/board`);
    const card = page.getByTestId("board-card-T-1");
    await expect(card).toBeVisible();

    const writes: string[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/tasks\//.test(req.url())) writes.push(req.url());
    });

    // A press with a 2px wobble stays a click and navigates (BRD-8).
    const box = await card.boundingBox();
    if (box === null) throw new Error("no box");
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + 20, { steps: 2 });
    await page.mouse.up();
    await expect(page).toHaveURL(/\/tasks\/T-1/);
    expect(writes).toHaveLength(0);

    // Esc mid-drag returns the card and issues no request.
    await page.goto(`${tracker.baseURL}/board`);
    const again = page.getByTestId("board-card-T-1");
    await expect(again).toBeVisible();
    const box2 = await again.boundingBox();
    if (box2 === null) throw new Error("no box");
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await page.mouse.down();
    await page.mouse.move(box2.x + box2.width / 2 + 40, box2.y + box2.height / 2 + 30, { steps: 6 });
    await expect(page.getByTestId("board-drag-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("board-drag-preview")).toHaveCount(0);
    await page.mouse.up();

    await page.waitForTimeout(400);
    expect(writes).toHaveLength(0);
    await expect(page.getByTestId("board-column-backlog").getByTestId("board-card-T-1"))
      .toBeVisible();
  });

  // @verifies BRD-41
  test("BRD-41: a failed cross-column drop snaps back and says why", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Mover" }]);
    const [mover] = keys as [string];

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${mover}`)).toBeVisible();

    // The server returns 500 on the atomic write.
    await page.route("**/board-move", route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "The server failed to save the move." }),
      }),
    );

    await dragCard(page, mover, await columnPoint(page, "in_progress"));

    // Named, stated, and retryable.
    const err = page.getByTestId("board-move-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(mover);
    await expect(err).toContainText("not saved");
    await expect(page.getByTestId("board-move-retry")).toBeVisible();

    // The card is back in its original column, and disk shows the
    // original values — no partial write of one field without the other.
    await expect(
      page.getByTestId("board-column-backlog").getByTestId(`board-card-${mover}`),
    ).toBeVisible();
    const text = await readTaskFile(tracker.root, mover);
    expect(frontmatterValue(text, "status")).toBe("backlog");
    expect(frontmatterValue(text, "board_rank")).toBeUndefined();
  });

  // @verifies BRD-42
  test("BRD-42: a drop into a status deleted since page load is rejected legibly", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Mover" }]);
    const [mover] = keys as [string];

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId("board-column-in_progress")).toBeVisible();

    // Delete the status from workflow.yaml *after* the board rendered,
    // so the column on screen is stale config.
    await setStatuses(tracker.root, [
      { key: "backlog", label: "Backlog", default: true },
      { key: "done", label: "Done", category: "completed" },
    ]);

    await dragCard(page, mover, await columnPoint(page, "in_progress"));

    // The message names the vanished key and says the board is stale.
    const err = page.getByTestId("board-move-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("in_progress");
    await expect(err).toContainText(/stale|reload/i);
    // A reload action is offered.
    await expect(page.getByTestId("board-move-reload")).toBeVisible();

    // Nothing was written.
    const text = await readTaskFile(tracker.root, mover);
    expect(frontmatterValue(text, "status")).toBe("backlog");
  });

  // @verifies BRD-43
  test("BRD-43: losing the connection mid-drop does not leave the card moved", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Mover" }]);
    const [mover] = keys as [string];

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${mover}`)).toBeVisible();

    // The connection dies between mouse-up and the response.
    await page.route("**/board-move", route => route.abort("connectionfailed"));

    await dragCard(page, mover, await columnPoint(page, "in_progress"));

    const err = page.getByTestId("board-move-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(mover);
    await expect(err).toContainText("not saved");

    // The card is not left rendered in the destination while the file
    // says otherwise.
    await expect(
      page.getByTestId("board-column-backlog").getByTestId(`board-card-${mover}`),
    ).toBeVisible();
    const text = await readTaskFile(tracker.root, mover);
    expect(frontmatterValue(text, "status")).toBe("backlog");

    // A reload shows server truth — the optimistic position does not
    // survive it.
    await page.unroute("**/board-move");
    await page.goto(`${tracker.baseURL}/board`);
    await expect(
      page.getByTestId("board-column-backlog").getByTestId(`board-card-${mover}`),
    ).toBeVisible();
    await expect(
      page.getByTestId("board-column-in_progress").getByTestId(`board-card-${mover}`),
    ).toHaveCount(0);
  });

  // @verifies BRD-44
  test("BRD-44: a drop next to a deleted task fails with a specific message", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Mover" },
      { title: "Neighbour", fields: { status: "in_progress" } },
    ]);
    const [mover, neighbour] = keys as [string, string];
    await tracker.run(["board-rerank", neighbour]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${neighbour}`)).toBeVisible();

    // The neighbour is deleted out from under the open board.
    await tracker.run(["delete", neighbour, "--yes"]);

    await dragCard(page, mover, await pointAboveCard(page, neighbour));

    // Named operation, stated reason.
    const err = page.getByTestId("board-move-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(mover);

    // The board refetches, so the deleted card disappears, and the
    // dragged card ends in a real persisted position — never one that
    // exists only in the browser.
    await expect(page.getByTestId(`board-card-${neighbour}`)).toHaveCount(0);
    const text = await readTaskFile(tracker.root, mover);
    const status = frontmatterValue(text, "status");
    expect(["backlog", "in_progress"]).toContain(status);
  });

  // @verifies BRD-38
  test("BRD-38: a card can be moved between columns without a mouse", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Keyboard mover" }]);
    const [mover] = keys as [string];

    await page.goto(`${tracker.baseURL}/board`);
    const card = page.getByTestId(`board-card-${mover}`);
    await expect(card).toBeVisible();

    const writes: { url: string; body: Record<string, unknown> }[] = [];
    page.on("request", req => {
      if (req.method() !== "POST") return;
      if (!/\/api\/tasks\//.test(req.url())) return;
      writes.push({ url: req.url(), body: req.postDataJSON() as Record<string, unknown> });
    });

    // Reachable by keyboard, with a visible focus ring.
    const button = card.getByRole("button").first();
    await button.focus();
    await expect(button).toBeFocused();

    // The documented sequence moves it to the next column.
    await page.keyboard.press("Control+ArrowRight");

    await expect(
      page.getByTestId("board-column-in_progress").getByTestId(`board-card-${mover}`),
    ).toBeVisible();

    // The SAME single atomic write a mouse drag makes (BRD-9).
    expect(writes).toHaveLength(1);
    expect(writes[0]?.url).toContain("/board-move");
    expect(writes[0]?.body["status"]).toBe("in_progress");

    // Announced to assistive tech, naming column and position.
    const live = page.getByTestId("board-live-region");
    await expect(live).toContainText(mover);

    // And it landed on disk.
    await expect(async () => {
      const text = await readTaskFile(tracker.root, mover);
      expect(frontmatterValue(text, "status")).toBe("in_progress");
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-12
  //
  // Was `test.fixme` until K8. Core's `reorderBoardRank` scoped board
  // rank per *status* and refused an anchor in a sibling status, so
  // the rank never landed even though the payload half of the case
  // held. K8 makes a column a group of tickets: the anchor check is by
  // column, and cards of different statuses interleave freely inside
  // one.
  test("BRD-12: reordering inside a multi-status column keeps the card's status", async ({
    page,
    tracker,
  }) => {
    await setStatuses(tracker.root, [
      { key: "backlog", label: "Backlog", default: true },
      { key: "in_progress", label: "In progress" },
      { key: "blocked", label: "Blocked" },
    ]);
    await setBoards(
      tracker.root,
      ["boards:", "  columns:", "    - key: flight", "      label: In flight",
       "      statuses: [in_progress, blocked]"].join("\n"),
    );

    const keys = await tracker.seed([
      { title: "Working", fields: { status: "in_progress" } },
      { title: "Stuck", fields: { status: "blocked" } },
    ]);
    const [working, stuck] = keys as [string, string];
    await tracker.run(["board-rerank", working]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${stuck}`)).toBeVisible();

    const writes: Record<string, unknown>[] = [];
    page.on("request", req => {
      if (req.method() !== "POST") return;
      if (!/\/api\/tasks\//.test(req.url())) return;
      writes.push(req.postDataJSON() as Record<string, unknown>);
    });

    // Drag the blocked card above the in_progress one, same column.
    await dragCard(page, stuck, await pointAboveCard(page, working));

    // Only board_rank is written; status is not in the payload.
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toHaveProperty("status");

    // The card's status stays `blocked` on disk.
    await expect(async () => {
      const text = await readTaskFile(tracker.root, stuck);
      expect(frontmatterValue(text, "status")).toBe("blocked");
      expect(frontmatterValue(text, "board_rank")).toBeDefined();
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-13
  test("BRD-13: a card dropped into a multi-status column adopts its first status", async ({
    page,
    tracker,
  }) => {
    await setStatuses(tracker.root, [
      { key: "backlog", label: "Backlog", default: true },
      { key: "in_progress", label: "In progress" },
      { key: "in_review", label: "In review" },
      { key: "blocked", label: "Blocked" },
    ]);
    await setBoards(
      tracker.root,
      ["boards:", "  columns:", "    - key: todo", "      label: Backlog",
       "      statuses: [backlog]",
       "    - key: flight", "      label: In flight",
       "      statuses: [in_progress, in_review, blocked]"].join("\n"),
    );

    const keys = await tracker.seed([{ title: "Mover" }]);
    const [mover] = keys as [string];

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${mover}`)).toBeVisible();

    await dragCard(page, mover, await columnPoint(page, "flight"));

    // The FIRST entry of the column's statuses array.
    await expect(async () => {
      const text = await readTaskFile(tracker.root, mover);
      expect(frontmatterValue(text, "status")).toBe("in_progress");
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-13
  test("BRD-13: reordering the statuses array changes what the drop writes", async ({
    page,
    tracker,
  }) => {
    await setStatuses(tracker.root, [
      { key: "backlog", label: "Backlog", default: true },
      { key: "in_progress", label: "In progress" },
      { key: "in_review", label: "In review" },
      { key: "blocked", label: "Blocked" },
    ]);
    // Same column, statuses reordered so `blocked` is first.
    await setBoards(
      tracker.root,
      ["boards:", "  columns:", "    - key: todo", "      label: Backlog",
       "      statuses: [backlog]",
       "    - key: flight", "      label: In flight",
       "      statuses: [blocked, in_progress, in_review]"].join("\n"),
    );

    const keys = await tracker.seed([{ title: "Mover" }]);
    const [mover] = keys as [string];

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${mover}`)).toBeVisible();

    await dragCard(page, mover, await columnPoint(page, "flight"));

    await expect(async () => {
      const text = await readTaskFile(tracker.root, mover);
      expect(frontmatterValue(text, "status")).toBe("blocked");
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-25
  test("BRD-25: dropping at the top generates a rank below the first card", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "First" }, { title: "Mover" }]);
    const [first, mover] = keys as [string, string];
    await tracker.run(["board-rerank", first]);
    const firstRank = frontmatterValue(await readTaskFile(tracker.root, first), "board_rank");
    expect(firstRank).toBe("u");

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${mover}`)).toBeVisible();

    await dragCard(page, mover, await pointAboveCard(page, first));

    await expect(async () => {
      const rank = frontmatterValue(await readTaskFile(tracker.root, mover), "board_rank");
      expect(rank).toBeDefined();
      // Strictly between MIN and the first card's rank.
      expect(rank! < firstRank!).toBe(true);
      expect(rank! > "0").toBe(true);
      expect(rank).not.toBe("0");
      expect(rank!.endsWith("0")).toBe(false);
    }).toPass({ timeout: 5000 });

    // Order survives a refetch from disk.
    await page.reload();
    const cards = page.getByTestId("board-column-backlog").locator("[data-task-key]");
    await expect(cards.first()).toHaveAttribute("data-task-key", mover);
  });

  // @verifies BRD-26
  test("BRD-26: dropping at the bottom generates a rank above the last card", async ({
    page,
    tracker,
  }) => {
    // The mover must start ABOVE the last card, or dropping it at the
    // bottom is the position it already holds and the no-op guard
    // (BRD-31) correctly refuses to write — which is what the first
    // version of this fixture accidentally asserted.
    const keys = await tracker.seed([{ title: "Mover" }, { title: "Last" }]);
    const [mover, last] = keys as [string, string];
    await tracker.run(["board-rerank", mover]);
    await tracker.run(["board-rerank", last, "--after", mover]);
    const lastRank = frontmatterValue(await readTaskFile(tracker.root, last), "board_rank");

    await page.goto(`${tracker.baseURL}/board`);
    const cards = page.getByTestId("board-column-backlog").locator("[data-task-key]");
    await expect(cards.first()).toHaveAttribute("data-task-key", mover);

    await dragCard(page, mover, await columnPoint(page, "backlog", "bottom"));

    await expect(async () => {
      const rank = frontmatterValue(await readTaskFile(tracker.root, mover), "board_rank");
      expect(rank).toBeDefined();
      expect(rank! > lastRank!).toBe(true);
      // Strictly before MAX, never equal to it.
      expect(rank! < "z").toBe(true);
      expect(rank).not.toBe("z");
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-27
  test("BRD-27: an unranked card sorts below ranked ones and can acquire a rank", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Ranked A" },
      { title: "Ranked B" },
      { title: "Unranked one" },
      { title: "Unranked two" },
    ]);
    const [a, b, u1, u2] = keys as [string, string, string, string];
    await tracker.run(["board-rerank", a]);
    await tracker.run(["board-rerank", b, "--after", a]);

    await page.goto(`${tracker.baseURL}/board`);
    const cards = page.getByTestId("board-column-backlog").locator("[data-task-key]");
    // Ranked first, then the unranked in creation order.
    await expect(cards.nth(0)).toHaveAttribute("data-task-key", a);
    await expect(cards.nth(1)).toHaveAttribute("data-task-key", b);
    await expect(cards.nth(2)).toHaveAttribute("data-task-key", u1);
    await expect(cards.nth(3)).toHaveAttribute("data-task-key", u2);

    // Dragging one unranked card above a ranked one gives it a rank.
    await dragCard(page, u1, await pointAboveCard(page, a));

    await expect(async () => {
      const rank = frontmatterValue(await readTaskFile(tracker.root, u1), "board_rank");
      expect(rank).toBeDefined();
    }).toPass({ timeout: 5000 });

    // The other unranked card is NOT silently backfilled.
    const other = await readTaskFile(tracker.root, u2);
    expect(frontmatterValue(other, "board_rank")).toBeUndefined();

    // It stays above after a reload.
    await page.reload();
    await expect(
      page.getByTestId("board-column-backlog").locator("[data-task-key]").first(),
    ).toHaveAttribute("data-task-key", u1);
  });

  // @verifies BRD-29
  test("BRD-29: two cards sharing a rank order deterministically and separate on drag", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Twin one" }, { title: "Twin two" }]);
    const [one, two] = keys as [string, string];
    // Hand-edit both to the same rank.
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
      if (!/^key: (?:T-1|T-2)$/m.test(text)) continue;
      await writeFile(file, text.replace(/^status:/m, "board_rank: u\nstatus:"), "utf8");
    }

    await page.goto(`${tracker.baseURL}/board`);
    const cards = page.getByTestId("board-column-backlog").locator("[data-task-key]");
    const firstOrder = await cards.first().getAttribute("data-task-key");

    // Two reloads produce the same order — not a random swap.
    await page.reload();
    await expect(page.getByTestId("board-column-backlog").locator("[data-task-key]").first())
      .toHaveAttribute("data-task-key", firstOrder!);

    // Dragging one above the other produces distinct ranks.
    const lower = firstOrder === one ? two : one;
    const upper = firstOrder === one ? one : two;
    await dragCard(page, lower, await pointAboveCard(page, upper));

    await expect(async () => {
      const r1 = frontmatterValue(await readTaskFile(tracker.root, one), "board_rank");
      const r2 = frontmatterValue(await readTaskFile(tracker.root, two), "board_rank");
      expect(r1).toBeDefined();
      expect(r2).toBeDefined();
      expect(r1).not.toBe(r2);
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-30
  test("BRD-30: an invalid board_rank is tolerated and repaired by a drag", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Bad rank" }, { title: "Good" }]);
    const [bad, good] = keys as [string, string];
    await tracker.run(["board-rerank", good]);

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
      if (!new RegExp(`^key: ${bad}$`, "m").test(text)) continue;
      await writeFile(file, text.replace(/^status:/m, 'board_rank: "ABC!"\nstatus:'), "utf8");
      break;
    }

    await page.goto(`${tracker.baseURL}/board`);
    // Still rendered — not dropped from the column, and no throw.
    await expect(page.getByTestId(`board-card-${bad}`)).toBeVisible();

    // Dragging it writes a valid rank, repairing it.
    await dragCard(page, bad, await pointAboveCard(page, good));

    await expect(async () => {
      const rank = frontmatterValue(await readTaskFile(tracker.root, bad), "board_rank");
      expect(rank).toBeDefined();
      expect(rank).not.toContain("!");
      expect(/^[0-9a-z]+$/.test(rank!)).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-36
  test("BRD-36: toggling a column off mid-drag cancels cleanly", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Dragged" }, { title: "Elsewhere", fields: { status: "in_progress" } }]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId("board-card-T-1")).toBeVisible();

    const writes: string[] = [];
    page.on("request", req => {
      if (req.method() === "POST" && /\/api\/tasks\//.test(req.url())) writes.push(req.url());
    });

    // Start a drag and hold it over the in_progress column.
    const box = await page.getByTestId("board-card-T-1").boundingBox();
    if (box === null) throw new Error("no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
    const target = await columnPoint(page, "in_progress");
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await expect(page.getByTestId("board-drag-preview")).toBeVisible();

    // Toggle that column off from the chips bar, via the keyboard.
    const chip = page.getByTestId("board-chip-in_progress");
    await chip.focus();
    await page.keyboard.press("Enter");

    // The drag is cancelled rather than dropping into a column that is
    // no longer rendered.
    await expect(page.getByTestId("board-drag-preview")).toHaveCount(0);
    await page.mouse.up();

    await page.waitForTimeout(400);
    expect(writes.filter(u => /board-move|board-rerank/.test(u))).toHaveLength(0);
    const text = await readTaskFile(tracker.root, "T-1");
    expect(frontmatterValue(text, "status")).toBe("backlog");
    expect(frontmatterValue(text, "board_rank")).toBeUndefined();
  });

  // @verifies BRD-32
  test("BRD-32: a refetch landing mid-drag does not yank the card", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Dragged" },
      { title: "Second" },
      { title: "Third" },
    ]);
    const [one, two, three] = keys as [string, string, string];
    await tracker.run(["board-rerank", one]);
    await tracker.run(["board-rerank", two, "--after", one]);
    await tracker.run(["board-rerank", three, "--after", two]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${three}`)).toBeVisible();

    const writes: Record<string, unknown>[] = [];
    page.on("request", req => {
      if (req.method() !== "POST") return;
      if (!/\/api\/tasks\//.test(req.url())) return;
      writes.push(req.postDataJSON() as Record<string, unknown>);
    });

    // Pick up the bottom card and hold it over the top slot.
    const box = await page.getByTestId(`board-card-${three}`).boundingBox();
    if (box === null) throw new Error("no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
    const top = await pointAboveCard(page, one);
    await page.mouse.move(top.x, top.y, { steps: 10 });
    await expect(page.getByTestId("board-drag-preview")).toBeVisible();

    // A write from another surface lands mid-drag, and the board's
    // poll picks it up while the card is still held.
    await tracker.run(["set", two, "priority", "high"]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(600);

    // The card is still under the cursor: the drag survived the
    // refetch rather than being re-sorted out from under it.
    await expect(page.getByTestId("board-drag-preview")).toBeVisible();

    await page.mouse.up();

    // The drop was computed against what was on screen at release:
    // dropped above the first card, so it has no `after` anchor.
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toHaveProperty("after");
    expect(writes[0]?.["before"]).toBe(one);

    // And the resulting order matches what the user saw.
    await expect(async () => {
      const rank = frontmatterValue(await readTaskFile(tracker.root, three), "board_rank");
      const firstRank = frontmatterValue(await readTaskFile(tracker.root, one), "board_rank");
      expect(rank! < firstRank!).toBe(true);
    }).toPass({ timeout: 5000 });
  });

  // @verifies BRD-34
  test("BRD-34: two tabs reordering one column converge on the files' order", async ({
    page,
    context,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Card one" },
      { title: "Card two" },
      { title: "Card three" },
    ]);
    const [one, two, three] = keys as [string, string, string];
    await tracker.run(["board-rerank", one]);
    await tracker.run(["board-rerank", two, "--after", one]);
    await tracker.run(["board-rerank", three, "--after", two]);

    // Tab A drags card one below card three.
    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${one}`)).toBeVisible();

    // Tab B opens on the same (now about to be stale) order.
    const pageB = await context.newPage();
    await pageB.goto(`${tracker.baseURL}/board`);
    await expect(pageB.getByTestId(`board-card-${two}`)).toBeVisible();

    await dragCard(page, one, await columnPoint(page, "backlog", "bottom"));
    await expect(async () => {
      expect(frontmatterValue(await readTaskFile(tracker.root, one), "board_rank"))
        .not.toBe("u");
    }).toPass({ timeout: 5000 });

    // Tab B, stale, drags card two to the top.
    await dragCard(pageB, two, await pointAboveCard(pageB, three));

    // Both writes succeeded — they touch different tasks, so neither
    // clobbered the other.
    const rankOf = async (k: string): Promise<string> => {
      const v = frontmatterValue(await readTaskFile(tracker.root, k), "board_rank");
      if (v === undefined) throw new Error(`no rank for ${k}`);
      return v;
    };

    // The order the FILES say. Both writes landed, so all three cards
    // carry a rank.
    const ranks = await Promise.all(
      [one, two, three].map(async k => [k, await rankOf(k)] as const),
    );
    const onDisk = [...ranks].sort((a, b) => a[1].localeCompare(b[1])).map(r => r[0]);

    // Both tabs, after refetching, agree with the files and with each
    // other — neither is left showing a position no rank justifies.
    for (const p of [page, pageB]) {
      await p.reload();
      const cards = p.getByTestId("board-column-backlog").locator("[data-task-key]");
      // Wait for the column to actually render before reading it, or
      // the order is read off a half-painted board.
      await expect(cards).toHaveCount(3);
      await expect(cards.nth(0)).toHaveAttribute("data-task-key", onDisk[0]!);
      await expect(cards.nth(1)).toHaveAttribute("data-task-key", onDisk[1]!);
      await expect(cards.nth(2)).toHaveAttribute("data-task-key", onDisk[2]!);
    }

    await pageB.close();
  });

  // @verifies BRD-35
  test("BRD-35: a card moved by another surface mid-drag resolves without inventing a state", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Contested" },
      { title: "Anchor", fields: { status: "in_progress" } },
    ]);
    const [contested, anchor] = keys as [string, string];
    await tracker.run(["board-rerank", anchor]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${contested}`)).toBeVisible();

    // Start dragging toward `in_progress`, and hold.
    const box = await page.getByTestId(`board-card-${contested}`).boundingBox();
    if (box === null) throw new Error("no box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 5 });
    const target = await columnPoint(page, "in_progress");
    await page.mouse.move(target.x, target.y, { steps: 10 });

    // The CLI moves that same task to a THIRD status while it is held.
    await tracker.run(["set", contested, "status", "done"]);

    // Release after the CLI write.
    await page.mouse.up();
    await page.waitForTimeout(800);

    // Either the drop applied against the task as it now exists, or it
    // was rejected — but the rendered column must match the stored
    // status, with no card floating in a column its file contradicts.
    const status = frontmatterValue(await readTaskFile(tracker.root, contested), "status");
    expect(status).toBeDefined();
    await page.reload();
    await expect(
      page.getByTestId(`board-column-${status}`).getByTestId(`board-card-${contested}`),
    ).toBeVisible();
  });

  // @verifies BRD-50
  test("BRD-50: cards surface blocked, epic child-count, and subtask", async ({
    page,
    tracker,
  }) => {
    // Four tasks: a blocker, its blocked task, an epic and its two
    // children. The default `blocks` / `parent` relationships write both
    // sides, so each card carries the edge that drives its own marker.
    const keys = await tracker.seed([
      { title: "The blocker" },
      { title: "Blocked task" },
      { title: "The epic" },
      { title: "Child one" },
      { title: "Child two" },
    ]);
    const [blocker, blocked, epic, child1, child2] = keys as [
      string, string, string, string, string,
    ];

    // `link A blocks B` → A gets `blocks`, B gets `is_blocked_by`.
    await tracker.run(["link", blocker, "blocks", blocked]);
    // `link child parent epic` → child gets `parent`, epic gets `child`.
    await tracker.run(["link", child1, "parent", epic]);
    await tracker.run(["link", child2, "parent", epic]);

    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${blocked}`)).toBeVisible();

    // The blocked task shows a blocked marker naming its blocker count.
    const blockedMarker = page.getByTestId(`board-card-blocked-${blocked}`);
    await expect(blockedMarker).toBeVisible();
    await expect(blockedMarker).toContainText("Blocked");
    await expect(blockedMarker).toHaveAttribute("title", "Blocked by 1 task");

    // The task that only *blocks* others is not itself marked blocked.
    await expect(page.getByTestId(`board-card-blocked-${blocker}`)).toHaveCount(0);

    // The epic shows a child-count badge of 2.
    const epicBadge = page.getByTestId(`board-card-epic-${epic}`);
    await expect(epicBadge).toBeVisible();
    await expect(epicBadge).toContainText("2");
    await expect(epicBadge).toHaveAttribute("title", "Epic with 2 children");

    // Each child shows the "belongs to an epic" subtask hint.
    await expect(page.getByTestId(`board-card-subtask-${child1}`)).toBeVisible();
    await expect(page.getByTestId(`board-card-subtask-${child2}`)).toBeVisible();
    // …and is not itself an epic.
    await expect(page.getByTestId(`board-card-epic-${child1}`)).toHaveCount(0);
  });

  // @verifies BRD-51
  test("BRD-51: column-visibility pills read as show/hide toggles", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "One" },
      { title: "Shipped", fields: { status: "done" } },
    ]);

    await page.goto(`${tracker.baseURL}/board`);

    // A shown column's pill names the *action* (Hide) and the column,
    // so its meaning as a toggle is discoverable — not a bare label that
    // a dimmed sibling could be misread as "no tasks".
    const backlog = page.getByTestId("board-chip-backlog");
    await expect(backlog).toHaveAttribute("title", /hide column/i);
    await expect(backlog).toHaveAttribute("aria-label", /hide column/i);

    // Toggling it off flips the affordance to "Show", and it stays a
    // pressable toggle (BRD-3's guarantee, made legible here).
    await backlog.click();
    await expect(backlog).toHaveAttribute("aria-pressed", "false");
    await expect(backlog).toHaveAttribute("title", /show column/i);
    await expect(backlog).toHaveAttribute("aria-label", /show column/i);
    await expect(page.getByTestId("board-column-backlog")).toHaveCount(0);
  });
});
