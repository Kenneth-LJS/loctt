/**
 * Transcribed from docs/dev/ui-test-cases/flow-timeline.md, section A
 * ("Happy path", TML-1..17).
 *
 * M3.3a builds the rendering half; the drag layer (the write half of
 * TML-9..12) and sections B and C are M3.3b. Cases whose *rendering*
 * half is buildable now are tagged here for that half only, and the
 * table in the ticket report says which bullets are deferred.
 *
 * One `test` per case, named by case ID, with a `@verifies` tag. The
 * prose is the specification: a spec asserting something the case does
 * not claim has drifted from it.
 *
 * The bar-geometry arithmetic is unit-tested in
 * `apps/web/src/client/timeline/geometry.test.ts` — a UI test asserting
 * "a bar is visible" passes whether or not its edges land on the right
 * dates, so the numbers are pinned there and the wiring is pinned here.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** Replaces or appends the `timeline:` block of workflow.yaml. */
async function setTimelineConfig(root: string, body: string | null): Promise<void> {
  const file = path.join(root, ".loctt", "config", "workflow.yaml");
  const text = await readFile(file, "utf8");
  // Strip the existing block (it runs to EOF or the next top-level key).
  const without = text.replace(/^timeline:\n(?:[ \t#].*\n|\n)*/m, "");
  if (without === text && /^timeline:/m.test(text)) {
    throw new Error("timeline block present but not replaced");
  }
  await writeFile(file, body === null ? without : `${without.trimEnd()}\n${body}\n`, "utf8");
}

/** Overwrites calendar.yaml wholesale. */
async function setCalendar(root: string, yaml: string): Promise<void> {
  await writeFile(path.join(root, ".loctt", "config", "calendar.yaml"), yaml, "utf8");
}

/** Reads one task's `task.md` by key. */
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
  throw new Error(`no task file for ${key}`);
}

/**
 * Two dated tasks and one undated one, with a `blocks` link.
 *
 * T-1 spans 2026-03-02 → 2026-03-06 (5 days), which is the exact span
 * TML-3 and TML-4 both name; T-2 is a single day, which is TML-4's
 * "not zero-width and not two days".
 */
async function seedDated(
  tracker: { seed: (t: readonly { title: string }[]) => Promise<string[]>; run: (a: readonly string[]) => Promise<string> },
): Promise<string[]> {
  const keys = await tracker.seed([
    { title: "Alpha task" },
    { title: "Beta task" },
    { title: "Undated task" },
  ]);
  const [a, b] = keys as [string, string, string];
  await tracker.run(["set", a, "start_date", "2026-03-02"]);
  await tracker.run(["set", a, "due_date", "2026-03-06"]);
  await tracker.run(["set", b, "start_date", "2026-03-09"]);
  await tracker.run(["set", b, "due_date", "2026-03-09"]);
  await tracker.run(["link", a, "blocks", b]);
  return keys;
}

/** Bar geometry as the DOM actually has it. */
async function barBox(
  page: import("@playwright/test").Page,
  key: string,
): Promise<{ left: number; width: number }> {
  const el = page.getByTestId(`timeline-bar-${key}`);
  await expect(el).toBeVisible();
  const left = await el.evaluate(n => parseFloat((n as HTMLElement).style.left));
  const width = await el.evaluate(n => parseFloat((n as HTMLElement).style.width));
  return { left, width };
}

test.describe("TML — timeline view", () => {
  // @verifies TML-1
  test("TML-1: opens at the zoom from workflow.timeline.default_zoom", async ({ page, tracker }) => {
    await seedDated(tracker);
    await setTimelineConfig(tracker.root, "timeline:\n  default_zoom: month\n  dependency_relationship: blocks");
    await page.goto(`${tracker.baseURL}/timeline`);

    // Opens at month — not the built-in week.
    await expect(page.getByTestId("timeline-zoom-month")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("timeline-zoom-week")).toHaveAttribute("aria-pressed", "false");

    // Removing default_zoom falls back to WEEK — the documented
    // built-in — and explicitly not to day.
    await setTimelineConfig(tracker.root, "timeline:\n  dependency_relationship: blocks");
    await page.goto(`${tracker.baseURL}/timeline`);
    await expect(page.getByTestId("timeline-zoom-week")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "false");

    // A pasted URL opens its own zoom regardless of the workspace
    // default: config says nothing, the URL says day.
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "true");
  });

  // @verifies TML-2
  test("TML-2: a saved view's display.zoom beats the workspace default", async ({ page, tracker }) => {
    await seedDated(tracker);
    await setTimelineConfig(tracker.root, "timeline:\n  default_zoom: month");

    // A saved view authored for the timeline at day zoom.
    const queriesPath = path.join(tracker.root, ".loctt", "config", "queries.yaml");
    const before = await readFile(queriesPath, "utf8");
    await writeFile(
      queriesPath,
      `${before.trimEnd()}\n  - id: tmlview\n    name: Day view\n    query: archived != true\n    display:\n      mode: timeline\n      zoom: day\n`,
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/timeline?view=tmlview`);
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "true");

    // Changing the zoom updates the URL but must NOT rewrite
    // queries.yaml — the saved view is unchanged on disk until the
    // user explicitly saves. Asserted against the FILE, not the screen.
    const savedBefore = await readFile(queriesPath, "utf8");
    await page.getByTestId("timeline-zoom-month").click();
    await expect(page).toHaveURL(/zoom=month/);
    await expect.poll(async () => readFile(queriesPath, "utf8")).toBe(savedBefore);

    // Reopening the view returns to day.
    await page.goto(`${tracker.baseURL}/timeline?view=tmlview`);
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "true");
  });

  // @verifies TML-3
  test("TML-3: switching zoom rescales the header and every bar consistently", async ({ page, tracker }) => {
    const [a] = await seedDated(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=week`);
    await expect(page.getByTestId(`timeline-bar-${a}`)).toBeVisible();

    const week = await barBox(page, a as string);

    // Day zoom: the 5-day span occupies 5 day-columns.
    await page.getByTestId("timeline-zoom-day").click();
    await expect(page).toHaveURL(/zoom=day/);
    const day = await barBox(page, a as string);
    expect(day.width).toBeGreaterThan(week.width);
    // Header re-labels: at day zoom cells are individual dates, so
    // there are far more of them than at month zoom.
    const dayCells = await page.getByTestId("timeline-header-cell").count();

    await page.getByTestId("timeline-zoom-month").click();
    await expect(page).toHaveURL(/zoom=month/);
    const month = await barBox(page, a as string);
    expect(month.width).toBeLessThan(week.width);
    const monthCells = await page.getByTestId("timeline-header-cell").count();
    expect(monthCells).toBeLessThan(dayCells);
    // Month cells are named months.
    await expect(page.getByTestId("timeline-header-cell").first()).toHaveText(/\w+ \d{4}/);

    // The zoom survives back/forward.
    await page.goBack();
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "true");
    await page.goForward();
    await expect(page.getByTestId("timeline-zoom-month")).toHaveAttribute("aria-pressed", "true");
  });

  // @verifies TML-4
  test("TML-4: bars run start_date to due_date inclusive, with a tooltip", async ({ page, tracker }) => {
    const [a, b] = await seedDated(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    const alpha = await barBox(page, a as string);
    const beta = await barBox(page, b as string);

    // A single-day task is exactly one column — not zero, not two.
    expect(beta.width).toBeGreaterThan(0);
    // The 5-day span is exactly five times the single day.
    expect(alpha.width).toBeCloseTo(beta.width * 5, 5);

    // The bar's label is the title, and the tooltip carries key,
    // title and both dates.
    await expect(page.getByTestId(`timeline-bar-${a}`)).toContainText("Alpha task");
    await expect(page.getByTestId(`timeline-bar-${a}`)).toHaveAttribute(
      "title",
      `${a} · Alpha task · 2026-03-02 → 2026-03-06`,
    );
  });

  // @verifies TML-5
  test("TML-5: tasks missing either date land in an Unscheduled lane", async ({ page, tracker }) => {
    const keys = await tracker.seed([
      { title: "Both dates" },
      { title: "Neither date" },
      { title: "Only start" },
      { title: "Only due" },
    ]);
    const [both, , onlyStart, onlyDue] = keys as [string, string, string, string];
    await tracker.run(["set", both, "start_date", "2026-03-02"]);
    await tracker.run(["set", both, "due_date", "2026-03-06"]);
    await tracker.run(["set", onlyStart, "start_date", "2026-03-02"]);
    await tracker.run(["set", onlyDue, "due_date", "2026-03-06"]);

    await page.goto(`${tracker.baseURL}/timeline`);

    // All three undated shapes are in the lane, with an honest count.
    await expect(page.getByTestId("timeline-unscheduled")).toBeVisible();
    await expect(page.getByTestId("timeline-unscheduled-count")).toHaveText("(3)");
    // Listed by key and title, and no bar is drawn for them.
    await expect(page.getByTestId(`timeline-unscheduled-row-${onlyStart}`)).toContainText("Only start");
    await expect(page.getByTestId(`timeline-bar-${onlyStart}`)).toHaveCount(0);
    // The dated one DOES get a bar — positive control.
    await expect(page.getByTestId(`timeline-bar-${both}`)).toBeVisible();

    // Clicking an unscheduled row opens the task detail.
    await page.getByTestId(`timeline-unscheduled-row-${onlyDue}`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${onlyDue}$`));
  });

  // @verifies TML-5
  test("TML-5: the lane is hidden — never an unlabelled blank row — when empty", async ({ page, tracker }) => {
    const [a] = await tracker.seed([{ title: "Fully dated" }]);
    await tracker.run(["set", a as string, "start_date", "2026-03-02"]);
    await tracker.run(["set", a as string, "due_date", "2026-03-06"]);
    await page.goto(`${tracker.baseURL}/timeline`);
    await expect(page.getByTestId(`timeline-bar-${a}`)).toBeVisible();
    await expect(page.getByTestId("timeline-unscheduled")).toHaveCount(0);
  });

  // @verifies TML-6
  test("TML-6: grouping by milestone splits rows into labelled bands", async ({ page, tracker }) => {
    const keys = await tracker.seed([{ title: "In milestone" }, { title: "No milestone task" }]);
    const [inM, noM] = keys as [string, string];
    for (const k of [inM, noM]) {
      await tracker.run(["set", k, "start_date", "2026-03-02"]);
      await tracker.run(["set", k, "due_date", "2026-03-06"]);
    }
    await tracker.run(["milestone", "create", "Alpha Release"]);
    const milestones = await readFile(
      path.join(tracker.root, ".loctt", "config", "milestones.yaml"),
      "utf8",
    );
    const mid = /id: (\S+)/.exec(milestones)?.[1] as string;
    await tracker.run(["set", inM, "milestone", mid]);

    await page.goto(`${tracker.baseURL}/timeline?grouping=milestone`);

    // The display label, not the slug/id.
    await expect(page.getByTestId(`timeline-band-${mid}`)).toContainText("Alpha Release");
    await expect(page.getByTestId(`timeline-band-${mid}`)).not.toContainText(mid);
    // Tasks with no milestone collect in one explicit band.
    await expect(page.getByTestId("timeline-band-__none__")).toContainText("No milestone");
    // Band counts match the rows inside.
    await expect(page.getByTestId(`timeline-band-count-${mid}`)).toHaveText("(1)");
    await expect(page.getByTestId("timeline-band-count-__none__")).toHaveText("(1)");

    // Bands are collapsible, and collapsing does not change the URL's
    // task scope.
    const urlBefore = page.url();
    await page.getByTestId(`timeline-band-${mid}`).click();
    await expect(page.getByTestId(`timeline-band-${mid}`)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId(`timeline-bar-${inM}`)).toHaveCount(0);
    expect(page.url()).toBe(urlBefore);
    // The count still reports the band's true size, not zero.
    await expect(page.getByTestId(`timeline-band-count-${mid}`)).toHaveText("(1)");
  });

  // @verifies TML-7
  test("TML-7: assignee, status and sprint groupings each band correctly", async ({ page, tracker }) => {
    const keys = await tracker.seed([{ title: "Assigned" }, { title: "Unassigned task" }]);
    const [assigned, unassigned] = keys as [string, string];
    for (const k of [assigned, unassigned]) {
      await tracker.run(["set", k, "start_date", "2026-03-02"]);
      await tracker.run(["set", k, "due_date", "2026-03-06"]);
    }
    const users = await readFile(path.join(tracker.root, ".loctt", "config", "users.yaml"), "utf8")
      .catch(async () => {
        const { readdir } = await import("node:fs/promises");
        const dir = path.join(tracker.root, ".loctt", "users");
        const ids = await readdir(dir);
        return readFile(path.join(dir, ids[0] as string, "profile.yaml"), "utf8");
      });
    // Asserted, not skipped: a silent `if (uid !== undefined)` here
    // would leave BOTH tasks unassigned, and the "Unassigned band"
    // assertion below would then pass for the wrong reason.
    const uid = /^id: (\S+)/m.exec(users)?.[1];
    expect(uid, "could not read a user id to assign").toBeDefined();
    await tracker.run(["set", assigned, "assignee", uid as string]);

    // Status bands use labels in declaration order, never keys.
    await page.goto(`${tracker.baseURL}/timeline?grouping=status`);
    await expect(page.getByTestId("timeline-band-backlog")).toContainText("Backlog");
    await expect(page.getByTestId("timeline-band-backlog")).not.toContainText("backlog(");

    // Switching grouping changes only the arrangement, never the set:
    // the same two bars are present under every grouping.
    for (const g of ["none", "assignee", "status", "sprint", "milestone"]) {
      await page.goto(`${tracker.baseURL}/timeline?grouping=${g}`);
      await expect(page.getByTestId(`timeline-bar-${assigned}`)).toBeVisible();
      await expect(page.getByTestId(`timeline-bar-${unassigned}`)).toBeVisible();
      await expect(page.getByTestId("timeline-total")).toHaveText("2 tasks");
    }

    // Unassigned tasks band together explicitly, and the assigned one
    // is in a band of its own under the user's display NAME — two
    // bands, not one, which is what proves the assignment took and
    // the "Unassigned" band is not just catching everything.
    await page.goto(`${tracker.baseURL}/timeline?grouping=assignee`);
    await expect(page.getByTestId("timeline-band-__none__")).toContainText("Unassigned");
    await expect(page.getByTestId(`timeline-band-${uid as string}`)).toBeVisible();
    // The band is labelled by name, never by the raw ULID.
    await expect(page.getByTestId(`timeline-band-${uid as string}`)).not.toContainText(uid as string);
    await expect(page.getByTestId(`timeline-band-count-${uid as string}`)).toHaveText("(1)");
    await expect(page.getByTestId("timeline-band-count-__none__")).toHaveText("(1)");
  });

  // @verifies TML-8
  test("TML-8: grouping defaults from config and is URL-addressable", async ({ page, tracker }) => {
    await seedDated(tracker);
    await setTimelineConfig(tracker.root, "timeline:\n  default_grouping: assignee");

    await page.goto(`${tracker.baseURL}/timeline`);
    await expect(page.getByTestId("timeline-grouping")).toHaveValue("assignee");

    // Changing to none flattens and updates the URL.
    await page.getByTestId("timeline-grouping").selectOption("none");
    await expect(page).toHaveURL(/grouping=none/);
    await expect(page.getByTestId("timeline-band-all")).toBeVisible();

    // The `none` URL opens ungrouped even though the default is
    // assignee — `none` is a value, not an absence.
    await page.goto(`${tracker.baseURL}/timeline?grouping=none`);
    await expect(page.getByTestId("timeline-grouping")).toHaveValue("none");
    await expect(page.getByTestId("timeline-band-all")).toBeVisible();

    // With default_grouping absent, the view opens at none.
    await setTimelineConfig(tracker.root, null);
    await page.goto(`${tracker.baseURL}/timeline`);
    await expect(page.getByTestId("timeline-grouping")).toHaveValue("none");
  });

  // @verifies TML-13
  test("TML-13: weekends and holidays are shaded from calendar.yaml", async ({ page, tracker }) => {
    const [a] = await seedDated(tracker);
    await setCalendar(
      tracker.root,
      "timezone: UTC\nfirst_day_of_week: 0\nworking_days: [1, 2, 3, 4, 5]\nholidays:\n  - date: 2026-03-07\n    label: Test Holiday\n",
    );
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    // 2026-03-07 is a Saturday AND the holiday: it is shaded and
    // exposes the holiday label on hover.
    const sat = page.locator('[data-testid="timeline-nonworking"][data-date="2026-03-07"]');
    await expect(sat).toHaveCount(1);
    await expect(sat).toHaveAttribute("title", "Test Holiday");
    // Sunday 2026-03-08 is shaded too.
    await expect(page.locator('[data-testid="timeline-nonworking"][data-date="2026-03-08"]')).toHaveCount(1);
    // A Friday is NOT shaded — positive control that the predicate
    // discriminates rather than shading everything.
    await expect(page.locator('[data-testid="timeline-nonworking"][data-date="2026-03-06"]')).toHaveCount(0);

    // Shading is decorative: the bar still renders across it.
    await expect(page.getByTestId(`timeline-bar-${a}`)).toBeVisible();

    // Changing working_days moves the shading — it is not hardcoded
    // to Sat/Sun. [0,1,2,3,4] = Sun..Thu, so Friday becomes shaded.
    await setCalendar(
      tracker.root,
      "timezone: UTC\nfirst_day_of_week: 0\nworking_days: [0, 1, 2, 3, 4]\nholidays: []\n",
    );
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.locator('[data-testid="timeline-nonworking"][data-date="2026-03-06"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="timeline-nonworking"][data-date="2026-03-08"]')).toHaveCount(0);
  });

  // @verifies TML-14
  test("TML-14: arrows are drawn only for the configured relationship", async ({ page, tracker }) => {
    const [a, b] = await seedDated(tracker);
    // The same pair also carries `parent` — an arrow for it would be
    // the leak TML-14's second bullet forbids.
    await tracker.run(["link", a as string, "parent", b as string]);
    await setTimelineConfig(tracker.root, "timeline:\n  dependency_relationship: blocks\n  show_arrows: true");

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    // Exactly one arrow — for `blocks`, not for `parent`.
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(1);
    // Positive control: the parent link really is on disk.
    expect(await readTaskFile(tracker.root, a as string)).toContain("parent");

    // With the relationship absent, no arrows at all, and the toggle
    // reflects that state.
    await setTimelineConfig(tracker.root, "timeline:\n  show_arrows: true");
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(0);
    await expect(page.getByTestId("timeline-arrows")).toBeDisabled();
  });

  // @verifies TML-15
  test("TML-15: the arrows toggle defaults from show_arrows and is shareable", async ({ page, tracker }) => {
    const [a] = await seedDated(tracker);
    await setTimelineConfig(
      tracker.root,
      "timeline:\n  dependency_relationship: blocks\n  show_arrows: false",
    );

    // Opens with arrows hidden and the toggle off.
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId("timeline-arrows")).not.toBeChecked();
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(0);

    // Turning it on draws arrows with no refetch of task data.
    let taskRequests = 0;
    page.on("request", r => {
      if (r.url().includes("/api/tasks")) taskRequests += 1;
    });
    await page.getByTestId("timeline-arrows").check();
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(1);
    expect(taskRequests).toBe(0);

    // The state is in the URL, so it is shareable.
    await expect(page).toHaveURL(/arrows=true/);

    // Toggling never changes which rows or bars are displayed.
    await expect(page.getByTestId(`timeline-bar-${a}`)).toBeVisible();
    await expect(page.getByTestId("timeline-total")).toHaveText("3 tasks");
  });

  // @verifies TML-16
  test("TML-16: today is marked and the view opens scrolled to it", async ({ page, tracker }) => {
    // Work far in the past, so "scrolled to today" and "scrolled to
    // the earliest task" are visibly different positions.
    const [a] = await tracker.seed([{ title: "Old work" }]);
    await tracker.run(["set", a as string, "start_date", "2020-01-06"]);
    await tracker.run(["set", a as string, "due_date", "2020-01-10"]);

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const marker = page.getByTestId("timeline-today-marker");
    await expect(marker).toBeAttached();

    const scroller = page.getByTestId("timeline-scroll");
    // The initial scroll is NOT at the earliest task (x≈0); it is out
    // near today.
    await expect.poll(async () => scroller.evaluate(n => n.scrollLeft)).toBeGreaterThan(100);

    // The Today control re-centres after scrolling away.
    await scroller.evaluate(n => { n.scrollLeft = 0; });
    await page.getByTestId("timeline-today").click();
    await expect.poll(async () => scroller.evaluate(n => n.scrollLeft)).toBeGreaterThan(100);
  });

  // @verifies TML-17
  test("TML-17: clicking a bar opens the task, and back returns to the same view", async ({ page, tracker }) => {
    const [a] = await seedDated(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day&grouping=status&arrows=false`);
    await expect(page.getByTestId(`timeline-bar-${a}`)).toBeVisible();

    await page.getByTestId(`timeline-bar-${a}`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${a}$`));

    // Back returns to the timeline with the same zoom, grouping and
    // arrows state.
    await page.goBack();
    await expect(page).toHaveURL(/\/timeline/);
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("timeline-grouping")).toHaveValue("status");
    await expect(page.getByTestId("timeline-arrows")).not.toBeChecked();
  });
});

/**
 * ---------------------------------------------------------------
 * M3.3b — the drag writes (TML-9..11) and sections B and C.
 * ---------------------------------------------------------------
 *
 * ## How a drag is performed here
 *
 * `page.mouse` rather than Playwright's `dragTo`: the gesture is built
 * on pointer events with a movement threshold (TML-17), and a
 * synthesized drag that jumps straight from press to release never
 * crosses it. Every drag below therefore moves in at least two steps.
 *
 * ## What these tests assert, and why it is not "the bar moved"
 *
 * A test that only checks the bar's rendered geometry passes from an
 * optimistic update alone, with the server write never landing or
 * landing wrong. So each write case asserts on **two** far ends:
 *
 *  - the request that left the browser — `payloadOf` captures the JSON
 *    body, because TML-9's "start_date is not included in the payload"
 *    and TML-11's "a single atomic write, not two sequential calls"
 *    are claims about the request, not about the result; and
 *  - the file on disk — `datesOf` re-reads `task.md`, because TML-10
 *    says in as many words that a previous attempt asserted only on
 *    screen.
 */

/** The `start_date` / `due_date` lines of a task file, as stored. */
async function datesOf(
  root: string,
  key: string,
): Promise<{ start?: string; due?: string; raw: string }> {
  const raw = await readTaskFile(root, key);
  const start = /^start_date:\s*(.+)$/m.exec(raw)?.[1]?.trim();
  const due = /^due_date:\s*(.+)$/m.exec(raw)?.[1]?.trim();
  return {
    ...(start !== undefined ? { start } : {}),
    ...(due !== undefined ? { due } : {}),
    raw,
  };
}

/** Every `set-dates` request body the page sends, in order. */
function captureSetDates(page: import("@playwright/test").Page): { calls: unknown[] } {
  const calls: unknown[] = [];
  page.on("request", r => {
    if (r.method() === "POST" && r.url().includes("/set-dates")) {
      calls.push(JSON.parse(r.postData() ?? "null"));
    }
  });
  return { calls };
}

/**
 * Drags from a point on a bar by `dx` pixels, in steps.
 *
 * `steps` matters: the first move must exceed the 4px threshold to
 * promote the press into a drag, and a single jump would arrive as one
 * `pointermove` that the hook may treat as a click's tail.
 */
async function dragBy(
  page: import("@playwright/test").Page,
  from: { x: number; y: number },
  dx: number,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.sign(dx) * 8, from.y, { steps: 2 });
  await page.mouse.move(from.x + dx, from.y, { steps: 6 });
  await page.mouse.up();
}

/** The centre of a bar, and its two edge handles, in page coordinates. */
async function barPoints(
  page: import("@playwright/test").Page,
  key: string,
): Promise<{ body: { x: number; y: number }; start: { x: number; y: number }; end: { x: number; y: number } }> {
  // The chart opens scrolled to *today* (TML-16), so a bar dated
  // months away starts far outside the viewport — measured at
  // x = -5539 for a March bar on an August tracker. Mouse coordinates
  // are viewport coordinates, so a drag aimed at an off-screen box
  // presses on nothing at all and silently does nothing. Scrolling the
  // bar into view first is what makes these gestures land.
  const el = page.getByTestId(`timeline-bar-${key}`);
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  if (box === null) throw new Error(`no bounding box for ${key}`);
  const y = box.y + box.height / 2;

  // The edge points come from the handles' own boxes, not from an
  // offset guessed off the bar. Measured: aiming at `box.x + width - 1`
  // put `elementFromPoint` on the BUTTON rather than the handle, so an
  // end-edge drag was silently read as a body drag — a test that aims
  // by arithmetic can assert the wrong gesture and never say so.
  const startBox = await page.getByTestId(`timeline-handle-start-${key}`).boundingBox();
  const endBox = await page.getByTestId(`timeline-handle-end-${key}`).boundingBox();
  if (startBox === null || endBox === null) throw new Error(`no handle boxes for ${key}`);
  return {
    body: { x: box.x + box.width / 2, y },
    start: { x: startBox.x + startBox.width / 2, y },
    end: { x: endBox.x + endBox.width / 2, y },
  };
}

/** One task spanning 5 days at day zoom, alone, so geometry is unambiguous. */
async function seedOne(
  tracker: { seed: (t: readonly { title: string }[]) => Promise<string[]>; run: (a: readonly string[]) => Promise<string> },
  start = "2026-03-02",
  due = "2026-03-06",
): Promise<string> {
  const [k] = await tracker.seed([{ title: "Draggable" }]);
  await tracker.run(["set", k as string, "start_date", start]);
  await tracker.run(["set", k as string, "due_date", due]);
  return k as string;
}

test.describe("TML — timeline drag writes (M3.3b)", () => {
  // @verifies TML-9
  test("TML-9: a right-edge drag writes due_date only", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    const before = await datesOf(tracker.root, key);
    expect(before.start).toBe("2026-03-02");

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();
    const seen = captureSetDates(page);

    // Three days at 36px/day.
    const p = await barPoints(page, key);
    await dragBy(page, p.end, 3 * 36);

    // The bar settles at its new width and does not snap back.
    await expect(page.getByTestId(`timeline-bar-${key}`))
      .toHaveAttribute("data-due", "2026-03-09");

    // Exactly one field in the payload, and it is `due_date`.
    // `start_date` is not present at its current value either — an
    // absent key, not a resent one.
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]).toEqual({ due_date: "2026-03-09" });

    // And the file agrees: the new due, the untouched start.
    const after = await datesOf(tracker.root, key);
    expect(after.due).toBe("2026-03-09");
    expect(after.start).toBe("2026-03-02");
  });

  // @verifies TML-10
  test("TML-10: a left-edge drag writes start_date only, and due_date is byte-identical", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    const before = await datesOf(tracker.root, key);
    // The exact stored line, not the parsed value — the case says
    // "byte-identical", and a rewrite that requoted or restyled the
    // value would still parse equal.
    const dueLineBefore = /^due_date:.*$/m.exec(before.raw)?.[0];
    expect(dueLineBefore).toBeDefined();

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();
    const seen = captureSetDates(page);

    const bar = page.getByTestId(`timeline-bar-${key}`);
    const p = await barPoints(page, key);

    /**
     * The bar's right edge as a **date**, derived from its own laid-out
     * geometry and the chart's origin.
     *
     * Neither raw `boundingBox()` nor raw `style.left` is stable here,
     * and both were measured failing for reasons that have nothing to
     * do with the bar moving:
     *
     *  - `boundingBox()` is viewport-relative, so
     *    `scrollIntoViewIfNeeded` alone shifted it by 6016px;
     *  - `style.left` is chart-relative, and pulling `start_date`
     *    earlier *widens* `computeRange`, moving the chart's own
     *    origin — measured as the first header cell changing from
     *    "21" to "19". `left` then reports a different number for an
     *    edge that never moved.
     *
     * Converting to a date removes both. TML-10's "does not move by
     * even one pixel-column" is a claim about which column the edge
     * sits on, and that is what this measures.
     */
    const rightEdgeDate = async (): Promise<string> => {
      const firstCell = await page
        .getByTestId("timeline-header-cell")
        .first()
        .getAttribute("data-date");
      const px = await bar.evaluate(n => {
        const el = n as HTMLElement;
        return parseFloat(el.style.left) + parseFloat(el.style.width);
      });
      const origin = Date.parse(`${firstCell ?? ""}T00:00:00Z`);
      return new Date(origin + (px / 36) * 86_400_000).toISOString().slice(0, 10);
    };
    const rightBefore = await rightEdgeDate();

    // Two days earlier.
    await dragBy(page, p.start, -2 * 36);

    await expect(bar).toHaveAttribute("data-start", "2026-02-28");

    // The right edge still sits on the same column.
    expect(await rightEdgeDate()).toBe(rightBefore);

    // Only `start_date` in the payload.
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]).toEqual({ start_date: "2026-02-28" });

    // Re-read the file: the new start, and a `due_date` line identical
    // to the bytes that were there before.
    const after = await datesOf(tracker.root, key);
    expect(after.start).toBe("2026-02-28");
    expect(/^due_date:.*$/m.exec(after.raw)?.[0]).toBe(dueLineBefore);
  });

  // @verifies TML-11
  test("TML-11: a body drag shifts both dates by the same delta in ONE request", async ({ page, tracker }) => {
    const key = await seedOne(tracker);

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();
    const seen = captureSetDates(page);

    const p = await barPoints(page, key);
    await dragBy(page, p.body, 4 * 36);

    await expect(page.getByTestId(`timeline-bar-${key}`))
      .toHaveAttribute("data-start", "2026-03-06");

    // The payload shape, not just the result. Two sequential writes
    // would leave two entries here and would pass a result-only check.
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0]).toEqual({
      start_date: "2026-03-06",
      due_date: "2026-03-10",
    });

    // Both dates on disk, the duration preserved, and the two deltas
    // identical — the off-by-one the case names is a start that moved
    // 4 days and a due that moved 3.
    const after = await datesOf(tracker.root, key);
    expect(after.start).toBe("2026-03-06");
    expect(after.due).toBe("2026-03-10");
  });

  // @verifies TML-11
  test("TML-11: the atomic write leaves one history batch, not two", async ({ page, tracker }) => {
    // The observable consequence of atomicity on disk. Two sequential
    // `set` calls stamp two separate `updated_at` writes and two
    // history entries; `setFields` appends one batch.
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();

    const p = await barPoints(page, key);
    await dragBy(page, p.body, 4 * 36);
    await expect(page.getByTestId(`timeline-bar-${key}`))
      .toHaveAttribute("data-start", "2026-03-06");
    // The rendered attribute can come from the refetch a moment before
    // the file settles; poll the file itself before reading its log.
    await expect
      .poll(async () => (await datesOf(tracker.root, key)).start)
      .toBe("2026-03-06");

    // `loctt log` prints one line per field change with its timestamp.
    // Measured: two sequential `loctt set` calls stamp two *different*
    // timestamps (…:20.023Z and …:20.250Z); one `setFields` change set
    // stamps both lines with the same one. That shared timestamp is
    // the on-disk evidence of "a single atomic multi-field write, not
    // two sequential calls" — and it is exactly what a two-request
    // implementation cannot produce.
    // Lines look like:
    //   2026-08-30T10:05:59.747Z  start_date: 2026-03-02 → 2026-03-06  (ken)
    const log = await tracker.run(["log", key]);
    const lines = [...log.matchAll(/^(\S+)\s+(start_date|due_date):\s*(.+)$/gm)];
    const startLine = lines.find(
      m => m[2] === "start_date" && (m[3] ?? "").includes("2026-03-06"),
    );
    const dueLine = lines.find(
      m => m[2] === "due_date" && (m[3] ?? "").includes("2026-03-10"),
    );
    expect(startLine).toBeDefined();
    expect(dueLine).toBeDefined();
    // The shared timestamp is the evidence. Positive control: the two
    // seeding `loctt set` calls, which ARE two sequential writes, do
    // not share one.
    expect(startLine?.[1]).toBe(dueLine?.[1]);
    const seedStart = lines.find(m => m[2] === "start_date" && (m[3] ?? "").includes("(none)"));
    const seedDue = lines.find(m => m[2] === "due_date" && (m[3] ?? "").includes("(none)"));
    expect(seedStart?.[1]).not.toBe(seedDue?.[1]);
  });

  // @verifies TML-12
  test("TML-12: drags snap to whole days and show the candidate date live", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=month`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();
    const seen = captureSetDates(page);

    // At month zoom a day is 4px. Move a deliberately non-multiple
    // distance: the result must still be a whole day.
    const p = await barPoints(page, key);
    await page.mouse.move(p.body.x, p.body.y);
    await page.mouse.down();
    await page.mouse.move(p.body.x + 9, p.body.y, { steps: 3 });
    await page.mouse.move(p.body.x + 22, p.body.y, { steps: 3 });

    // The live candidate-date label is what makes a 4px day aimable.
    const label = page.getByTestId("timeline-drag-label");
    await expect(label).toBeVisible();
    const shown = await label.getAttribute("data-start");
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await page.mouse.up();

    // Whole days, with no time component, and the value written is the
    // one the label showed.
    expect(seen.calls).toHaveLength(1);
    const body = seen.calls[0] as { start_date: string; due_date: string };
    expect(body.start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.start_date).toBe(shown);
    await expect
      .poll(async () => (await datesOf(tracker.root, key)).start)
      .toBe(body.start_date);
  });

  // @verifies TML-12
  test("TML-12: releasing without crossing a snap boundary issues no request", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();
    const seen = captureSetDates(page);

    // 6px at day zoom (36px/day) is past the 4px drag threshold but
    // rounds to a zero-day delta — a drag that happened and changed
    // nothing.
    const p = await barPoints(page, key);
    await page.mouse.move(p.body.x, p.body.y);
    await page.mouse.down();
    await page.mouse.move(p.body.x + 5, p.body.y, { steps: 2 });
    await page.mouse.move(p.body.x + 6, p.body.y, { steps: 2 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(seen.calls).toHaveLength(0);
    const after = await datesOf(tracker.root, key);
    expect(after.start).toBe("2026-03-02");
    expect(after.due).toBe("2026-03-06");
  });

  // @verifies TML-17
  test("TML-17: a click that was the tail of a drag does not navigate", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();

    const p = await barPoints(page, key);
    await dragBy(page, p.body, 3 * 36);

    // Still on the timeline — the drag's release must not have been
    // read as a click through to the task.
    await expect(page).toHaveURL(/\/timeline/);
    await expect(page.getByTestId("timeline-toolbar")).toBeVisible();

    // And a genuine click immediately afterwards still navigates: the
    // suppression is consumed by the one click it is about.
    await page.getByTestId(`timeline-bar-${key}`).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${key}$`));
  });

  // @verifies TML-38
  test("TML-38: Esc cancels a drag with no write", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const bar = page.getByTestId(`timeline-bar-${key}`);
    await expect(bar).toBeVisible();
    const boxBefore = (await bar.boundingBox())!;
    const seen = captureSetDates(page);

    const p = await barPoints(page, key);
    await page.mouse.move(p.end.x, p.end.y);
    await page.mouse.down();
    await page.mouse.move(p.end.x + 8, p.end.y, { steps: 2 });
    await page.mouse.move(p.end.x + 5 * 36, p.end.y, { steps: 4 });
    await expect(page.getByTestId("timeline-drag-label")).toBeVisible();

    await page.keyboard.press("Escape");
    await page.mouse.up();

    // The bar returns to its original geometry, and no request went out.
    await expect(page.getByTestId("timeline-drag-label")).toHaveCount(0);
    const boxAfter = (await bar.boundingBox())!;
    expect(Math.abs(boxAfter.width - boxBefore.width)).toBeLessThan(1);
    await page.waitForTimeout(300);
    expect(seen.calls).toHaveLength(0);
    expect((await datesOf(tracker.root, key)).due).toBe("2026-03-06");

    // A subsequent drag on the same bar works normally.
    const p2 = await barPoints(page, key);
    await dragBy(page, p2.end, 2 * 36);
    await expect(bar).toHaveAttribute("data-due", "2026-03-08");
    expect((await datesOf(tracker.root, key)).due).toBe("2026-03-08");
  });

  // @verifies TML-39
  test("TML-39: dragging a bar out and back before release issues no request", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();
    const before = await datesOf(tracker.root, key);
    const seen = captureSetDates(page);

    const p = await barPoints(page, key);
    await page.mouse.move(p.body.x, p.body.y);
    await page.mouse.down();
    await page.mouse.move(p.body.x + 3 * 36, p.body.y, { steps: 5 });
    // ...and back to exactly where it started.
    await page.mouse.move(p.body.x, p.body.y, { steps: 5 });
    await page.mouse.up();

    await page.waitForTimeout(300);
    expect(seen.calls).toHaveLength(0);
    // `updated_at` is not bumped, which is the disk-side half.
    const after = await datesOf(tracker.root, key);
    expect(/^updated_at:.*$/m.exec(after.raw)?.[0])
      .toBe(/^updated_at:.*$/m.exec(before.raw)?.[0]);
  });

  // @verifies TML-36
  test("TML-36: a resize cannot produce a zero-day or backwards bar", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const bar = page.getByTestId(`timeline-bar-${key}`);
    await expect(bar).toBeVisible();

    // Drag the right edge far past the left one.
    const p = await barPoints(page, key);
    await dragBy(page, p.end, -20 * 36);

    // The resize stopped at one day; nothing inverted.
    await expect(bar).toHaveAttribute("data-due", "2026-03-02");
    await expect(bar).toHaveAttribute("data-start", "2026-03-02");
    const after = await datesOf(tracker.root, key);
    expect(after.start).toBe("2026-03-02");
    expect(after.due).toBe("2026-03-02");
    expect(after.start! <= after.due!).toBe(true);
  });

  // @verifies TML-37
  test("TML-37: a refetch landing mid-drag does not move the bar out from under the cursor", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const bar = page.getByTestId(`timeline-bar-${key}`);
    await expect(bar).toBeVisible();
    const seen = captureSetDates(page);

    const p = await barPoints(page, key);
    await page.mouse.move(p.body.x, p.body.y);
    await page.mouse.down();
    await page.mouse.move(p.body.x + 4 * 36, p.body.y, { steps: 5 });
    const midDrag = await bar.getAttribute("data-start");
    expect(midDrag).toBe("2026-03-06");

    // A concurrent CLI edit plus a forced refetch: new data arrives
    // while the pointer is still down.
    await tracker.run(["set", key, "title", "Renamed mid-drag"]);
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); });
    await page.waitForTimeout(400);

    // The bar the user is holding kept its drag geometry.
    await expect(bar).toHaveAttribute("data-start", "2026-03-06");

    await page.mouse.up();

    // And the write used the dates the user saw at release.
    await expect.poll(() => seen.calls.length).toBe(1);
    expect(seen.calls[0]).toEqual({
      start_date: "2026-03-06",
      due_date: "2026-03-10",
    });
  });
});

test.describe("TML — timeline edge cases (section B)", () => {
  // @verifies TML-18
  test("TML-18: a due_date before start_date is flagged, not drawn backwards", async ({ page, tracker }) => {
    const [bad, good] = await tracker.seed([{ title: "Reversed" }, { title: "Normal" }]);
    // Via the CLI, which permits the pair — the case says "hand-edit".
    await tracker.run(["set", bad as string, "start_date", "2026-03-10"]);
    await tracker.run(["set", bad as string, "due_date", "2026-03-04"]);
    await tracker.run(["set", good as string, "start_date", "2026-03-02"]);
    await tracker.run(["set", good as string, "due_date", "2026-03-06"]);

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    // No bar at all for the reversed task — neither backwards, nor
    // zero-width, nor silently swapped to run 03-04 → 03-10.
    await expect(page.getByTestId(`timeline-bar-${bad}`)).toHaveCount(0);

    // An error-styled marker naming the problem.
    const marker = page.getByTestId(`timeline-anomaly-${bad}`);
    await expect(marker).toBeVisible();
    await expect(marker).toHaveAttribute("title", /Due date is before start date/);
    await expect(marker).toHaveAttribute("title", /2026-03-10/);
    await expect(marker).toHaveAttribute("title", /2026-03-04/);

    // The row is still clickable through to detail so the user can fix it.
    await marker.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${bad}$`));
    await page.goBack();

    // The rest of the timeline renders normally.
    await expect(page.getByTestId(`timeline-bar-${good}`)).toBeVisible();
  });

  // @verifies TML-19
  test("TML-19: a start with no due is explicit and distinguishable", async ({ page, tracker }) => {
    const [only, both] = await tracker.seed([{ title: "Start only" }, { title: "Both" }]);
    await tracker.run(["set", only as string, "start_date", "2026-03-02"]);
    await tracker.run(["set", both as string, "start_date", "2026-03-02"]);
    await tracker.run(["set", both as string, "due_date", "2026-03-06"]);

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    // Not drawn as a bar running to an arbitrary "today" or "forever"
    // edge: it has no bar, it is in the Unscheduled lane, and it is
    // visibly distinct from the two-date bar next to it.
    await expect(page.getByTestId(`timeline-bar-${only}`)).toHaveCount(0);
    await expect(page.getByTestId(`timeline-bar-${both}`)).toBeVisible();
    await expect(page.getByTestId(`timeline-unscheduled-row-${only}`)).toBeVisible();

    // The reason is stated, not merely implied by the placement.
    const reason = page.getByTestId(`timeline-unscheduled-reason-${only}`);
    await expect(reason).toBeVisible();
    await expect(reason).toContainText("No due date");
    await expect(reason).toContainText("2026-03-02");

    // Dragging cannot silently invent a due date: there is no bar to
    // grab, so a body-drag the user "thought was a move" is not
    // reachable at all.
    await expect(page.getByTestId(`timeline-bar-${only}`)).toHaveCount(0);
  });

  // @verifies TML-20
  test("TML-20: a due with no start mirrors TML-19", async ({ page, tracker }) => {
    const [only] = await tracker.seed([{ title: "Due only" }]);
    await tracker.run(["set", only as string, "due_date", "2026-03-06"]);

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${only}`)).toHaveCount(0);
    const reason = page.getByTestId(`timeline-unscheduled-reason-${only}`);
    await expect(reason).toContainText("No start date");
    await expect(reason).toContainText("2026-03-06");

    // No `start_date` was backfilled on the way in.
    expect(await readTaskFile(tracker.root, only as string)).not.toMatch(/^start_date:/m);
  });

  // @verifies TML-21
  test("TML-21: a 129-year span at day zoom stays responsive", async ({ page, tracker }) => {
    const [k] = await tracker.seed([{ title: "Epoch spanner" }]);
    await tracker.run(["set", k as string, "start_date", "1970-01-01"]);
    await tracker.run(["set", k as string, "due_date", "2099-12-31"]);

    const began = Date.now();
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId("timeline-toolbar")).toBeVisible();
    // Interaction is possible within a couple of seconds.
    await page.getByTestId("timeline-zoom-day").click();
    expect(Date.now() - began).toBeLessThan(15_000);

    // The bar is a real span, not a zero-width artefact from an
    // overflow: ~47,000 days at 36px.
    const box = await page.getByTestId(`timeline-bar-${k}`).boundingBox();
    expect(box).not.toBeNull();
    const width = await page
      .getByTestId(`timeline-bar-${k}`)
      .evaluate(n => parseFloat((n as HTMLElement).style.width));
    expect(width).toBeGreaterThan(1_000_000);

    // Dates at the far end are correct, not drifted by accumulated
    // floating-point stepping.
    await expect(page.getByTestId(`timeline-bar-${k}`))
      .toHaveAttribute("data-due", "2099-12-31");
  });

  // @verifies TML-22
  test("TML-22: a bar can be dragged to end on a leap day", async ({ page, tracker }) => {
    const [k] = await tracker.seed([{ title: "Leap" }]);
    await tracker.run(["set", k as string, "start_date", "2028-02-20"]);
    await tracker.run(["set", k as string, "due_date", "2028-02-25"]);

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${k}`)).toBeVisible();

    // 2028-02-29 is a real column between 02-28 and 03-01.
    const p = await barPoints(page, k as string);
    await dragBy(page, p.end, 4 * 36);

    // Writes 02-29, not 03-01.
    await expect(page.getByTestId(`timeline-bar-${k}`))
      .toHaveAttribute("data-due", "2028-02-29");
    expect((await datesOf(tracker.root, k as string)).due).toBe("2028-02-29");
  });

  // @verifies TML-24
  test("TML-24: dates are never converted through a timezone", async ({ page, tracker }) => {
    // `start_date` / `due_date` are date strings. A browser 16 hours
    // from the workspace must render the same columns.
    const [k] = await tracker.seed([{ title: "TZ" }]);
    await tracker.run(["set", k as string, "start_date", "2026-03-02"]);
    await tracker.run(["set", k as string, "due_date", "2026-03-06"]);
    await setCalendar(
      tracker.root,
      "timezone: Asia/Tokyo\nfirst_day_of_week: 1\nworking_days: [1,2,3,4,5]\nholidays: []\n",
    );

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const bar = page.getByTestId(`timeline-bar-${k}`);
    await expect(bar).toHaveAttribute("data-start", "2026-03-02");
    const left = await bar.evaluate(n => parseFloat((n as HTMLElement).style.left));
    const width = await bar.evaluate(n => parseFloat((n as HTMLElement).style.width));

    // A drag then writes the same civil dates, with no ±1 day drift.
    const p = await barPoints(page, k as string);
    await dragBy(page, p.body, 2 * 36);
    await expect
      .poll(async () => (await datesOf(tracker.root, k as string)).start)
      .toBe("2026-03-04");
    // The far end too: the due date moved by the same two days, with
    // no ±1 drift from a timezone conversion at either end.
    expect((await datesOf(tracker.root, k as string)).due).toBe("2026-03-08");

    // And the geometry is unchanged in shape — 5 columns, wherever the
    // viewer sits.
    expect(width).toBe(5 * 36);
    expect(Number.isFinite(left)).toBe(true);
  });

  // @verifies TML-29
  test("TML-29: a dangling milestone bands under the key verbatim, not 'No milestone'", async ({ page, tracker }) => {
    const [k, other] = await tracker.seed([{ title: "Orphan" }, { title: "Unset" }]);
    await tracker.run(["milestone", "create", "Ghost"]);
    await tracker.run(["set", k as string, "milestone", "Ghost"]);
    for (const t of [k, other]) {
      await tracker.run(["set", t as string, "start_date", "2026-03-02"]);
      await tracker.run(["set", t as string, "due_date", "2026-03-06"]);
    }
    // Remove the milestone while the task still references it.
    await tracker.run(["milestone", "delete", "Ghost", "--yes"]);

    await page.goto(`${tracker.baseURL}/timeline?zoom=day&grouping=milestone`);

    // The orphan does NOT merge into "No milestone" — that would hide
    // the drift. It gets its own band, and the other task's band is
    // separate.
    await expect(page.getByTestId(`timeline-bar-${k}`)).toBeVisible();
    await expect(page.getByTestId(`timeline-bar-${other}`)).toBeVisible();
    const bandLabels = await page.locator('[data-testid^="timeline-band-"]').allInnerTexts();
    const joined = bandLabels.join(" | ");
    expect(joined).toContain("No milestone");
    // A band labelled with something other than the fallback exists too.
    expect(bandLabels.length).toBeGreaterThan(1);
  });

  // @verifies TML-33
  test("TML-33: a dependency cycle renders all three arrows without hanging", async ({ page, tracker }) => {
    const [a, b, c] = await tracker.seed([{ title: "A" }, { title: "B" }, { title: "C" }]);
    for (const t of [a, b, c]) {
      await tracker.run(["set", t as string, "start_date", "2026-03-02"]);
      await tracker.run(["set", t as string, "due_date", "2026-03-06"]);
    }
    // `blocks` is declared **acyclic** in the default workflow, so core
    // refuses the third link outright ("cannot create cycle in
    // relationship 'blocks'"). That refusal is correct and is not what
    // this case is about: TML-33 asks whether the *renderer* survives a
    // cycle, which can only be posed with a relationship that permits
    // one. `causes` carries no graph constraint, so the cycle is
    // creatable and the arrows question is the one actually being asked.
    await tracker.run(["link", a as string, "causes", b as string]);
    await tracker.run(["link", b as string, "causes", c as string]);
    await tracker.run(["link", c as string, "causes", a as string]);
    await setTimelineConfig(tracker.root, "timeline:\n  dependency_relationship: causes\n  show_arrows: true");

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    // All three edges render — none silently pruned to break the cycle.
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(3);
    // The view did not hang: the toolbar is still interactive.
    await page.getByTestId("timeline-zoom-week").click();
    await expect(page.getByTestId("timeline-zoom-week")).toHaveAttribute("aria-pressed", "true");
  });

  // @verifies TML-34
  test("TML-34: a dangling dependency_relationship gives no arrows plus a notice naming the key", async ({ page, tracker }) => {
    const [a, b] = await seedDated(tracker);
    // Positive control first: with a real key, arrows are drawn and
    // there is no notice — so the absence below means something.
    await setTimelineConfig(tracker.root, "timeline:\n  dependency_relationship: blocks\n  show_arrows: true");
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(1);
    await expect(page.getByTestId("timeline-dependency-config-error")).toHaveCount(0);

    // Now a key that `relationships` does not define.
    await setTimelineConfig(
      tracker.root,
      "timeline:\n  dependency_relationship: blokcs\n  show_arrows: true",
    );
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    // No arrows, no crash — the view still renders its bars.
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(0);
    await expect(page.getByTestId(`timeline-bar-${a}`)).toBeVisible();
    await expect(page.getByTestId(`timeline-bar-${b}`)).toBeVisible();

    // And a visible configuration notice naming the missing key.
    const notice = page.getByTestId("timeline-dependency-config-error");
    await expect(notice).toBeVisible();
    await expect(page.getByTestId("timeline-dependency-missing-key")).toHaveText("blokcs");
    await expect(notice).toContainText("workflow.yaml");

    // The dangling value survives on disk — core no longer deletes the
    // user's line (A31), which is what leaves the typo visible.
    const wf = await readFile(
      path.join(tracker.root, ".loctt", "config", "workflow.yaml"),
      "utf8",
    );
    expect(wf).toContain("blokcs");
  });

  // @verifies TML-34
  test("TML-34: switching the relationship changes which arrows are drawn", async ({ page, tracker }) => {
    const [a, b] = await seedDated(tracker);
    // The pair carries `blocks` already; add a second, different
    // relationship. Not `depends_on` — the default workflow does not
    // define it (measured: "unknown relationship 'depends_on'. Known:
    // blocks, parent, clones, duplicates, causes, relates_to"); the
    // inverse of `blocks` is `is_blocked_by`. `causes` is a genuinely
    // separate forward relationship, which is what the case needs.
    await tracker.run(["link", b as string, "causes", a as string]);

    await setTimelineConfig(tracker.root, "timeline:\n  dependency_relationship: blocks\n  show_arrows: true");
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(1);

    await setTimelineConfig(tracker.root, "timeline:\n  dependency_relationship: causes\n  show_arrows: true");
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    // Still one arrow, and the toggle still works with the new key.
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(1);
    // Scoped to the toolbar: `timeline-arrows` is also the testid of
    // the arrows <svg> inside the chart, so an unscoped locator is a
    // strict-mode violation once any arrow is drawn.
    const toggle = page.getByTestId("timeline-toolbar").getByTestId("timeline-arrows");
    await toggle.uncheck();
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(0);
    await toggle.check();
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(1);
  });

  // @verifies TML-41
  test("TML-41: loading shows a skeleton, and an empty filter names itself", async ({ page, tracker }) => {
    await seedDated(tracker);

    // A held-open response on a COLD load: the skeleton must be what is
    // on screen, not a fully drawn empty timeline that then
    // repopulates. The route is installed before the first navigation
    // to `/timeline`, so nothing is in the query cache to short-circuit
    // the pending state (`useTasksFeed` sets `keepPreviousData`, which
    // would otherwise render the previous result instead of loading).
    let release = (): void => {};
    const held = new Promise<void>(r => { release = () => { r(); }; });
    // Only the *first* request is held; the rest pass straight through.
    // The feed pages itself (A27), so holding every request leaves
    // later ones to be continued after the test released and unrouted,
    // which Playwright rejects as "Route is already handled".
    // Matched on `limit=200`, the timeline's own page size, not on
    // `/api/tasks` generally. Measured: the sidebar fires four
    // `?limit=0&query=…` count requests *before* the feed's
    // `?limit=200&offset=0`, so a first-request gate holds a sidebar
    // counter and lets the feed through — the chart then renders and
    // the skeleton is never on screen.
    let firstOnly = true;
    await page.route(/\/api\/tasks\?.*limit=200/, async route => {
      if (!firstOnly) {
        await route.fallback();
        return;
      }
      firstOnly = false;
      await held;
      await route.fallback();
    });
    const nav = page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    // The skeleton is what the user sees while the feed is in flight —
    // not a fully drawn empty timeline that then repopulates.
    await expect(page.getByTestId("timeline-skeleton")).toBeVisible();
    release();
    await nav;
    await expect(page.getByTestId("timeline-scroll")).toBeVisible();
    await page.unroute(/\/api\/tasks\?.*limit=200/);

    // A filter matching nothing gets an explicit empty state that
    // names the active filter, not a bare date grid.
    // `?status=done` rather than `?q=…`: `q` maps to the server's
    // `query=` DSL parameter, and a bare word there is not a title
    // match — measured returning the full set unfiltered, which would
    // have made this assertion pass or fail for the wrong reason. A
    // status no task holds filters to nothing unambiguously.
    await page.goto(`${tracker.baseURL}/timeline?zoom=day&status=done`);
    await expect(page.getByTestId("timeline-empty")).toBeVisible();
    await expect(page.getByTestId("timeline-empty-filters")).toContainText("status");
    await expect(page.getByTestId("timeline-empty-filters")).toContainText("done");
  });

  // @verifies TML-41
  test("TML-41: a tracker whose tasks all lack dates explains the empty chart", async ({ page, tracker }) => {
    const keys = await tracker.seed([{ title: "No dates 1" }, { title: "No dates 2" }]);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    // Not the "nothing matches" state — there ARE tasks. The chart
    // area is empty and says why, and the lane is populated.
    await expect(page.getByTestId("timeline-empty")).toHaveCount(0);
    await expect(page.getByTestId("timeline-no-dated-tasks")).toBeVisible();
    await expect(page.getByTestId("timeline-unscheduled-count")).toHaveText("(2)");
    await expect(page.getByTestId(`timeline-unscheduled-row-${keys[0]}`)).toBeVisible();
  });
});

test.describe("TML — timeline error cases (section C)", () => {
  // @verifies TML-42
  test("TML-42: a failed resize reverts the bar and names the failure", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const bar = page.getByTestId(`timeline-bar-${key}`);
    await expect(bar).toBeVisible();
    const widthBefore = await bar.evaluate(n => parseFloat((n as HTMLElement).style.width));

    await page.route("**/set-dates", route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "internal",
          message: "The file could not be written.",
          data_state: "not_saved",
        }),
      }),
    );

    const p = await barPoints(page, key);
    await dragBy(page, p.end, 3 * 36);

    // The message names the task, says the due date was not changed,
    // shows what was attempted, and offers retry.
    const err = page.getByTestId("timeline-drag-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(key);
    await expect(err).toContainText("due date was not changed");
    await expect(page.getByTestId("timeline-drag-error-attempted")).toHaveText("2026-03-09");
    await expect(page.getByTestId("timeline-drag-retry")).toBeVisible();

    // The bar is back at its original width — not left rendered at the
    // new one while the file holds the old date.
    await expect.poll(async () =>
      bar.evaluate(n => parseFloat((n as HTMLElement).style.width)),
    ).toBe(widthBefore);

    // And the file confirms the original due date.
    expect((await datesOf(tracker.root, key)).due).toBe("2026-03-06");
  });

  // @verifies TML-43
  test("TML-43: a failed body drag leaves NEITHER date changed", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();

    await page.route("**/set-dates", route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "internal", message: "Disk error.", data_state: "not_saved" }),
      }),
    );

    const p = await barPoints(page, key);
    await dragBy(page, p.body, 4 * 36);

    const err = page.getByTestId("timeline-drag-error");
    await expect(err).toBeVisible();
    // The specific claim: both dates unchanged, not "a date failed".
    await expect(err).toContainText("neither the start date nor the due date was changed");

    // The half-applied shift this case exists to catch: a duration
    // that silently changed. Neither field moved on disk.
    const after = await datesOf(tracker.root, key);
    expect(after.start).toBe("2026-03-02");
    expect(after.due).toBe("2026-03-06");

    // And the bar reverted to its original position AND width.
    const bar = page.getByTestId(`timeline-bar-${key}`);
    await expect(bar).toHaveAttribute("data-start", "2026-03-02");
    await expect(bar).toHaveAttribute("data-due", "2026-03-06");
  });

  // @verifies TML-44
  test("TML-44: connection loss mid-drop is honest, and a reload shows server truth", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();

    await page.route("**/set-dates", route => route.abort("connectionfailed"));

    const p = await barPoints(page, key);
    await dragBy(page, p.end, 3 * 36);

    // States what was attempted and that it was not saved.
    const err = page.getByTestId("timeline-drag-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(key);
    await expect(err).toContainText("due date was not changed");

    // The bar is NOT rendered as a settled new position while the
    // server holds the old one.
    await expect(page.getByTestId(`timeline-bar-${key}`))
      .toHaveAttribute("data-due", "2026-03-06");

    // A reload shows server truth; nothing tentative survives it.
    await page.unroute("**/set-dates");
    await page.reload();
    await expect(page.getByTestId(`timeline-bar-${key}`))
      .toHaveAttribute("data-due", "2026-03-06");
    await expect(page.getByTestId("timeline-drag-error")).toHaveCount(0);

    // After reconnect, the rendered geometry matches the dates on disk.
    const onDisk = await datesOf(tracker.root, key);
    expect(onDisk.due).toBe("2026-03-06");
  });

  // @verifies TML-45
  test("TML-45: a drag that would invert the dates is refused, naming the constraint", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();

    // The client clamps at one day, so the gesture cannot reach an
    // inverted state: dragging the left edge 20 days right lands on
    // the due date, not past it.
    const p = await barPoints(page, key);
    await dragBy(page, p.start, 20 * 36);

    await expect(page.getByTestId(`timeline-bar-${key}`))
      .toHaveAttribute("data-start", "2026-03-06");
    const after = await datesOf(tracker.root, key);
    expect(after.start! <= after.due!).toBe(true);

    // And the server refuses independently, so a client that lost its
    // clamp still cannot write the anomaly. This is the far end of the
    // same constraint, asserted directly against the API.
    const res = await page.request.post(
      `${tracker.baseURL}/api/tasks/${key}/set-dates`,
      {
        headers: { "x-loctt-client": "1" },
        data: { start_date: "2026-03-20" },
      },
    );
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("cannot be after the due date");

    // Nothing was written by the refused call.
    const unchanged = await datesOf(tracker.root, key);
    expect(unchanged.start).toBe(after.start);
    expect(unchanged.due).toBe(after.due);
  });

  // @verifies TML-46
  test("TML-46: a malformed calendar.yaml degrades to an unshaded grid with an explanation", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    // Positive control: with a valid calendar, weekends ARE shaded.
    await setCalendar(
      tracker.root,
      "timezone: UTC\nfirst_day_of_week: 1\nworking_days: [1,2,3,4,5]\nholidays: []\n",
    );
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    // Retried, not read once: the calendar is a separate query, and a
    // one-shot `count()` can run before it resolves — which reads as
    // "no shading" and would make the assertion below meaningless.
    // 2026-03-07 is a Saturday.
    await expect(
      page.locator('[data-testid="timeline-nonworking"][data-date="2026-03-07"]'),
    ).toHaveCount(1);
    await expect(page.getByTestId("timeline-calendar-error")).toHaveCount(0);

    // Out of the 0–6 range.
    await setCalendar(
      tracker.root,
      "timezone: UTC\nfirst_day_of_week: 1\nworking_days: [9]\nholidays: []\n",
    );
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    // The timeline still renders bars and dates.
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();
    await expect(page.getByTestId("timeline-header-cell").first()).toBeVisible();

    // Shading is skipped rather than applied wrongly.
    await expect(page.getByTestId("timeline-nonworking")).toHaveCount(0);

    // A visible notice names the file and says the marker fell back to
    // a documented timezone.
    const notice = page.getByTestId("timeline-calendar-error");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("calendar.yaml");
    await expect(notice).toContainText("UTC");

    // The today-marker is still drawn, not gone.
    await expect(page.getByTestId("timeline-today-marker")).toBeAttached();
  });

  // @verifies TML-47
  test("TML-47: one corrupt task.md does not blank the timeline", async ({ page, tracker }) => {
    const keys = await tracker.seed([{ title: "Good one" }, { title: "Doomed" }]);
    const [good, doomed] = keys as [string, string];
    await tracker.run(["set", good, "start_date", "2026-03-02"]);
    await tracker.run(["set", good, "due_date", "2026-03-06"]);

    // Corrupt the second task's frontmatter.
    const { readdir } = await import("node:fs/promises");
    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const file = path.join(tasksDir, id, "task.md");
      const text = await readFile(file, "utf8");
      if (new RegExp(`^key: ${doomed}$`, "m").test(text)) {
        await writeFile(file, "---\nthis: [is: not: yaml\n---\nbody\n", "utf8");
        break;
      }
    }

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    // Every other task's row and bar renders.
    await expect(page.getByTestId(`timeline-bar-${good}`)).toBeVisible();

    // The failure is surfaced once, naming the file and the problem.
    const notice = page.getByTestId("timeline-unreadable");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("could not be read");
    await expect(notice).toContainText("Check the file");

    // The counts are honest about the unreadable task.
    await expect(page.getByTestId("timeline-total-unreadable")).toContainText("1 unreadable");
  });

  // @verifies TML-48
  test("TML-48: an invalid start_date does not crash the view and is shown verbatim", async ({ page, tracker }) => {
    const keys = await tracker.seed([{ title: "Bad date" }, { title: "Fine" }]);
    const [bad, fine] = keys as [string, string];
    await tracker.run(["set", fine, "start_date", "2026-03-02"]);
    await tracker.run(["set", fine, "due_date", "2026-03-06"]);

    // Hand-edit an unparseable value in — the CLI would reject it.
    const { readdir } = await import("node:fs/promises");
    const tasksDir = path.join(tracker.root, ".loctt", "tasks");
    for (const id of await readdir(tasksDir)) {
      const file = path.join(tasksDir, id, "task.md");
      const text = await readFile(file, "utf8");
      if (new RegExp(`^key: ${bad}$`, "m").test(text)) {
        await writeFile(
          file,
          text.replace(/^(title: .*)$/m, '$1\nstart_date: "next tuesday"'),
          "utf8",
        );
        break;
      }
    }

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);

    // The view did not crash; the healthy bar is there.
    await expect(page.getByTestId(`timeline-bar-${fine}`)).toBeVisible();

    /**
     * Where the invalid task surfaces, and why it is here rather than
     * in the Unscheduled lane.
     *
     * The case's first bullet offers "Unscheduled (**or flagged in
     * place**)". Measured against the real server: a `start_date` of
     * "next tuesday" fails the task schema on read, so `/api/tasks`
     * returns the task not in `items` at all but in `unreadable`, with
     * `reason: "start_date must be YYYY-MM-DD or full ISO-8601
     * timestamp"`. The client is never handed a task carrying the bad
     * value, so it cannot place one in the lane — the flag is the
     * unreadable notice, which is the "flagged" branch.
     *
     * The client-side lane path still exists and is unit-tested
     * (`dateProblem.test.ts`, kind `invalid`); it is what renders this
     * if the API ever starts passing such tasks through. What the case
     * actually requires either way is met here: the task is named, the
     * offending field is named, and no `Invalid Date` leaks anywhere.
     */
    const notice = page.getByTestId("timeline-unreadable");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("start_date");
    await expect(notice).toContainText("YYYY-MM-DD");

    // No `Invalid Date` leaks into a header, tooltip, or bar label.
    expect(await page.locator("body").innerText()).not.toContain("Invalid Date");
    const titles = await page.locator("[title]").evaluateAll(ns =>
      ns.map(n => n.getAttribute("title") ?? ""),
    );
    expect(titles.join(" | ")).not.toContain("Invalid Date");
  });

  // @verifies TML-49
  test("TML-49: a drag on a task deleted elsewhere fails specifically", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${key}`)).toBeVisible();

    // Deleted via the CLI while the page still shows its bar.
    await tracker.run(["delete", key, "--yes"]);

    const p = await barPoints(page, key);
    await dragBy(page, p.end, 3 * 36);

    // The error names the task and says it no longer exists — not the
    // generic "was not saved".
    const err = page.getByTestId("timeline-drag-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(key);
    await expect(err).toContainText("no longer exists");

    // The timeline refetched, so no orphan bar is left rendered.
    await expect(page.getByTestId(`timeline-bar-${key}`)).toHaveCount(0);
  });

  // @verifies TML-50
  test("TML-50: a failed preference write does not lose the user's current zoom", async ({ page, tracker }) => {
    await seedDated(tracker);
    await setTimelineConfig(tracker.root, "timeline:\n  default_zoom: month");

    await page.goto(`${tracker.baseURL}/timeline`);
    await expect(page.getByTestId("timeline-zoom-month")).toHaveAttribute("aria-pressed", "true");

    // Fail every settings-persistence path.
    await page.route("**/api/user-settings", route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "internal", message: "nope", data_state: "not_saved" }),
      }),
    );

    await page.getByTestId("timeline-zoom-day").click();

    // The timeline stays at the zoom the user selected for this
    // session; it does not snap back to the workspace default.
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("timeline-zoom-month")).toHaveAttribute("aria-pressed", "false");
    await expect(page).toHaveURL(/zoom=day/);

    // The zoom survives a re-render driven by other interaction.
    await page.getByTestId("timeline-grouping").selectOption("status");
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("PRU — project scope on the timeline", () => {
  /**
   * PRU-1's third bullet, timeline half: "the timeline's lanes contain
   * only `backend` bars".
   *
   * The case's other three bullets are about the **top-bar project
   * switcher**, which does not exist in the client yet (grepped for a
   * switcher component and a `data-testid="project…"`; neither is
   * present, against a positive control that finds the board's own
   * testid). What is buildable and load-bearing today is the scope
   * itself: that `/timeline?project=…` shows one project's bars and
   * not the other's, and that the *server* filtered rather than the
   * client narrowing a full response. When the switcher lands, its
   * label-on-every-route bullet joins this test.
   */
  // @verifies PRU-1
  test("PRU-1: the timeline is scoped to the active project", async ({ page, tracker }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BACKEND"]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);

    // A task's `project` is immutable after creation (measured:
    // `loctt set … project …` refuses with "cannot set immutable
    // field") — project identity is part of the key, so it is assigned
    // at `create` and only `project remap` moves it. So these are
    // created into their projects rather than assigned afterwards.
    const beKey = (await tracker.run(["create", "Backend work", "--project", "Backend"]))
      .replace(/^Created (\S+):.*$/s, "$1").trim();
    const webKey = (await tracker.run(["create", "Web work", "--project", "Web"]))
      .replace(/^Created (\S+):.*$/s, "$1").trim();
    for (const k of [beKey, webKey]) {
      await tracker.run(["set", k, "start_date", "2026-03-02"]);
      await tracker.run(["set", k, "due_date", "2026-03-06"]);
    }

    // The filter takes the project's **id**, not its name or prefix
    // (measured: `?project=Backend`, `backend` and `BACKEND` all return
    // 0 of 2, the ULID returns 1). Identity is a ULID (P-2), and the
    // switcher will pass the same thing when it lands.
    const projectList = await tracker.run(["project", "list", "--ids"]);
    const beId = /^Backend\t\S+\t(\S+)$/m.exec(projectList)?.[1];
    const webId = /^Web\t\S+\t(\S+)$/m.exec(projectList)?.[1];
    expect(beId).toBeDefined();
    expect(webId).toBeDefined();

    // Unscoped: both bars, so the scoped assertions below mean
    // something rather than passing on an empty tracker.
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId("timeline-total")).toHaveText("2 tasks");

    // Scoped to backend: only the backend bar is charted.
    await page.goto(`${tracker.baseURL}/timeline?zoom=day&project=${beId!}`);
    await expect(page.getByTestId(`timeline-bar-${beKey}`)).toBeVisible();
    await expect(page.getByTestId(`timeline-bar-${webKey}`)).toHaveCount(0);
    await expect(page.getByTestId("timeline-total")).toHaveText("1 task");

    // The *server* filtered — not the client narrowing a full
    // response. Asked directly, the API returns one item.
    const res = await page.request.get(
      `${tracker.baseURL}/api/tasks?project=${beId!}&limit=200`,
    );
    const body = (await res.json()) as { items: { key: string }[]; total: number };
    expect(body.items.map(i => i.key)).toEqual([beKey]);
    expect(body.total).toBe(1);

    // And the other project scopes the other way.
    await page.goto(`${tracker.baseURL}/timeline?zoom=day&project=${webId!}`);
    await expect(page.getByTestId(`timeline-bar-${webKey}`)).toBeVisible();
    await expect(page.getByTestId(`timeline-bar-${beKey}`)).toHaveCount(0);
  });
});

test.describe("TML — remaining section B cases (M3.3b)", () => {
  // @verifies TML-25
  test("TML-25: first_day_of_week drives the week-zoom column boundaries", async ({ page, tracker }) => {
    const [k] = await tracker.seed([{ title: "Week" }]);
    // 2026-03-02 is a Monday, 2026-03-01 a Sunday.
    await tracker.run(["set", k as string, "start_date", "2026-03-02"]);
    await tracker.run(["set", k as string, "due_date", "2026-03-06"]);

    // Monday-start weeks: every header cell begins on a Monday.
    await setCalendar(
      tracker.root,
      "timezone: UTC\nfirst_day_of_week: 1\nworking_days: [1,2,3,4,5]\nholidays: []\n",
    );
    await page.goto(`${tracker.baseURL}/timeline?zoom=week`);
    await expect(page.getByTestId("timeline-header-cell").first()).toBeVisible();
    const mondayStarts = await page
      .getByTestId("timeline-header-cell")
      .evaluateAll(ns => ns.map(n => n.getAttribute("data-date")));
    // The first cell may be a partial week (the range rarely starts on
    // a boundary), so check from the second onwards.
    const mondayDows = mondayStarts
      .slice(1)
      .filter((d): d is string => d !== null)
      .map(d => new Date(`${d}T00:00:00Z`).getUTCDay());
    expect(mondayDows.length).toBeGreaterThan(2);
    expect([...new Set(mondayDows)]).toEqual([1]);

    // Sunday-start weeks: the same header now begins on Sundays, so the
    // geometry re-derives from the configuration rather than a
    // hardcoded week start.
    await setCalendar(
      tracker.root,
      "timezone: UTC\nfirst_day_of_week: 0\nworking_days: [1,2,3,4,5]\nholidays: []\n",
    );
    await page.goto(`${tracker.baseURL}/timeline?zoom=week`);
    await expect(page.getByTestId("timeline-header-cell").first()).toBeVisible();
    const sundayStarts = await page
      .getByTestId("timeline-header-cell")
      .evaluateAll(ns => ns.map(n => n.getAttribute("data-date")));
    const sundayDows = sundayStarts
      .slice(1)
      .filter((d): d is string => d !== null)
      .map(d => new Date(`${d}T00:00:00Z`).getUTCDay());
    expect(sundayDows.length).toBeGreaterThan(2);
    expect([...new Set(sundayDows)]).toEqual([0]);
  });

  // @verifies TML-28
  test("TML-28: a task assigned to a deleted user id gets a labelled band, not a blank one", async ({ page, tracker }) => {
    const [k] = await tracker.seed([{ title: "Orphaned assignee" }]);
    await tracker.run(["set", k as string, "start_date", "2026-03-02"]);
    await tracker.run(["set", k as string, "due_date", "2026-03-06"]);
    await tracker.run(["user", "create", "Ghost User"]);
    await tracker.run(["set", k as string, "assignee", "Ghost User"]);

    // Confirm the task really carries the id before removing the user —
    // otherwise the assertions below would pass on an unassigned task.
    const before = await readTaskFile(tracker.root, k as string);
    const assigneeId = /^assignee:\s*(\S+)$/m.exec(before)?.[1];
    expect(assigneeId).toBeDefined();

    // Delete the user's folder while the task still references the id,
    // which is what the case describes.
    const { readdir, rm } = await import("node:fs/promises");
    const usersDir = path.join(tracker.root, ".loctt", "users");
    for (const entry of await readdir(usersDir)) {
      if (entry === assigneeId) {
        await rm(path.join(usersDir, entry), { recursive: true, force: true });
      }
    }

    await page.goto(`${tracker.baseURL}/timeline?zoom=day&grouping=assignee`);

    // The task is still visible and clickable.
    const bar = page.getByTestId(`timeline-bar-${k}`);
    await expect(bar).toBeVisible();

    // Its band header is not empty — it says *something*, rather than
    // rendering a blank strip.
    const headers = await page
      .locator('[data-testid^="timeline-band-"]')
      .filter({ hasNotText: /^$/ })
      .allInnerTexts();
    expect(headers.length).toBeGreaterThan(0);
    expect(headers.join("").trim().length).toBeGreaterThan(0);
    // Specifically, it is not banded as "Unassigned" — the task does
    // have an assignee, and hiding the drift there is what the case
    // forbids.
    expect(headers.join(" | ")).not.toMatch(/^\s*Unassigned/);

    await bar.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${k}$`));
  });

  // @verifies TML-31
  test("TML-31: a dependency on a task with no bar is badged, not vanished", async ({ page, tracker }) => {
    const keys = await tracker.seed([{ title: "Source" }, { title: "Undrawable target" }]);
    const [src, tgt] = keys as [string, string];
    await tracker.run(["set", src, "start_date", "2026-03-02"]);
    await tracker.run(["set", src, "due_date", "2026-03-06"]);
    // The target is unscheduled, so it has a row in the lane but no bar
    // for an arrow to land on.
    await tracker.run(["link", src, "blocks", tgt]);
    await setTimelineConfig(
      tracker.root,
      "timeline:\n  dependency_relationship: blocks\n  show_arrows: true",
    );

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId(`timeline-bar-${src}`)).toBeVisible();

    // No arrow terminating in empty space.
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(0);
    // But the link did not simply vanish: the source bar is badged.
    const badge = page.getByTestId(`timeline-offscreen-dep-${src}`);
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute("title", /not shown/);

    // Giving the target dates makes it drawable, and the full arrow
    // appears — the badge's condition is the target's drawability, not
    // a permanent mark on the source.
    await tracker.run(["set", tgt, "start_date", "2026-03-09"]);
    await tracker.run(["set", tgt, "due_date", "2026-03-11"]);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(1);
    await expect(page.getByTestId(`timeline-offscreen-dep-${src}`)).toHaveCount(0);
  });

  // @verifies TML-35
  test("TML-35: a same-day dependency still draws a visible arrow", async ({ page, tracker }) => {
    const keys = await tracker.seed([{ title: "Co-located A" }, { title: "Co-located B" }]);
    const [a, b] = keys as [string, string];
    // Identical dates: the two bars sit exactly on top of each other
    // horizontally, which is where a naive straight-line arrow
    // degenerates to zero length.
    for (const t of [a, b]) {
      await tracker.run(["set", t, "start_date", "2026-03-02"]);
      await tracker.run(["set", t, "due_date", "2026-03-06"]);
    }
    await tracker.run(["link", a, "blocks", b]);
    await setTimelineConfig(
      tracker.root,
      "timeline:\n  dependency_relationship: blocks\n  show_arrows: true",
    );

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const arrow = page.getByTestId("timeline-arrow");
    await expect(arrow).toHaveCount(1);

    // Not a zero-length artefact: the path has real horizontal extent
    // (the `Math.max` stub routes it around rather than doubling back
    // through the bars) and real vertical extent (the two rows differ).
    const d = await arrow.getAttribute("d");
    expect(d).toBeTruthy();
    const nums = (d ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    expect(nums.length).toBeGreaterThanOrEqual(4);
    const box = await arrow.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.width ?? 0) + (box?.height ?? 0)).toBeGreaterThan(1);
  });

  // @verifies TML-40
  test("TML-40: bar dates can be changed from the keyboard, with one write", async ({ page, tracker }) => {
    const key = await seedOne(tracker);
    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const bar = page.getByTestId(`timeline-bar-${key}`);
    await expect(bar).toBeVisible();
    const seen = captureSetDates(page);

    // The bar is focusable, and announces its current dates.
    await bar.focus();
    await expect(bar).toBeFocused();
    await expect(bar).toHaveAttribute("aria-label", /2026-03-02 to 2026-03-06/);

    // Right shifts the whole bar one day, in ONE atomic two-field
    // write — the same semantics TML-11 requires of the mouse.
    await page.keyboard.press("ArrowRight");
    await expect(bar).toHaveAttribute("data-start", "2026-03-03");
    await expect.poll(() => seen.calls.length).toBe(1);
    expect(seen.calls[0]).toEqual({ start_date: "2026-03-03", due_date: "2026-03-07" });
    await expect
      .poll(async () => (await datesOf(tracker.root, key)).start)
      .toBe("2026-03-03");

    // Shift+Right resizes the due edge only — one field, as TML-9.
    await bar.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(bar).toHaveAttribute("data-due", "2026-03-08");
    await expect.poll(() => seen.calls.length).toBe(2);
    expect(seen.calls[1]).toEqual({ due_date: "2026-03-08" });

    // Alt+Right resizes the start edge only — one field, as TML-10.
    await bar.focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(bar).toHaveAttribute("data-start", "2026-03-04");
    await expect.poll(() => seen.calls.length).toBe(3);
    expect(seen.calls[2]).toEqual({ start_date: "2026-03-04" });

    // The announcement tracks the change.
    await expect(bar).toHaveAttribute("aria-label", /2026-03-04 to 2026-03-08/);
    const onDisk = await datesOf(tracker.root, key);
    expect(onDisk.start).toBe("2026-03-04");
    expect(onDisk.due).toBe("2026-03-08");
  });
});
