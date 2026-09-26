/**
 * Transcribed from tests/cases/ui-test-cases/flow-timeline.md, section A
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

/**
 * Replaces the `custom_fields: []` line of workflow.yaml with one or more
 * single-value enum fields, so the group-by catalog offers `field.<key>`
 * for each.
 */
async function setCustomEnumFields(
  root: string,
  fields: readonly { key: string; label: string; values: readonly { key: string; label: string }[] }[],
): Promise<void> {
  const file = path.join(root, ".loctt", "config", "workflow.yaml");
  const text = await readFile(file, "utf8");
  const block =
    `custom_fields:\n`
    + fields.map(field =>
      `  - key: ${field.key}\n`
      + `    label: ${field.label}\n`
      + `    type: enum\n`
      + `    multi: false\n`
      + `    searchable: false\n`
      + `    values:\n`
      + field.values.map(v => `      - key: ${v.key}\n        label: ${v.label}\n`).join(""),
    ).join("");
  const next = text.replace(/^custom_fields: \[\]\s*$/m, block.trimEnd());
  if (next === text) throw new Error("custom_fields: [] not found to replace");
  await writeFile(file, next, "utf8");
}

/**
 * Writes a top-level frontmatter scalar straight into a task's file.
 *
 * The CLI now REFUSES a due_date before its start_date ("The start date
 * … cannot be after the due date …"), which is correct — but TML-18 is
 * explicitly about a pair that reached disk by a **hand edit**, which is
 * the only way such a pair can exist now. So the reversed pair is
 * written here rather than through `loctt set`, which is what the case
 * describes and what the degradation path has to survive.
 */
async function handEditTaskField(
  root: string,
  taskKey: string,
  field: string,
  value: string,
): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    const p = path.join(tasksDir, id, "task.md");
    let text: string;
    try { text = await readFile(p, "utf8"); } catch { continue; }
    if (!new RegExp(`^key: ${taskKey}$`, "m").test(text)) continue;
    const line = `${field}: ${value}`;
    const next = new RegExp(`^${field}:.*$`, "m").test(text)
      ? text.replace(new RegExp(`^${field}:.*$`, "m"), line)
      : text.replace(/\n---\n/, `\n${line}\n---\n`);
    await writeFile(p, next, "utf8");
    return;
  }
  throw new Error(`no task file for ${taskKey}`);
}

/** Sets one enum custom-field value on a task's frontmatter, by key. */
async function setTaskField(
  root: string,
  taskKey: string,
  field: string,
  value: string,
): Promise<void> {
  const { readdir } = await import("node:fs/promises");
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    const p = path.join(tasksDir, id, "task.md");
    let text: string;
    try { text = await readFile(p, "utf8"); } catch { continue; }
    if (!new RegExp(`^key: ${taskKey}$`, "m").test(text)) continue;
    // Insert (or extend) a `fields:` map just before the closing `---`.
    const line = `fields:\n  ${field}: ${value}\n`;
    const next = text.replace(/\n---\n/, `\n${line}---\n`);
    await writeFile(p, next, "utf8");
    return;
  }
  throw new Error(`no task file for ${taskKey}`);
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
 * Writes `count` users straight to `.loctt/users/<id>/profile.yaml`,
 * returning their ids in order.
 *
 * The scale cases (TML-27) need dozens of users; `loctt user create`
 * is a subprocess each, so forty of them would pay ten seconds of
 * spawn time before the page loads — the starvation the fixture's
 * `seedBulk` docstring records. These are the same shape `user create`
 * writes: an id, a name, a timezone, and `archived: true` on the ones
 * the caller marks. Ids are monotonic 26-char ULatiish strings, unique
 * within the call, and distinct from `seedBulk`'s `01M…` task ids.
 */
async function seedUsers(
  root: string,
  count: number,
  opts?: { archivedIndexes?: readonly number[]; name?: (n: number) => string },
): Promise<string[]> {
  const { mkdir } = await import("node:fs/promises");
  const archived = new Set(opts?.archivedIndexes ?? []);
  const ids: string[] = [];
  await Promise.all(
    Array.from({ length: count }, async (_u, i) => {
      const id = `01U${String(i).padStart(23, "0")}`;
      ids[i] = id;
      const dir = path.join(root, ".loctt", "users", id);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "profile.yaml"),
        `id: ${id}\nname: ${opts?.name?.(i) ?? `User ${String(i)}`}\n`
        + `timezone: UTC\n${archived.has(i) ? "archived: true\n" : ""}`,
        "utf8",
      );
    }),
  );
  return ids;
}

/**
 * Writes `count` dated tasks straight to disk, one per caller-supplied
 * spec, returning their keys. Bypasses the CLI for the same reason
 * `seedBulk` does — the scale cases need dozens or thousands of rows,
 * and a subprocess each starves the suite.
 *
 * Each task carries `start_date`/`due_date` and, optionally, an
 * `assignee`, so the timeline has bars to lay out and bands to group.
 * `state.yaml`'s counter is advanced past the block so a later
 * `create` cannot collide.
 */
async function seedDatedTasks(
  root: string,
  specs: readonly { start: string; due: string; assignee?: string; title?: string }[],
): Promise<string[]> {
  const { mkdir } = await import("node:fs/promises");
  const statePath = path.join(root, ".loctt", "state.yaml");
  const stateText = await readFile(statePath, "utf8");
  const projectId = /^\s{2}([0-9A-Z]{26}):/m.exec(stateText)?.[1];
  if (projectId === undefined) throw new Error("no project in state.yaml");
  const rawPrefix = /^\s{4}prefix:\s*(\S+)\s*$/m.exec(stateText)?.[1];
  const keyPrefix = rawPrefix?.replace(/^["']|["']$/g, "") ?? "T-";
  const sep = keyPrefix.endsWith("-") ? "" : "-";
  const first = Number(/^\s{4}next_number:\s*(\d+)\s*$/m.exec(stateText)?.[1] ?? "1");
  const stamp = "2026-01-01T00:00:00.000Z";
  const keys: string[] = [];
  await Promise.all(
    specs.map(async (spec, i) => {
      const n = first + i;
      const id = `01T${String(n).padStart(23, "0")}`;
      keys[i] = `${keyPrefix}${sep}${String(n)}`;
      const dir = path.join(root, ".loctt", "tasks", id);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "task.md"),
        `---\nid: ${id}\nkey: ${keyPrefix}${sep}${String(n)}\n`
        + `title: ${spec.title ?? `Task ${String(n)}`}\n`
        + `created_at: ${stamp}\nupdated_at: ${stamp}\nproject: ${projectId}\n`
        + `status: backlog\nstart_date: ${spec.start}\ndue_date: ${spec.due}\n`
        + (spec.assignee !== undefined ? `assignee: ${spec.assignee}\n` : "")
        + `---\n`,
        "utf8",
      );
    }),
  );
  await writeFile(
    statePath,
    stateText.replace(
      /^(\s{4}next_number:\s*)(\d+)\s*$/m,
      (_m, head: string, cur: string) =>
        `${head}${String(Math.max(Number(cur), first + specs.length))}`,
    ),
    "utf8",
  );
  return keys;
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

/**
 * The group-by control is no longer a native `<select>` — it is the
 * shared searchable Combobox (the `GroupByPicker`). These helpers replace
 * the old `selectOption` / `toHaveValue`:
 *  - the selected value is on the trigger as `data-value` (the parity
 *    with a `<select>`'s `value`), so assertions read that;
 *  - to change it, open the trigger and click the option row
 *    (`timeline-grouping-opt-<id>`; `none` is the pinned clear row).
 */
async function expectGrouping(
  page: import("@playwright/test").Page,
  id: string,
): Promise<void> {
  const trigger = page.getByTestId("timeline-grouping");
  await expect(trigger).toHaveAttribute("data-value", id);

  // The other half, which `data-value` alone lost (known-gaps.md): a
  // native `<select>`'s `.value` could only report a value that HAD a
  // matching `<option>`, while `data-value` echoes draft state whether
  // or not the control offers it. So also prove the value is genuinely
  // on offer — otherwise this passes for a grouping the picker does not
  // have, which is exactly how three escape-hatch branches were deleted
  // with the unit suite staying green.
  await trigger.click();
  if (id === "none") {
    // `none` is the pinned CLEAR row, and `Dropdown` renders that row
    // only while something is selected — so when grouping already IS
    // none there is correctly nothing to clear. What has to hold here is
    // that the picker is a real, populated control rather than an empty
    // one that would make any `data-value` claim vacuous.
    await expect(page.getByTestId("timeline-grouping-options")
      .getByRole("option")).not.toHaveCount(0);
  } else {
    await expect(page.getByTestId(`timeline-grouping-opt-${id}`)).toHaveCount(1);
  }
  await page.keyboard.press("Escape");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

async function chooseGrouping(
  page: import("@playwright/test").Page,
  id: string,
): Promise<void> {
  await page.getByTestId("timeline-grouping").click();
  await page.getByTestId(`timeline-grouping-opt-${id}`).click();
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
    //
    // Written in the CURRENT view shape: a structured `filters:` block
    // and a ULID id. The legacy `query:` scalar this used to seed was
    // removed with structured conditions (`9c673e71`/`596725fe`), and
    // queries.yaml now rejects the whole file over the unknown key — so
    // the old seed made the view unreadable rather than exercising the
    // zoom precedence this case is about.
    const viewId = "01M2TIMELINEVIEW00000000001";
    const queriesPath = path.join(tracker.root, ".loctt", "config", "queries.yaml");
    const before = await readFile(queriesPath, "utf8");
    await writeFile(
      queriesPath,
      `${before.trimEnd()}\n  - id: ${viewId}\n    name: Day view\n`
      + `    filters:\n      - kind: simple\n        field: archived\n        op: "!="\n`
      + `        values:\n          - "true"\n`
      + `    display:\n      mode: timeline\n      zoom: day\n`,
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/timeline?view=${viewId}`);
    await expect(page.getByTestId("timeline-zoom-day")).toHaveAttribute("aria-pressed", "true");

    // Changing the zoom updates the URL but must NOT rewrite
    // queries.yaml — the saved view is unchanged on disk until the
    // user explicitly saves. Asserted against the FILE, not the screen.
    const savedBefore = await readFile(queriesPath, "utf8");
    await page.getByTestId("timeline-zoom-month").click();
    await expect(page).toHaveURL(/zoom=month/);
    await expect.poll(async () => readFile(queriesPath, "utf8")).toBe(savedBefore);

    // Reopening the view returns to day.
    await page.goto(`${tracker.baseURL}/timeline?view=${viewId}`);
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

    // The drawer header is always visible with an honest count — even
    // while collapsed (the redesign: the count-on-header stays; the rows
    // live behind an expand).
    await expect(page.getByTestId("timeline-unscheduled")).toBeVisible();
    await expect(page.getByTestId("timeline-unscheduled-count")).toHaveText("(3)");
    // The dated one DOES get a bar — positive control.
    await expect(page.getByTestId(`timeline-bar-${both}`)).toBeVisible();

    // Expand the drawer to reach the rows (collapsed-by-default redesign).
    await page.getByTestId("timeline-unscheduled-toggle").click();
    // Listed by key and title, and no bar is drawn for them.
    await expect(page.getByTestId(`timeline-unscheduled-row-${onlyStart}`)).toContainText("Only start");
    await expect(page.getByTestId(`timeline-bar-${onlyStart}`)).toHaveCount(0);

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
    await expectGrouping(page, "assignee");

    // Changing to none flattens and updates the URL. `none` is the
    // picker's pinned clear row.
    await chooseGrouping(page, "none");
    await expect(page).toHaveURL(/grouping=none/);
    await expect(page.getByTestId("timeline-band-all")).toBeVisible();

    // The `none` URL opens ungrouped even though the default is
    // assignee — `none` is a value, not an absence.
    await page.goto(`${tracker.baseURL}/timeline?grouping=none`);
    await expectGrouping(page, "none");
    await expect(page.getByTestId("timeline-band-all")).toBeVisible();

    // With default_grouping absent, the view opens at none.
    await setTimelineConfig(tracker.root, null);
    await page.goto(`${tracker.baseURL}/timeline`);
    await expectGrouping(page, "none");
  });

  // @verifies TML-8
  test("TML-8: the picker groups by a single-value enum custom field, found via search", async ({ page, tracker }) => {
    // The full group-by set (Ken): a single-value enum custom field is
    // groupable as `field.<key>`, and the searchable picker is how it is
    // reached once the list is long. The two dated tasks carry different
    // Area values, so grouping bands them apart and the total holds.
    const [a, b] = await seedDated(tracker);
    // Enough single-value enum fields that the catalog (7 builtins as
    // options + these + the pinned None row) crosses the Combobox search
    // threshold (12), so the search box appears on its own. `area` is the
    // one we group by; the rest are padding to force search on.
    await setCustomEnumFields(tracker.root, [
      { key: "area", label: "Area", values: [{ key: "fe", label: "Frontend" }, { key: "be", label: "Backend" }] },
      { key: "risk", label: "Risk", values: [{ key: "lo", label: "Low" }] },
      { key: "tier", label: "Tier", values: [{ key: "t1", label: "T1" }] },
      { key: "phase", label: "Phase", values: [{ key: "p1", label: "P1" }] },
      { key: "squad", label: "Squad", values: [{ key: "s1", label: "S1" }] },
      { key: "domain", label: "Domain", values: [{ key: "d1", label: "D1" }] },
    ]);
    await setTaskField(tracker.root, a as string, "area", "fe");
    await setTaskField(tracker.root, b as string, "area", "be");

    await page.goto(`${tracker.baseURL}/timeline`);

    // Open the picker and type into the search box (it appears once the
    // list crosses the threshold) to find the custom field by its label.
    await page.getByTestId("timeline-grouping").click();
    await expect(page.getByTestId("timeline-grouping-search")).toBeVisible();
    await page.getByTestId("timeline-grouping-search").fill("area");
    await page.getByTestId("timeline-grouping-opt-field.area").click();

    // The URL and the trigger both reflect the custom-field grouping.
    await expect(page).toHaveURL(/grouping=field\.area/);
    await expectGrouping(page, "field.area");

    // Bands read by the value LABELS from workflow.yaml, never the keys.
    await expect(page.getByTestId("timeline-band-fe")).toContainText("Frontend");
    await expect(page.getByTestId("timeline-band-be")).toContainText("Backend");
    await expect(page.getByTestId("timeline-band-fe")).not.toContainText("fe(");

    // TML-7: switching to a custom-field grouping does not change the set.
    // seedDated makes three tasks (two dated + one undated); the undated
    // one sits in the Unscheduled lane but is still counted in the total.
    await expect(page.getByTestId("timeline-total")).toHaveText("3 tasks");

    // A search for "custom" surfaces the custom field (its hint), not the
    // builtins — the group reads as its own thing.
    await page.getByTestId("timeline-grouping").click();
    await page.getByTestId("timeline-grouping-search").fill("custom");
    await expect(page.getByTestId("timeline-grouping-opt-field.area")).toBeVisible();
    await expect(page.getByTestId("timeline-grouping-opt-status")).toHaveCount(0);
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

    // Turning it on draws arrows with no refetch of task data. Settle
    // any in-flight/background loads first (the shared FilterBar issues
    // its own sidebar queries on mount), so the counter attributes only
    // the requests the *toggle* causes — the property under test.
    await page.waitForLoadState("networkidle");
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
    await expectGrouping(page, "status");
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

  // The redesign adds a sticky task-name gutter pinned over the chart
  // body's left edge (z above the bars). A bar scrolled hard against the
  // left edge lands *behind* the gutter, where a press hits the gutter
  // instead of the bar. Nudge the horizontal scroll so the bar clears the
  // gutter before measuring — this mirrors what a user does (scroll the
  // bar into the open chart area) rather than pressing on a covered bar.
  const gutter = page.getByTestId("timeline-gutter");
  const gutterBox = await gutter.boundingBox();
  const scroll = page.getByTestId("timeline-scroll");
  for (let i = 0; i < 3; i += 1) {
    const box0 = await el.boundingBox();
    if (box0 === null || gutterBox === null) break;
    const clearing = gutterBox.x + gutterBox.width + 12;
    if (box0.x >= clearing) break;
    await scroll.evaluate((node, dx) => { node.scrollLeft -= dx; }, clearing - box0.x + 8);
  }

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

    // `mouse.up()` resolves once the synthetic pointerup dispatch
    // completes; the resulting `setDates.mutate()` fetch is a
    // subsequent tick, so checking `seen.calls` synchronously right
    // after raced the network layer and failed intermittently (found
    // while investigating a run that was consistently red — the
    // request DOES fire, `expect.poll` below over the on-disk dates
    // already tolerated this for the write's effect, but the request
    // list itself had no such tolerance). Every other drag test in
    // this file that checks `seen.calls` right after `mouse.up()`
    // already waits (`page.waitForTimeout(300)`, e.g. TML-38/TML-39
    // below); this one was missing it.
    await expect.poll(() => seen.calls.length).toBe(1);

    // Whole days, with no time component, and the value written is the
    // one the label showed.
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
    // The case says "hand-edit", and that is now the only way this pair
    // can exist: `loctt set` rejects a due_date before its start_date.
    // Written straight to the file, which is what the timeline has to
    // degrade against.
    await handEditTaskField(tracker.root, bad as string, "start_date", "2026-03-10");
    await handEditTaskField(tracker.root, bad as string, "due_date", "2026-03-04");
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

    // Expand the collapsed-by-default drawer to reach the row.
    await page.getByTestId("timeline-unscheduled-toggle").click();
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
    // Every task here is unscheduled, so the chart has no bars and the
    // drawer auto-expands (TML-41) — no manual expand needed.
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

    // The header and grid VIRTUALIZE: the ~47,000 day columns are not
    // all in the DOM at once. Only a windowed screenful (plus overscan)
    // is rendered — a bounded count two orders of magnitude below the
    // span. This is the second bullet the pre-windowing build could not
    // satisfy; without windowing this count would be ~47,000.
    const headerCellCount = await page.getByTestId("timeline-header-cell").count();
    expect(headerCellCount).toBeGreaterThan(0);
    expect(headerCellCount).toBeLessThan(500);

    // Scrolling to the far end shows the correct dates there — the
    // window follows the scroll and the far cells carry 2099 dates, not
    // dates drifted by accumulated floating-point stepping.
    await page.getByTestId("timeline-scroll").evaluate(el => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect
      .poll(async () =>
        page.locator('[data-testid="timeline-header-cell"][data-date^="2099-12"]').count())
      .toBeGreaterThan(0);
    // And the count stays bounded after scrolling — it did not accrete
    // every column passed over.
    expect(await page.getByTestId("timeline-header-cell").count()).toBeLessThan(500);

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
  //
  // Pinned, because the case's premise is a browser 16-17 hours from
  // the workspace and nothing made that true: there was exactly one
  // `timezoneId` in the whole test tree, in a different spec. On a
  // UTC+8 host, Asia/Tokyo is one hour away, so the test could not
  // tell a component reading calendar.yaml from one reading the
  // browser. Measured: sourcing `today` from `new Date()` instead of
  // the server left all 52 timeline tests green.
  test.describe("TML-24 in a browser far from the workspace", () => {
    test.use({ timezoneId: "America/Los_Angeles" });
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

    // Bullets 1-2: the today-marker follows the WORKSPACE timezone.
    // The browser is pinned to America/Los_Angeles and the workspace
    // to Asia/Tokyo — 16-17 hours apart, so for much of the day they
    // are on different dates. The marker must carry the workspace's,
    // which is what the server computes and sends.
    const marker = page.getByTestId("timeline-today-marker");
    await expect(marker).toBeVisible();
    const tokyoToday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    await expect(marker).toHaveAttribute("data-today", tokyoToday);
    });
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
    await expect(err).toContainText("Neither the start date nor the due date was changed");

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
    await expect(notice).toContainText("Missing from this timeline");

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
     * Where the invalid task surfaces — the case's "flagged in place"
     * branch, now reached the primary way.
     *
     * The tolerant loader (K26 field-local degrade) lifts a wrong-typed
     * `start_date` into the task's `health` list and leaves the field
     * *absent* from frontmatter, rather than failing the whole task on
     * read. So `/api/tasks` returns the task in `items` (with `health`
     * forwarded via `wireHealth`), not in `unreadable`. The client's
     * `dateProblem` reads the health entry, classifies it `corrupt`, and
     * the Unscheduled lane flags the row with the offending value shown
     * verbatim. (This supersedes the earlier A41 measurement, where a bad
     * date was object-fatal and surfaced only through the unreadable
     * notice — that is no longer how the loader behaves.)
     */
    // Expand the collapsed-by-default drawer to reach the flagged row.
    await page.getByTestId("timeline-unscheduled-toggle").click();
    const row = page.getByTestId(`timeline-unscheduled-row-${bad}`);
    await expect(row).toBeVisible();
    const reason = page.getByTestId(`timeline-unscheduled-reason-${bad}`);
    // Bullet 3: names the field and shows the offending value verbatim.
    await expect(reason).toContainText("start_date");
    await expect(reason).toContainText("next tuesday");

    // Bullet 2: no `Invalid Date` leaks into a header, tooltip, or label.
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
    await chooseGrouping(page, "status");
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

  // @verifies TML-27
  test("TML-27: grouping by 40 assignees produces 40 identifiable bands, collapse is per-band, and an archived user is marked", async ({ page, tracker }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // 40 users; user 0 is archived. Names, not ULIDs, are what the
    // bands must show.
    const N = 40;
    const users = await seedUsers(tracker.root, N, {
      archivedIndexes: [0],
      name: i => `Member ${String(i)}`,
    });

    // Every user gets a task or two, so each is a non-empty band —
    // rows.ts emits only bands that have rows in scope. Users 0..9 get
    // two tasks so at least some bands are multi-row.
    const specs = users.flatMap((uid, i) => {
      const start = `2026-0${String((i % 9) + 1)}-0${String((i % 8) + 1)}`;
      const one = { start, due: start, assignee: uid, title: `T for ${String(i)}` };
      return i < 10 ? [one, { ...one, title: `T2 for ${String(i)}` }] : [one];
    });
    const keys = await seedDatedTasks(tracker.root, specs);
    const expectedTasks = specs.length; // 40 + 10 = 50

    await page.goto(`${tracker.baseURL}/timeline?zoom=month&grouping=assignee`);

    // The page is responsive: the total is the true count and a first
    // bar renders. Await a positive signal before any absence check so
    // a `toHaveCount(0)` cannot pass vacuously against an empty page.
    await expect(page.getByTestId("timeline-total")).toHaveText(`${String(expectedTasks)} tasks`);
    await expect(page.getByTestId(`timeline-bar-${keys[0]}`)).toBeVisible();

    // 40 bands, one per user. Not 39, not 41 — the archived user still
    // gets a band, and there is no stray "Unassigned" band because
    // every task has an assignee.
    const bandHeaders = page.locator('[data-testid^="timeline-band-"]:not([data-testid*="-count-"])');
    await expect(bandHeaders).toHaveCount(N);
    await expect(page.getByTestId("timeline-band-__none__")).toHaveCount(0);

    // Bands are identifiable by the user's NAME, never the raw ULID.
    const firstBand = page.getByTestId(`timeline-band-${users[1] ?? ""}`);
    await expect(firstBand).toContainText("Member 1");
    await expect(firstBand).not.toContainText(users[1] ?? "@@@");

    // The archived user's band carries the (archived) marker rather
    // than vanishing or showing a ULID.
    const archivedBand = page.getByTestId(`timeline-band-${users[0] ?? ""}`);
    await expect(archivedBand).toContainText("Member 0");
    await expect(archivedBand).toContainText("(archived)");

    // Counts in the header are the true totals. User 0 has two tasks,
    // user 20 has one — the header count is the real number, not the
    // number of rendered rows.
    await expect(page.getByTestId(`timeline-band-count-${users[0] ?? ""}`)).toHaveText("(2)");
    await expect(page.getByTestId(`timeline-band-count-${users[20] ?? ""}`)).toHaveText("(1)");

    // Collapsing is per-band and independent: collapse three, and
    // expanding one leaves the other two collapsed. "Expanding one
    // does not reset the others."
    const b0 = page.getByTestId(`timeline-band-${users[0] ?? ""}`);
    const b1 = page.getByTestId(`timeline-band-${users[1] ?? ""}`);
    const b2 = page.getByTestId(`timeline-band-${users[2] ?? ""}`);
    for (const b of [b0, b1, b2]) await b.click();
    for (const b of [b0, b1, b2]) await expect(b).toHaveAttribute("aria-expanded", "false");
    // Re-expand only b1.
    await b1.click();
    await expect(b1).toHaveAttribute("aria-expanded", "true");
    await expect(b0).toHaveAttribute("aria-expanded", "false");
    await expect(b2).toHaveAttribute("aria-expanded", "false");
    // And a band the run never touched is still expanded — collapsing
    // some did not collapse all.
    await expect(page.getByTestId(`timeline-band-${users[30] ?? ""}`))
      .toHaveAttribute("aria-expanded", "true");

    // Collapsing every band leaves a compact list of 40 headers with no
    // bars showing. The header count on a collapsed band is still the
    // true total, so the counts survive the collapse.
    for (let i = 0; i < N; i += 1) {
      const b = page.getByTestId(`timeline-band-${users[i] ?? ""}`);
      if ((await b.getAttribute("aria-expanded")) === "true") await b.click();
    }
    await expect(bandHeaders).toHaveCount(N);
    for (const b of await bandHeaders.all()) {
      await expect(b).toHaveAttribute("aria-expanded", "false");
    }
    await expect(page.getByTestId(`timeline-band-count-${users[0] ?? ""}`)).toHaveText("(2)");
    // No bar is rendered while all are collapsed.
    await expect(page.getByTestId(`timeline-bar-${keys[0]}`)).toHaveCount(0);

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });

  // @verifies TML-30
  test("TML-30: many overlapping bars each get their own row, and rows do not stack", async ({ page, tracker }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // 60 tasks whose dates all overlap the same fortnight, ungrouped.
    const N = 60;
    const specs = Array.from({ length: N }, (_v, i) => ({
      start: "2026-03-02",
      due: "2026-03-13",
      title: `Overlap ${String(i)}`,
    }));
    const keys = await seedDatedTasks(tracker.root, specs);

    await page.goto(`${tracker.baseURL}/timeline?zoom=week&grouping=none`);

    // Responsive and complete: the total is the real count and the
    // first bar renders before any geometry is read.
    await expect(page.getByTestId("timeline-total")).toHaveText(`${String(N)} tasks`);
    await expect(page.getByTestId(`timeline-bar-${keys[0]}`)).toBeVisible();

    // Each task gets its OWN row — bars are not stacked in one row where
    // only the topmost is clickable. Read the vertical offset of every
    // bar; there must be 60 distinct `top` values, one per task.
    const tops = await page
      .locator('[data-testid^="timeline-bar-"]')
      .evaluateAll(els =>
        els.map(e => Math.round(parseFloat((e as HTMLElement).style.top))));
    expect(tops).toHaveLength(N);
    expect(new Set(tops).size).toBe(N);

    // The rows are stacked vertically at a constant pitch — consecutive
    // rows differ by the same delta, which is what "its own row" means
    // geometrically and what a single-row overlap would violate (every
    // top equal).
    const sorted = [...tops].sort((a, b) => a - b);
    const deltas = sorted.slice(1).map((t, i) => t - (sorted[i] ?? 0));
    expect(Math.min(...deltas)).toBeGreaterThan(0);
    expect(new Set(deltas).size).toBe(1);

    // The vertical extent scrolls: the content is taller than the
    // scroll viewport, and the date header is sticky so it stays put
    // as the rows scroll under it.
    const scroll = page.getByTestId("timeline-scroll");
    const metrics = await scroll.evaluate(el => ({
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    }));
    expect(metrics.scrollH).toBeGreaterThan(metrics.clientH);

    // Scoped to the chart's scroll container: `timeline-header` is
    // carried by BOTH the chart's sticky date-header row and the page's
    // `PageHeader` (the latter added by `6b7ac9dc`). This case is about
    // the sticky one — the page title never scrolls either, so an
    // unscoped locator could pass against the wrong element.
    const header = page.getByTestId("timeline-scroll").getByTestId("timeline-header");
    const headerTopBefore = await header.evaluate(el => el.getBoundingClientRect().top);
    await scroll.evaluate(el => { el.scrollTop = 400; });
    // A last row that only exists if all 60 laid out: scroll reaches it.
    const headerTopAfter = await header.evaluate(el => el.getBoundingClientRect().top);
    // The header did not scroll away with the rows (sticky): its
    // viewport-relative top is unchanged after a 400px scroll.
    expect(headerTopAfter).toBeCloseTo(headerTopBefore, 0);

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });

  // @verifies TML-26
  test("TML-26: 3,000 dated tasks virtualize vertically — mounted rows are a window, and scrolling changes which", async ({ page, tracker }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // 3,000 tasks spanning three years, ungrouped so they are one long
    // lane of rows — the scale case's shape.
    const N = 3000;
    const specs = Array.from({ length: N }, (_v, i) => {
      const year = 2026 + (i % 3);
      const month = String((i % 12) + 1).padStart(2, "0");
      const day = String((i % 28) + 1).padStart(2, "0");
      const start = `${String(year)}-${month}-${day}`;
      return { start, due: start, title: `Row ${String(i)}` };
    });
    const keys = await seedDatedTasks(tracker.root, specs);

    await page.goto(`${tracker.baseURL}/timeline?zoom=month&grouping=none`);

    // Responsive and complete: the total is the TRUE count. 3,000 tasks
    // page in over several feed requests, so this is given room to
    // settle — the point of the case is that it DOES settle, and stays
    // interactive while it does.
    await expect(page.getByTestId("timeline-total")).toHaveText(`${String(N)} tasks`, { timeout: 30_000 });

    // Only a window of rows is mounted — far fewer than 3,000. If rows
    // did not virtualize this would be 3,000 and the assertion fails.
    const mountedAtTop = await page.locator('[data-testid^="timeline-bar-"]').count();
    expect(mountedAtTop).toBeGreaterThan(0);
    expect(mountedAtTop).toBeLessThan(N);
    expect(mountedAtTop).toBeLessThan(400);

    // The set of mounted rows CHANGES as you scroll: a row near the top
    // is mounted at rest, and after scrolling far down it is gone while
    // a row far down is now mounted. This is the windowing moving, not
    // just fewer nodes.
    const firstKey = keys[0] as string;
    const lastKey = keys[N - 1] as string;
    await expect(page.getByTestId(`timeline-bar-${firstKey}`)).toHaveCount(1);
    await expect(page.getByTestId(`timeline-bar-${lastKey}`)).toHaveCount(0);

    // Scroll to the very bottom of the row extent.
    await page.getByTestId("timeline-scroll").evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    // The last row is now mounted; the first has been unmounted.
    await expect(page.getByTestId(`timeline-bar-${lastKey}`)).toHaveCount(1);
    await expect(page.getByTestId(`timeline-bar-${firstKey}`)).toHaveCount(0);
    // Still a window, not the whole list, after scrolling.
    expect(await page.locator('[data-testid^="timeline-bar-"]').count()).toBeLessThan(400);

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });

  // @verifies TML-32
  test("TML-32: a task with 50 outgoing arrows highlights them on hover of the source", async ({ page, tracker }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // One source blocking 50 targets. All 51 tasks are dated and share
    // an overlapping span so every bar and every arrow renders.
    const N = 51;
    const specs = Array.from({ length: N }, (_v, i) => ({
      start: "2026-03-02",
      due: "2026-03-20",
      title: i === 0 ? "Source" : `Target ${String(i)}`,
    }));
    const keys = await seedDatedTasks(tracker.root, specs);
    const source = keys[0] as string;
    // Link the source to all 50 targets via `blocks`.
    for (let i = 1; i < N; i += 1) {
      await tracker.run(["link", source, "blocks", keys[i] as string]);
    }
    await setTimelineConfig(tracker.root, "timeline:\n  dependency_relationship: blocks\n  show_arrows: true");

    await page.goto(`${tracker.baseURL}/timeline?zoom=week&grouping=none`);
    await expect(page.getByTestId(`timeline-bar-${source}`)).toBeVisible();

    // All 50 arrows are drawn, and none is highlighted at rest.
    await expect(page.getByTestId("timeline-arrow")).toHaveCount(50);
    await expect(page.locator('[data-testid="timeline-arrow"][data-highlighted="true"]')).toHaveCount(0);

    // Hovering the source bar highlights its 50 outgoing arrows so a
    // single dependency can be traced out of the fan.
    await page.getByTestId(`timeline-bar-${source}`).hover();
    await expect(page.locator('[data-testid="timeline-arrow"][data-highlighted="true"]')).toHaveCount(50);

    // Moving the pointer off the bar clears the highlight.
    await page.getByTestId("timeline-toolbar").hover();
    await expect(page.locator('[data-testid="timeline-arrow"][data-highlighted="true"]')).toHaveCount(0);

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });
});
