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
