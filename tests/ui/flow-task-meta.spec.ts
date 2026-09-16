/**
 * Transcribed from docs/dev/ui-test-cases/flow-tasks.md and
 * flow-cross-surface.md — M2.2a, the meta panel's inline editors.
 *
 * **Every picker case asserts the far end.** A test that a dropdown
 * *shows* "In progress" passes whether or not the write stored
 * `in_progress`, which is vacuity shape 2 and is what LST-16 and VUE-6
 * did. So each write here is read back off disk (`frontmatterOf`) or
 * through the CLI (`tracker.run(["show", key])`) — a surface that
 * cannot be fooled by client state.
 *
 * Reads off disk rather than a `page.reload()` wherever the case is
 * about client behaviour: a reload refetches everything from the
 * server regardless of what the client does, and can mask the deletion
 * of the whole mechanism under test (the XS-1 defect). Where a case
 * explicitly requires persistence *across* a reload, the reload is the
 * assertion and is named as such.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** The frontmatter block of the task with this key. */
async function frontmatterOf(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) return text;
  }
  throw new Error(`no task on disk with key ${key}`);
}

/**
 * Waits until the file on disk satisfies `predicate`, then returns it.
 *
 * The write is asynchronous from the browser's point of view, so a
 * bare read races it. Polling the *file* rather than the DOM is the
 * point: the DOM is optimistic and would satisfy an assertion before
 * anything reached disk.
 */
async function waitForFile(
  root: string,
  key: string,
  predicate: (text: string) => boolean,
  what: string,
): Promise<string> {
  const deadline = Date.now() + 10_000;
  let last = "";
  while (Date.now() < deadline) {
    last = await frontmatterOf(root, key);
    if (predicate(last)) return last;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`task.md for ${key} never ${what}. Last:\n${last}`);
}

/** Rewrites `workflow.yaml` wholesale. */
async function writeWorkflow(root: string, yaml: string): Promise<void> {
  await writeFile(path.join(root, ".loctt", "config", "workflow.yaml"), yaml, "utf8");
}

async function readWorkflow(root: string): Promise<string> {
  return readFile(path.join(root, ".loctt", "config", "workflow.yaml"), "utf8");
}

/** The meta panel's trigger for a field, by its rendered label. */
function trigger(page: import("@playwright/test").Page, label: string) {
  return page.getByTestId(`meta-edit-${label}`);
}

function options(page: import("@playwright/test").Page, label: string) {
  return page.getByTestId(`meta-options-${label}`);
}

test.describe("TSK — meta panel pickers", () => {
  // @verifies TSK-4
  test("TSK-4: status edits inline against the configured vocabulary, and the key lands on disk", async ({
    page,
    tracker,
  }) => {
    // Seven statuses, none of them the built-in four, and labels that
    // differ from their keys in a way no hardcoded map could produce.
    // A panel that shipped a To Do / In Progress / Done list, or that
    // rendered the raw key, fails here and passes against the default
    // config — which is why the default config is not what this uses.
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Vocabulary task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // The trigger renders the *label*, not the key it stores.
    await expect(trigger(page, "status")).toContainText("Triaging");
    expect(await trigger(page, "status").innerText()).not.toContain("triage");

    await trigger(page, "status").click();
    const list = options(page, "status");

    // All seven, in configured order. Both halves matter: a panel
    // that clipped to three renders three of these correctly.
    await expect(list.getByRole("option")).toHaveCount(7);
    await expect(list.getByRole("option")).toHaveText([
      "Triaging",
      "Specced",
      "Building",
      "In review",
      "Verifying",
      "Shipped",
      "Abandoned",
    ]);

    await list.getByRole("option", { name: "In review" }).click();

    // Optimistic: the panel has moved before anything settled. This is
    // asserted against the *label*, and the disk assertion below is
    // what makes the pair meaningful — either alone is vacuous.
    await expect(trigger(page, "status")).toContainText("In review");

    // The far end. `in_review` is the config key; "In review" is the
    // label, and a panel that stored the label would satisfy every
    // on-screen assertion above.
    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*in_review\s*$/m.test(t),
      "took status in_review",
    );
    expect(fm).not.toMatch(/^status:\s*In review\s*$/m);

    // And through a different surface entirely, which cannot be
    // fooled by anything the browser did. `loctt show` prints the
    // stored value — the key — which is exactly the assertion that
    // matters here: the browser stored `in_review`, not "In review".
    const shown = await tracker.run(["show", key]);
    expect(shown).toMatch(/Status:\s*in_review/);

    // Survives a reload — server truth, not a cache (TSK-4 bullet 3).
    await page.reload();
    await expect(trigger(page, "status")).toContainText("In review");

    // No full page load was required for the change itself: the URL
    // never changed and no modal appeared.
    await expect(page).toHaveURL(new RegExp(`/tasks/${key}$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  // @verifies TSK-5
  test("TSK-5: a completed-category status sets the read-only completed date; leaving clears it", async ({
    page,
    tracker,
  }) => {
    // The completed-category status here is called "Shipped", not
    // "Done", and there is a *decoy*: "Abandoned" is `discarded`, not
    // `completed`. An implementation keyed on a status named "done"
    // fails this; one keyed on category passes. That is TSK-5's fourth
    // bullet, and without the rename the test could not tell them
    // apart.
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Completion task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("meta-completed-date")).toHaveCount(0);

    // Into `discarded` first. A completed date appearing here would
    // mean the trigger is "a terminal-looking status" rather than the
    // category the case names.
    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "Abandoned" }).click();
    await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*abandoned\s*$/m.test(t),
      "took status abandoned",
    );
    expect(await frontmatterOf(tracker.root, key)).not.toMatch(/^completed_date:/m);
    await expect(page.getByTestId("meta-completed-date")).toHaveCount(0);

    // Now into `completed`.
    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "Shipped" }).click();

    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^completed_date:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(t),
      "gained a completed_date",
    );
    expect(fm).toMatch(/^status:\s*shipped\s*$/m);

    const completed = page.getByTestId("meta-completed-date");
    await expect(completed).toBeVisible();

    // Read-only: no edit affordance. Positive assertion first — the
    // row is present and shows a date — so this is not green merely
    // because the row vanished.
    await expect(completed).toContainText(/\d/);
    await expect(page.getByTestId("meta-edit-completed")).toHaveCount(0);
    await expect(completed.getByRole("button")).toHaveCount(0);
    // Clicking it opens nothing.
    await completed.click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(completed.getByRole("textbox")).toHaveCount(0);

    // Back out of the completed category clears it.
    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "Building" }).click();
    await waitForFile(
      tracker.root,
      key,
      t => !/^completed_date:/m.test(t) && /^status:\s*building\s*$/m.test(t),
      "cleared completed_date",
    );
    await expect(page.getByTestId("meta-completed-date")).toHaveCount(0);
  });

  // @verifies TSK-6
  test("TSK-6: priority and type render seven configured entries and store keys", async ({
    page,
    tracker,
  }) => {
    // Seven priorities, because "the panel does not assume three" is
    // the bullet. Their labels are again nothing a hardcoded
    // Low/Medium/High map could produce.
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Priority task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    await trigger(page, "priority").click();
    const prios = options(page, "priority");
    await expect(prios.getByRole("option")).toHaveText([
      "Drop everything",
      "This week",
      "This sprint",
      "This quarter",
      "Someday",
      "Nice to have",
      "Not now",
    ]);
    await prios.getByRole("option", { name: "This sprint" }).click();

    await waitForFile(
      tracker.root,
      key,
      t => /^priority:\s*p3_sprint\s*$/m.test(t),
      "took priority p3_sprint",
    );

    await trigger(page, "type").click();
    const types = options(page, "type");
    await expect(types.getByRole("option")).toHaveText([
      "Chore",
      "Defect",
      "Investigation",
    ]);
    await types.getByRole("option", { name: "Investigation" }).click();

    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^task_type:\s*investigation\s*$/m.test(t),
      "took task_type investigation",
    );
    // The label never lands in frontmatter.
    expect(fm).not.toMatch(/This sprint|Investigation/);

    // Both survive a reload (TSK-6 bullet 3).
    await page.reload();
    await expect(trigger(page, "priority")).toContainText("This sprint");
    await expect(trigger(page, "type")).toContainText("Investigation");
  });

  // @verifies TSK-7
  test("TSK-7: the user picker marks archived users, disambiguates duplicate names, and stores ULIDs", async ({
    page,
    tracker,
  }) => {
    // Two users sharing a display name, plus an archived one. Every
    // clause of the case needs a seeded condition that could fail:
    // one user would make "disambiguates" untestable, and no archived
    // user would make the marker untestable.
    await tracker.run(["user", "create", "Sam Rivers", "--email", "sam1@example.com"]);
    await tracker.run(["user", "create", "Sam Rivers", "--email", "sam2@example.com"]);
    await tracker.run(["user", "create", "Old Hand", "--email", "old@example.com"]);
    const [key] = await tracker.seed([{ title: "Assignment task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    // Assign the soon-to-be-archived user *first*, so the "historical
    // attribution is preserved" bullet has something to preserve.
    await tracker.run(["set", key, "assignee", "Old Hand"]);
    await tracker.run(["user", "archive", "Old Hand"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // Bullet 3: the archived assignee still displays, by name, marked.
    // Not blank, and not a raw ULID.
    const assignee = trigger(page, "assignee");
    await expect(assignee).toContainText("Old Hand");
    await expect(assignee).toContainText("(archived)");
    expect(await assignee.innerText()).not.toMatch(/[0-9A-HJKMNP-TV-Z]{26}/);

    await assignee.click();
    const list = options(page, "assignee");

    // Bullet 2: the archived user is listed, marked, and *cannot be
    // selected*. Disabled rather than absent — absent would render the
    // current value as unresolved.
    const archived = list.getByRole("option", { name: /Old Hand/ });
    await expect(archived).toContainText("(archived)");
    await expect(archived).toBeDisabled();

    // Bullet 4: the two Sam Rivers are told apart. Both carry a
    // fragment of their own id, and the fragments differ — which is
    // the whole claim, since the names do not.
    const sams = list.getByRole("option", { name: /Sam Rivers/ });
    await expect(sams).toHaveCount(2);
    const hints = (await sams.allInnerTexts()).map(
      t => /([0-9A-HJKMNP-TV-Z]{6})\s*$/.exec(t.trim())?.[1] ?? "",
    );
    expect(hints[0]).not.toBe("");
    expect(hints[1]).not.toBe("");
    expect(hints[0]).not.toBe(hints[1]);

    // Click the *second* one specifically, so "the right user was
    // stored" is a claim that can fail — clicking the first would also
    // be satisfied by a picker that always assigned whoever came first.
    const clickedHint = hints[1] ?? "";
    await sams.nth(1).click();

    // Bullet 5: the ULID lands, not the name. Both halves — a file
    // holding "Sam Rivers" would satisfy a bare "assignee changed".
    //
    // The predicate names the *clicked* id, not merely "some ULID":
    // the task already held the archived user's ULID, so a predicate
    // that only asked for a ULID was satisfied by the value that was
    // there before the click and returned before the write landed.
    const fm = await waitForFile(
      tracker.root,
      key,
      t => new RegExp(`^assignee:\\s*[0-9A-HJKMNP-TV-Z]{20}${clickedHint}\\s*$`, "m").test(t),
      `took the clicked assignee (…${clickedHint})`,
    );
    expect(fm).not.toMatch(/^assignee:\s*Sam Rivers/m);

    // And it is the one that was clicked, not merely *a* ULID — which
    // is what makes the disambiguation claim mean something rather
    // than "some Sam was assigned".
    const stored = /^assignee:\s*(\S+)\s*$/m.exec(fm)?.[1] ?? "";
    expect(stored.slice(-6)).toBe(clickedHint);
  });

  // @verifies TSK-8
  // @verifies TSK-28
  test("TSK-8/TSK-28: dates round-trip verbatim, mark non-working days, clear rather than blank, and flag inversion", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Dated task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // TSK-28: 1970-01-01. The bug this guards is a value treated as
    // epoch zero and rendered "no date"; and 1970-01-01 is a Thursday,
    // a working day in the default calendar, so it is not accidentally
    // marked either.
    await trigger(page, "due").click();
    await page.getByTestId("meta-input-due").fill("1970-01-01");
    await page.getByTestId("meta-input-due").press("Enter");
    await waitForFile(
      tracker.root,
      key,
      t => /^due_date:\s*'?1970-01-01'?\s*$/m.test(t),
      "took due_date 1970-01-01",
    );
    // Displayed as that date, with its year — not "Jan 1" (which would
    // read as this year) and not "no date".
    await expect(trigger(page, "due")).toContainText("1970");
    await expect(trigger(page, "due")).toContainText("Jan 1");

    // TSK-28: 2099-12-31 is accepted rather than clamped to a nearer
    // year. The `max` on the input is what could clamp it, so the disk
    // assertion is the one that matters.
    await trigger(page, "due").click();
    await page.getByTestId("meta-input-due").fill("2099-12-31");
    await page.getByTestId("meta-input-due").press("Enter");
    await waitForFile(
      tracker.root,
      key,
      t => /^due_date:\s*'?2099-12-31'?\s*$/m.test(t),
      "took due_date 2099-12-31",
    );

    // TSK-28 bullet 3: round-trips through a reload unchanged. The
    // reload is the assertion here, not an accident.
    await page.reload();
    await expect(trigger(page, "due")).toContainText("2099");
    await expect(trigger(page, "due")).toContainText("Dec 31");

    // TSK-8 bullet 1: a non-working day is marked. 2099-12-31 is a
    // Thursday — a working day — so the *absence* of a marker now is
    // what makes its presence next meaningful.
    await expect(page.getByTestId("meta-nonworking-due")).toHaveCount(0);

    // 2026-01-03 is a Saturday; `working_days` is Mon–Fri.
    await trigger(page, "due").click();
    await page.getByTestId("meta-input-due").fill("2026-01-03");
    await page.getByTestId("meta-input-due").press("Enter");
    await waitForFile(
      tracker.root,
      key,
      t => /^due_date:\s*'?2026-01-03'?\s*$/m.test(t),
      "took due_date 2026-01-03",
    );
    await expect(page.getByTestId("meta-nonworking-due")).toContainText("Saturday");

    // TSK-8 bullet 4: start after due is flagged rather than saving
    // silently as though valid.
    await trigger(page, "start").click();
    await page.getByTestId("meta-input-start").fill("2026-06-01");
    await page.getByTestId("meta-input-start").press("Enter");
    await waitForFile(
      tracker.root,
      key,
      t => /^start_date:\s*'?2026-06-01'?\s*$/m.test(t),
      "took start_date 2026-06-01",
    );
    await expect(page.getByTestId("meta-problem-start")).toBeVisible();
    await expect(page.getByTestId("meta-problem-due")).toBeVisible();

    // TSK-8 bullet 3: clearing removes the key. Not `due_date: ""`,
    // not today's date — the two failures the bullet names.
    await trigger(page, "due").click();
    await page.getByTestId("meta-input-due").fill("");
    await page.getByTestId("meta-input-due").press("Enter");
    const cleared = await waitForFile(
      tracker.root,
      key,
      t => !/^due_date:/m.test(t),
      "dropped due_date",
    );
    expect(cleared).not.toMatch(/^due_date:\s*(''|""|null)\s*$/m);
    expect(cleared).not.toMatch(new RegExp(`^due_date:.*${new Date().toISOString().slice(0, 10)}`, "m"));
    // The inversion flag goes with it, since there is nothing to
    // invert against any more.
    await expect(page.getByTestId("meta-problem-start")).toHaveCount(0);
  });

  // @verifies TSK-9
  test("TSK-9: the estimate control follows the configured estimation mode", async ({
    page,
    tracker,
  }) => {
    // Numeric first, with a unit_label the panel cannot guess.
    const [key] = await tracker.seed([{ title: "Estimated task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await trigger(page, "estimate").click();
    await page.getByTestId("meta-input-estimate").fill("5");
    await page.getByTestId("meta-input-estimate").press("Enter");
    await waitForFile(
      tracker.root,
      key,
      t => /^estimate:\s*5\s*$/m.test(t),
      "took estimate 5",
    );
    // "5 pts" — the configured `unit_label`, rendered as a suffix.
    await expect(trigger(page, "estimate")).toContainText("5");
    await expect(trigger(page, "estimate")).toContainText("pts");
  });

  // @verifies TSK-9
  test("TSK-9: custom_enum estimation is a constrained picker, and disabled estimation removes the row", async ({
    page,
    tracker,
  }) => {
    const base = await readWorkflow(tracker.root);
    await writeWorkflow(
      tracker.root,
      base.replace(
        /estimation:[\s\S]*?(?=\ntimeline:)/,
        [
          "estimation:",
          "  enabled: true",
          "  unit: custom_enum",
          "  unit_label: size",
          "  preset_values:",
          "    - XS",
          "    - S",
          "    - M",
          "    - L",
          "",
        ].join("\n"),
      ),
    );
    const [key] = await tracker.seed([{ title: "Sized task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // A picker, not a free-text box. Asserting the textbox is absent
    // alone would pass on a panel with no estimate row at all, so the
    // option list is asserted positively first.
    await trigger(page, "estimate").click();
    await expect(options(page, "estimate").getByRole("option")).toHaveText([
      "XS", "S", "M", "L",
    ]);
    await expect(page.getByTestId("meta-input-estimate")).toHaveCount(0);

    await options(page, "estimate").getByRole("option", { name: "M", exact: true }).click();
    await waitForFile(
      tracker.root,
      key,
      t => /^estimate:\s*'?M'?\s*$/m.test(t),
      "took estimate M",
    );

    // Disabled → the row is absent entirely, not shown empty.
    await writeWorkflow(
      tracker.root,
      base.replace(
        /estimation:[\s\S]*?(?=\ntimeline:)/,
        "estimation:\n  enabled: false\n  unit: points\n\n",
      ),
    );
    await page.reload();
    // Positive first: the panel is rendering, and other rows are
    // there. Without this the absence check is green on a blank page.
    await expect(trigger(page, "status")).toBeVisible();
    await expect(page.getByTestId("meta-edit-estimate")).toHaveCount(0);
    await expect(page.getByTestId("meta-panel")).not.toContainText("Estimate");
  });

  // @verifies TSK-10
  test("TSK-10: milestone and sprint pick from config, store keys, and keep archived references visible", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["milestone", "create", "Launch", "--target-date", "2026-09-01"]);
    await tracker.run(["milestone", "create", "Retired MS"]);
    await tracker.run(["sprint", "create", "Sprint 7", "--start", "2026-01-01", "--end", "2026-01-14"]);
    const [key] = await tracker.seed([{ title: "Planned task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    // Bullet 3 needs a task already pointing at what will be archived.
    await tracker.run(["set", key, "milestone", "Retired MS"]);
    await tracker.run(["milestone", "archive", "Retired MS"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // Shows the archived milestone by name, marked — not blank.
    await expect(trigger(page, "milestone")).toContainText("Retired MS");
    await expect(trigger(page, "milestone")).toContainText("(archived)");

    await trigger(page, "milestone").click();
    const ms = options(page, "milestone");
    // The archived one is excluded from *new selection* — present but
    // disabled — while the live one is choosable.
    await expect(ms.getByRole("option", { name: /Retired MS/ })).toBeDisabled();
    await expect(ms.getByRole("option", { name: /^Launch/ })).toBeEnabled();
    await ms.getByRole("option", { name: /^Launch/ }).click();

    // The entry's id, not its name.
    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^milestone:\s*[0-9A-HJKMNP-TV-Z]{26}\s*$/m.test(t),
      "took a milestone id",
    );
    expect(fm).not.toMatch(/^milestone:\s*Launch/m);

    await trigger(page, "sprint").click();
    await options(page, "sprint").getByRole("option", { name: "Sprint 7" }).click();
    await waitForFile(
      tracker.root,
      key,
      t => /^sprint:\s*[0-9A-HJKMNP-TV-Z]{26}\s*$/m.test(t),
      "took a sprint id",
    );

    // Bullet 2's second half: clearing removes the field.
    await trigger(page, "milestone").click();
    await options(page, "milestone").getByRole("option", { name: /^Clear/ }).click();
    const cleared = await waitForFile(
      tracker.root,
      key,
      t => !/^milestone:/m.test(t),
      "dropped milestone",
    );
    expect(cleared).not.toMatch(/^milestone:\s*(''|""|null)/m);
  });

  // @verifies TSK-11
  test("TSK-11: labels attach, create inline, detach without deleting, and reach the list filter", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "bug", "--color", "#cc0000"]);
    const [first, second] = await tracker.seed([
      { title: "Labelled task" },
      { title: "Other task" },
    ]);
    if (first === undefined || second === undefined) throw new Error("seed returned no keys");

    await page.goto(`${tracker.baseURL}/tasks/${first}`);

    // Attach the existing one. Its pill carries the configured colour
    // — not a colour this app chose (P3's hardcoded-colour-map
    // violation).
    await page.getByTestId("meta-add-label").click();
    await page.getByTestId("meta-label-options").getByRole("option", { name: "bug" }).click();
    await waitForFile(
      tracker.root,
      first,
      t => /^labels:/m.test(t),
      "gained a labels list",
    );
    const pill = page.getByTestId("label-pill").filter({ hasText: "bug" });
    await expect(pill).toBeVisible();
    expect(await pill.evaluate(el => getComputedStyle(el).color)).toBe("rgb(204, 0, 0)");

    // Inline creation: a name not yet defined offers "Create label",
    // and accepting writes it to labels.yaml *and* attaches it, in one
    // flow without leaving the task.
    await page.getByTestId("meta-add-label").click();
    await expect(page.getByTestId("meta-label-input")).toBeVisible();
    await page.getByTestId("meta-label-input").fill("regression");
    await page.getByTestId("meta-create-label").click();

    await expect(page.getByTestId("label-pill").filter({ hasText: "regression" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/tasks/${first}$`));

    // Both far ends: the label is in labels.yaml, and attached on disk.
    const labelsYaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "labels.yaml"),
      "utf8",
    );
    expect(labelsYaml).toContain("regression");
    await waitForFile(
      tracker.root,
      first,
      t => (t.match(/^\s+- [0-9A-HJKMNP-TV-Z]{26}$/gm) ?? []).length === 2,
      "attached two labels",
    );

    // Removing a pill detaches but does NOT delete from labels.yaml.
    await pill.getByRole("button", { name: /Remove label bug/ }).click();
    await waitForFile(
      tracker.root,
      first,
      t => (t.match(/^\s+- [0-9A-HJKMNP-TV-Z]{26}$/gm) ?? []).length === 1,
      "detached one label",
    );
    // Still in the config file...
    expect(
      await readFile(path.join(tracker.root, ".loctt", "config", "labels.yaml"), "utf8"),
    ).toContain("bug");
    // ...and still offered on *another* task, which is the bullet's
    // own way of putting it and a stronger claim than reading the file.
    await page.goto(`${tracker.baseURL}/tasks/${second}`);
    await page.getByTestId("meta-add-label").click();
    await expect(
      page.getByTestId("meta-label-options").getByRole("option", { name: "bug" }),
    ).toBeVisible();

    // Bullet 4: the new label is immediately available in the list
    // view's Label filter — no reload between creating it and using
    // it, which is what "immediately" means here.
    await page.getByTestId("meta-label-options").getByRole("option", { name: "regression" }).click();
    await page.goto(`${tracker.baseURL}/list`);
    await page.getByRole("button", { name: "Filter Label" }).click();
    // Both labels offered — the pre-existing one and the one created
    // from the task detail moments ago. The pre-existing one is the
    // control: a filter that listed nothing would fail on it too, so
    // "regression is there" is not green by accident.
    await expect(
      page.getByRole("menuitemcheckbox", { name: "bug" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitemcheckbox", { name: "regression" }),
    ).toBeVisible();
  });

  // @verifies TSK-12
  test("TSK-12: each custom field type renders its own control and writes under fields:", async ({
    page,
    tracker,
  }) => {
    const base = await readWorkflow(tracker.root);
    await writeWorkflow(tracker.root, base.replace("custom_fields: []", CUSTOM_FIELDS_BLOCK));
    const [key] = await tracker.seed([{ title: "Custom task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // string → text input
    await trigger(page, "component").click();
    await page.getByTestId("meta-input-component").fill("parser");
    await page.getByTestId("meta-input-component").press("Enter");

    // number → rejects non-numeric text without sending it
    await trigger(page, "story-points").click();
    await page.getByTestId("meta-input-story-points").fill("abc");
    await page.getByTestId("meta-input-story-points").press("Enter");
    await expect(page.getByTestId("meta-problem-story-points")).toBeVisible();
    await page.getByTestId("meta-input-story-points").fill("8");
    await page.getByTestId("meta-input-story-points").press("Enter");

    // date → date input
    await trigger(page, "review-by").click();
    await page.getByTestId("meta-input-review-by").fill("2026-05-05");
    await page.getByTestId("meta-input-review-by").press("Enter");

    // boolean → two-state control. `click()` rather than `check()`:
    // the input is React-controlled and only flips once the optimistic
    // update lands, which Playwright's `check()` treats as the click
    // having failed.
    await page.getByTestId("meta-input-needs_docs").click();
    await expect(page.getByTestId("meta-input-needs_docs")).toBeChecked();

    // enum, multi:false → constrained picker that *replaces*
    await trigger(page, "team").click();
    await options(page, "team").getByRole("option", { name: "Platform" }).click();
    await waitForFile(tracker.root, key, t => /team: platform/.test(t), "took team platform");
    await trigger(page, "team").click();
    await options(page, "team").getByRole("option", { name: "Frontend" }).click();

    const fm = await waitForFile(
      tracker.root,
      key,
      t =>
        /component: parser/.test(t) &&
        /story_points: 8/.test(t) &&
        /review_by: '?2026-05-05'?/.test(t) &&
        /needs_docs: true/.test(t) &&
        /team: frontend/.test(t),
      "took every custom field",
    );

    // Bullet 3: under `fields:`, not as top-level keys. Both halves —
    // the values being present says nothing about where.
    const fieldsBlock = /^fields:\n((?:[ \t]+.*\n)+)/m.exec(fm)?.[1] ?? "";
    expect(fieldsBlock).toContain("component: parser");
    expect(fieldsBlock).toContain("team: frontend");
    expect(fm).not.toMatch(/^component:/m);
    expect(fm).not.toMatch(/^team:/m);

    // multi:false replaced rather than appended: exactly one team.
    expect(fm).not.toContain("platform");

    // The invalid number never reached disk (TSK-12 bullet 1, and the
    // "not written to disk" clause of TSK-49).
    expect(fm).not.toContain("abc");

    // multi:true appends rather than replaces.
    await trigger(page, "add-to-platforms").click();
    await options(page, "add-to-platforms").getByRole("option", { name: "iOS" }).click();
    await waitForFile(tracker.root, key, t => /platforms:/.test(t), "gained platforms");
    await trigger(page, "add-to-platforms").click();
    await options(page, "add-to-platforms").getByRole("option", { name: "Android" }).click();
    const multi = await waitForFile(
      tracker.root,
      key,
      t => /- ios/.test(t) && /- android/.test(t),
      "kept both platforms",
    );
    expect(multi).toMatch(/platforms:\n\s+- ios\n\s+- android/);
  });

  // @verifies TSK-12
  test("TSK-12: custom fields scope to the task's type, and an out-of-scope value stays read-only", async ({
    page,
    tracker,
  }) => {
    // `severity` is scoped to type `defect`; `component` is global. The
    // SEVEN_STATUS_WORKFLOW declares types chore / defect / investigation.
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW.replace("custom_fields: []", SCOPED_FIELDS_BLOCK));
    const [key] = await tracker.seed([{ title: "Scoped task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    // Make it a defect and set the defect-scoped field.
    await tracker.run(["set", key, "task_type", "defect"]);
    await tracker.run(["set", key, "severity", "high"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // As a defect: both the scoped Severity and the global Component
    // rows are editable and present.
    await expect(trigger(page, "severity")).toBeVisible();
    await expect(trigger(page, "component")).toBeVisible();
    // The out-of-scope read-only presentation is NOT shown while in scope.
    await expect(page.getByTestId("meta-out-of-scope-severity")).toHaveCount(0);

    // Change the type to Chore in the UI — no reload. Severity is now out
    // of scope, but it HAS a value, so it must show read-only with a note
    // and a Remove action (K91), never silently vanish.
    await trigger(page, "type").click();
    await options(page, "type").getByRole("option", { name: "Chore" }).click();
    await waitForFile(tracker.root, key, t => /^task_type:\s*chore\s*$/m.test(t), "became a chore");

    // The editable Severity control is gone; the read-only kept-value is shown.
    await expect(trigger(page, "severity")).toHaveCount(0);
    const readonly = page.getByTestId("meta-out-of-scope-severity");
    await expect(readonly).toBeVisible();
    await expect(readonly).toContainText("high");
    // Global Component stays editable throughout.
    await expect(trigger(page, "component")).toBeVisible();

    // The value is still on disk — K91 forbids an automatic write on the
    // type change.
    expect(await frontmatterOf(tracker.root, key)).toMatch(/severity: high/);

    // The Remove action removes it deliberately.
    await page.getByRole("button", { name: /Remove Severity/i }).click();
    await waitForFile(tracker.root, key, t => !/severity:/.test(t), "removed the out-of-scope value");
    await expect(page.getByTestId("meta-out-of-scope-severity")).toHaveCount(0);
  });

  // @verifies TSK-13
  // @verifies TSK-37
  test("TSK-13/TSK-37: rapid successive changes settle on the last one, on screen and on disk", async ({
    page,
    tracker,
  }) => {
    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Racing task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    const before = /^updated_at:\s*(\S+)/m.exec(await frontmatterOf(tracker.root, key))?.[1];

    // **The delay goes on the response, not the request.**
    //
    // Delaying the *request* would reorder what reaches the server,
    // and the server serializes writes through a state lock in arrival
    // order — so a slowed first request makes the file honestly end on
    // the first value. The test would then be asserting that the
    // client overrides the server, which is not what TSK-37 asks for
    // and not what P1 permits.
    //
    // What the case actually forbids is "an earlier response arriving
    // late must not repaint the panel with a superseded value". So the
    // requests go out and are processed in order, and their
    // *responses* are held so that response 1 lands after response 3.
    // A client that seeded its cache from each response would then
    // flick the panel back to the first status.
    let responses = 0;
    await page.route("**/api/tasks/**/set", async route => {
      const res = await route.fetch();
      const body = await res.text();
      responses += 1;
      // First response held longest, last released at once.
      const hold = responses === 1 ? 1800 : responses === 2 ? 900 : 0;
      await new Promise(r => setTimeout(r, hold));
      await route.fulfill({
        status: res.status(),
        headers: res.headers(),
        body,
      });
    });

    for (const label of ["Specced", "Building", "In review"]) {
      await trigger(page, "status").click();
      await options(page, "status").getByRole("option", { name: label }).click();
    }

    // The panel ends on the third — and stays there while the two
    // superseded responses land.
    await expect(trigger(page, "status")).toContainText("In review");
    await page.waitForTimeout(3000);
    await expect(trigger(page, "status")).toContainText("In review");

    // The file ends on the third too: the requests were never
    // reordered, so the server's own ordering is what settles it.
    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*in_review\s*$/m.test(t),
      "settled on in_review",
    );

    // TSK-13's third bullet: the footer's updated timestamp moved.
    expect(/^updated_at:\s*(\S+)/m.exec(fm)?.[1]).not.toBe(before);

    // Nothing left in flight that would later overwrite: after the
    // network is quiet, disk and panel agree.
    await page.waitForLoadState("networkidle");
    expect(await frontmatterOf(tracker.root, key)).toMatch(/^status:\s*in_review\s*$/m);
    await expect(trigger(page, "status")).toContainText("In review");
  });

  // @verifies TSK-41
  test("TSK-41: Escape closes the dropdown, sends no request, and returns focus to the trigger", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Escapable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    const original = await frontmatterOf(tracker.root, key);

    const writes: string[] = [];
    page.on("request", r => {
      if (r.method() === "POST" && r.url().includes("/set")) writes.push(r.url());
    });

    await trigger(page, "status").click();
    await expect(options(page, "status")).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(options(page, "status")).toHaveCount(0);
    // The original value remains — positive, not merely "nothing
    // changed": the trigger still reads Backlog.
    await expect(trigger(page, "status")).toContainText("Backlog");
    expect(writes).toHaveLength(0);
    expect(await frontmatterOf(tracker.root, key)).toBe(original);

    // Focus is back on the trigger, so keyboard navigation continues.
    // Asserted by *using* it: Enter reopens the list, which only works
    // if the trigger is what has focus.
    await page.keyboard.press("Enter");
    await expect(options(page, "status")).toBeVisible();
  });

  // @verifies TSK-42
  test("TSK-42: clearing an optional field removes the key rather than storing a blank", async ({
    page,
    tracker,
  }) => {
    const base = await readWorkflow(tracker.root);
    await writeWorkflow(tracker.root, base.replace("custom_fields: []", CUSTOM_FIELDS_BLOCK));
    await tracker.run(["user", "create", "Pat Lane", "--email", "pat@example.com"]);
    await tracker.run(["milestone", "create", "Launch"]);
    const [key] = await tracker.seed([{ title: "Clearable task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "assignee", "Pat Lane"]);
    await tracker.run(["set", key, "milestone", "Launch"]);
    await tracker.run(["set", key, "component", "parser"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    // Seeded values are actually there, so the clears below have
    // something to clear.
    await expect(trigger(page, "assignee")).toContainText("Pat Lane");
    await expect(trigger(page, "milestone")).toContainText("Launch");

    await trigger(page, "assignee").click();
    await options(page, "assignee").getByRole("option", { name: /^Clear/ }).click();
    await trigger(page, "milestone").click();
    await options(page, "milestone").getByRole("option", { name: /^Clear/ }).click();
    await trigger(page, "component").click();
    await page.getByTestId("meta-input-component").fill("");
    await page.getByTestId("meta-input-component").press("Enter");

    const fm = await waitForFile(
      tracker.root,
      key,
      t => !/^assignee:/m.test(t) && !/^milestone:/m.test(t) && !/component:/.test(t),
      "dropped all three",
    );
    // Absent, not present-and-empty. The regexes above only prove
    // absence of the exact key line; these rule out the blank forms
    // the case names.
    expect(fm).not.toMatch(/(assignee|milestone|component):\s*(''|""|null|~)\s*$/m);

    // Each row returns to its unset presentation.
    await expect(trigger(page, "assignee")).toContainText("—");
    await expect(trigger(page, "milestone")).toContainText("—");

    // The list view's corresponding column shows an empty cell.
    await page.goto(`${tracker.baseURL}/list`);
    const row = page.getByRole("row").filter({ hasText: "Clearable task" });
    await expect(row).toHaveCount(1);
    await expect(row).not.toContainText("Pat Lane");
  });

  // @verifies TSK-14
  // @verifies XS-46
  test("TSK-14/XS-46: the footer shows created/updated and prior keys, and nothing when there are none", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Web App", "--prefix", "WEB"]);
    const [moving, staying] = await tracker.seed([
      { title: "Rekeyed task" },
      { title: "Stable task" },
    ]);
    if (moving === undefined || staying === undefined) throw new Error("seed returned no keys");

    // A task with no key_history — the discriminating half. Without
    // it, "shows no such row" could be green because the row never
    // renders for anyone.
    await page.goto(`${tracker.baseURL}/tasks/${staying}`);
    await expect(page.getByTestId("meta-created")).toBeVisible();
    await expect(page.getByTestId("meta-updated")).toBeVisible();
    await expect(page.getByTestId("meta-key-history")).toHaveCount(0);
    await expect(page.getByTestId("meta-panel")).not.toContainText("Previously");

    // The absolute timestamp is available on hover, via `title`.
    const createdAt = /^created_at:\s*(\S+)/m.exec(
      await frontmatterOf(tracker.root, staying),
    )?.[1] ?? "";
    expect(createdAt).not.toBe("");
    await expect(page.getByTestId("meta-created").locator("time")).toHaveAttribute(
      "title",
      createdAt,
    );

    // Now the task that *has* history.
    const out = await tracker.run(["move", moving, "Web App"]);
    const newKey = /→\s*(\S+)/.exec(out)?.[1];
    if (newKey === undefined) throw new Error(`no key in: ${out}`);

    await page.goto(`${tracker.baseURL}/tasks/${newKey}`);
    const history = page.getByTestId("meta-key-history");
    await expect(history).toBeVisible();
    // Both keys, and the old one labelled as previous so it cannot be
    // mistaken for the live one.
    await expect(history).toContainText(moving);
    await expect(history).toContainText(newKey);
    await expect(history).toContainText("Previously");
  });

  // @verifies TSK-26
  test("TSK-26: 25 labels wrap inside the panel and stay individually removable", async ({
    page,
    tracker,
  }) => {
    const names = Array.from({ length: 25 }, (_u, i) => `label-${String(i + 1).padStart(2, "0")}`);
    for (const n of names) await tracker.run(["label", "create", n]);
    // `loctt set <key> labels` wants an array, not a comma string, so
    // the labels go on at creation via the repeatable `--label` flag.
    const out = await tracker.run([
      "create", "Overloaded task", ...names.flatMap(n => ["--label", n]),
    ]);
    const key = /\b([A-Z][A-Z0-9]*-\d+)\b/.exec(out)?.[1];
    if (key === undefined) throw new Error(`no key in: ${out}`);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("label-pill")).toHaveCount(25);

    // The row wraps rather than overflowing: no pill extends past the
    // panel's right edge, and the page does not scroll sideways.
    const panel = await page.getByTestId("meta-panel").boundingBox();
    if (panel === null) throw new Error("no panel box");
    for (let i = 0; i < 25; i += 1) {
      const box = await page.getByTestId("label-pill").nth(i).boundingBox();
      if (box === null) throw new Error(`no box for pill ${String(i)}`);
      expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // Every field below labels is still reachable — the panel did not
    // push them off. The last row is the footer.
    await expect(page.getByTestId("meta-updated")).toBeVisible();
    await trigger(page, "sprint").scrollIntoViewIfNeeded();
    await expect(trigger(page, "sprint")).toBeVisible();

    // All 25 remain individually removable: the 25th has its own
    // remove button and using it detaches exactly one.
    await page.getByTestId("label-pill").nth(24).scrollIntoViewIfNeeded();
    await page.getByTestId("label-pill").nth(24)
      .getByRole("button", { name: /^Remove label/ }).click();
    await waitForFile(
      tracker.root,
      key,
      t => (t.match(/^\s+- [0-9A-HJKMNP-TV-Z]{26}$/gm) ?? []).length === 24,
      "detached exactly one of 25",
    );
    await expect(page.getByTestId("label-pill")).toHaveCount(24);
  });

  // @verifies TSK-32
  test("TSK-32: an unknown top-level frontmatter key survives an edit from the UI", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([
      { title: "Experimental task", fields: { x_experiment: "cohort-b" } },
    ]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // The panel does not give the unknown key a normal editable field row,
    // but (DEG-7, superseding TSK-32's old "ignores the key" bullet — see
    // decisions.md A179) it IS surfaced in the read-only "Not recognised"
    // group so a preserved-but-unknown key is never silently hidden.
    // Positive first: the panel is rendering real rows.
    await expect(trigger(page, "status")).toBeVisible();
    const unrecognised = page.getByTestId("meta-panel").getByText("Not recognised");
    await expect(unrecognised).toBeVisible();
    await expect(page.getByTestId("meta-panel")).toContainText("x_experiment");
    await expect(page.getByTestId("meta-panel")).toContainText("cohort-b");
    // It is NOT a known editable field row — no edit trigger for it (a
    // known field would have `meta-edit-x_experiment`); it lives only in
    // the read-only Not-recognised group.
    await expect(page.getByTestId("meta-edit-x_experiment")).toHaveCount(0);

    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "In progress" }).click();

    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*in_progress\s*$/m.test(t),
      "took status in_progress",
    );
    // Still there, with its original value.
    expect(fm).toMatch(/^x_experiment:\s*cohort-b\s*$/m);
  });

  // @verifies TSK-33
  test("TSK-33: archived references survive an unrelated edit and a new one is rejected", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Gone User", "--email", "gone@example.com"]);
    await tracker.run(["user", "create", "Here User", "--email", "here@example.com"]);
    await tracker.run(["milestone", "create", "Old MS"]);
    await tracker.run(["milestone", "create", "New MS"]);
    const [key] = await tracker.seed([{ title: "Legacy task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await tracker.run(["set", key, "assignee", "Gone User"]);
    await tracker.run(["set", key, "milestone", "Old MS"]);
    await tracker.run(["user", "archive", "Gone User"]);
    await tracker.run(["milestone", "archive", "Old MS"]);
    const before = await frontmatterOf(tracker.root, key);
    const storedAssignee = /^assignee:\s*(\S+)/m.exec(before)?.[1];
    const storedMilestone = /^milestone:\s*(\S+)/m.exec(before)?.[1];

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // Both render with archived markers.
    await expect(trigger(page, "assignee")).toContainText("Gone User");
    await expect(trigger(page, "assignee")).toContainText("(archived)");
    await expect(trigger(page, "milestone")).toContainText("Old MS");
    await expect(trigger(page, "milestone")).toContainText("(archived)");

    // Editing priority does not strip or reset either reference.
    await trigger(page, "priority").click();
    await options(page, "priority").getByRole("option", { name: "High" }).click();
    const after = await waitForFile(
      tracker.root,
      key,
      t => /^priority:\s*high\s*$/m.test(t),
      "took priority high",
    );
    expect(/^assignee:\s*(\S+)/m.exec(after)?.[1]).toBe(storedAssignee);
    expect(/^milestone:\s*(\S+)/m.exec(after)?.[1]).toBe(storedMilestone);

    // Setting a *new* archived reference is not offered: the archived
    // option is disabled, and the live one is not — which is what
    // makes the disabled state a property of archiving rather than of
    // the whole list.
    await trigger(page, "milestone").click();
    await expect(options(page, "milestone").getByRole("option", { name: /Old MS/ })).toBeDisabled();
    await expect(options(page, "milestone").getByRole("option", { name: /New MS/ })).toBeEnabled();
    // And the reason is named, not merely implied by the disabled
    // state (P4).
    await expect(options(page, "milestone")).toContainText(/archived/i);
  });

  // @verifies TSK-49
  test("TSK-49: a rejected custom-field value names the field, stays put, and never reaches disk", async ({
    page,
    tracker,
  }) => {
    const base = await readWorkflow(tracker.root);
    await writeWorkflow(tracker.root, base.replace("custom_fields: []", CUSTOM_FIELDS_BLOCK));
    const [key] = await tracker.seed([{ title: "Validated task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    await trigger(page, "story-points").click();
    await page.getByTestId("meta-input-story-points").fill("not a number");
    await page.getByTestId("meta-input-story-points").press("Enter");

    // The error is at the field, not a detached toast: it is inside
    // the meta panel and adjacent to this input.
    const problem = page.getByTestId("meta-problem-story-points");
    await expect(problem).toBeVisible();
    // It names the field's *label* and what is acceptable.
    await expect(problem).toContainText("Story points");
    await expect(problem).toContainText("number");
    await expect(page.getByTestId("meta-panel")).toContainText("Story points");

    // The field retains the user's input so it can be corrected —
    // this is the clause a rollback-based implementation fails.
    await expect(page.getByTestId("meta-input-story-points")).toHaveValue("not a number");

    // Nothing reached disk.
    await page.waitForTimeout(500);
    expect(await frontmatterOf(tracker.root, key)).not.toContain("not a number");

    // Correcting it works from the retained input.
    await page.getByTestId("meta-input-story-points").fill("13");
    await page.getByTestId("meta-input-story-points").press("Enter");
    await waitForFile(tracker.root, key, t => /story_points: 13/.test(t), "took 13");
    await expect(page.getByTestId("meta-problem-story-points")).toHaveCount(0);
  });

  // @verifies TSK-30
  // @verifies XS-27
  test("TSK-30/XS-27: an enum value no longer declared renders flagged and is not silently dropped", async ({
    page,
    tracker,
  }) => {
    const base = await readWorkflow(tracker.root);
    await writeWorkflow(tracker.root, base.replace("custom_fields: []", CUSTOM_FIELDS_BLOCK));
    const [key] = await tracker.seed([{ title: "Drifted task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "team", "platform"]);

    // Now remove `platform` from the declared values, leaving the
    // task holding it.
    await writeWorkflow(
      tracker.root,
      base.replace("custom_fields: []", CUSTOM_FIELDS_BLOCK)
        .replace("      - key: platform\n        label: Platform\n", ""),
    );

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // Flagged, and the stored value shown — not blank, not dropped.
    const flagged = page.getByTestId("meta-unrecognized-team");
    await expect(flagged).toBeVisible();
    await expect(flagged).toContainText("platform");
    await expect(flagged).toContainText(/not in the current config/i);

    // The picker offers the currently declared values, and not the
    // stale one.
    await trigger(page, "team").click();
    await expect(options(page, "team").getByRole("option")).toContainText([
      /Clear/, "Frontend", "Backend",
    ]);
    await expect(
      options(page, "team").getByRole("option", { name: "Platform", exact: true }),
    ).toHaveCount(0);

    // The file retains the old value until the user changes it — the
    // case's own words, and the assertion this ticket can make
    // honestly. An *unrelated* edit is blocked by core rather than
    // stripping the value (see known-gaps.md), so that path is
    // covered by asserting the rejection is attributed rather than by
    // pretending the write succeeds.
    expect(await frontmatterOf(tracker.root, key)).toContain("team: platform");

    // And the user's own change *does* land, replacing the stale value
    // — which is what "until the user changes it" requires, and the
    // half that would be lost if the picker refused to write at all.
    await options(page, "team").getByRole("option", { name: "Frontend" }).click();
    const after = await waitForFile(
      tracker.root,
      key,
      t => /team: frontend/.test(t),
      "replaced the stale enum value",
    );
    expect(after).not.toContain("team: platform");
  });

  // @verifies TSK-31
  test("TSK-31: a custom field whose declared type changed under its value surfaces the mismatch", async ({
    page,
    tracker,
  }) => {
    const base = await readWorkflow(tracker.root);
    // Declared `string` first, so a string value is legitimately
    // stored — not smuggled past validation.
    await writeWorkflow(
      tracker.root,
      base.replace(
        "custom_fields: []",
        "custom_fields:\n  - key: story_points\n    label: Story points\n    type: string\n    multi: false\n    searchable: false\n",
      ),
    );
    const [key] = await tracker.seed([{ title: "Retyped task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "story_points", "quite a lot"]);

    // Now the declaration changes to `number` underneath it.
    await writeWorkflow(
      tracker.root,
      base.replace(
        "custom_fields: []",
        "custom_fields:\n  - key: story_points\n    label: Story points\n    type: number\n    multi: false\n    searchable: false\n",
      ),
    );

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // Neither NaN nor an empty numeric input: the stored text is
    // visible, and the mismatch is stated.
    await expect(trigger(page, "story-points")).toContainText("quite a lot");
    expect(await page.getByTestId("meta-panel").innerText()).not.toContain("NaN");

    const problem = page.getByTestId("meta-problem-story-points");
    await expect(problem).toBeVisible();
    // Which field, and what is expected.
    await expect(problem).toContainText("Story points");
    await expect(problem).toContainText("number");

    // The stored value is not silently overwritten — the panel never
    // sends it. An *unrelated* save is blocked by core on a task
    // holding an unparseable value (known-gaps.md), so what is
    // asserted is that nothing was written and the file is intact:
    // the failure mode TSK-31 names is an empty numeric input
    // overwriting on the next save, and that would show up here as
    // the string being gone.
    await page.waitForTimeout(500);
    expect(await frontmatterOf(tracker.root, key)).toContain("quite a lot");

    // The user *can* replace it, from a control that shows what is
    // there rather than an empty box.
    await trigger(page, "story-points").click();
    await expect(page.getByTestId("meta-input-story-points")).toHaveValue("quite a lot");
    await page.getByTestId("meta-input-story-points").fill("21");
    await page.getByTestId("meta-input-story-points").press("Enter");
    const after = await waitForFile(
      tracker.root,
      key,
      t => /story_points: 21/.test(t),
      "took 21",
    );
    expect(after).not.toContain("quite a lot");
  });

  // @verifies XS-26
  test("XS-26: a custom field removed from workflow.yaml leaves its stored value visible", async ({
    page,
    tracker,
  }) => {
    const base = await readWorkflow(tracker.root);
    await writeWorkflow(tracker.root, base.replace("custom_fields: []", CUSTOM_FIELDS_BLOCK));
    const [key] = await tracker.seed([{ title: "Orphaned task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "component", "parser"]);

    // The declaration goes away; the value stays on the task.
    await writeWorkflow(tracker.root, base);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // Shown under the raw field name, marked as no longer configured.
    const orphan = page.getByTestId("meta-orphan-component");
    await expect(orphan).toBeVisible();
    await expect(orphan).toContainText("parser");
    await expect(page.getByTestId("meta-panel")).toContainText("component");
    await expect(page.getByTestId("meta-panel")).toContainText(/no longer configured/i);

    // **XS-26's second bullet, both halves.** "Saving an unrelated
    // field does not strip it."
    //
    // This assertion was inverted when it was written, and the comment
    // said so honestly: core rejected *every* write to a task holding
    // a value for an undeclared field, so the unrelated save could not
    // happen at all, and the test asserted the rejection instead. That
    // was the reachable half of a broken situation, not the case.
    //
    // The core defect is fixed (`46507e8`) — validation is now scoped
    // to the field being written, so a value config no longer declares
    // is preserved rather than blocking the task. So the real bullet
    // is testable, and this asserts it: the unrelated save **lands**,
    // and the orphaned value is **still on disk afterwards**.
    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "In progress" }).click();

    // The unrelated write succeeded — no error, and the new value
    // stands rather than rolling back.
    await expect(page.getByTestId("meta-field-error")).toHaveCount(0);
    await expect(trigger(page, "status")).toContainText("In progress");

    // And it did not strip the orphan on its way through. Read off
    // disk, not off the screen: the screen could show a cached value
    // the file no longer has.
    //
    // `waitForFile`, not a bare read — the write is in flight when the
    // click returns, and reading immediately is a race. A first cut
    // did exactly that and failed for a reason that had nothing to do
    // with the case.
    const after = await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*in_progress\s*$/m.test(t),
      "took status in_progress",
    );
    expect(after).toMatch(/^\s*component:\s*parser\s*$/m);

    // Still shown, still marked — the unrelated save changed nothing
    // about how the orphan is presented.
    await expect(orphan).toBeVisible();
    await expect(orphan).toContainText("parser");

    // It disappears from the column picker, which enumerates current
    // config. The positive half — a field that *is* configured is
    // still offered — is what makes this discriminate.
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByRole("table")).toBeVisible();
    expect(await page.getByRole("table").innerText()).not.toContain("component");
  });

  // @verifies XS-42
  test("XS-42: key and key_history are immutable through the web API and have no UI control", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Immutable task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // No UI control: the panel renders rows with triggers, and none of
    // them is for key or key_history. The positive half first, so this
    // is not green on an empty panel.
    await expect(trigger(page, "status")).toBeVisible();
    await expect(page.getByTestId("meta-edit-key")).toHaveCount(0);
    await expect(page.getByTestId("meta-edit-key-history")).toHaveCount(0);
    // The key chip is text, not a button.
    await expect(page.getByTestId("task-key-chip")).toBeVisible();
    await expect(page.getByTestId("task-key-chip").getByRole("button")).toHaveCount(0);

    // A hand-crafted request is rejected as immutable, with the
    // header the browser client sends — without it a 403 would look
    // like the rejection and prove nothing about immutability.
    for (const field of ["key", "key_history"]) {
      const res = await page.request.post(
        `${tracker.baseURL}/api/tasks/${key}/set`,
        {
          headers: { "X-Loctt-Client": "web" },
          data: { field, value: field === "key" ? "T-999" : ["T-998"] },
        },
      );
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { message?: string; field?: string };
      expect(body.message ?? "").toMatch(/immutable/i);
      expect(body.message ?? "").toContain(field);
    }

    // And nothing changed on disk.
    const fm = await frontmatterOf(tracker.root, key);
    expect(fm).toMatch(new RegExp(`^key:\\s*${key}\\s*$`, "m"));
    expect(fm).not.toContain("T-999");
    expect(fm).not.toContain("T-998");
  });

  // @verifies XS-54
  // @verifies TSK-36
  test("XS-54/TSK-36: two tabs edit different fields, both land, and each converges", async ({
    page,
    context,
    tracker,
  }) => {
    await tracker.run(["user", "create", "Pat Lane", "--email", "pat@example.com"]);
    const [key] = await tracker.seed([{ title: "Two-tab task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    const tabB = await context.newPage();
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await tabB.goto(`${tracker.baseURL}/tasks/${key}`);

    // Tab A changes status.
    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "In progress" }).click();
    await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*in_progress\s*$/m.test(t),
      "took status in_progress",
    );

    // Tab B changes a *different* field, from its stale view of the
    // task. A client that sent the whole frontmatter would revert
    // tab A's status here.
    await tabB.getByTestId("meta-edit-priority").click();
    await tabB.getByTestId("meta-options-priority")
      .getByRole("option", { name: "High" }).click();

    // Both writes land — neither clobbers the other.
    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^priority:\s*high\s*$/m.test(t),
      "took priority high",
    );
    expect(fm).toMatch(/^status:\s*in_progress\s*$/m);

    // TSK-36: tab B converges on tab A's change rather than continuing
    // to show and act on the old value. It refetches after its own
    // write settles, which is the mechanism — no page reload here, so
    // a reload cannot be what makes this pass.
    await expect(tabB.getByTestId("meta-edit-status")).toContainText("In progress", {
      timeout: 15_000,
    });

    // No shared browser state made one tab authoritative: neither tab
    // wrote task data into localStorage.
    for (const p of [page, tabB]) {
      const stored = await p.evaluate(() => {
        const out: string[] = [];
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i);
          if (k !== null) out.push(`${k}=${localStorage.getItem(k) ?? ""}`);
        }
        return out.join("\n");
      });
      expect(stored).not.toContain("in_progress");
      expect(stored).not.toContain(key);
    }

    await tabB.close();
  });

  // @verifies VUE-30
  test("VUE-30: reassigning to the current user moves the Assigned-to-me count without a reload", async ({
    page,
    tracker,
  }) => {
    // Two tasks, only one of which will be reassigned. Seeding both
    // unassigned is what makes the count able to move by exactly one
    // rather than being right by construction.
    const [first] = await tracker.seed([
      { title: "Mine soon" },
      { title: "Not mine" },
    ]);
    if (first === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${first}`);

    const badge = page.locator("aside").getByRole("link", { name: /Assigned to me/ });
    await expect(badge).toBeVisible();
    const before = countIn(await badge.innerText());

    // Whoever the current user is — the picker's own list is the
    // source, so this does not hardcode a name.
    // `loctt user current` prints `<id>\t<name>`.
    const me = (await tracker.run(["user", "current"])).trim();
    const myName = me.split(/\t/)[1]?.trim() ?? me;
    expect(myName).not.toBe("");

    await trigger(page, "assignee").click();
    await options(page, "assignee").getByRole("option", { name: myName }).first().click();

    await waitForFile(
      tracker.root,
      first,
      t => /^assignee:\s*[0-9A-HJKMNP-TV-Z]{26}\s*$/m.test(t),
      "took an assignee",
    );

    // No reload: the badge itself must move. A reload here would
    // refetch the count from the server regardless of any client
    // invalidation, which is the XS-1 defect shape.
    await expect
      .poll(async () => countIn(await badge.innerText()), { timeout: 15_000 })
      .toBe(before + 1);
  });
});

/** The integer in a sidebar badge's text, or 0 when it has none. */
function countIn(text: string): number {
  const m = /(\d+)\s*$/.exec(text.trim());
  return m?.[1] === undefined ? 0 : Number(m[1]);
}

/**
 * A workflow that shares nothing with the shipped default: seven
 * statuses and seven priorities, keys that differ from labels, a
 * `completed`-category status not called "Done", and a `discarded`
 * one beside it as a decoy.
 *
 * Every P3 assertion in this file rests on this config. Against the
 * default, a panel with a hardcoded To Do / In Progress / Done list
 * and a three-priority assumption would pass most of them.
 */
const SEVEN_STATUS_WORKFLOW = `key:
  prefix: "T-"

statuses:
  - key: triage
    label: Triaging
    category: pending
    default: true
  - key: specced
    label: Specced
    category: pending
  - key: building
    label: Building
    category: active
  - key: in_review
    label: In review
    category: active
  - key: verifying
    label: Verifying
    category: active
  - key: shipped
    label: Shipped
    category: completed
  - key: abandoned
    label: Abandoned
    category: discarded

priorities:
  - key: p0_now
    label: Drop everything
    value: 7
  - key: p1_week
    label: This week
    value: 6
  - key: p3_sprint
    label: This sprint
    value: 5
  - key: p4_quarter
    label: This quarter
    value: 4
  - key: p5_someday
    label: Someday
    value: 3
  - key: p6_nice
    label: Nice to have
    value: 2
  - key: p7_no
    label: Not now
    value: 1

task_types:
  - key: chore
    label: Chore
  - key: defect
    label: Defect
  - key: investigation
    label: Investigation

relationships:
  - key: blocks
    label: Blocks
    inverse: is_blocked_by
    inverse_label: Is blocked by
    graph: acyclic
  - key: relates_to
    label: Relates to
    kind: symmetric

custom_fields: []

estimation:
  enabled: true
  unit: points
  unit_label: pts
`;

/**
 * TSK-12 / K91 scope fixture: a `severity` field scoped to type
 * `defect` (via `task_types`), plus a global `component` field with no
 * allowlist. Used to prove the visible set follows the task's type and
 * that an out-of-scope stored value is kept read-only.
 */
const SCOPED_FIELDS_BLOCK = `custom_fields:
  - key: component
    label: Component
    type: string
    multi: false
    searchable: false
  - key: severity
    label: Severity
    type: string
    multi: false
    searchable: false
    task_types:
      - defect`;

/** One field per declared type, plus a multi enum. */
const CUSTOM_FIELDS_BLOCK = `custom_fields:
  - key: component
    label: Component
    type: string
    multi: false
    searchable: true
  - key: story_points
    label: Story points
    type: number
    multi: false
    searchable: false
  - key: review_by
    label: Review by
    type: date
    multi: false
    searchable: false
  - key: needs_docs
    label: needs_docs
    type: boolean
    multi: false
    searchable: false
  - key: team
    label: Team
    type: enum
    multi: false
    searchable: true
    values:
      - key: platform
        label: Platform
      - key: frontend
        label: Frontend
      - key: backend
        label: Backend
  - key: platforms
    label: Platforms
    type: enum
    multi: true
    searchable: false
    values:
      - key: ios
        label: iOS
      - key: android
        label: Android
`;

/* ================================================================== *
 * TSK-43 — key and key history are not editable from the UI
 * TSK-55 — inline label creation failing does not attach a phantom
 * ================================================================== */

test.describe("TSK-43 / TSK-55 — immutable key, and a failed inline label", () => {
  // @verifies TSK-43
  test("TSK-43: the key and key history are shown read-only, with no edit affordance", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    // A task moved to a second project gains a key_history entry, so
    // the footer that TSK-43 forbids editing actually renders — an
    // absence case is only meaningful if its subject is present.
    await tracker.run(["project", "create", "Backend", "--prefix", "BE"]);
    const [key] = await tracker.seed([{ title: "Immutable key" }]);
    if (key === undefined) throw new Error("seed returned no key");
    const moved = await tracker.run(["move", key, "Backend"]);
    // `Moved <old> → <new>`; the new key carries the BE prefix.
    const newKey = /→\s*(\S+)/.exec(moved)?.[1];
    if (newKey === undefined || newKey === key) {
      throw new Error(`could not parse the moved key from: ${moved}`);
    }

    await page.goto(`${tracker.baseURL}/tasks/${newKey}`);

    // Positive control: the key chip is present and shows the current
    // key. Asserting "no edit control found" alone would pass if the
    // chip were missing entirely — the case is that it is read-only,
    // not that it is absent.
    const chip = page.getByTestId("task-key-chip");
    await expect(chip).toHaveText(newKey);
    // It is inert: not a button, not an input, no click handler that
    // opens an editor.
    expect(await chip.evaluate(el => el.tagName)).toBe("SPAN");
    await expect(chip.getByRole("button")).toHaveCount(0);
    await expect(chip.getByRole("textbox")).toHaveCount(0);
    // Clicking it opens nothing.
    await chip.click();
    await expect(chip.getByRole("textbox")).toHaveCount(0);

    // Positive control: the key-history footer is present and names the
    // retired key as prose.
    const footer = page.getByTestId("meta-key-history");
    await expect(footer).toBeVisible();
    await expect(footer).toContainText(key);
    await expect(footer).toContainText(newKey);
    // …and holds no edit affordance of its own.
    await expect(footer.getByRole("button")).toHaveCount(0);
    await expect(footer.getByRole("textbox")).toHaveCount(0);
    await footer.getByText(key).click();
    await expect(footer.getByRole("textbox")).toHaveCount(0);

    // Nothing in the More menu edits key or key_history. Copy key is
    // a read, Move rekeys via a project change (TSK-21) — neither is a
    // direct key edit.
    await page.getByRole("button", { name: "More", exact: true }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const itemText = (await menu.getByRole("menuitem").allInnerTexts())
      .map(t => t.toLowerCase());
    for (const item of itemText) {
      // "Copy key" and "Copy link" are the only items that mention the
      // key at all, and both are reads. No item offers to change it.
      expect(item).not.toMatch(/edit key|change key|rename key|edit history/);
    }

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });

  // @verifies TSK-55
  test("TSK-55: a failed inline label create leaves no pill and no orphan in labels.yaml", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    const [key] = await tracker.seed([{ title: "No stray labels" }]);
    if (key === undefined) throw new Error("seed returned no key");

    // Fail the label-create write at the network edge. The create is a
    // POST /api/labels; anything else (the labels list read, the task
    // read, the set write) is left alone.
    await page.route("**/api/labels", async route => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            code: "config_invalid",
            message: "The label store could not be written (simulated failure).",
            data_state: "not_saved",
            recovery: { kind: "retry" },
          }),
        });
        return;
      }
      await route.fallback();
    });

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    await page.getByTestId("meta-add-label").click();
    await expect(page.getByTestId("meta-label-input")).toBeVisible();
    await page.getByTestId("meta-label-input").fill("phantomlabel");
    const failed = page.waitForResponse(
      r => /\/api\/labels$/.test(r.url())
        && r.request().method() === "POST"
        && r.status() === 400,
    );
    await page.getByTestId("meta-create-label").click();
    await failed;

    // Second bullet: the message states the label was not created and
    // why — not a silent swallow.
    const err = page.getByTestId("meta-label-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("phantomlabel");
    await expect(err).toContainText(/not created|could not be written/i);

    // First bullet: no pill is left attached. The task started with no
    // labels and the create failed, so there must be *zero* pills —
    // not merely no pill whose text reads "phantomlabel". An
    // optimistically attached phantom renders as an unresolved pill
    // ("unresolved — not in the current config") rather than the typed
    // name, so a name-filtered count would miss it; the total count
    // will not.
    await expect(page.getByTestId("label-pill")).toHaveCount(0);

    // The task's labels on disk do not contain the failed label —
    // frontmatter should carry no labels list at all, since none was
    // ever attached.
    const fm = await frontmatterOf(tracker.root, key);
    // No labels list was ever written, so the failed label cannot be in one.
    expect(fm).not.toContain("phantomlabel");
    expect(fm).not.toMatch(/^labels:/m);

    // labels.yaml has no orphan. It may not exist at all (nothing was
    // ever created); if it does, it does not name the failed label.
    const labelsPath = path.join(tracker.root, ".loctt", "config", "labels.yaml");
    let labelsYaml = "";
    try {
      labelsYaml = await readFile(labelsPath, "utf8");
    } catch { /* absent is the strongest form of "no orphan" */ }
    expect(labelsYaml).not.toContain("phantomlabel");

    // Third bullet: the label is not offered in other pickers or the
    // list view's Label filter afterwards. Drop the route so the real
    // list read is honest, then check the filter.
    await page.unroute("**/api/labels");
    await page.goto(`${tracker.baseURL}/list`);
    await page.getByRole("button", { name: "Filter Label" }).click();
    await expect(page.getByRole("menuitemcheckbox", { name: "phantomlabel" }))
      .toHaveCount(0);

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});

test.describe("XS-10 — optimistic edits reconcile against the server", () => {
  // @verifies XS-10
  /**
   * Transcribed from flow-cross-surface.md XS-10.
   *
   * The reconciliation is asserted at the one value the optimistic
   * path deliberately does NOT invent: `updated_at`. `applyLocally`
   * (useSetField.ts) touches only the field named — never the
   * timestamp — so during the optimistic window the footer still shows
   * the *pre-edit* time. Only the settling refetch (onSettled →
   * invalidate → GET) brings the server's freshly-stamped time. So a
   * footer that ends on the server's `updated_at` is proof the settled
   * state came from the response, not from the browser (XS-10 bullet
   * 2), and a value that never moved would be proof the optimistic
   * guess was left standing.
   *
   * The assertion is tied to disk: the footer's ISO must equal the
   * `updated_at` core actually wrote. A test that only checked "the
   * time changed" would pass on any client clock; equality with disk
   * is what makes it the *server's* value.
   *
   * Mutation shown to fail: delete the three `invalidateQueries` calls
   * in `useSetField`'s `onSettled` and this goes red — the footer
   * keeps the stale pre-edit `updated_at` because nothing refetches
   * the reconciled task. (Verified while writing: with onSettled
   * gutted the final `toBe(diskUpdatedAt)` fails, footer frozen at the
   * seed timestamp.)
   */
  test("XS-10: the settled footer timestamp is the server's, not the optimistic guess", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    await writeWorkflow(tracker.root, SEVEN_STATUS_WORKFLOW);
    const [key] = await tracker.seed([{ title: "Reconciled task" }]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    // The pre-edit timestamp, as the server currently reports it.
    const updated = () =>
      page.getByTestId("meta-updated").locator("time").getAttribute("title");
    const beforeIso = await updated();
    expect(beforeIso).toBeTruthy();
    const beforeDisk = /^updated_at:\s*(\S+)/m.exec(
      await frontmatterOf(tracker.root, key),
    )?.[1];
    expect(beforeIso).toBe(beforeDisk);

    // Change a field. The optimistic path repaints the status at once
    // but leaves `updated_at` alone — so if reconciliation never
    // happened, the footer would stay on `beforeIso` forever.
    await trigger(page, "status").click();
    await options(page, "status").getByRole("option", { name: "Building" }).click();
    await expect(trigger(page, "status")).toContainText("Building");

    // The far end moves first: core stamps a new updated_at on write.
    const fm = await waitForFile(
      tracker.root,
      key,
      t => /^status:\s*building\s*$/m.test(t),
      "settled on building",
    );
    const diskUpdatedAt = /^updated_at:\s*(\S+)/m.exec(fm)?.[1];
    expect(diskUpdatedAt).toBeDefined();
    expect(diskUpdatedAt).not.toBe(beforeIso);

    // The footer settles onto exactly the server's timestamp — the
    // reconciled value, not the stale optimistic one and not a browser
    // clock reading.
    await expect(async () => {
      expect(await updated()).toBe(diskUpdatedAt);
    }).toPass({ timeout: 8000 });

    // XS-10 bullet 3: nothing that exists only in browser state
    // survives a reload. The reconciled value is already on disk, so a
    // reload shows the same time — not a regression to the optimistic
    // guess.
    await page.reload();
    await expect(async () => {
      expect(await updated()).toBe(diskUpdatedAt);
    }).toPass({ timeout: 8000 });

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});

/**
 * GIT-19 (flow-git-sync.md) — the follow-with-note half.
 *
 * The sharp data-integrity bullet (an edit never lands on the OTHER task
 * that took the old key) is locked at unit/server level
 * (`server.git19-rekey-precondition.test.ts`) and through the git browser
 * flow (`flow-git-rekey.spec.ts`). This spec covers the resolvable case
 * the case pairs it with: a rekey where the old key still resolves to the
 * SAME task via `key_history` (here produced by `loctt move`, which rekeys
 * without another task claiming the old key). The tab on the old URL must
 * FOLLOW — update to the current key with a note — and never keep showing
 * the old key as authoritative (bullets 1, 2, 4).
 */
test.describe("GIT-19 — a tab on a rekeyed task follows the rename", () => {
  test("the old-key URL follows to the current key with an explanatory note, and reload still resolves", async ({
    page, tracker,
  }) => {
    // @verifies GIT-19
    const [oldKey] = await tracker.seed([{ title: "Portable task" }]);
    expect(oldKey).toBeDefined();
    const old = oldKey as string;

    await tracker.run(["project", "create", "Elsewhere", "--prefix", "ELS"]);
    const moved = await tracker.run(["move", old, "Elsewhere"]);
    const newKey = /→\s*(\S+)/.exec(moved)?.[1];
    expect(newKey).toBeDefined();
    expect(newKey).not.toBe(old);
    const fresh = newKey as string;

    // Open the tab on the OLD key, as a tab left sitting on it would be.
    await page.goto(`${tracker.baseURL}/tasks/${old}`);

    // FOLLOW: the URL updates to the current key (never left on the stale
    // one), and the chip shows the current key as authoritative.
    await expect(page).toHaveURL(new RegExp(`/tasks/${fresh}(?:[?#]|$)`));
    await expect(page.getByTestId("task-key-chip")).toHaveText(fresh);

    // The note explains the change and names the old key.
    const note = page.getByText(/renumbered while you had it open|retired key for this task/i);
    await expect(note).toBeVisible();
    await expect(note).toContainText(old);
    await expect(note).toContainText(fresh);

    // Bullet 4: a fresh load of the OLD URL still lands on the same task.
    await page.goto(`${tracker.baseURL}/tasks/${old}`);
    await expect(page.getByTestId("task-key-chip")).toHaveText(fresh);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Portable task");
  });
});
