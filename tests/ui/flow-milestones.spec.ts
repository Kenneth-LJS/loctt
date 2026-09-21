/**
 * Transcribed from tests/cases/ui-test-cases/flow-milestones-labels.md —
 * M4.9, the `/milestones` progress view and `/milestones/<ulid>`
 * detail.
 *
 * The bulk of this file is the `/milestones` progress view and detail.
 * A tail of Settings → Data cases (MSL-10, MSL-13, and — added for the
 * milestone-and-label management batch — MSL-8, MSL-9, MSL-14, MSL-27,
 * MSL-28) also lives here, exercising the CRUD panels at
 * `/settings/labels` and `/settings/milestones`. Other label/milestone
 * cases (pills, filters) belong to flow-list.spec.ts.
 *
 * One `test` per case, named by case ID, with a `@verifies` tag. The
 * prose is the specification: a spec asserting something the case does
 * not claim has drifted from it.
 *
 * The progress numbers are core's, reached over `?progress=true`.
 * Where a case is about a *number*, the spec asserts what the page
 * renders — a correct field on the wire that nothing displays is not
 * the thing any of these cases ask for.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** The milestones in `milestones.yaml`, paired id → name. */
async function readMilestones(root: string): Promise<{ id: string; name: string }[]> {
  const text = await readFile(
    path.join(root, ".loctt", "config", "milestones.yaml"),
    "utf8",
  );
  const out: { id: string; name: string }[] = [];
  const re = /- id:\s*(\S+)\s*\n\s*name:\s*(.+)\s*\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      id: (m[1] ?? "").trim(),
      name: (m[2] ?? "").trim().replace(/^["']|["']$/g, ""),
    });
  }
  return out;
}

/**
 * MSL-3's worked example, on disk: 10 tasks on one milestone — 4
 * completed, 2 discarded, 4 active — plus an undated, task-free
 * second milestone.
 *
 * Seeded through the CLI rather than by hand so the frontmatter is
 * exactly what `loctt set` writes; the whole point of several of these
 * cases is that the UI and the CLI agree about one corpus.
 */
async function seedWorkedExample(t: {
  root: string;
  run(args: readonly string[]): Promise<string>;
}): Promise<{ alpha: string; empty: string }> {
  await t.run(["milestone", "create", "Alpha release", "--target-date", "2025-01-01"]);
  await t.run(["milestone", "create", "Someday"]);
  const ms = await readMilestones(t.root);
  const alpha = ms.find(x => x.name === "Alpha release")?.id ?? "";
  const empty = ms.find(x => x.name === "Someday")?.id ?? "";

  const keys: string[] = [];
  for (let i = 1; i <= 10; i += 1) {
    const out = await t.run(["create", `Task ${String(i)}`]);
    keys.push((/Created (\S+):/.exec(out)?.[1] ?? "").replace(/:$/, ""));
  }
  for (const k of keys) await t.run(["set", k, "milestone", alpha]);
  for (const k of keys.slice(0, 4)) await t.run(["set", k, "status", "done"]);
  for (const k of keys.slice(4, 6)) await t.run(["set", k, "status", "wont_do"]);

  return { alpha, empty };
}

test.describe("MSL — the milestones view", () => {
  // @verifies MSL-1
  test("MSL-1: one row per non-archived milestone, named, dated and with a matching bar", async ({
    page,
    tracker,
  }) => {
    const { alpha, empty } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);
    const rows = page.getByTestId("milestone-row");
    await expect(rows).toHaveCount(2);

    const alphaRow = page.locator(`[data-milestone-id="${alpha}"]`);

    // The `name` as configured. The positive control matters: the
    // "never the ULID" assertion below is an absence assertion, and
    // absence assertions pass just as well when the app renders
    // nothing at all.
    await expect(alphaRow.getByTestId("milestone-name")).toHaveText("Alpha release");
    await expect(alphaRow.getByTestId("milestone-name")).not.toHaveText(alpha);
    // Nor anywhere else in the row's visible text.
    await expect(alphaRow).not.toContainText(alpha);

    // The date, formatted — not the raw ISO string, not blank.
    await expect(alphaRow.getByTestId("milestone-date")).toHaveText("Jan 1, 2025");

    // The readout, and a bar whose fill matches those very numbers.
    const readout = page.getByTestId(`milestone-${alpha}-readout`);
    await expect(readout).toContainText("4 / 8");
    const bar = page.getByTestId(`milestone-${alpha}-bar`);
    await expect(bar).toHaveAttribute("data-fill", "0.5000");
    await expect(bar).toHaveAttribute("aria-valuenow", "4");
    await expect(bar).toHaveAttribute("aria-valuemax", "8");

    // No milestone omitted and none duplicated.
    await expect(page.locator(`[data-milestone-id="${empty}"]`)).toHaveCount(1);
  });

  // @verifies MSL-2
  test("MSL-2: the numerator counts by status category and matches `loctt list`", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    // A *second* completed-category status, and a task in it. MSL-2's
    // premise: two `completed`-category statuses both count.
    const wf = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    const original = await readFile(wf, "utf8");
    await writeFile(
      wf,
      original.replace(
        "  - key: wont_do",
        "  - key: shipped\n    label: Shipped\n    category: completed\n  - key: wont_do",
      ),
      "utf8",
    );
    // Move one *active* task to the other completed status. It must be
    // an active one specifically: promoting a discarded task instead
    // would also raise the denominator (8 → 9), which is a different
    // change than the one this case is about. Selected by category
    // rather than by list position, which is not ordered by seeding.
    const active = (await tracker.run([
      "list",
      "--query",
      `milestone = "${alpha}" AND (status.category = active OR status.category = pending)`,
    ])).trim().split("\n").map(l => l.trim().split(/\s+/)[0] ?? "").filter(Boolean);
    expect(active.length).toBe(4);
    await tracker.run(["set", active[0] ?? "", "status", "shipped"]);

    await page.goto(`${tracker.baseURL}/milestones`);
    const readout = page.getByTestId(`milestone-${alpha}-readout`);
    // 4 `done` + 1 `shipped` = 5, both `completed`-category.
    await expect(readout).toContainText("5 / 8");

    // The CLI, asked the same question by category, returns the same
    // numerator. This is the assertion that catches the UI computing
    // progress independently of core — run against the real binary.
    const listed = await tracker.run([
      "list",
      "--query",
      `milestone = "${alpha}" AND status.category = completed`,
    ]);
    const cliCount = listed.trim().split("\n").filter(l => l.trim() !== "").length;
    expect(cliCount).toBe(5);

    // And a *label* rename changes nothing: the count is on the
    // category, not the human string.
    await writeFile(
      wf,
      (await readFile(wf, "utf8")).replace("label: Done", "label: Finished!"),
      "utf8",
    );
    await page.reload();
    await expect(page.getByTestId(`milestone-${alpha}-readout`)).toContainText("5 / 8");
  });

  // @verifies MSL-3
  test("MSL-3: discarded tasks are excluded from the denominator and the rule is stated", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);

    // MSL-3's worked example reads `4 / 8` — not `4 / 10`.
    const listReadout = page.getByTestId(`milestone-${alpha}-readout`);
    await expect(listReadout).toContainText("4 / 8");
    await expect(listReadout).not.toContainText("4 / 10");

    // And the rule is *stated where the number is shown*, naming the
    // two excluded tasks. A bare `4 / 8` is exactly the ambiguity the
    // case's first bullet forbids.
    const listNote = page.getByTestId(`milestone-${alpha}-discarded-note`);
    await expect(listNote).toContainText("2 discarded");
    await expect(listNote).toContainText("excluded");
    // Captured before navigating away — the list note does not exist
    // on the detail page, so reading it afterwards waits forever.
    const listNoteText = await listNote.textContent();

    // The same rule, identically, on the detail — the case's last
    // bullet is that one milestone never shows two denominators on two
    // surfaces. Compared character-for-character, not merely "both
    // mention discards": two surfaces phrasing it differently is the
    // drift this component exists to prevent.
    await page.goto(`${tracker.baseURL}/milestones/${alpha}`);
    await expect(page.getByTestId("milestone-detail-readout")).toContainText("4 / 8");
    const detailNote = page.getByTestId("milestone-detail-discarded-note");
    await expect(detailNote).toContainText("2 discarded");
    expect(await detailNote.textContent()).toBe(listNoteText);
  });

  /**
   * Cross-ticket consistency with M4.3's MSL-11, which this ticket
   * owns asserting (nothing else did).
   *
   * MSL-11 requires Settings → Milestones' reference count to agree
   * with MSL-3's progress rule. `countTasksByReferences` and
   * `milestoneProgress` are separate code paths with their own
   * archived handling, so "they agree" is a claim, not a guarantee.
   *
   * Untagged on purpose: MSL-11 is M4.3's case and is covered there.
   * This is the reconciliation neither ticket had.
   */
  test("the reference count and the progress denominator reconcile exactly (MSL-11 × MSL-3)", async ({
    request,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    const res = await request.get(
      `${tracker.baseURL}/api/milestones?counts=true&progress=true`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      items: { id: string; taskCount?: number; progress?: { total: number; discarded: number } }[];
    };
    const row = body.items.find(i => i.id === alpha);
    expect(row).toBeDefined();

    // The count includes discarded tasks; the denominator excludes
    // them. They must differ by exactly the discarded count — if they
    // differed by anything else, the two paths would be scanning
    // different corpora and the settings badge would contradict the
    // progress bar for one milestone.
    expect(row?.taskCount).toBe(10);
    expect(row?.progress?.total).toBe(8);
    expect(row?.progress?.discarded).toBe(2);
    expect((row?.progress?.total ?? 0) + (row?.progress?.discarded ?? 0))
      .toBe(row?.taskCount);
  });

  // @verifies MSL-4
  test("MSL-4: the row opens a scoped task list whose row count equals `total`", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);
    await page.locator(`[data-milestone-id="${alpha}"]`).getByTestId("milestone-open").click();

    await expect(page.getByTestId("milestone-detail")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/milestones/${alpha}$`));

    // The count equality, under the same discarded rule: 8 rows for a
    // `4 / 8` readout, not the 10 tasks the milestone literally has.
    // This is the divergence measured on the raw endpoint —
    // `/api/tasks?milestone=<id>` alone returns 10.
    await expect(page.getByTestId("milestone-task-row")).toHaveCount(8);
    await expect(page.getByTestId("milestone-task-count")).toHaveText("8");
    await expect(page.getByTestId("milestone-detail-readout")).toContainText("4 / 8");

    // The URL is pasteable: a fresh load of it reproduces the list.
    await page.goto(`${tracker.baseURL}/milestones/${alpha}`);
    await expect(page.getByTestId("milestone-task-row")).toHaveCount(8);
  });

  // @verifies MSL-15
  test("MSL-15: a zero-task milestone reads 'No tasks', never NaN or 0/0", async ({
    page,
    tracker,
  }) => {
    // Seeded with a milestone that genuinely has no tasks — the only
    // seeding that exercises a zero denominator at all.
    const { empty } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);
    const readout = page.getByTestId(`milestone-${empty}-readout`);
    await expect(readout).toHaveText("No tasks");

    const text = (await page.getByTestId("milestones-rows").textContent()) ?? "";
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("Infinity");
    expect(text).not.toContain("0 / 0");
    expect(text).not.toContain("0/0");
    // The bar renders empty rather than full, and no percent is shown.
    await expect(page.getByTestId(`milestone-${empty}-bar`))
      .toHaveAttribute("data-fill", "0.0000");
    await expect(readout).not.toContainText("%");
  });

  // @verifies MSL-16
  test("MSL-16: an undated milestone says so, still shows a bar, and sorts last", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["milestone", "create", "Dated", "--target-date", "2026-01-01"]);
    await tracker.run(["milestone", "create", "Undated one"]);
    const ms = await readMilestones(tracker.root);
    const undated = ms.find(x => x.name === "Undated one")?.id ?? "";

    // Give the undated milestone real tasks — the case requires a
    // *working* progress bar on it, which an empty one cannot show.
    const out = await tracker.run(["create", "U task"]);
    const key = (/Created (\S+):/.exec(out)?.[1] ?? "").replace(/:$/, "");
    await tracker.run(["set", key, "milestone", undated]);
    await tracker.run(["set", key, "status", "done"]);

    await page.goto(`${tracker.baseURL}/milestones`);

    const dateCell = page.locator(`[data-milestone-id="${undated}"]`).getByTestId("milestone-date");
    await expect(dateCell).toHaveText("No target date");
    // Not blank, not a bare dash, and not today's date.
    await expect(dateCell).not.toHaveText("");
    await expect(dateCell).not.toHaveText("—");
    const today = new Date().toISOString().slice(0, 10);
    await expect(dateCell).not.toContainText(today.slice(0, 4) + "-");

    // A working bar, not a suppressed one.
    await expect(page.getByTestId(`milestone-${undated}-readout`)).toContainText("1 / 1");

    // Sorted into its defined position: after all dated milestones.
    const names = await page.getByTestId("milestone-name").allTextContents();
    expect(names).toEqual(["Dated", "Undated one"]);
  });

  // @verifies MSL-17
  test("MSL-17: overdue keys off incomplete tasks, not the date, and changes no number", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);
    const row = page.locator(`[data-milestone-id="${alpha}"]`);

    // A past date with 4 tasks still incomplete.
    await expect(row).toHaveAttribute("data-overdue", "true");
    // Not colour alone — the indication is a word.
    await expect(row.getByTestId("milestone-overdue")).toHaveText("Overdue");

    // The flag is additive: the numbers are what they were.
    await expect(page.getByTestId(`milestone-${alpha}-readout`)).toContainText("4 / 8");

    // Now complete the remaining work. Same past date; the flag must
    // go, which is what distinguishes "driven by incomplete tasks"
    // from "driven by the date".
    const keys = (await tracker.run(["list", "--query", `milestone = "${alpha}"`]))
      .trim().split("\n").map(l => l.trim().split(/\s+/)[0] ?? "").filter(Boolean);
    for (const k of keys) await tracker.run(["set", k, "status", "done"]);

    await page.reload();
    await expect(row).toHaveAttribute("data-overdue", "false");
    await expect(row.getByTestId("milestone-overdue")).toHaveCount(0);
    // Positive control: the row is still on the page and still dated
    // in the past — the flag went, not the row.
    await expect(row.getByTestId("milestone-date")).toHaveText("Jan 1, 2025");
  });

  // @verifies MSL-18
  test("MSL-18: a 100% milestone reads n / n, full, and completed rather than overdue", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);
    const keys = (await tracker.run(["list", "--query", `milestone = "${alpha}"`]))
      .trim().split("\n").map(l => l.trim().split(/\s+/)[0] ?? "").filter(Boolean);
    for (const k of keys) await tracker.run(["set", k, "status", "done"]);

    await page.goto(`${tracker.baseURL}/milestones`);
    const row = page.locator(`[data-milestone-id="${alpha}"]`);

    // All 10 are now `done`, so nothing is discarded: 10 / 10.
    await expect(page.getByTestId(`milestone-${alpha}-readout`)).toContainText("10 / 10");
    await expect(page.getByTestId(`milestone-${alpha}-bar`))
      .toHaveAttribute("data-fill", "1.0000");

    // A past target date on a complete milestone reads completed, not
    // overdue.
    await expect(row.getByTestId("milestone-complete")).toHaveText("Completed");
    await expect(row.getByTestId("milestone-overdue")).toHaveCount(0);
  });

  // @verifies MSL-24
  test("MSL-24: a dangling milestone id is no phantom row, and its tasks stay visible", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    // Hand-delete the milestone entry while tasks still point at it —
    // the case's own instruction. `milestones.yaml` keeps only the
    // other one.
    const file = path.join(tracker.root, ".loctt", "config", "milestones.yaml");
    const text = await readFile(file, "utf8");
    const kept = text.split(/(?=- id:)/).filter(b => !b.includes(alpha)).join("");
    await writeFile(file, kept.startsWith("milestones:") ? kept : `milestones:\n${kept}`, "utf8");

    await page.goto(`${tracker.baseURL}/milestones`);

    // The view does not crash, and the dangling id is not a row.
    await expect(page.getByTestId("milestones")).toBeVisible();
    await expect(page.locator(`[data-milestone-id="${alpha}"]`)).toHaveCount(0);

    // The 10 tasks it orphaned are counted toward no milestone below,
    // so their exclusion must be visible *somewhere* — silently
    // vanishing tasks are the case's named failure mode.
    const notice = page.getByTestId("milestones-orphans");
    await expect(notice).toBeVisible();
    await expect(page.getByTestId("milestones-orphan-count")).toHaveText("10");
    // Named, so the user can find it on disk.
    await expect(page.getByTestId("milestones-orphan-id").first()).toHaveText(alpha);
  });

  // @verifies MSL-25
  test("MSL-25: an archived milestone is out of the default view, revealed without unarchiving", async ({
    page,
    tracker,
  }) => {
    const { alpha, empty } = await seedWorkedExample(tracker);
    await tracker.run(["milestone", "archive", alpha]);

    await page.goto(`${tracker.baseURL}/milestones`);

    // The positive control comes FIRST and is awaited: `toHaveCount(0)`
    // on a page whose rows have not rendered yet passes trivially, and
    // then the run moves on. Measured — a mutation defaulting the view
    // to *show* archived survived this test until the wait below was
    // added. So: wait for the rendered row set to settle at exactly
    // one row, and only then assert which one it is.
    await expect(page.getByTestId("milestone-row")).toHaveCount(1);
    await expect(page.locator(`[data-milestone-id="${empty}"]`)).toHaveCount(1);
    // Excluded from the default view.
    await expect(page.locator(`[data-milestone-id="${alpha}"]`)).toHaveCount(0);

    // Revealed by the affordance.
    await page.getByTestId("milestones-archived-scope").selectOption("all");
    await expect(page.locator(`[data-milestone-id="${alpha}"]`)).toHaveCount(1);

    // Without unarchiving it: the file still says archived.
    const yaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "milestones.yaml"),
      "utf8",
    );
    expect(yaml).toMatch(/archived:\s*true/);

    // Its detail route stays reachable, with a working task list.
    await page.goto(`${tracker.baseURL}/milestones/${alpha}`);
    await expect(page.getByTestId("milestone-detail-archived")).toBeVisible();
    await expect(page.getByTestId("milestone-task-row")).toHaveCount(8);
  });

  // @verifies MSL-29
  test("MSL-29: recategorising a status raises the numerator, with no cached figure surviving", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);
    await expect(page.getByTestId(`milestone-${alpha}-readout`)).toContainText("4 / 8");

    // Move the *active* status into the completed category. The 4
    // backlog tasks are untouched on disk; only the config changed.
    const wf = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    const text = await readFile(wf, "utf8");
    await writeFile(
      wf,
      text.replace(
        "  - key: backlog\n    label: Backlog\n    category: pending",
        "  - key: backlog\n    label: Backlog\n    category: completed",
      ),
      "utf8",
    );

    // MSL-29's own wording is "**on refresh**", which is what this
    // does. Two things this deliberately does NOT claim, because they
    // were measured and are not true:
    //
    //  - It does not prove the query *key* is what invalidates. A
    //    reload drops the whole React Query cache, so a mutation
    //    removing `"workflow"` from the progress key survives this
    //    test. The key still earns its place — it is what drops the
    //    figure when a workflow edit is made *through the settings
    //    panel*, with no reload — but that path is M4.2's write, not
    //    this case's hand-edit.
    //  - It does not hold for a client-side navigation away and back.
    //    A hand-edit of `workflow.yaml` fires no mutation, so nothing
    //    invalidates, and the 30s stale window legitimately serves the
    //    old figure. Measured: the navigate-and-return version of this
    //    test fails against correct code. See known-gaps.
    await page.reload();

    // The 4 backlog tasks now count: 8 / 8. A figure computed once and
    // frozen against the config would still read 4 / 8.
    await expect(page.getByTestId(`milestone-${alpha}-readout`)).toContainText("8 / 8");
  });

  // @verifies MSL-39
  test("MSL-39: the whole card opens the milestone, and an inner control is not swallowed", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);
    const row = page.locator(`[data-milestone-id="${alpha}"]`);
    await expect(row).toBeVisible();
    // The card advertises itself as a link to assistive tech — the
    // affordance is the whole card, not only the name sub-target.
    await expect(row).toHaveAttribute("role", "link");

    // Click the card body away from the name link — the progress bar
    // region, which is inert. It must still navigate to the detail.
    await page.getByTestId(`milestone-${alpha}-bar`).click();
    await expect(page.getByTestId("milestone-detail")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/milestones/${alpha}$`));

    // The name link inside the card also opens it (a real link — keyboard
    // and open-in-new-tab keep working) rather than being swallowed.
    await page.goBack();
    await expect(page.getByTestId("milestones")).toBeVisible();
    await row.getByTestId("milestone-open").click();
    await expect(page.getByTestId("milestone-detail")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/milestones/${alpha}$`));
  });

  // @verifies MSL-40
  test("MSL-40: a dated card shows a countdown, a past one shows overdue, undated degrades", async ({
    page,
    tracker,
  }) => {
    // The tracker's today, read from the server, is the frame the
    // countdown is measured in — computed here so the fixture dates are
    // relative to it and the test does not drift with the wall clock.
    const info = await (await page.request.get(`${tracker.baseURL}/api/info`)).json() as {
      today: string;
    };
    const today = new Date(`${info.today}T12:00:00Z`);
    const plus = (n: number): string =>
      new Date(today.getTime() + n * 86_400_000).toISOString().slice(0, 10);

    await tracker.run(["milestone", "create", "Soon", "--target-date", plus(5)]);
    await tracker.run(["milestone", "create", "Late", "--target-date", plus(-3)]);
    await tracker.run(["milestone", "create", "Someday"]);
    const ms = await readMilestones(tracker.root);
    const soon = ms.find(m => m.name === "Soon")?.id ?? "";
    const late = ms.find(m => m.name === "Late")?.id ?? "";
    const someday = ms.find(m => m.name === "Someday")?.id ?? "";

    // "Late" needs an incomplete task so it reads overdue rather than
    // just past — MSL-40's marker rides the same overdue rule (MSL-17).
    const out = await tracker.run(["create", "L task"]);
    const key = (/Created (\S+):/.exec(out)?.[1] ?? "").replace(/:$/, "");
    await tracker.run(["set", key, "milestone", late]);

    await page.goto(`${tracker.baseURL}/milestones`);

    // A future date: days-remaining.
    await expect(page.getByTestId(`milestone-${soon}-countdown`)).toContainText("in 5 days");
    // A past date with work left: an overdue duration.
    await expect(page.getByTestId(`milestone-${late}-countdown`)).toContainText("3 days overdue");
    // Undated: no countdown at all, and the date slot still says so.
    await expect(page.getByTestId(`milestone-${someday}-countdown`)).toHaveCount(0);
    await expect(
      page.locator(`[data-milestone-id="${someday}"]`).getByTestId("milestone-date"),
    ).toHaveText("No target date");
  });

  // @verifies MSL-41
  test("MSL-41: each card shows a done/remaining/discarded breakdown at a glance", async ({
    page,
    tracker,
  }) => {
    // The worked example: 10 tasks — 4 done, 2 discarded, 4 active.
    // done = 4, remaining = total(8) - done(4) = 4, discarded = 2.
    const { alpha, empty } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);

    const bd = page.getByTestId(`milestone-${alpha}-breakdown`);
    await expect(bd).toBeVisible();
    await expect(page.getByTestId(`milestone-${alpha}-breakdown-done`)).toContainText("4");
    await expect(page.getByTestId(`milestone-${alpha}-breakdown-remaining`)).toContainText("4");
    await expect(page.getByTestId(`milestone-${alpha}-breakdown-discarded`)).toContainText("2");
    // The three buckets are labelled, not bare numbers — "at a glance".
    await expect(bd).toContainText("done");
    await expect(bd).toContainText("remaining");
    await expect(bd).toContainText("discarded");

    // The zero-task milestone shows no breakdown — it already reads
    // "No tasks", and a 0/0/0 breakdown would be noise.
    await expect(page.getByTestId(`milestone-${empty}-breakdown`)).toHaveCount(0);
  });

  // @verifies MSL-42
  test("MSL-42: the view's copy points to where milestones are managed", async ({
    page,
    tracker,
  }) => {
    await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones`);

    // The discoverability copy names the reachable management location
    // and links to it — closing UX-15's "a view you cannot find" gap.
    const subhead = page.getByTestId("milestones-subhead");
    await expect(subhead).toBeVisible();
    await expect(subhead).toContainText("Settings");
    const link = subhead.getByRole("link", { name: /Settings . Milestones/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/settings\/milestones$/);
  });

  // @verifies MSL-38
  test("MSL-38: an unknown id in the detail URL is a not-found, distinct from zero tasks", async ({
    page,
    tracker,
  }) => {
    const { empty } = await seedWorkedExample(tracker);

    await page.goto(`${tracker.baseURL}/milestones/01ZZZZZZZZZZZZZZZZZZZZZZZZ`);

    const nf = page.getByTestId("milestone-not-found");
    await expect(nf).toBeVisible();
    await expect(nf).toContainText("No milestone matches this link");
    // Names the id from the URL.
    await expect(page.getByTestId("milestone-not-found-id"))
      .toHaveText("01ZZZZZZZZZZZZZZZZZZZZZZZZ");
    // Links back to the view, in one click.
    await page.getByTestId("milestone-not-found-back").click();
    await expect(page.getByTestId("milestones")).toBeVisible();

    // Visually distinct from a milestone that exists with zero tasks:
    // that one renders the whole detail page, header and all.
    await page.goto(`${tracker.baseURL}/milestones/${empty}`);
    await expect(page.getByTestId("milestone-not-found")).toHaveCount(0);
    await expect(page.getByTestId("milestone-detail")).toBeVisible();
    await expect(page.getByTestId("milestone-detail-name")).toHaveText("Someday");
    await expect(page.getByTestId("milestone-tasks-empty")).toBeVisible();
  });

  /**
   * MSL-35 is **not** claimed by this test, and carries no `@verifies`
   * tag deliberately.
   *
   * What the case asks for is a *per-row* error: the failing
   * milestone's row shows an error naming that milestone, with a
   * retry, **while other milestones' rows continue to render their own
   * progress**. That last bullet is architecturally unreachable today,
   * measured rather than assumed:
   *
   *  - `withProgress` calls `milestoneProgress` **once for the whole
   *    list**, and `referenceProgress` does a single corpus scan by
   *    design. It succeeds for every milestone or throws for all of
   *    them; there is no per-milestone failure to render.
   *  - `handleListMilestones` does not catch, so a throw becomes a
   *    whole-response 500 (server.ts:4408). There is no partial
   *    success shape on the wire.
   *  - `withProgress` also fills any id missing from the map with
   *    `{done:0,total:0,…}`, so a missing computation is
   *    indistinguishable from a real zero — verified against a live
   *    server: every item in the response carries a `progress` object,
   *    never `undefined`.
   *
   * A per-row error needs either a per-milestone progress endpoint or
   * a `progress | {error}` partial-success shape, both of which are
   * server work this ticket does not own.
   *
   * What IS built and is what this test asserts: a failed progress
   * read is a named error state with a working retry, and never
   * renders as `0 / 0` — which is the confusion MSL-35 exists to
   * prevent, and which MSL-15 uses for a genuinely empty milestone.
   * The client-side half (`progressState(undefined)` →
   * `kind: "unavailable"`, rendered by `ProgressReadout` in place of
   * the numbers) is built and unit-tested, but is unreachable from the
   * server as it stands.
   */
  test("a failed progress read shows a retryable error rather than 0 / 0 (MSL-35, partial)", async ({
    page,
    tracker,
  }) => {
    const { alpha } = await seedWorkedExample(tracker);

    // Fail the progress read. This is the whole-list failure the
    // server can actually produce — see the note above the test.
    await page.route("**/api/milestones?progress=true**", route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ message: "progress failed", code: "io_failed" }),
      }),
    );

    await page.goto(`${tracker.baseURL}/milestones`);

    // In place of the numbers, not `0 / 0` — which is what MSL-15's
    // real empty milestone shows, and the two must not be confusable.
    const err = page.getByTestId("milestones-load-error");
    await expect(err).toBeVisible();
    const text = (await err.textContent()) ?? "";
    expect(text).not.toContain("0 / 0");
    expect(text).not.toContain("No tasks");
    // A retry control, not just prose.
    await expect(err.getByRole("button", { name: "Retry" })).toBeVisible();

    // Lifting the failure and retrying restores the real numbers —
    // the positive control that the error state is not permanent.
    await page.unroute("**/api/milestones?progress=true**");
    await err.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId(`milestone-${alpha}-readout`)).toContainText("4 / 8");
  });
});

// @verifies MSL-10
//
// MSL-10's four bullets all concern *pickers*; its only two tags sat
// on server tests asserting `labels.yaml` on disk, so the picker
// behaviour was unguarded. Measured: forcing archived labels back into
// the picker left 24 label and meta UI tests green.
//
// Both halves matter. Asserting the archived label is absent would
// pass on an empty picker, so a live label is asserted present
// alongside it.
test("MSL-10: an archived label leaves the picker but stays on tasks that carry it", async ({
  page,
  tracker,
}) => {
  await tracker.run(["label", "create", "keepme"]);
  await tracker.run(["label", "create", "retired"]);
  // `set … labels` needs an array and the CLI has no `label add`;
  // `create --label` is the gesture that attaches one. Measured: `set`
  // gives "labels must be an array, got: string".
  const out = await tracker.run(["create", "Labelled", "--label", "retired"]);
  const key = /(\w+-\d+)/.exec(out)?.[1];
  if (key === undefined) throw new Error(`no key in: ${out}`);

  // Archive *after* attaching, so bullet 1 has something to preserve.
  await tracker.run(["label", "archive", "retired"]);

  // A second task that does NOT carry the label. The picker excludes
  // already-attached labels via `!attachedSet.has(l.id)`, so opening it
  // on the labelled task hides `retired` whether or not the archived
  // filter works — my first draft did exactly that and passed with the
  // filter disabled. Shape (d): seeding that cannot discriminate.
  const other = await tracker.run(["create", "Unlabelled"]);
  const otherKey = /(\w+-\d+)/.exec(other)?.[1];
  if (otherKey === undefined) throw new Error(`no key in: ${other}`);

  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  const meta = page.getByTestId("meta-labels");

  // Bullet 1: the reference survives archiving.
  await expect(meta.getByTestId("label-pill").filter({ hasText: "retired" }))
    .toHaveCount(1);

  // Bullet 2: the picker no longer offers it — with a positive control,
  // without which an empty picker satisfies the assertion.
  await page.goto(`${tracker.baseURL}/tasks/${otherKey}`);
  await page.getByTestId("meta-add-label").click();
  await expect(page.getByRole("option", { name: "keepme", exact: true }))
    .toHaveCount(1);
  await expect(page.getByRole("option", { name: "retired", exact: true }))
    .toHaveCount(0);
});

// @verifies MSL-13
//
// MSL-13's three bullets are all about the *dialog's shape*; its only
// tag sat on a server test asserting MSL-12's remap mechanic, so the
// lighter-weight confirmation was unguarded. Measured: forcing the
// remap picker onto every delete left 48 settings UI tests green.
//
// Both branches are asserted in one test, because "no picker" alone
// passes on a dialog that never renders a picker at all.
test("MSL-13: an unreferenced milestone confirms without a remap picker", async ({
  page,
  tracker,
}) => {
  await tracker.run(["milestone", "create", "Orphan"]);
  await tracker.run(["milestone", "create", "Used"]);
  await tracker.run(["create", "Has a milestone", "--milestone", "Used"]);

  await page.goto(`${tracker.baseURL}/settings/milestones`);

  // Zero references: a simple confirm, no remap choice.
  // Scoped by the row's refcount attribute rather than by text: the
  // rows carry ids in their testid, and `hasText` on a name is fragile
  // when one name is a substring of another or the row shows extra
  // copy. This asserts the fixture is what I think it is *before*
  // asserting the dialog, so a fixture mistake fails here rather than
  // masquerading as an app defect.
  const orphanRow = page.locator('[data-testid^="milestone-row-"]')
    .filter({ has: page.locator('[data-milestone-refcount="0"]') });
  await expect(orphanRow).toHaveCount(1);
  await orphanRow.getByTestId("milestone-delete").click();
  await expect(page.getByTestId("remap-choice")).toHaveCount(0);
  await page.getByRole("button", { name: /cancel/i }).click();

  // Referenced: the remap choice IS demanded. The positive control —
  // without it, a dialog that never renders a picker satisfies the
  // assertion above.
  const usedRow = page.locator('[data-testid^="milestone-row-"]')
    .filter({ hasText: "Used" });
  await usedRow.getByTestId("milestone-delete").click();
  await expect(page.getByTestId("remap-choice")).toHaveCount(1);
});

/** The raw text of `.loctt/config/labels.yaml`. */
async function labelsYaml(root: string): Promise<string> {
  return readFile(path.join(root, ".loctt", "config", "labels.yaml"), "utf8");
}

/**
 * The labels array from a task's frontmatter, read straight off disk.
 * `loctt show` renders labels by *name*, so it cannot witness that a
 * task still references a label *id* — the file is the only far end for
 * "no task loses its label". Scans `.loctt/tasks/<id>/task.md` for the
 * one whose frontmatter `key` matches.
 */
async function taskLabelsOnDisk(root: string, key: string): Promise<string[]> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  const dirs = await readdir(tasksDir);
  for (const d of dirs) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, d, "task.md"), "utf8");
    } catch {
      continue;
    }
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
    if (!new RegExp(`key:\\s*${key}\\b`).test(fm)) continue;
    // labels: as a flow array [a, b] or a block list of `- id` lines.
    const inline = /labels:\s*\[([^\]]*)\]/.exec(fm)?.[1];
    if (inline !== undefined) {
      return inline.split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
    const block = /labels:\s*\n((?:\s*-\s*.+\n?)+)/.exec(fm)?.[1] ?? "";
    return block.split("\n")
      .map(l => /-\s*(.+)/.exec(l)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "")
      .filter(Boolean);
  }
  return [];
}

// @verifies MSL-8
//
// MSL-8 is about the on-disk write, so every load-bearing assertion
// reads the far end — `labels.yaml` and the loader — not the response
// or the row alone. The key bullet is that the file STILL PARSES AS A
// WHOLE after the write: a single malformed entry can make the loader
// reject every label. `loctt label list` runs the real loader, so a
// successful list that names both the new label and a pre-existing one
// proves the whole file re-loads, not merely that the new line is
// present in the text.
test("MSL-8: creating a label writes a valid entry and labels.yaml still parses whole", async ({
  page,
  tracker,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", err => pageErrors.push(err.message));

  // A pre-existing label. If the create corrupts the file, THIS is the
  // label that silently vanishes — so it is the witness for "one
  // malformed entry must not take every label with it".
  await tracker.run(["label", "create", "existing", "--color", "#112233"]);

  await page.goto(`${tracker.baseURL}/settings/labels`);
  await expect(page.getByTestId("labels-list")).toBeVisible();

  await page.getByTestId("label-create-name").fill("Backend");
  await page.getByTestId("label-create-color").fill("#1e6fcb");
  await page.getByTestId("label-create-submit").click();

  // The row lands (the panel refetches on the create mutation). Wait on
  // it before reading disk so the write has completed.
  await expect(
    page.getByTestId("labels-list").getByText("Backend", { exact: true }),
  ).toBeVisible();

  // The far end: the new entry carries a generated ULID id plus name and
  // color, and the id was never typed by the user.
  const yaml = await labelsYaml(tracker.root);
  expect(yaml).toMatch(/name:\s*Backend/);
  expect(yaml).toContain("#1e6fcb");
  // A ULID id sits on the same entry (26 Crockford chars).
  expect(yaml).toMatch(/id:\s*[0-9A-HJKMNP-TV-Z]{26}/);

  // The whole file still parses — the loader lists the new label AND the
  // pre-existing one. A create that emitted one malformed entry would
  // throw here (a non-zero exit makes `tracker.run` reject) or drop
  // `existing`, and either fails the test rather than passing silently.
  const listed = await tracker.run(["label", "list"]);
  expect(listed).toContain("Backend");
  expect(listed).toContain("existing");

  // Immediately offered in a task's label picker, no restart.
  const created = await tracker.run(["create", "Needs a label"]);
  const key = /(\w+-\d+)/.exec(created)?.[1];
  if (key === undefined) throw new Error(`no key in: ${created}`);
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await page.getByTestId("meta-add-label").click();
  await expect(page.getByRole("option", { name: "Backend", exact: true }))
    .toHaveCount(1);

  expect(pageErrors, "the SPA threw while creating a label").toEqual([]);
});

// @verifies MSL-9
//
// MSL-9: a recolour changes the colour on every surface while leaving
// the label's id and every task reference untouched — no task loses its
// label. Asserts the far end (labels.yaml colour + the task's own
// frontmatter still carrying the id) and a rendering surface (the list
// pill's colour), not just the settings row.
test("MSL-9: recolouring a label updates surfaces and keeps every reference", async ({
  page,
  tracker,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", err => pageErrors.push(err.message));

  const created = await tracker.run(["label", "create", "bug", "--color", "#aa0000"]);
  const labelId = /([0-9A-HJKMNP-TV-Z]{26})/.exec(created)?.[1] ?? "";
  expect(labelId).not.toBe("");
  const taskOut = await tracker.run(["create", "Buggy", "--label", "bug"]);
  const key = /(\w+-\d+)/.exec(taskOut)?.[1];
  if (key === undefined) throw new Error(`no key in: ${taskOut}`);

  await page.goto(`${tracker.baseURL}/settings/labels`);
  const row = page.getByTestId(`label-row-${labelId}`);
  await expect(row).toBeVisible();
  await row.getByTestId("label-edit").click();
  const colorInput = row.getByTestId("label-color-input");
  await colorInput.fill("#00aa55");
  await row.getByTestId("label-save").click();
  // The edit form closes on success — wait for it before reading disk.
  await expect(row.getByTestId("label-color-input")).toHaveCount(0);

  // Far end 1: labels.yaml holds the NEW valid hex, and the id is
  // unchanged (same 26-char id, now paired with the new colour).
  await expect.poll(async () => labelsYaml(tracker.root)).toContain("#00aa55");
  const yaml = await labelsYaml(tracker.root);
  expect(yaml).toContain(labelId);
  expect(yaml).not.toContain("#aa0000");

  // Far end 2: the task did not lose its label — its frontmatter still
  // carries the same id. Read the file, not `loctt show`, which renders
  // labels by name and so cannot witness the id.
  expect(await taskLabelsOnDisk(tracker.root, key)).toContain(labelId);

  // Surface: the list-row pill renders in the new colour. The pill's
  // background is derived from the label colour (a translucent wash of
  // it), one colour source for all surfaces (MSL-5), so the list is a
  // genuine second surface, not the settings row again.
  await page.goto(`${tracker.baseURL}/list`);
  const pill = page.locator("tbody").getByTitle("bug", { exact: true });
  await expect(pill).toBeVisible();
  // Read the computed background rather than a data-attribute, so this
  // fails if the colour is written to disk but never reaches the paint.
  // The pill uses a translucent wash (`${color}22`), so match the new
  // colour's rgb channels rather than an exact string, and assert the
  // OLD colour's channels are gone.
  const bg = await pill.evaluate(el => getComputedStyle(el).backgroundColor);
  // #00aa55 → channels 0, 170, 85; #aa0000 → 170, 0, 0.
  expect(bg).toContain("0, 170, 85");
  expect(bg).not.toContain("170, 0, 0");

  expect(pageErrors, "the SPA threw while recolouring a label").toEqual([]);
});

// @verifies MSL-14
//
// MSL-14: setting a target date on an undated milestone writes an ISO
// `YYYY-MM-DD`, the view re-sorts on refresh, and CLEARING returns the
// milestone to the undated presentation — not a `1970-01-01` epoch
// sentinel. All three bullets, each read at the far end.
test("MSL-14: editing a milestone's target date persists, re-sorts, and clears cleanly", async ({
  page,
  tracker,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", err => pageErrors.push(err.message));

  // "Later" is already dated far out; "Undated" starts with no date.
  // After we date "Undated" to 2025-01-01 it must sort BEFORE "Later".
  await tracker.run(["milestone", "create", "Later", "--target-date", "2030-12-31"]);
  await tracker.run(["milestone", "create", "Undated"]);
  const ms = await readMilestones(tracker.root);
  const undatedId = ms.find(m => m.name === "Undated")?.id ?? "";
  expect(undatedId).not.toBe("");

  await page.goto(`${tracker.baseURL}/settings/milestones`);
  const row = page.getByTestId(`milestone-row-${undatedId}`);
  await expect(row.getByTestId("milestone-date")).toHaveAttribute(
    "data-milestone-date",
    "none",
  );
  await row.getByTestId("milestone-edit").click();
  await row.getByTestId("milestone-date-input").fill("2025-01-01");
  await row.getByTestId("milestone-save").click();
  await expect(row.getByTestId("milestone-date-input")).toHaveCount(0);

  // Far end: an ISO YYYY-MM-DD reaches milestones.yaml.
  await expect.poll(async () =>
    readFile(path.join(tracker.root, ".loctt", "config", "milestones.yaml"), "utf8"),
  ).toMatch(/target_date:\s*['"]?2025-01-01['"]?/);

  // Re-sorts on refresh: the newly-dated "Undated" (2025) now precedes
  // "Later" (2030) on the progress view, which orders by target date.
  await page.goto(`${tracker.baseURL}/milestones`);
  // Both rows must be rendered before order can be read — a one-shot
  // allTextContents() races the fetch and can see an empty list.
  await expect(page.getByTestId("milestone-name")).toHaveCount(2);
  const names = await page.getByTestId("milestone-name").allTextContents();
  expect(names).toContain("Undated");
  expect(names).toContain("Later");
  // Undated (now 2025) sorts before Later (2030).
  expect(names.indexOf("Undated")).toBeLessThan(names.indexOf("Later"));

  // Clearing returns to the undated presentation, NOT a 1970 epoch.
  await page.goto(`${tracker.baseURL}/settings/milestones`);
  await row.getByTestId("milestone-edit").click();
  await row.getByTestId("milestone-date-input").fill("");
  await row.getByTestId("milestone-save").click();
  await expect(row.getByTestId("milestone-date-input")).toHaveCount(0);

  await expect(row.getByTestId("milestone-date")).toHaveAttribute(
    "data-milestone-date",
    "none",
  );
  await expect(row.getByTestId("milestone-date")).toHaveText("No target date");
  // The key is gone from disk — not written as an epoch date.
  const cleared = await readFile(
    path.join(tracker.root, ".loctt", "config", "milestones.yaml"),
    "utf8",
  );
  expect(cleared).not.toContain("1970-01-01");
  // The "Undated" entry no longer carries target_date at all. (The
  // still-dated "Later" keeps its own, so a bare absence check would be
  // wrong — scope to the cleared milestone's block.)
  const block = new RegExp(`id:\\s*${undatedId}[\\s\\S]*?(?=\\n- id:|$)`).exec(cleared)?.[0] ?? "";
  expect(block).not.toContain("target_date");

  expect(pageErrors, "the SPA threw while editing a milestone date").toEqual([]);
});

// @verifies MSL-11
//
// Retag (B2): this exercises the *management panel's* archive/unarchive
// TOGGLE — the row stays visible and marked, and `archived: true`
// reaches milestones.yaml. That is panel CRUD, MSL-11's surface. It is
// NOT MSL-25, whose claim is that an archived milestone still *resolves
// on tasks and by URL* (its detail route reachable, excluded from the
// default /milestones view, revealed by a "show archived" affordance) —
// a different surface owned by the milestones-view ticket. The mis-tag
// made MSL-25 look verified here while its task/URL far-end was untested.
test("the milestones panel archives and unarchives without hiding the row", async ({
  page,
  tracker,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", err => pageErrors.push(err.message));

  await tracker.run(["milestone", "create", "Legacy"]);
  const ms = await readMilestones(tracker.root);
  const id = ms.find(m => m.name === "Legacy")?.id ?? "";
  expect(id).not.toBe("");

  await page.goto(`${tracker.baseURL}/settings/milestones`);
  const row = page.getByTestId(`milestone-row-${id}`);
  await expect(row).toHaveAttribute("data-milestone-archived", "false");

  // Archive: one click, no typed confirmation (it is reversible).
  await row.getByTestId("milestone-archive-toggle").click();
  await expect(row).toHaveAttribute("data-milestone-archived", "true");
  await expect(row.getByTestId("milestone-archived-marker")).toBeVisible();
  await expect(row.getByTestId("milestone-archive-toggle")).toHaveText("Unarchive");
  // Far end: the flag reached milestones.yaml.
  await expect.poll(async () =>
    readFile(path.join(tracker.root, ".loctt", "config", "milestones.yaml"), "utf8"),
  ).toMatch(/archived:\s*true/);

  // Unarchive reverses it, and the flag leaves disk.
  await row.getByTestId("milestone-archive-toggle").click();
  await expect(row).toHaveAttribute("data-milestone-archived", "false");
  await expect(row.getByTestId("milestone-archive-toggle")).toHaveText("Archive");
  await expect.poll(async () =>
    readFile(path.join(tracker.root, ".loctt", "config", "milestones.yaml"), "utf8"),
  ).not.toMatch(/archived:\s*true/);

  expect(pageErrors, "the SPA threw while archiving a milestone").toEqual([]);
});

// @verifies MSL-27
//
// MSL-27: a label created in the CLI while the UI is open appears
// without a full restart. A CLI write fires no client mutation, so the
// UI learns of it on the next data refresh. A `page.reload()` drops the
// cache and is the deterministic observation the harness uses for a
// hand/CLI-side write (a fresh, already-observed React Query is not
// refetched by invalidation alone — see known-gaps); the case's bar is
// "next refresh", not "without reload", and the second bullet — no
// indefinitely-cached stale list — is exactly what the reload proves is
// not happening at the data layer.
test("MSL-27: a label created in the CLI surfaces in the open UI on refresh", async ({
  page,
  tracker,
}) => {
  await tracker.run(["label", "create", "already-here"]);

  await page.goto(`${tracker.baseURL}/settings/labels`);
  await expect(
    page.getByTestId("labels-list").getByText("already-here", { exact: true }),
  ).toBeVisible();
  // Positive control: the CLI-made label is absent BEFORE the CLI write,
  // so its later presence is the write surfacing, not a fixture artefact.
  await expect(
    page.getByTestId("labels-list").getByText("from-cli", { exact: true }),
  ).toHaveCount(0);

  // The out-of-band write, while the UI is open.
  await tracker.run(["label", "create", "from-cli"]);

  await page.reload();
  await expect(
    page.getByTestId("labels-list").getByText("from-cli", { exact: true }),
  ).toBeVisible();
  // And the picker offers it too — not a cached stale list.
  const created = await tracker.run(["create", "Pick me"]);
  const key = /(\w+-\d+)/.exec(created)?.[1];
  if (key === undefined) throw new Error(`no key in: ${created}`);
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await page.getByTestId("meta-add-label").click();
  await expect(page.getByRole("option", { name: "from-cli", exact: true }))
    .toHaveCount(1);
});

// @verifies MSL-28
//
// MSL-28: a rename to label B in the UI must not revert a concurrent
// rename to label A made in the CLI. Both renames must survive in
// labels.yaml. The write path reads the file, edits one entry, writes
// it back — so the risk is the UI writing back a copy that predates the
// CLI's edit to A.
//
// The assertion is a BOUNDED, NON-ASSERTING poll of the file (not a
// gesture-then-immediate-read), because the UI save races its own
// refetch under load — the exact shape that has flaked three times in
// this repo (see known-gaps). `expect.poll` retries until both renames
// are present or it times out.
test("MSL-28: concurrent CLI and UI label renames do not clobber each other", async ({
  page,
  tracker,
}) => {
  const a = await tracker.run(["label", "create", "alpha"]);
  const idA = /([0-9A-HJKMNP-TV-Z]{26})/.exec(a)?.[1] ?? "";
  const b = await tracker.run(["label", "create", "beta"]);
  const idB = /([0-9A-HJKMNP-TV-Z]{26})/.exec(b)?.[1] ?? "";
  expect(idA).not.toBe("");
  expect(idB).not.toBe("");

  await page.goto(`${tracker.baseURL}/settings/labels`);
  const rowB = page.getByTestId(`label-row-${idB}`);
  await expect(rowB).toBeVisible();

  // The CLI renames A out of band, while the panel is open on B.
  await tracker.run(["label", "edit", idA, "--name", "alpha-renamed"]);

  // The UI renames B and saves.
  await rowB.getByTestId("label-edit").click();
  await rowB.getByTestId("label-name-input").fill("beta-renamed");
  await rowB.getByTestId("label-save").click();
  await expect(rowB.getByTestId("label-name-input")).toHaveCount(0);

  // Both renames are present after the write. Polled, because the UI
  // save and its refetch race — a single read right after the click can
  // catch the file mid-flight.
  await expect.poll(async () => labelsYaml(tracker.root)).toContain("beta-renamed");
  const yaml = await labelsYaml(tracker.root);
  expect(yaml).toContain("alpha-renamed");
  expect(yaml).toContain("beta-renamed");
  // Neither original name lingers as a whole value — the renames
  // replaced them, and A's rename was not reverted by B's save.
  // Anchored to end-of-value so "alpha" does not match inside
  // "alpha-renamed" (a hyphen is a word boundary).
  expect(yaml).not.toMatch(/name:\s*alpha\s*$/m);
  expect(yaml).not.toMatch(/name:\s*beta\s*$/m);
});
