/**
 * Transcribed from docs/dev/ui-test-cases/flow-comments-activity.md —
 * M2.4b, the Activity feed (CMT-13..38, XS-53).
 *
 * **`actor` is a ULID on disk.** Every assertion about who did
 * something names the *rendered display name*, never the id. A test
 * asserting an entry "appears" passes on a ULID — that is LST-33, and
 * it is this group's specific trap.
 *
 * **Several cases are unreachable from CLI-written history**, because
 * every entry the CLI writes has an actor and a distinct timestamp. So
 * `appendHistory` writes entries straight into `_history.yaml` here,
 * in the same shape core writes them. That is the only way to reach
 * CMT-28 (no actor), CMT-30 (same-timestamp ordering) and CMT-31
 * (a workspace timezone the browser does not share).
 *
 * **The pure logic is tested next to itself**, in
 * `apps/web/src/client/activity/*.test.ts`: day cutting, bulk-run
 * collapsing and per-kind phrasing are all decidable without a
 * browser, and a unit fixture can be built to *require* a rule where a
 * browser fixture can only illustrate it. These specs cover what only
 * a real page and a real file can show — that the feed reads the
 * server's own bytes, that pagination pages, and that a failure is
 * scoped to this section.
 */

import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import type { TrackerFixture } from "./fixtures/tracker.ts";
import { expect, test } from "./fixtures/tracker.ts";

/* ------------------------------------------------------------------ *
 * Reading and writing the far end
 * ------------------------------------------------------------------ */

/** The directory of the task with this key. */
async function taskDir(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) {
      return path.join(tasksDir, id);
    }
  }
  throw new Error(`no task on disk with key ${key}`);
}

async function historyFile(root: string, key: string): Promise<string> {
  return path.join(await taskDir(root, key), "_history.yaml");
}

/**
 * Appends raw YAML entries to `_history.yaml`.
 *
 * By hand rather than through the CLI because the CLI cannot produce
 * what several of these cases require: an entry with no `actor`, two
 * entries sharing a timestamp to the millisecond, or a `before` naming
 * a config value that no longer exists. The file is a plain YAML
 * sequence, which is why appending is safe.
 */
async function appendHistory(
  root: string,
  key: string,
  yaml: string,
): Promise<void> {
  await appendFile(await historyFile(root, key), yaml, "utf8");
}

/** The `_history.yaml` bytes, for asserting the file was not rewritten. */
async function historyBytes(root: string, key: string): Promise<string> {
  return readFile(await historyFile(root, key), "utf8");
}

/* ------------------------------------------------------------------ *
 * People and tasks
 * ------------------------------------------------------------------ */

interface Person { readonly id: string; readonly name: string }

async function makeUser(tracker: TrackerFixture, name: string): Promise<Person> {
  const out = await tracker.run(["user", "create", name]);
  const id = /\(([0-9A-Z]{26})\)/.exec(out)?.[1];
  if (id === undefined) throw new Error(`could not parse a user id from: ${out}`);
  return { id, name };
}

async function currentUser(tracker: TrackerFixture): Promise<Person> {
  const out = await tracker.run(["user", "current"]);
  const id = /\b([0-9A-Z]{26})\b/.exec(out)?.[1];
  if (id === undefined) throw new Error(`could not parse the current user from: ${out}`);
  const list = await tracker.run(["user", "list"]);
  const name = list.split("\n").find(l => l.includes(id))?.split("\t")[1]?.trim() ?? "";
  return { id, name };
}

function onlyKey(keys: readonly string[]): string {
  const key = keys[0];
  if (key === undefined) throw new Error("seed returned no keys");
  return key;
}

/**
 * Drives a real hidden → visible transition so `refetchOnWindowFocus`
 * refreshes the queries **in the page that is already open**.
 *
 * Not `page.reload()`, which is the XS-1 vacuity: a reload rebuilds
 * the whole JS context and refetches everything from the server
 * regardless of client state, so it masks the deletion of the
 * mechanism under test. The 31-second wait is part of the mechanism
 * rather than a sleep papering over a race — `refetchOnWindowFocus`
 * only refetches a *stale* query, and the shared stale window is 30
 * seconds, so refocusing inside it is correctly a no-op. Copied from
 * `flow-comments.spec.ts`, which established the pattern.
 */
async function refocus(page: Page): Promise<void> {
  // Outlast the 30s `staleTime`: `refetchOnWindowFocus` only refetches
  // data that has gone stale, so a shorter wait makes the focus
  // transition a no-op and the test asserts against the pre-rename
  // cache. 31s left a one-second margin, which a loaded machine loses —
  // the observed CMT-10 flake. The extra second is cheap; the refetch
  // below is what the assertion actually waits on.
  await page.waitForTimeout(33_000);
  // Wait for the refetch this focus transition triggers, rather than
  // racing it. Armed before the event is dispatched, or the response
  // can land before the wait begins.
  const refetched = page.waitForResponse(
    r => r.url().includes("/api/users") && r.status() === 200,
    { timeout: 15_000 },
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden", configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible", configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await refetched;
}

async function openTask(page: Page, tracker: TrackerFixture, key: string): Promise<void> {
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await expect(page.getByTestId("task-key-chip")).toHaveText(key);
}

/**
 * The lane now defaults to the **Comments** tab (K-5 / A163 — the tabbed
 * panel is the single comments home), and the activity feed is
 * mount-on-activation behind the **Activity** tab: `activity-entry` and
 * friends are not in the DOM until the tab is clicked. Tests that assert
 * the feed call this after `openTask`. Matches the pattern
 * `flow-comments.spec.ts` established for the same split.
 */
async function showActivity(page: Page): Promise<void> {
  await page.getByTestId("activity-tab-activity").click();
  await expect(page.getByTestId("activity-tabpanel-activity")).toBeVisible();
}

/**
 * The **All** tab stacks both lanes, so the comment composer AND the
 * activity feed are mounted at once — used by tests that assert on both
 * (a composer/composer-disabled-reason/comments-* element and a feed
 * element in the same test).
 */
async function showAll(page: Page): Promise<void> {
  await page.getByTestId("activity-tab-all").click();
  await expect(page.getByTestId("activity-tabpanel-all")).toBeVisible();
}

/** The rendered rows of the feed, top to bottom, flattened to one line each. */
async function rows(page: Page): Promise<string[]> {
  return (await page
    .locator('[data-testid="activity-entry"], [data-testid="activity-bulk-row"]')
    .allInnerTexts())
    .map(t => t.replace(/\s+/g, " ").trim());
}

/** Sets the workspace timezone in `calendar.yaml`. */
async function setTimezone(root: string, tz: string): Promise<void> {
  const file = path.join(root, ".loctt", "config", "calendar.yaml");
  const text = await readFile(file, "utf8");
  await writeFile(file, text.replace(/^timezone:.*$/m, `timezone: ${tz}`), "utf8");
}

/* ================================================================== *
 * The cases
 * ================================================================== */

test.describe("CMT — activity", () => {
  /**
   * CMT-13. Newest at the top — **the opposite of the comments list**,
   * which is what makes this worth asserting rather than assuming.
   * The two are on the same page, so the test reads both and requires
   * them to disagree: a feed that had silently inherited the comments'
   * ordering would pass any assertion made about the feed alone.
   */
  // @verifies CMT-13
  test("CMT-13: newest first, grouped under day headings, opposite the comments", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Ordered" }]));
    const ken = await currentUser(tracker);

    // Two comments, so the comments list has an order of its own.
    await tracker.run(["comment", key, "first comment"]);
    await tracker.run(["comment", key, "second comment"]);

    // Three field changes, backdated across three days. Written by
    // hand because the CLI stamps `now`, and a feed whose entries are
    // all within one second cannot demonstrate a day grouping.
    await appendHistory(tracker.root, key, [
      `- timestamp: 2026-08-20T10:00:00.000Z`,
      `  kind: field_change`,
      `  field: status`,
      `  before: backlog`,
      `  after: in_progress`,
      `  actor: ${ken.id}`,
      `- timestamp: 2026-08-21T10:00:00.000Z`,
      `  kind: field_change`,
      `  field: status`,
      `  before: in_progress`,
      `  after: done`,
      `  actor: ${ken.id}`,
      `- timestamp: 2026-08-21T14:00:00.000Z`,
      `  kind: field_change`,
      `  field: priority`,
      `  before: null`,
      `  after: high`,
      `  actor: ${ken.id}`,
      ``,
    ].join("\n"));

    await openTask(page, tracker, key);
    // Both lanes at once: the case's first bullet is a *contrast* between
    // the feed's order and the comments' order, so both must be mounted.
    await showAll(page);
    await expect(page.getByTestId("activity-entry").first()).toBeVisible();

    /**
     * Newest first. The three appended entries are the last three in
     * the file, so reverse order puts the 21st's 14:00 above the
     * 21st's 10:00 above the 20th's — asserted by the *values* they
     * carry, since the timestamps are not on the face of the row.
     */
    const text = await rows(page);
    const priorityAt = text.findIndex(t => t.includes("Priority"));
    const doneAt = text.findIndex(t => t.includes("→ Done"));
    const cookingAt = text.findIndex(t => t.includes("Backlog → In progress"));
    expect(priorityAt).toBeGreaterThanOrEqual(0);
    expect(priorityAt).toBeLessThan(doneAt);
    expect(doneAt).toBeLessThan(cookingAt);

    /**
     * Grouped under day headings, one per day. The two entries on the
     * 21st share a heading — a feed that emitted a heading per entry
     * would give three.
     */
    const days = await page.getByTestId("activity-day").evaluateAll(
      els => els.map(el => el.getAttribute("data-day")),
    );
    expect(new Set(days).size).toBe(days.length); // no day repeats
    expect(days).toContain("2026-08-20");
    expect(days).toContain("2026-08-21");
    const twentyFirst = page.locator('[data-day="2026-08-21"] [data-testid="activity-entry"]');
    await expect(twentyFirst).toHaveCount(2);

    /**
     * And the comments beside it run the other way — the case's first
     * bullet is a *contrast*, so both halves are read.
     */
    const bodies = await page.getByTestId("comment-body").allInnerTexts();
    expect(bodies.map(b => b.trim())).toEqual(["first comment", "second comment"]);

    // The actor renders as a name. Never the ULID that is on disk.
    const actors = await page.getByTestId("activity-actor").allInnerTexts();
    expect(actors).toContain(ken.name);
    expect(actors.join(" ")).not.toContain(ken.id);
    expect((await historyBytes(tracker.root, key))).toContain(ken.id);
  });

  /**
   * CMT-14, end to end: the *stored keys* are on disk and the
   * *configured labels* are on screen. Read off both, so a renderer
   * that printed the key could not pass.
   */
  // @verifies CMT-14
  test("CMT-14: before and after render as labels, with the empty side explicit", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Transitions" }]));
    const ken = await currentUser(tracker);
    const ana = await makeUser(tracker, "Ana Lopez");

    // Through the CLI, so the entries are exactly what core writes.
    await tracker.run(["set", key, "status", "in_progress"]);
    await tracker.run(["set", key, "assignee", ana.id]);
    await tracker.run(["unset", key, "assignee"]);

    await openTask(page, tracker, key);
    await showActivity(page);
    await expect(page.getByTestId("activity-entry").first()).toBeVisible();

    // The file holds keys and ULIDs…
    const stored = await historyBytes(tracker.root, key);
    expect(stored).toContain("after: in_progress");
    expect(stored).toContain(ana.id);

    // …and the screen holds labels and names.
    const status = page.locator('[data-testid="activity-change"]', { hasText: "Status:" });
    await expect(status).toContainText("Backlog → In progress");
    expect(await status.innerText()).not.toContain("in_progress");

    /**
     * The two assignee entries, newest first — so the *clear* is
     * above the *set*. Asserted as an ordered pair rather than by
     * `.first()` on a filtered locator: the order is part of what
     * CMT-13 claims, and picking either row by content would hide a
     * feed that had put them the wrong way round.
     */
    const assignee = page.locator(
      '[data-testid="activity-change"]', { hasText: "Assignee:" },
    );
    await expect(assignee).toHaveCount(2);
    // Cleared, newest.
    await expect(assignee.nth(0)).toContainText("Assignee: Ana Lopez → —");
    // Set from empty: the empty side is stated, not omitted — a bare
    // "Assignee: Ana Lopez" is what the case rules out.
    await expect(assignee.nth(1)).toContainText("Assignee: — → Ana Lopez");
    expect(await assignee.nth(1).innerText()).not.toContain(ana.id);

    // Every entry carries an actor name and a time.
    const count = await page.getByTestId("activity-entry").count();
    await expect(page.getByTestId("activity-actor")).toHaveCount(count);
    await expect(page.getByTestId("activity-time")).toHaveCount(count);
    expect((await page.getByTestId("activity-actor").allInnerTexts()).join(" "))
      .not.toContain(ken.id);
  });

  /**
   * CMT-16, the case where a passing test proves least: a grouping
   * that collapsed *everything* would satisfy "the bulk entries render
   * as one row".
   *
   * So the fixture contains, in order: two bulk entries, an unrelated
   * entry, one more bulk entry with the same id, and a lone entry with
   * no id. The correct rendering is **four rows** — bulk(2), single,
   * single, single — and every wrong grouping gives a different shape.
   */
  // @verifies CMT-16
  test("CMT-16: consecutive bulk entries collapse into one expandable row", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Bulk target" }]));
    const ken = await currentUser(tracker);

    await appendHistory(tracker.root, key, [
      `- timestamp: 2026-08-20T10:00:00.000Z`,
      `  kind: field_change`,
      `  field: status`,
      `  before: backlog`,
      `  after: in_progress`,
      `  actor: ${ken.id}`,
      `  bulk_op_id: OP1`,
      `- timestamp: 2026-08-20T10:00:00.001Z`,
      `  kind: field_change`,
      `  field: priority`,
      `  before: null`,
      `  after: high`,
      `  actor: ${ken.id}`,
      `  bulk_op_id: OP1`,
      // Not part of the op — this must break the run.
      `- timestamp: 2026-08-20T10:00:01.000Z`,
      `  kind: comment_added`,
      `  meta:`,
      `    comment_id: C1`,
      `    author: ${ken.id}`,
      `  after: unrelated`,
      `  actor: ${ken.id}`,
      // Same op id, but no longer consecutive.
      `- timestamp: 2026-08-20T10:00:02.000Z`,
      `  kind: field_change`,
      `  field: status`,
      `  before: in_progress`,
      `  after: done`,
      `  actor: ${ken.id}`,
      `  bulk_op_id: OP1`,
      /**
       * **Two adjacent entries with no op id at all** — the fourth
       * bullet, and it needs two rather than one. Measured: with a
       * single no-id entry the fixture cannot discriminate, because a
       * grouping that treated "no id" as one shared id still finds no
       * adjacent pair to collapse. Two adjacent ones make that
       * mutation produce three rows where the answer is five.
       */
      `- timestamp: 2026-08-20T10:00:03.000Z`,
      `  kind: archived`,
      `  actor: ${ken.id}`,
      `- timestamp: 2026-08-20T10:00:04.000Z`,
      `  kind: unarchived`,
      `  actor: ${ken.id}`,
      ``,
    ].join("\n"));

    await openTask(page, tracker, key);
    await showActivity(page);
    await expect(page.getByTestId("activity-bulk-row")).toHaveCount(1);

    const day = page.locator('[data-day="2026-08-20"]');
    /**
     * The shape. Newest-first, so: unarchived, archived (two singles
     * with no op id), the third OP1 entry stranded on its own, the
     * comment, then the run of two collapsed. **Five rows.**
     *
     * Each wrong grouping gives a different count, which is why the
     * shape is asserted rather than "a bulk row is present":
     *
     *  - promoting any earlier same-id single, not only the adjacent
     *    one → four rows, with all three OP1 entries in one
     *  - treating "no bulk_op_id" as one shared id → four rows, the
     *    two archive entries wrongly collapsed
     *  - collapsing every adjacent pair → fewer still
     *
     * Both of those first two were run against this fixture. Only the
     * second needed the extra `unarchived` entry to be catchable at
     * all — with one no-id entry there is no adjacent pair for it to
     * merge, and the mutation is inert rather than survived.
     */
    const dayRows = day.locator(
      '[data-testid="activity-entry"], [data-testid="activity-bulk-row"]',
    );
    await expect(dayRows).toHaveCount(5);
    const kinds = await dayRows.evaluateAll(els =>
      els.map(el => el.getAttribute("data-testid")));
    expect(kinds).toEqual([
      "activity-entry",     // unarchived — no bulk_op_id (fourth bullet)
      "activity-entry",     // archived   — no bulk_op_id, adjacent to it
      "activity-entry",     // the stranded OP1 entry (third bullet)
      "activity-entry",     // the comment that broke the run
      "activity-bulk-row",  // the run of two
    ]);

    const bulk = page.getByTestId("activity-bulk-row");
    await expect(bulk).toHaveAttribute("data-entry-count", "2");
    await expect(bulk).toHaveAttribute("data-bulk-op-id", "OP1");

    // The summary names the operation and the actor.
    await expect(bulk.getByTestId("activity-bulk-summary")).toContainText("bulk-changed");
    // Collapsed does not hide the actor or the timestamp — the fifth
    // bullet, and the reason a "3 changes" row would be wrong.
    await expect(bulk.getByTestId("activity-actor")).toHaveText(ken.name);
    await expect(bulk.getByTestId("activity-time")).toBeVisible();
    expect(await bulk.getByTestId("activity-actor").innerText()).not.toContain(ken.id);

    /**
     * Expanding reveals the individual entries **with their own
     * before/after values** — the second bullet. Collapsed, those
     * values are not on the page at all, which is what makes the
     * disclosure mean something.
     */
    await expect(bulk.getByTestId("activity-bulk-entries")).toHaveCount(0);
    await bulk.getByTestId("activity-bulk-toggle").click();
    const inner = bulk.getByTestId("activity-bulk-entries").getByTestId("activity-entry");
    await expect(inner).toHaveCount(2);
    // Newest-first inside the group too, matching the feed around it:
    // the priority entry was written second, so it is on top.
    await expect(inner.nth(0)).toContainText("Priority: — → High");
    await expect(inner.nth(1)).toContainText("Status: Backlog → In progress");
  });

  /**
   * CMT-17. 120 entries at a page size of 50, so three pages and a
   * boundary that lands mid-day.
   *
   * The load-bearing assertion is **the set of entries**, not the
   * count: a "Load more" that re-requested offset 0 would also grow
   * the list, and a count assertion cannot tell that from paging. Each
   * entry carries a distinct marker, so duplicates and gaps are both
   * visible.
   */
  // @verifies CMT-17
  test("CMT-17: Load more pages without duplicating or skipping", async ({
    page, tracker,
  }) => {
    test.setTimeout(90_000);
    const key = onlyKey(await tracker.seed([{ title: "Long history" }]));
    const ken = await currentUser(tracker);

    // 120 entries across two days, so a day is split across a page
    // boundary (the last bullet). Each names its own index.
    const lines: string[] = [];
    for (let i = 0; i < 120; i++) {
      const day = i < 60 ? "2026-08-20" : "2026-08-21";
      const mm = String(Math.floor(i / 60) * 0 + (i % 60)).padStart(2, "0");
      lines.push(
        `- timestamp: ${day}T10:${mm}:00.000Z`,
        `  kind: custom_field_change`,
        `  field: marker`,
        `  before: null`,
        `  after: entry-${String(i).padStart(3, "0")}`,
        `  actor: ${ken.id}`,
      );
    }
    await appendHistory(tracker.root, key, `${lines.join("\n")}\n`);

    await openTask(page, tracker, key);
    await showActivity(page);
    await expect(page.getByTestId("activity-scope")).toBeVisible();

    // The total includes the `created` entry the CLI wrote: 121.
    await expect(page.getByTestId("activity-scope")).toHaveText("50 of 121 entries");
    await expect(page.getByTestId("activity-entry")).toHaveCount(50);

    const markers = async (): Promise<string[]> =>
      (await page.getByTestId("activity-after").allInnerTexts())
        .map(t => t.trim())
        .filter(t => t.startsWith("entry-"));

    const page1 = await markers();
    expect(page1).toHaveLength(50);
    // Newest first: entry-119 down to entry-070.
    expect(page1[0]).toBe("entry-119");
    expect(page1[49]).toBe("entry-070");

    await page.getByTestId("activity-load-more").click();
    await expect(page.getByTestId("activity-entry")).toHaveCount(100);
    const page2 = await markers();

    /**
     * The boundary entry is neither repeated nor skipped. Asserted as
     * a **set**, so a re-request of offset 0 (which duplicates) and a
     * mis-stepped offset (which skips) are both caught — a length
     * check alone catches only the second.
     */
    expect(new Set(page2).size).toBe(page2.length);
    expect(page2.slice(0, 50)).toEqual(page1);
    expect(page2[50]).toBe("entry-069");
    expect(page2[99]).toBe("entry-020");

    await page.getByTestId("activity-load-more").click();
    await expect(page.getByTestId("activity-entry")).toHaveCount(121);

    const all = await markers();
    expect(new Set(all).size).toBe(120);
    // Every one of the 120 present, exactly once.
    for (let i = 0; i < 120; i++) {
      expect(all).toContain(`entry-${String(i).padStart(3, "0")}`);
    }

    // Everything loaded: the control is gone and the scope says so.
    await expect(page.getByTestId("activity-load-more")).toHaveCount(0);
    await expect(page.getByTestId("activity-scope")).toHaveText("121 entries");

    /**
     * The last bullet: a day split across a page boundary renders one
     * heading, not two. The 20th's 60 entries straddle the 50/100
     * boundary, so a per-page grouping would emit it twice.
     */
    const days = await page.getByTestId("activity-day").evaluateAll(
      els => els.map(el => el.getAttribute("data-day")),
    );
    expect(new Set(days).size).toBe(days.length);
    expect(days.filter(d => d === "2026-08-20")).toHaveLength(1);
  });

  /**
   * CMT-19's second bullet. A `_history.yaml` that is genuinely empty
   * — not absent, not corrupt — says so rather than rendering an empty
   * box, and the comments section beside it shows its own empty state
   * with the composer (the first bullet).
   */
  // @verifies CMT-19
  test("CMT-19: an empty history and an empty thread both get designed states", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Nothing here" }]));
    // Emptied on purpose: an empty YAML sequence, which parses.
    await writeFile(await historyFile(tracker.root, key), "[]\n", "utf8");

    await openTask(page, tracker, key);
    // Asserts the feed's empty state AND the comments empty state +
    // composer — both lanes, so the All tab mounts both.
    await showAll(page);

    const empty = page.getByTestId("activity-empty");
    await expect(empty).toBeVisible();
    // Says something, rather than being an empty box — an absence
    // assertion alone would pass on a blank pane.
    expect((await empty.innerText()).trim().length).toBeGreaterThan(20);
    await expect(page.getByTestId("activity-error")).toHaveCount(0);

    // The comments section: says there are none, and shows the composer.
    await expect(page.getByTestId("comments-empty")).toBeVisible();
    await expect(page.getByTestId("comment-composer")).toBeVisible();
  });

  /**
   * CMT-26, through the app rather than the unit test beside it: the
   * *file* holds a priority key that `workflow.yaml` no longer
   * declares, and the feed renders it marked rather than blank —
   * without failing to load.
   */
  // @verifies CMT-26
  test("CMT-26: a field_change naming a deleted config value renders, marked", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Drifted" }]));
    const ken = await currentUser(tracker);

    await appendHistory(tracker.root, key, [
      `- timestamp: 2026-08-20T10:00:00.000Z`,
      `  kind: field_change`,
      `  field: priority`,
      `  before: urgent`,
      `  after: high`,
      `  actor: ${ken.id}`,
      ``,
    ].join("\n"));

    // `urgent` is not in the shipped workflow, so this is genuine
    // drift rather than a value the test invented. Asserted, so the
    // fixture cannot silently stop discriminating.
    const wf = await readFile(
      path.join(tracker.root, ".loctt", "config", "workflow.yaml"), "utf8",
    );
    expect(wf).not.toContain("key: urgent");
    expect(wf).toContain("key: high");

    await openTask(page, tracker, key);
    await showActivity(page);

    const change = page.locator('[data-testid="activity-change"]', { hasText: "Priority:" });
    const before = change.getByTestId("activity-before");
    // The raw key, with a marker — not a blank.
    await expect(before).toContainText("urgent");
    await expect(before).toContainText("no longer defined");
    await expect(before).toHaveAttribute("data-drifted", "true");
    // The still-valid side resolves to its label, and is *not* marked
    // — the pairing is what makes the marker mean something.
    const after = change.getByTestId("activity-after");
    await expect(after).toHaveText("High");
    expect(await after.getAttribute("data-drifted")).toBeNull();

    // The feed did not fail to load because of it: the other entries
    // are here too (the third bullet).
    await expect(page.getByTestId("activity-error")).toHaveCount(0);
    await expect(page.locator('[data-kind="created"]')).toHaveCount(1);
  });

  /**
   * CMT-28. Unreachable from the CLI, which stamps an actor on
   * everything it writes — so the entry is written by hand with the
   * key simply absent.
   */
  // @verifies CMT-28
  test("CMT-28: an entry with no actor says System, and groups normally", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Headless" }]));
    const ken = await currentUser(tracker);

    await appendHistory(tracker.root, key, [
      // Two entries sharing a bulk id and *no* actor, so the case's
      // second bullet — the absence breaks neither the day grouping
      // nor the collapsing — has something to break.
      `- timestamp: 2026-08-20T10:00:00.000Z`,
      `  kind: field_change`,
      `  field: status`,
      `  before: backlog`,
      `  after: in_progress`,
      `  bulk_op_id: OP9`,
      `- timestamp: 2026-08-20T10:00:00.001Z`,
      `  kind: field_change`,
      `  field: priority`,
      `  before: null`,
      `  after: high`,
      `  bulk_op_id: OP9`,
      ``,
    ].join("\n"));

    // The file genuinely has no actor on those rows.
    const stored = await historyBytes(tracker.root, key);
    expect(stored).toContain("bulk_op_id: OP9");
    expect(stored.split("bulk_op_id: OP9")[0]?.split("- timestamp: 2026-08-20").pop())
      .not.toContain("actor:");

    await openTask(page, tracker, key);
    await showActivity(page);

    const bulk = page.getByTestId("activity-bulk-row");
    // Grouped and collapsed despite having no actor.
    await expect(bulk).toHaveCount(1);
    await expect(bulk).toHaveAttribute("data-entry-count", "2");
    await expect(page.locator('[data-day="2026-08-20"]')).toHaveCount(1);

    const byline = bulk.getByTestId("activity-actor");
    await expect(byline).toHaveText("System");
    await expect(byline).toHaveAttribute("data-actor", "system");
    // Not blank, and not a fabricated user — the two failures the case
    // names. `ken` exists in this tracker and did not do this.
    expect((await byline.innerText()).trim()).not.toBe("");
    expect(await byline.innerText()).not.toContain(ken.name);

    // And the entry the CLI *did* write still names its real actor, so
    // "System" is a distinction the feed draws rather than the only
    // thing it can say.
    const created = page.locator('[data-kind="created"] [data-testid="activity-actor"]');
    await expect(created).toHaveText(ken.name);
  });

  /**
   * CMT-30. Six entries sharing a timestamp to the millisecond,
   * unreachable from the CLI. The order must be the file's, and must
   * be the same before and after a "Load more" that pulls the rest.
   */
  // @verifies CMT-30
  test("CMT-30: entries sharing a timestamp keep a stable order across Load more", async ({
    page, tracker,
  }) => {
    test.setTimeout(90_000);
    const key = onlyKey(await tracker.seed([{ title: "Same instant" }]));
    const ken = await currentUser(tracker);

    /**
     * 60 entries, **every one on the same timestamp**, so nothing
     * about the ordering can come from comparing them. The markers
     * count up in file order, so the expected rendering is exactly
     * their reverse — and any reshuffle is visible as a permutation
     * rather than as a count.
     *
     * 60 is past the 50-entry page size on purpose: the case asks for
     * stability "across 'Load more'", which needs a boundary.
     */
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      lines.push(
        `- timestamp: 2026-08-20T10:00:00.000Z`,
        `  kind: custom_field_change`,
        `  field: marker`,
        `  before: null`,
        `  after: same-${String(i).padStart(2, "0")}`,
        `  actor: ${ken.id}`,
      );
    }
    await appendHistory(tracker.root, key, `${lines.join("\n")}\n`);

    const markers = async (): Promise<string[]> =>
      (await page.getByTestId("activity-after").allInnerTexts())
        .map(t => t.trim())
        .filter(t => t.startsWith("same-"));

    await openTask(page, tracker, key);
    await showActivity(page);
    await expect(page.getByTestId("activity-entry")).toHaveCount(50);

    const first = await markers();
    expect(first).toHaveLength(50);
    // File order reversed — the server's order, unmodified.
    expect(first[0]).toBe("same-59");
    expect(first[49]).toBe("same-10");

    /**
     * A second render of the same data, with no refetch: the panel
     * regroups on every render, so toggling something that forces one
     * exercises the grouping again. The order must be identical.
     */
    await page.setViewportSize({ width: 900, height: 700 });
    const second = await markers();
    expect(second).toEqual(first);

    // And across the page boundary: the first page's order is a
    // prefix of the loaded list, not merely a subset of it.
    await page.getByTestId("activity-load-more").click();
    await expect(page.getByTestId("activity-entry")).toHaveCount(61);

    const both = await markers();
    expect(both.slice(0, 50)).toEqual(first);
    expect(both[50]).toBe("same-09");
    expect(both[59]).toBe("same-00");
    expect(new Set(both).size).toBe(60);
  });

  /**
   * Pinned to a browser timezone 21 hours from the workspace's, so
   * every instant in the fixture falls on a different calendar day
   * in each. Without this the test inherits the host's zone, and on
   * a host near the workspace's own offset it cannot tell a feed
   * that reads `calendar.yaml` from one that reads the browser —
   * measured, on a UTC+8 host.
   */
  test.describe("in a browser far from the workspace", () => {
    // Pinned 21 hours from the workspace's Asia/Singapore. Without
    // this the browser inherits the host's zone, and on a UTC+8 host
    // that IS the workspace zone — so the test cannot tell a component
    // reading calendar.yaml from one reading the browser, and passes
    // either way. known-gaps.md records this exact vacuity being found
    // and fixed during M2.4b; the pin was then replaced by a comment
    // saying it had been removed "simulating the vacuous original",
    // and that comment shipped in 1ae1761. Re-measured 2026-08-31 on a
    // UTC+8 host: deleting the whole mechanism left flow-activity
    // 15/15 green.
    test.use({ timezoneId: "America/Los_Angeles" });


    /**
     * CMT-31's second bullet, which cannot be reached without a
     * workspace timezone the browser does not share.
     *
     * **The browser's zone is pinned**, and that is load-bearing rather
     * than tidiness. Playwright inherits the host's zone, and on a host
     * already at UTC+8 the two instants below fall on the same two days
     * in the browser's reckoning as in the workspace's — so the fixture
     * agrees with a feed that ignored the workspace entirely.
     * Measured: with the zone unpinned, replacing the workspace
     * timezone with `Intl.DateTimeFormat().resolvedOptions().timeZone`
     * left this test green.
     *
     * Pinned to `America/Los_Angeles` (UTC-7) against a workspace on
     * `Pacific/Kiritimati` (UTC+14) — 21 hours apart, so every instant
     * below lands on a different calendar day in each.
     */
    // @verifies CMT-31
    test("CMT-31: day headings follow the workspace timezone, per day", async ({
      page, tracker,
    }) => {
      const key = onlyKey(await tracker.seed([{ title: "Zones" }]));
      const ken = await currentUser(tracker);
      await setTimezone(tracker.root, "Pacific/Kiritimati");

      await appendHistory(tracker.root, key, [
        // 22:00Z on the 20th → 12:00 on the 21st in Kiritimati.
        `- timestamp: 2026-08-20T22:00:00.000Z`,
        `  kind: field_change`,
        `  field: status`,
        `  before: backlog`,
        `  after: in_progress`,
        `  actor: ${ken.id}`,
        // 08:00Z on the 20th → 22:00 on the 20th there. Same UTC day as
        // the entry above, a *different* workspace day.
        `- timestamp: 2026-08-20T08:00:00.000Z`,
        `  kind: field_change`,
        `  field: priority`,
        `  before: null`,
        `  after: high`,
        `  actor: ${ken.id}`,
        ``,
      ].join("\n"));

      await openTask(page, tracker, key);
      await showActivity(page);
      await expect(page.getByTestId("activity-entry").first()).toBeVisible();

      /**
       * Both entries are on 2026-08-20 in UTC. A feed reading the
       * browser's clock puts them under one heading; the workspace's
       * puts them under two. Two is the answer.
       */
      const days = await page.getByTestId("activity-day").evaluateAll(
        els => els.map(el => el.getAttribute("data-day")),
      );
      expect(days).toContain("2026-08-21");
      expect(days).toContain("2026-08-20");
      // Not merged, and not skipped — the first bullet, day-based rather
      // than week-based: the 20th and 21st get their own headings even
      // though they fall in the same week.
      expect(new Set(days).size).toBe(days.length);

      await expect(
        page.locator('[data-day="2026-08-21"] [data-testid="activity-entry"]'),
      ).toHaveCount(1);
      await expect(
        page.locator('[data-day="2026-08-20"] [data-testid="activity-entry"]'),
      ).toHaveCount(1);

      // The status change — 22:00Z — sits under the 21st, which is the
      // workspace's day for it and not the browser's.
      await expect(page.locator('[data-day="2026-08-21"]'))
        .toContainText("Backlog → In progress");

      // The headings are written days, not week ranges.
      const headings = await page.getByTestId("activity-day-heading").allInnerTexts();
      expect(headings.some(h => h.includes("August 21, 2026"))).toBe(true);
      expect(headings.some(h => h.includes("August 20, 2026"))).toBe(true);
    });
  });

  /**
   * CMT-29. A `loctt move` rekeys the task and writes a `key`
   * `field_change`, so both bullets are reachable through the CLI: the
   * feed opened at the **new** key still holds the entries written
   * under the old one, and the rename itself is in the log with both
   * keys on it.
   */
  // @verifies CMT-29
  test("CMT-29: a rekeyed task keeps its history, and the rename is in the feed", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Movable" }]));
    const ken = await currentUser(tracker);

    // An entry written under the *old* key, before the move.
    await tracker.run(["set", key, "status", "in_progress"]);

    await tracker.run(["project", "create", "Other", "--prefix", "M"]);
    const moved = await tracker.run(["move", key, "Other"]);
    const newKey = /→\s*(\S+)/.exec(moved)?.[1];
    expect(newKey).toBeDefined();
    expect(newKey).not.toBe(key);

    await page.goto(`${tracker.baseURL}/tasks/${String(newKey)}`);
    await expect(page.getByTestId("task-key-chip")).toHaveText(String(newKey));
    await showActivity(page);

    /**
     * The first bullet: the entry written under `T-1` is still on this
     * task, reached by `M1`. Asserted by its *content* — a count alone
     * would pass on a feed holding only the entries written after the
     * move.
     */
    await expect(page.locator('[data-testid="activity-change"]', { hasText: "Status:" }))
      .toContainText("Backlog → In progress");
    await expect(page.locator('[data-kind="created"]')).toHaveCount(1);

    /**
     * The second: the key change itself, with both keys visible. Not
     * "a key entry exists" — the old key is the half that would be
     * lost if the rename were recorded as a bare event.
     */
    const rename = page.locator('[data-testid="activity-change"]', {
      // `hasText` is case-**insensitive**, so `"Key:"` also matches the
      // raw field key `key:` — measured: deleting `key: "Key"` from
      // the field-name map left this green. The exact-cased assertion
      // below is what distinguishes the product's own field name from
      // the stored key showing through.
      hasText: `${key} →`,
    });
    await expect(rename).toContainText(`${key} → ${String(newKey)}`);
    expect(await rename.innerText()).toContain("Key:");
    expect(await rename.innerText()).not.toContain("key:");
    await expect(rename.getByTestId("activity-before")).toHaveText(key);
    await expect(rename.getByTestId("activity-after")).toHaveText(String(newKey));

    // Attributed by name, as everything else is.
    const actors = await page.getByTestId("activity-actor").allInnerTexts();
    expect(new Set(actors)).toEqual(new Set([ken.name]));
    expect(actors.join(" ")).not.toContain(ken.id);
  });

  /**
   * CMT-36's third bullet, which M2.4a built and deliberately did not
   * claim: the composer must be **disabled with a stated reason**, so
   * a post cannot overwrite a broken file and silently discard the
   * comments already in it.
   */
  // @verifies CMT-36
  test("CMT-36: a corrupt comments file degrades the section and disables the composer", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Broken thread" }]));
    await tracker.run(["comment", key, "the comment that must not be lost"]);

    const file = path.join(await taskDir(tracker.root, key), "_comments.yaml");
    const original = await readFile(file, "utf8");
    // Hand-broken: an unclosed flow mapping, which YAML cannot parse.
    await writeFile(file, `${original}\n  broken: {\n`, "utf8");

    await openTask(page, tracker, key);
    // Asserts the degraded comments section AND that the feed still
    // renders — both lanes, so the All tab mounts both.
    await showAll(page);

    // The section names the file and the parse problem.
    const err = page.getByTestId("comments-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("_comments.yaml");
    // A next action, at the named path (the fourth bullet).
    await expect(err).toContainText(file);

    /**
     * The composer is not there to be posted into, and the page says
     * why. A disabled control with no reason fails P4 just as an
     * enabled one fails the case.
     */
    await expect(page.getByTestId("comment-composer")).toHaveCount(0);
    const reason = page.getByTestId("composer-disabled-reason");
    await expect(reason).toBeVisible();
    await expect(reason).toContainText("overwrite");

    /**
     * Everything else on the task still renders — the second bullet.
     * Each is asserted positively rather than by "no error appeared",
     * which would pass on a blank page.
     */
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);
    await expect(page.getByTestId("activity-entry").first()).toBeVisible();
    await expect(page.getByTestId("activity-error")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Broken thread" })).toBeVisible();

    /** And the file was not rewritten by the attempt to read it. */
    expect(await readFile(file, "utf8")).toBe(`${original}\n  broken: {\n`);
    expect(await readFile(file, "utf8")).toContain("the comment that must not be lost");
  });

  /**
   * CMT-37, the mirror image: a corrupt `_history.yaml` takes the
   * activity feed and nothing else.
   */
  // @verifies CMT-37
  test("CMT-37: a corrupt history file degrades the activity feed only", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Broken log" }]));
    await tracker.run(["comment", key, "a comment that still renders"]);

    const file = await historyFile(tracker.root, key);
    await appendFile(file, "  - this: {\n", "utf8");

    await openTask(page, tracker, key);
    // Asserts the feed's scoped error AND that comments render normally
    // — both lanes, so the All tab mounts both.
    await showAll(page);

    // The feed shows an error naming the file — not a generic 500.
    const err = page.getByTestId("activity-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("_history.yaml");
    await expect(err).toContainText(file);
    // Not the generic envelope this used to produce.
    expect(await err.innerText()).not.toContain("The server failed while handling");
    await expect(page.getByTestId("activity-retry")).toBeVisible();

    // Comments and every other section render normally — asserted by
    // what is *there*, not by what is absent.
    await expect(page.getByTestId("comment-body"))
      .toHaveText("a comment that still renders");
    await expect(page.getByTestId("comment-composer")).toBeVisible();
    await expect(page.getByTestId("comments-error")).toHaveCount(0);
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);
    await expect(page.getByRole("heading", { name: "Broken log" })).toBeVisible();
  });

  /**
   * CMT-37's second bullet, which the whole-file failure above cannot
   * reach: **some** entries parsed, so they render — and the feed says
   * the list is incomplete rather than presenting a partial log as
   * complete.
   *
   * This was the half the probe left unverified. `readHistory` drops
   * malformed rows and says nothing about them, so before this ticket
   * a file with one broken entry read back as a complete, shorter
   * history.
   */
  // @verifies CMT-37
  test("CMT-37: a partially readable history renders what parsed and says it is incomplete", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Half a log" }]));
    const ken = await currentUser(tracker);

    await appendHistory(tracker.root, key, [
      `- timestamp: 2026-08-20T10:00:00.000Z`,
      `  kind: field_change`,
      `  field: status`,
      `  before: backlog`,
      `  after: in_progress`,
      `  actor: ${ken.id}`,
      // Parses as YAML, but `kind` is not one of the 17 — so
      // `readHistory` drops it while the rest still read.
      `- timestamp: 2026-08-20T11:00:00.000Z`,
      `  kind: not_a_real_kind`,
      `  actor: ${ken.id}`,
      ``,
    ].join("\n"));

    await openTask(page, tracker, key);
    // Asserts the partial feed + incomplete notice AND that comments
    // render — both lanes, so the All tab mounts both.
    await showAll(page);

    // What parsed renders: the `created` entry and the status change.
    await expect(page.getByTestId("activity-entry")).toHaveCount(2);
    await expect(page.locator('[data-testid="activity-change"]'))
      .toContainText("Backlog → In progress");
    // Not the whole-file error — this is a *partial* read, at 200.
    await expect(page.getByTestId("activity-error")).toHaveCount(0);

    /**
     * And the feed says so. Without this the reader sees "2 entries"
     * and has no way to know a third exists on disk — a partial log
     * presented as complete, which is precisely what the bullet rules
     * out.
     */
    const notice = page.getByTestId("activity-incomplete");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("incomplete");
    await expect(notice).toContainText("1");
    await expect(notice).toContainText("_history.yaml");

    // The dropped row is still on disk — nothing rewrote the file.
    expect(await historyBytes(tracker.root, key)).toContain("not_a_real_kind");

    // Comments unaffected.
    await expect(page.getByTestId("comment-composer")).toBeVisible();
  });

  /**
   * CMT-38. The second page is failed at the network layer, so the
   * failure is a real one rather than a state flag flipped by hand.
   */
  // @verifies CMT-38
  test("CMT-38: a failed Load more keeps the loaded entries and resumes from the same offset", async ({
    page, tracker,
  }) => {
    test.setTimeout(90_000);
    const key = onlyKey(await tracker.seed([{ title: "Flaky paging" }]));
    const ken = await currentUser(tracker);

    const lines: string[] = [];
    for (let i = 0; i < 70; i++) {
      lines.push(
        `- timestamp: 2026-08-20T10:00:00.000Z`,
        `  kind: custom_field_change`,
        `  field: marker`,
        `  before: null`,
        `  after: p-${String(i).padStart(2, "0")}`,
        `  actor: ${ken.id}`,
      );
    }
    await appendHistory(tracker.root, key, `${lines.join("\n")}\n`);

    const markers = async (): Promise<string[]> =>
      (await page.getByTestId("activity-after").allInnerTexts())
        .map(t => t.trim())
        .filter(t => t.startsWith("p-"));

    await openTask(page, tracker, key);
    await showActivity(page);
    await expect(page.getByTestId("activity-entry")).toHaveCount(50);
    const loaded = await markers();
    expect(loaded).toHaveLength(50);

    /**
     * Fail exactly the next page — the request carrying `offset=50`.
     * Routing on the offset rather than on the path is what keeps the
     * first page's already-settled request out of it.
     *
     * A served 500 rather than `route.abort`. An aborted request is a
     * *transport* failure, which the app-wide health surface correctly
     * reads as "the server is gone" and replaces the whole shell with
     * — measured, and it made this test assert against a page that no
     * longer had a feed on it. CMT-38 is about one pagination request
     * failing while the app is otherwise fine, so the failure has to
     * be one the server itself returned.
     */
    let seenOffsets: string[] = [];
    /** Flipped off before the retry, so the route survives to record it. */
    let failing = true;
    await page.route("**/activity?*", async route => {
      const url = new URL(route.request().url());
      const offset = url.searchParams.get("offset") ?? "";
      seenOffsets.push(offset);
      if (failing && offset === "50") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            code: "unknown",
            message: "The activity page could not be read.",
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.getByTestId("activity-load-more").click();

    // The message names the pagination request as what failed…
    const err = page.getByTestId("activity-load-more-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("next page");
    // …and the already-loaded entries are still on screen (first
    // bullet). Asserted as the same 50 markers, not as a count: a
    // feed that reset to page 1 would also show 50.
    await expect(page.getByTestId("activity-entry")).toHaveCount(50);
    expect(await markers()).toEqual(loaded);

    /**
     * Retrying resumes from **the same offset** — it does not restart
     * from zero and duplicate entries (the third bullet). The route
     * records every offset requested, so the retry's offset is read
     * off the wire rather than inferred from what rendered.
     */
    seenOffsets = [];
    failing = false;
    await page.getByTestId("activity-load-more").click();
    await expect(page.getByTestId("activity-entry")).toHaveCount(71);

    /**
     * Every offset the retry requested was 50 — never 0. Asserted as
     * the *set*, because the shared query client retries once, so a
     * single logical attempt can be two requests; what matters is
     * that none of them restarted the sequence.
     */
    expect(seenOffsets.length).toBeGreaterThan(0);
    expect(new Set(seenOffsets)).toEqual(new Set(["50"]));
    const after = await markers();
    expect(after.slice(0, 50)).toEqual(loaded);
    expect(new Set(after).size).toBe(70);
  });

  /**
   * XS-53's third bullet, which is the half that belongs to this
   * ticket: history records writes from every surface, and the feed
   * attributes each to the user who made it.
   *
   * The other two bullets — every write landing, and last-writer-wins
   * on the same field — are about core's concurrency and are asserted
   * against the files.
   */
  // @verifies XS-53
  test("XS-53: writes from UI and CLI both land, and the feed attributes each", async ({
    page, tracker,
  }) => {
    test.setTimeout(90_000);
    const key = onlyKey(await tracker.seed([{ title: "Three surfaces" }]));
    const ken = await currentUser(tracker);
    const ana = await makeUser(tracker, "Ana Lopez");

    await openTask(page, tracker, key);
    // Posts through the comment composer AND reads the feed's
    // attribution — both lanes, so the All tab mounts both.
    await showAll(page);
    await expect(page.getByTestId("activity-entry").first()).toBeVisible();

    // A write from the UI, as Ken: a comment, which writes both a
    // comment and a `comment_added` history entry.
    await page.getByTestId("comment-composer").getByTestId("comment-composer-rich-editor").click();
    await page.keyboard.type("from the browser");
    const posted = page.waitForResponse(
      r => /\/comments$/.test(r.url()) && r.request().method() === "POST",
    );
    await page.getByTestId("comment-composer-submit").click();
    await posted;

    // A write from the CLI, as Ana, to a *different* field — so both
    // survive rather than one overwriting the other.
    await tracker.run(["user", "switch", ana.id]);
    await tracker.run(["set", key, "status", "in_progress"]);
    await tracker.run(["user", "switch", ken.id]);

    /**
     * Both landed, read off disk — the far end, not the screen.
     */
    const taskMd = await readFile(
      path.join(await taskDir(tracker.root, key), "task.md"), "utf8",
    );
    expect(taskMd).toContain("status: in_progress");
    const history = await historyBytes(tracker.root, key);
    expect(history).toContain("kind: comment_added");
    expect(history).toContain("field: status");

    // And the CLI agrees with the file. `loctt show` prints the stored
    // key rather than the label — asserted as what it actually prints,
    // because the point is that the surfaces agree on the *value*, not
    // that they render it the same way.
    expect(await tracker.run(["show", key])).toContain("Status: in_progress");

    /**
     * The feed shows both, each attributed to the user who made it —
     * **by name**, and the two must differ. A feed attributing
     * everything to the current user would pass a test that only
     * checked one entry.
     */
    /**
     * A real hidden → visible transition, **not** `page.reload()`.
     *
     * XS-53 is about the UI converging on what the other surfaces
     * wrote, and a reload refetches everything from the server
     * regardless of client state — so it would pass with every
     * client-side refetch mechanism deleted. That is the XS-1
     * vacuity, verbatim. The wait is part of the mechanism:
     * `refetchOnWindowFocus` only refetches a *stale* query, and the
     * shared stale window is 30 seconds.
     */
    await refocus(page);
    await expect(page.getByTestId("task-key-chip")).toHaveText(key);

    const statusRow = page.locator('[data-testid="activity-entry"]', {
      hasText: "Backlog → In progress",
    });
    await expect(statusRow.getByTestId("activity-actor")).toHaveText(ana.name);

    const commentRow = page.locator('[data-kind="comment_added"]');
    await expect(commentRow.getByTestId("activity-actor")).toHaveText(ken.name);

    // Two different names, neither of them a ULID.
    const actors = await page.getByTestId("activity-actor").allInnerTexts();
    expect(new Set(actors)).toEqual(new Set([ken.name, ana.name]));
    expect(actors.join(" ")).not.toContain(ana.id);
    expect(actors.join(" ")).not.toContain(ken.id);
  });
});

/* ================================================================== *
 * CMT-25 — 300 history entries collapsing into few bulk groups still
 * paginate correctly.
 * ================================================================== */

test.describe("CMT — activity pagination under bulk collapse", () => {
  // @verifies CMT-25
  test("CMT-25: pagination counts entries, merges a boundary-straddling group, and is untouched by expansion", async ({
    page, tracker,
  }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    const key = onlyKey(await tracker.seed([{ title: "Deep history" }]));
    const ken = await currentUser(tracker);

    /**
     * 300 hand-written entries in **display order** (index 0 = newest,
     * the top of page 1), of which 200 share three `bulk_op_id`s in
     * three contiguous blocks:
     *
     *  - OP-A: display 45–84 (40 entries) — **straddles the 50-entry
     *    page-1/page-2 boundary**, which is the second bullet's whole
     *    point.
     *  - OP-B: display 120–199 (80 entries).
     *  - OP-C: display 210–289 (80 entries).
     *
     * The remaining 100 are single entries. The file is append-order,
     * which the server reverses to newest-first — so the file is the
     * display array reversed. A contiguous run in the file stays
     * contiguous (and same-ordered relative to itself) after reversal,
     * so a block that straddles a display page boundary is exactly what
     * this produces.
     */
    const opFor = (d: number): string | null => {
      if (d >= 45 && d <= 84) return "OP-A";
      if (d >= 120 && d <= 199) return "OP-B";
      if (d >= 210 && d <= 289) return "OP-C";
      return null;
    };
    const disp: string[] = [];
    for (let d = 0; d < 300; d++) {
      // A single day for all of them: this case is about entry-level
      // pagination and bulk merging, not day cutting (that is CMT-17).
      const mm = String(Math.floor(d / 60)).padStart(2, "0");
      const ss = String(d % 60).padStart(2, "0");
      const op = opFor(d);
      disp.push(
        `- timestamp: 2026-08-20T10:${mm}:${ss}.000Z`,
        `  kind: field_change`,
        `  field: marker`,
        `  before: null`,
        `  after: d-${String(d).padStart(3, "0")}`,
        `  actor: ${ken.id}`,
        ...(op !== null ? [`  bulk_op_id: ${op}`] : []),
      );
    }
    // File order is the display array reversed: split back into
    // per-entry chunks (each entry is 6 or 7 lines) and reverse the
    // chunks, not the lines.
    const chunks: string[][] = [];
    let cur: string[] = [];
    for (const line of disp) {
      if (line.startsWith("- ") && cur.length > 0) { chunks.push(cur); cur = []; }
      cur.push(line);
    }
    if (cur.length > 0) chunks.push(cur);
    chunks.reverse();
    await appendHistory(tracker.root, key, `${chunks.flat().join("\n")}\n`);

    await openTask(page, tracker, key);
    await showActivity(page);
    await expect(page.getByTestId("activity-scope")).toBeVisible();

    // First bullet: the count is in *entries*, and it counts the
    // underlying entries (301 with the CLI's `created`), not the
    // collapsed rows above them. Page one is 50 entries.
    await expect(page.getByTestId("activity-scope")).toHaveText("50 of 301 entries");

    const bulkRows = () => page.getByTestId("activity-bulk-row");
    const opA = () => page.locator('[data-testid="activity-bulk-row"][data-bulk-op-id="OP-A"]');

    // On page 1 only OP-A's newest five entries (display 45–49) are
    // loaded, so its row is present but partial.
    await expect(opA()).toHaveCount(1);
    await expect(opA()).toHaveAttribute("data-entry-count", "5");

    // Second bullet: load page 2, and OP-A is ONE row spanning the
    // boundary — not two. Its full span is now loaded (display 45–84,
    // 40 entries), all under a single row.
    await page.getByTestId("activity-load-more").click();
    await expect(page.getByTestId("activity-scope")).toHaveText("100 of 301 entries");
    await expect(opA()).toHaveCount(1);
    await expect(opA()).toHaveAttribute("data-entry-count", "40");

    // Third bullet: expanding a group does not consume a page of the
    // pagination budget or reset the loaded offset. Capture the state,
    // expand OP-A, and require pagination unchanged.
    const scopeBefore = await page.getByTestId("activity-scope").innerText();
    const rowsBefore = await bulkRows().count();
    const loadMoreLabelBefore = await page.getByTestId("activity-load-more").innerText();

    await opA().getByTestId("activity-bulk-toggle").click();
    await expect(opA().getByTestId("activity-bulk-entries")).toBeVisible();
    // The individual entries are now visible…
    await expect(opA().getByTestId("activity-bulk-entries").getByTestId("activity-entry"))
      .toHaveCount(40);
    // …but the pagination scope, the number of loaded pages (as the
    // "remaining" label), and the row set are all unchanged. Expansion
    // is local component state, not a fetch.
    await expect(page.getByTestId("activity-scope")).toHaveText(scopeBefore);
    await expect(page.getByTestId("activity-load-more")).toHaveText(loadMoreLabelBefore);
    expect(await bulkRows().count()).toBe(rowsBefore);

    // And loading the rest still pages by entries to completion: 301
    // total means five more presses from 100 (150, 200, 250, 300, 301).
    for (const expected of [150, 200, 250, 300, 301]) {
      await page.getByTestId("activity-load-more").click().catch(() => { /* last press may vanish */ });
      await expect(page.getByTestId("activity-scope"))
        .toHaveText(expected === 301 ? "301 entries" : `${String(expected)} of 301 entries`);
    }
    await expect(page.getByTestId("activity-load-more")).toHaveCount(0);

    // With everything loaded, each bulk op is exactly one row of its
    // full size — no split anywhere across all the boundaries crossed.
    await expect(page.locator('[data-testid="activity-bulk-row"][data-bulk-op-id="OP-A"]'))
      .toHaveCount(1);
    await expect(page.locator('[data-testid="activity-bulk-row"][data-bulk-op-id="OP-A"]'))
      .toHaveAttribute("data-entry-count", "40");
    await expect(page.locator('[data-testid="activity-bulk-row"][data-bulk-op-id="OP-B"]'))
      .toHaveAttribute("data-entry-count", "80");
    await expect(page.locator('[data-testid="activity-bulk-row"][data-bulk-op-id="OP-C"]'))
      .toHaveAttribute("data-entry-count", "80");

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});
