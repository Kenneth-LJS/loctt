/**
 * Transcribed from docs/dev/ui-test-cases/flow-milestones-labels.md —
 * M4.9, the `/milestones` progress view and `/milestones/<ulid>`
 * detail.
 *
 * **Not Settings → Milestones (M4.3)**, which is CRUD management. The
 * label half of that flow doc (MSL-5..MSL-14, MSL-19..MSL-23, MSL-26..
 * MSL-28, MSL-30..MSL-34, MSL-36, MSL-37) belongs to other tickets and
 * is not exercised here.
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

import { readFile, writeFile } from "node:fs/promises";
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
    await page.getByTestId("milestones-show-archived").check();
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
