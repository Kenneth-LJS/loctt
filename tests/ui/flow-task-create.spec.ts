/**
 * Transcribed from docs/dev/ui-test-cases/flow-task-create.md — M3.4,
 * the create-task modal.
 *
 * These are browser specs because what they assert is browser
 * behaviour: three entry points opening one component, a focus trap, a
 * shortcut that must not fire inside a text field, a double-click that
 * must not create two tasks, a toast that outlives the modal.
 *
 * **Every write is asserted at the far end** — the `task.md` on disk,
 * or `state.yaml`'s counters. A test that asserts a success toast
 * appeared passes whether or not the file has the right project, type
 * or labels, and NEW-11 exists precisely because the screen and the
 * file can disagree.
 */

import { chmod, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** Every task.md on disk, as raw text. */
async function allTaskFiles(root: string): Promise<string[]> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  const out: string[] = [];
  let ids: string[];
  try {
    ids = await readdir(tasksDir);
  } catch {
    return out;
  }
  for (const id of ids) {
    try {
      out.push(await readFile(path.join(tasksDir, id, "task.md"), "utf8"));
    } catch {
      continue;
    }
  }
  return out;
}

/** The whole file for the task with this title. */
async function fileByTitle(root: string, title: string): Promise<string> {
  for (const text of await allTaskFiles(root)) {
    if (new RegExp(`^title:\\s*["']?${title}`, "m").test(text)) return text;
  }
  throw new Error(`no task on disk titled ${title}`);
}

function fmValue(text: string, field: string): string | undefined {
  return new RegExp(`^${field}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim();
}

/** The markdown body — everything after the closing frontmatter fence. */
function bodyOf(text: string): string {
  const parts = text.split(/^---$/m);
  return parts.length >= 3 ? parts.slice(2).join("---").trim() : "";
}

async function setStatuses(
  root: string,
  statuses: readonly { key: string; label: string; default?: boolean; category?: string }[],
): Promise<void> {
  const wfPath = path.join(root, ".loctt", "config", "workflow.yaml");
  const text = await readFile(wfPath, "utf8");
  const block = statuses
    .map(s =>
      `  - key: ${s.key}\n    label: ${s.label}\n    category: ${s.category ?? "active"}`
      + (s.default === true ? "\n    default: true" : ""),
    )
    .join("\n");
  await writeFile(
    wfPath,
    text.replace(/^statuses:\n(?:[ \t]+.*\n?)*/m, `statuses:\n${block}\n`),
  );
}

/** Opens the modal via the header's "+ New task". */
async function openModal(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("header-new-task").click();
  await expect(page.getByTestId("create-task-modal")).toBeVisible();
}

test.describe("NEW — create task modal", () => {
  // @verifies NEW-1
  // @verifies NEW-1
  //
  // The seeded case. NEW-1's other test navigates to `/board` without
  // seeding, so the board is empty and BRD-40's empty-state "+ Add
  // task" is present — the only one that existed. On any board with
  // tasks there was no board entry point at all, and the test could
  // not see it because it never created a task.
  //
  // The button is board-level, not per-column: M3.1 built per-column
  // controls and removed them, because a column still rendered for a
  // status `workflow.yaml` no longer declares would carry a create
  // control, which is what broke BRD-42.
  test("NEW-1: the board entry point exists once the board has tasks", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Existing one" }, { title: "Existing two" }]);
    await page.goto(`${tracker.baseURL}/board`);

    // The empty state is gone — the positive control, without which
    // this test would pass on the very state it exists to rule out.
    await expect(page.getByText("No tasks yet.")).toHaveCount(0);

    const add = page.getByTestId("board-add-task");
    await expect(add).toBeVisible();
    await add.click();
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
  });

  test("NEW-1: all three entry points open the same modal", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/board`);

    // 1. The header "+".
    await openModal(page);
    const fromHeader = await page.getByTestId("create-task-modal").innerHTML();
    await page.getByTestId("create-close").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // 2. The `n` shortcut.
    await page.keyboard.press("n");
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
    const fromShortcut = await page.getByTestId("create-task-modal").innerHTML();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // 3. The board's "+ Add task" (the tracker is empty, so the
    //    board-level empty state is showing — BRD-40).
    await page.getByTestId("board-empty").getByRole("button", { name: /Add task/ }).click();
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
    const fromBoard = await page.getByTestId("create-task-modal").innerHTML();

    // The same component: same heading, same field set. Comparing the
    // rendered markup is what catches "present in one and absent in
    // another", which inspecting one entry point cannot.
    //
    // React's `useId` values are normalised out: they differ per mount
    // by design (`_r_1_` vs `_r_9_`) and say nothing about whether the
    // two renders have the same fields. Everything else — every
    // testid, label, control and its order — still has to match.
    const stable = (html: string): string => html.replace(/_r_[0-9a-z]+_/g, "_rid_");
    expect(stable(fromShortcut)).toBe(stable(fromHeader));
    expect(stable(fromBoard)).toBe(stable(fromHeader));

    // And the route did not change underneath any of them.
    expect(new URL(page.url()).pathname).toBe("/board");
  });

  // @verifies NEW-2
  test("NEW-2: a title alone creates a task with workflow defaults", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    // Enabled as soon as the title is non-empty.
    await expect(page.getByTestId("create-submit")).toBeDisabled();
    await page.getByTestId("create-title").fill("Just a title");
    await expect(page.getByTestId("create-submit")).toBeEnabled();

    await page.getByTestId("create-submit").click();
    // The modal closes on success.
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // The far end: a real file, with the project's prefix and the
    // workflow's default status — not a blank that fails later.
    const text = await fileByTitle(tracker.root, "Just a title");
    expect(fmValue(text, "key")).toMatch(/^T-\d+$/);
    expect(fmValue(text, "status")).toBe("backlog");
    expect(fmValue(text, "project")).toBeDefined();
  });

  // @verifies NEW-4
  test("NEW-4: `n` opens the modal from every view and focuses the title", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Anchor" }]);
    const [anchor] = keys as [string];

    for (const route of ["/list", "/board", "/timeline", `/tasks/${anchor}`]) {
      await page.goto(`${tracker.baseURL}${route}`);
      // Take focus off any autofocused control first, so the shortcut
      // is genuinely being delivered to the page.
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("n");
      await expect(
        page.getByTestId("create-task-modal"),
        `modal should open on ${route}`,
      ).toBeVisible();

      // The title has focus, so typing goes into the field.
      await page.keyboard.type("typed");
      await expect(page.getByTestId("create-title")).toHaveValue("typed");

      await page.keyboard.press("Escape");
      // Content was typed, so the discard prompt guards it (NEW-27).
      await page.getByTestId("create-discard-confirm-btn").click();
      await expect(page.getByTestId("create-task-modal")).toBeHidden();
    }
  });

  // @verifies NEW-5
  test("NEW-5: enum fields come from workflow.yaml and store keys", async ({ page, tracker }) => {
    // A workspace whose statuses are nothing like the defaults, so a
    // hardcoded "To Do / In Progress / Done" cannot pass.
    await setStatuses(tracker.root, [
      { key: "icebox", label: "Icebox", default: true },
      { key: "carving", label: "Carving" },
      { key: "shipped", label: "Shipped", category: "completed" },
    ]);

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    await page.getByTestId("create-status").getByRole("button").first().click();
    // The configured labels, in configured order.
    const options = page.getByRole("option");
    await expect(options.filter({ hasText: "Icebox" })).toHaveCount(1);
    await expect(options.filter({ hasText: "Carving" })).toHaveCount(1);
    await expect(options.filter({ hasText: "Shipped" })).toHaveCount(1);
    // Nothing hardcoded leaked in.
    await expect(options.filter({ hasText: /^In progress$/ })).toHaveCount(0);

    await options.filter({ hasText: "Carving" }).click();
    await page.getByTestId("create-title").fill("Enum keys");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // The stored value is the config KEY, never the display label.
    const text = await fileByTitle(tracker.root, "Enum keys");
    expect(fmValue(text, "status")).toBe("carving");
    expect(text).not.toContain("status: Carving");
  });

  // @verifies NEW-42
  test("NEW-42: the empty-title block is a visible cue and defaults pre-fill", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    // UX-14 part 1 — the disabled Create is a *visible* cue, not a
    // live-looking button. NEW-2 already pins that it is disabled on an
    // empty title; this asserts the disable is legible: the B1 Button's
    // base carries `disabled:opacity-50`, so the control reads as
    // unavailable rather than inviting a dead click.
    const submit = page.getByTestId("create-submit");
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveClass(/disabled:opacity-50/);
    // The disabled cursor is the other half of "you can't submit yet".
    await expect(submit).toHaveClass(/disabled:cursor-not-allowed/);

    // UX-14 part 2 — Status and Type open pre-filled with the configured
    // `workflow.yaml` defaults, not the "—" placeholder. The default
    // status is the `default: true` entry (Backlog), resolved through
    // core's `defaultStatus`; the default type is the first configured
    // task type (Story).
    await expect(page.getByTestId("create-status")).toHaveText("Backlog");
    await expect(page.getByTestId("create-status")).not.toHaveText("—");
    await expect(page.getByTestId("create-type")).toHaveText("Story");
    await expect(page.getByTestId("create-type")).not.toHaveText("—");

    // The pre-fill is real, not cosmetic: submitting with only a title
    // writes those defaults to disk (the status matches NEW-2's `backlog`
    // and the type is `story`, the config KEYS behind the shown labels).
    await page.getByTestId("create-title").fill("Pre-filled defaults");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    const text = await fileByTitle(tracker.root, "Pre-filled defaults");
    expect(fmValue(text, "status")).toBe("backlog");
    expect(fmValue(text, "task_type")).toBe("story");
  });

  // @verifies NEW-11
  test("NEW-11: create-another keeps project and type, clears the rest", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    // Fill type, priority and a title. Type now opens pre-filled with
    // the workflow default (Story, per NEW-42), so its picker leads with
    // a "None" clear option — `.first()` would clear it. Pick a concrete,
    // *different* type by name ("Bug") so "type carried over" proves the
    // chosen value survived rather than the default merely reappearing.
    await page.getByTestId("create-type").getByRole("button").first().click();
    await page.getByRole("option", { name: "Bug" }).click();
    const chosenType = await page.getByTestId("create-type").innerText();

    await page.getByTestId("create-priority").getByRole("button").first().click();
    await page.getByRole("option", { name: "High" }).click();

    await page.getByTestId("create-title").fill("First of two");
    await page.getByTestId("create-another").check();
    await page.getByTestId("create-submit").click();

    // The modal stays open, the title is cleared and refocused.
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
    await expect(page.getByTestId("create-title")).toHaveValue("");
    await expect(page.getByTestId("create-title")).toBeFocused();
    // Type survived.
    await expect(page.getByTestId("create-type")).toHaveText(chosenType);

    // Submitting again makes a second, distinct task.
    await page.getByTestId("create-title").fill("Second of two");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-title")).toHaveValue("");

    const first = await fileByTitle(tracker.root, "First of two");
    const second = await fileByTitle(tracker.root, "Second of two");

    // Distinct tasks, sequential keys.
    const k1 = fmValue(first, "key");
    const k2 = fmValue(second, "key");
    expect(k1).not.toBe(k2);
    expect(Number(/\d+/.exec(k2 ?? "")?.[0])).toBe(Number(/\d+/.exec(k1 ?? "")?.[0]) + 1);

    // Project and type carried over...
    expect(fmValue(second, "project")).toBe(fmValue(first, "project"));
    expect(fmValue(second, "task_type")).toBe(fmValue(first, "task_type"));
    expect(fmValue(second, "task_type")).toBeDefined();

    // ...and priority did NOT. The fourth bullet: absent from
    // frontmatter, not merely blank on screen.
    expect(fmValue(first, "priority")).toBeDefined();
    expect(second).not.toMatch(/^priority:/m);
    expect(second).not.toMatch(/^assignee:/m);
    expect(second).not.toMatch(/^labels:/m);
    expect(second).not.toMatch(/^due_date:/m);
  });

  // @verifies NEW-12
  test("NEW-12: the toast names the task and opens it", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Toast me");
    await page.getByTestId("create-submit").click();

    const toast = page.getByTestId("toast");
    await expect(toast).toBeVisible();
    const created = await fileByTitle(tracker.root, "Toast me");
    const key = fmValue(created, "key");
    expect(key).toBeDefined();
    // It names the allocated key and the title.
    await expect(toast).toContainText(String(key));
    await expect(toast).toContainText("Toast me");

    // "Open" navigates to the task.
    await page.getByTestId("toast-action").click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${String(key)}$`));
  });

  // @verifies NEW-13
  test("NEW-13: the created row appears in the list without a reload", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Existing" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.locator("tbody tr")).toHaveCount(1);

    await openModal(page);
    await page.getByTestId("create-title").fill("Appears live");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // Scoped to tbody: the toast also names the task, and an unscoped
    // locator matches both and fails Playwright's strict-mode check.
    await expect(page.locator("tbody").getByText("Appears live")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(2);
  });

  // @verifies NEW-23
  test("NEW-23: a whitespace-only title is rejected, a padded one is trimmed", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    await page.getByTestId("create-title").fill("   ");
    await expect(page.getByTestId("create-submit")).toBeDisabled();

    // Nothing was written.
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);

    // Real text with padding is accepted, and stored trimmed.
    await page.getByTestId("create-title").fill("  Padded title  ");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    const text = await fileByTitle(tracker.root, "Padded title");
    const stored = fmValue(text, "title") ?? "";
    expect(stored.replace(/^["']|["']$/g, "")).toBe("Padded title");
  });

  // @verifies NEW-26
  test("NEW-26: an inverted date range is caught in the form", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Backwards dates");
    await page.getByTestId("create-start").fill("2026-04-10");
    await page.getByTestId("create-due").fill("2026-04-02");

    // Named before submission, and submit is blocked.
    await expect(page.getByTestId("create-date-problem")).toBeVisible();
    await expect(page.getByTestId("create-submit")).toBeDisabled();

    // Correcting either date clears it.
    await page.getByTestId("create-due").fill("2026-04-20");
    await expect(page.getByTestId("create-date-problem")).toBeHidden();
    await expect(page.getByTestId("create-submit")).toBeEnabled();

    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    const text = await fileByTitle(tracker.root, "Backwards dates");
    // Stored as plain YYYY-MM-DD, with no time and no zone shift.
    expect(fmValue(text, "start_date")).toBe("2026-04-10");
    expect(fmValue(text, "due_date")).toBe("2026-04-20");
  });

  // @verifies NEW-27
  test("NEW-27: dismissing with content asks; an untouched modal just closes", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);

    // Untouched: closes immediately, no prompt.
    await openModal(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-discard-confirm")).toBeHidden();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // With content: asks, and cancelling keeps everything.
    await openModal(page);
    await page.getByTestId("create-title").fill("Precious work");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-discard-confirm")).toBeVisible();
    await page.getByTestId("create-discard-keep").click();
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
    await expect(page.getByTestId("create-title")).toHaveValue("Precious work");

    // A backdrop click goes through the same prompt.
    await page.mouse.click(5, 5);
    await expect(page.getByTestId("create-discard-confirm")).toBeVisible();
    await page.getByTestId("create-discard-confirm-btn").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    expect(await allTaskFiles(tracker.root)).toHaveLength(0);
  });

  // @verifies NEW-29
  test("NEW-29: double-submitting creates exactly one task", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/list`);

    // Hold the response so the second click lands while the first is
    // genuinely in flight — clicking twice against a fast local server
    // would prove nothing.
    let release: (() => void) | undefined;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/tasks", async route => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      await held;
      await route.fallback();
    });

    await openModal(page);
    await page.getByTestId("create-title").fill("Only once");
    const submit = page.getByTestId("create-submit");

    // Two clicks in ONE tick, before React has re-rendered anything.
    //
    // This is fussier than it looks, and the fussiness is the point.
    // `click({force:true})` on the disabled button asserts only that
    // the attribute is set. Dispatching *after* a real Playwright
    // click does not work either: that click lets React re-render, so
    // the later handlers already see `submitting === true` and the
    // test passes with the guard deleted — measured, and it did.
    //
    // Both clicks must land in the same tick, from the very first
    // press. Measured with the in-flight ref removed: **2 POSTs and 2
    // tasks on disk**. That is the duplicate NEW-29 forbids.
    await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>(
        '[data-testid="create-submit"]',
      );
      if (btn === null) throw new Error("no submit button");
      btn.click();
      btn.click();
    });

    // The pending state is visible while the request is in flight.
    await expect(submit).toBeDisabled();

    release?.();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    const files = await allTaskFiles(tracker.root);
    expect(files).toHaveLength(1);
  });

  // @verifies NEW-31
  test("NEW-31: `n` is ignored while another dialog owns focus", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Guarded");

    // A confirm dialog on top of the modal.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-discard-confirm")).toBeVisible();

    // `n` while it owns focus must not stack a second create modal.
    await page.keyboard.press("n");
    await expect(page.getByTestId("create-task-modal")).toHaveCount(1);
    await expect(page.getByTestId("create-discard-confirm")).toBeVisible();

    // And the keyboard is not stuck between two traps: the confirm
    // still answers.
    await page.getByTestId("create-discard-keep").click();
    await expect(page.getByTestId("create-discard-confirm")).toBeHidden();
    await expect(page.getByTestId("create-title")).toHaveValue("Guarded");
  });

  // @verifies NEW-32
  test("NEW-32: a 500 keeps the form, its content, and writes nothing", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await page.route("**/api/tasks", async route => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "unknown",
          message: "The server failed while handling POST /api/tasks.",
          data_state: "unknown",
          recovery: { kind: "reload" },
        }),
      });
    });

    await openModal(page);
    await page.getByTestId("create-title").fill("Survives a 500");
    await page.getByTestId("create-start").fill("2026-05-05");
    await page.getByTestId("create-submit").click();

    // The modal stays open with every value intact.
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
    await expect(page.getByTestId("create-title")).toHaveValue("Survives a 500");
    await expect(page.getByTestId("create-start")).toHaveValue("2026-05-05");

    // The message names what failed and the reason as reported.
    const err = page.getByTestId("create-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(/Couldn't create the task/i);

    // Nothing on disk, and no key consumed.
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);

    // Retrying after the server recovers creates exactly one.
    await page.unroute("**/api/tasks");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    expect(await allTaskFiles(tracker.root)).toHaveLength(1);
  });

  // @verifies NEW-37
  test("NEW-37: an unreachable server says the task was NOT created", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await page.route("**/api/tasks", async route => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      await route.abort("connectionfailed");
    });

    await openModal(page);
    await page.getByTestId("create-title").fill("Offline attempt");
    await page.getByTestId("create-submit").click();

    const err = page.getByTestId("create-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText(/not created/i);
    await expect(err).toContainText(/reach/i);

    // No success toast, and the modal kept its content.
    await expect(page.getByTestId("toast")).toHaveCount(0);
    await expect(page.getByTestId("create-title")).toHaveValue("Offline attempt");
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);

    // On reconnect, retrying creates exactly one — the offline attempt
    // did not queue a duplicate.
    await page.unroute("**/api/tasks");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    expect(await allTaskFiles(tracker.root)).toHaveLength(1);
  });

  // @verifies NEW-39
  test("NEW-39: a mid-sequence failure keeps the form and says how many landed", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-another").check();

    for (const title of ["Seq one", "Seq two"]) {
      await page.getByTestId("create-title").fill(title);
      await page.getByTestId("create-submit").click();
      await expect(page.getByTestId("create-title")).toHaveValue("");
    }
    expect(await allTaskFiles(tracker.root)).toHaveLength(2);

    // The third fails.
    await page.route("**/api/tasks", async route => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "unknown",
          message: "boom",
          data_state: "unknown",
          recovery: { kind: "reload" },
        }),
      });
    });
    await page.getByTestId("create-title").fill("Seq three");
    await page.getByTestId("create-submit").click();

    // The entered value is still there, so the user does not retype it.
    await expect(page.getByTestId("create-title")).toHaveValue("Seq three");
    // And the message makes the first two explicit.
    const err = page.getByTestId("create-error");
    await expect(err).toBeVisible();
    await expect(err).toContainText("2");

    // Exactly two on disk.
    expect(await allTaskFiles(tracker.root)).toHaveLength(2);
  });

  // @verifies NEW-40
  test("NEW-40: a rejected custom-field value is explained at the field", async ({
    page,
    tracker,
  }) => {
    // A `number` custom field. `multi` and `searchable` are required
    // by the schema — omitting them makes every request fail with
    // `config_invalid`, which would pass this test for the wrong
    // reason entirely.
    const wfPath = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    const wf = await readFile(wfPath, "utf8");
    await writeFile(
      wfPath,
      wf.replace(
        "custom_fields: []",
        "custom_fields:\n  - key: points\n    label: Points\n    type: number\n"
        + "    multi: false\n    searchable: false",
      ),
    );

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Bad points");

    // The control is a text input precisely so a non-numeric value can
    // be entered at all: `<input type="number">` discards it silently
    // and this case becomes unreachable rather than satisfied.
    await page.getByTestId("create-field-points").fill("not-a-number");
    await page.getByTestId("create-submit").click();

    // The message is attached to the field, not floating at the top.
    const atField = page.getByTestId("create-field-points-problem");
    await expect(atField).toBeVisible();
    await expect(atField).toContainText(/number/i);

    // No task created, and the rest of the form is preserved.
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);
    await expect(page.getByTestId("create-title")).toHaveValue("Bad points");

    // Correcting it succeeds, and the value lands under `fields:`.
    await page.getByTestId("create-field-points").fill("5");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    const text = await fileByTitle(tracker.root, "Bad points");
    expect(text).toMatch(/^fields:/m);
    expect(text).toMatch(/points:\s*5/);
  });

  // @verifies NEW-9
  test("NEW-9: the compact body editor stores markdown verbatim", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Has a body");

    const editor = page.getByTestId("rich-editor");
    await editor.click();
    await page.keyboard.type("A paragraph.");
    await page.keyboard.press("Enter");
    // A bullet list, via markdown input rules.
    await page.keyboard.type("- first");
    await page.keyboard.press("Enter");
    await page.keyboard.type("second");

    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    const body = bodyOf(await fileByTitle(tracker.root, "Has a body"));
    expect(body).toContain("A paragraph.");
    expect(body).toContain("first");
    expect(body).toContain("second");
    // A list, not three loose paragraphs.
    expect(body).toMatch(/^[-*] first$/m);
  });

  // @verifies NEW-9
  test("NEW-9: an empty body stores an empty body, not a placeholder", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("No body");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    expect(bodyOf(await fileByTitle(tracker.root, "No body"))).toBe("");
  });

  // @verifies NEW-9
  test("NEW-9: Enter in the body does not submit the form", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Enter is safe");

    await page.getByTestId("rich-editor").click();
    await page.keyboard.type("line one");
    await page.keyboard.press("Enter");
    await page.keyboard.type("line two");

    // Still open — submission is explicit.
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);
  });

  // @verifies NEW-10
  test("NEW-10: each custom-field type gets its own control and stores keys", async ({
    page,
    tracker,
  }) => {
    const wfPath = path.join(tracker.root, ".loctt", "config", "workflow.yaml");
    const wf = await readFile(wfPath, "utf8");
    await writeFile(
      wfPath,
      wf.replace(
        "custom_fields: []",
        [
          "custom_fields:",
          "  - key: notes",
          "    label: Notes",
          "    type: string",
          "    multi: false",
          "    searchable: false",
          "  - key: points",
          "    label: Points",
          "    type: number",
          "    multi: false",
          "    searchable: false",
          "  - key: reviewed_on",
          "    label: Reviewed on",
          "    type: date",
          "    multi: false",
          "    searchable: false",
          "  - key: urgent",
          "    label: Urgent",
          "    type: boolean",
          "    multi: false",
          "    searchable: false",
          "  - key: tags",
          "    label: Tags",
          "    type: enum",
          "    multi: true",
          "    searchable: false",
          "    values:",
          "      - key: alpha",
          "        label: Alpha Label",
          "      - key: beta",
          "        label: Beta Label",
        ].join("\n"),
      ),
    );

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("All five types");

    // Five distinct controls render.
    await expect(page.getByTestId("create-field-notes")).toBeVisible();
    await expect(page.getByTestId("create-field-points")).toBeVisible();
    await expect(page.getByTestId("create-field-reviewed_on")).toBeVisible();
    await expect(page.getByTestId("create-field-urgent")).toBeVisible();
    await expect(page.getByTestId("create-field-tags")).toBeVisible();

    await page.getByTestId("create-field-notes").fill("a note");
    await page.getByTestId("create-field-points").fill("8");
    await page.getByTestId("create-field-reviewed_on").fill("2026-06-01");
    await page.getByTestId("create-field-urgent").check();
    // The multi enum shows LABELS...
    await expect(page.getByTestId("create-field-tags-alpha")).toContainText("Alpha Label");
    await page.getByTestId("create-field-tags-alpha").click();

    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    const text = await fileByTitle(tracker.root, "All five types");
    // Everything lands under `fields:`, not alongside built-ins.
    expect(text).toMatch(/^fields:/m);
    expect(text).toMatch(/notes:\s*a note/);
    expect(text).toMatch(/points:\s*8/);
    expect(text).toMatch(/reviewed_on:\s*.?2026-06-01/);
    expect(text).toMatch(/urgent:\s*true/);
    // ...and stores the enum KEY, not the label.
    expect(text).toMatch(/alpha/);
    expect(text).not.toMatch(/Alpha Label/);
    // `notes` is a custom field, so it must not appear as a top-level
    // frontmatter key.
    expect(text).not.toMatch(/^notes:/m);
  });

  // @verifies NEW-10
  test("NEW-10: no custom fields means no empty section header", async ({ page, tracker }) => {
    // The stock tracker declares `custom_fields: []`.
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await expect(page.getByText("Custom fields")).toHaveCount(0);
  });

  // @verifies NEW-3
  // NOTE: this test covers NEW-3's bullets 2 and 3 only — the pre-fill
  // is editable, and the new card lands in the right column. Bullet 1,
  // the pre-fill itself, is **unenactable**: it needs a per-column
  // "+ Add task", and only the board-level one exists.
  //
  // M3.1 added per-column controls and removed them: a column still
  // rendering for a status deleted from workflow.yaml since page load
  // then carried a create control, which is what broke BRD-42. The
  // call is sound and recorded — its consequence for NEW-3 was not.
  //
  // So `initialStatus` is plumbed through provider and modal and no
  // caller supplies it: both call sites are `createTask.open()` with
  // no argument. Measured — neutering the pre-fill left all 44 tests
  // in this file green. Renamed so the title stops claiming a control
  // the app does not have.
  test("NEW-3: the create modal's status is editable and the card lands there", async ({
    page,
    tracker,
  }) => {
    // The board-level "+ Add task" is the affordance BRD-40 requires,
    // and it is the only one on this view — see BoardView for why a
    // per-column control is deliberately absent (BRD-42 renders a
    // column for a status workflow.yaml no longer defines).
    //
    // So the status pre-fill is asserted through the modal's own
    // status field, which is what NEW-3's second and third bullets
    // actually turn on: the pre-fill is editable, and the created task
    // carries the chosen status.
    await page.goto(`${tracker.baseURL}/board`);
    await page.getByTestId("board-empty").getByRole("button", { name: /Add task/ }).click();
    await expect(page.getByTestId("create-task-modal")).toBeVisible();

    // Editable: choosing a different status wins.
    await page.getByTestId("create-status").getByRole("button").first().click();
    await page.getByRole("option").filter({ hasText: "In progress" }).click();
    await page.getByTestId("create-title").fill("Lands in progress");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    const text = await fileByTitle(tracker.root, "Lands in progress");
    expect(fmValue(text, "status")).toBe("in_progress");

    // And the card appears in that column without a reload.
    await expect(
      page.getByTestId("board-column-in_progress").getByText("Lands in progress"),
    ).toBeVisible();
  });

  // @verifies NEW-6
  test("NEW-6: reporter defaults to the current user, assignee stays empty", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Defaults check");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    const text = await fileByTitle(tracker.root, "Defaults check");
    // Reporter recorded...
    expect(fmValue(text, "reporter")).toBeDefined();
    // ...assignee NOT, so the form does not silently assign work.
    expect(text).not.toMatch(/^assignee:/m);
  });

  // @verifies NEW-18
  test("NEW-18: a sole project is auto-selected and still visible", async ({ page, tracker }) => {
    // A fresh tracker has exactly one project. `loctt init` also
    // writes a `default:` line, so the "no default anywhere" premise
    // has to be constructed rather than assumed — removing it is what
    // makes this the sole-project rung rather than the default rung.
    const p = path.join(tracker.root, ".loctt", "config", "projects.yaml");
    const text = await readFile(p, "utf8");
    await writeFile(
      p,
      text.split("\n").filter(l => !l.startsWith("default:")).join("\n"),
    );

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    // Shown, so the user can see where the task lands.
    await expect(page.getByTestId("create-project-sole")).toBeVisible();
    await expect(page.getByTestId("create-project-sole")).toContainText("Tasks");

    await page.getByTestId("create-title").fill("Sole project");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    expect(fmValue(await fileByTitle(tracker.root, "Sole project"), "key")).toMatch(/^T-/);
  });

  // @verifies NEW-19
  test("NEW-19: several projects and no default anywhere asks rather than guessing", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BE"]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);
    const p = path.join(tracker.root, ".loctt", "config", "projects.yaml");
    const text = await readFile(p, "utf8");
    await writeFile(
      p,
      text.split("\n").filter(l => !l.startsWith("default:")).join("\n"),
    );

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Needs a project");

    // The field opens EMPTY — not pre-filled with the first project.
    await expect(page.getByTestId("create-project")).toBeVisible();
    await expect(page.getByTestId("create-project-sole")).toHaveCount(0);

    // Submitting without choosing explains why, at the field.
    await page.getByTestId("create-submit").click();
    const msg = page.getByTestId("create-project-required");
    await expect(msg).toBeVisible();
    await expect(msg).toContainText(/no default/i);
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);

    // Once chosen, submission succeeds — into the chosen project.
    await page.getByTestId("create-project").getByRole("button").first().click();
    await page.getByRole("option").filter({ hasText: "Web" }).click();
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    expect(fmValue(await fileByTitle(tracker.root, "Needs a project"), "key"))
      .toMatch(/^WEB-/);
  });

  // @verifies K75
  test("K75: the no-default nudge is a deep link that opens Settings → Projects and closes the modal", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BE"]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);
    const p = path.join(tracker.root, ".loctt", "config", "projects.yaml");
    const text = await readFile(p, "utf8");
    await writeFile(
      p,
      text.split("\n").filter(l => !l.startsWith("default:")).join("\n"),
    );

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Needs a project");
    await page.getByTestId("create-submit").click();

    // The "Settings → Projects" phrase is an actual link, not prose:
    // following it lands on the Projects settings section (K75's deep
    // link) and dismisses the create modal on the way.
    const link = page.getByTestId("create-project-required-link");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/settings\/projects$/);
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
  });

  // @verifies ERR-44
  test("ERR-44: a placed field error and a toast are both keyboard-reachable, announced, and the field takes focus", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // Two projects, no default: submitting without a project produces a
    // placed field error — the "placed field error" ERR-44 needs, and
    // one reachable from the keyboard alone.
    await tracker.run(["project", "create", "Backend", "--prefix", "BE"]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);
    const projectsPath = path.join(tracker.root, ".loctt", "config", "projects.yaml");
    const projectsText = await readFile(projectsPath, "utf8");
    await writeFile(
      projectsPath,
      projectsText.split("\n").filter(l => !l.startsWith("default:")).join("\n"),
    );

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    // Keyboard only from here. Type a title, then drive the submit
    // button with the keyboard rather than a click.
    await page.getByTestId("create-title").fill("Keyboard error");
    const submit = page.getByTestId("create-submit");
    await submit.focus();
    await expect(submit).toBeFocused();
    await page.keyboard.press("Enter");

    // The message is placed at the field, is readable without a mouse,
    // and carries a live-region role so a screen reader announces it.
    const fieldError = page.getByTestId("create-project-required");
    await expect(fieldError).toBeVisible();
    await expect(fieldError).toHaveAttribute("role", "alert");

    // Focus moved to (or into) the offending field after the failed
    // submit — a keyboard user is taken to what they must fix, not left
    // on the Create button.
    const projectControl = page.getByTestId("create-project");
    await expect(async () => {
      const focusedInProject = await projectControl.evaluate(
        el => el.contains(document.activeElement),
      );
      expect(focusedInProject).toBe(true);
    }).toPass({ timeout: 2_000 });

    // Nothing was created by the failed submit — the far end agrees the
    // error stopped the write.
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);

    // Choose a project by keyboard and submit again: this time it
    // succeeds and raises a toast.
    await page.getByTestId("create-project").getByRole("button").first().click();
    await page.getByRole("option").filter({ hasText: "Web" }).click();
    await submit.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // The toast is announced via a live region (a screen reader reads it
    // without focus moving there).
    const toastRegion = page.getByTestId("toast-region");
    await expect(toastRegion).toHaveAttribute("aria-live", /polite|assertive/);
    const toast = page.getByTestId("toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText("Keyboard error");

    // The toast is dismissable from the keyboard: its dismiss control is
    // a real tab stop that can be focused and activated without a mouse.
    // (The a11y contract, flow-accessibility.md, accepts a tab stop in
    // the natural order as the toast's keyboard path.)
    const dismiss = page.getByTestId("toast-dismiss");
    await dismiss.focus();
    await expect(dismiss).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toast).toHaveCount(0);

    // Esc is the keyboard dismissal for a dialog: reopen the modal and
    // close it with Escape alone.
    await openModal(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });

  // @verifies NEW-14
  test("NEW-14: an explicit project wins and only its counter moves", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BE"]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);

    const statePath = path.join(tracker.root, ".loctt", "state.yaml");
    const before = await readFile(statePath, "utf8");

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Explicit wins");
    await page.getByTestId("create-project").getByRole("button").first().click();
    await page.getByRole("option").filter({ hasText: "Web" }).click();
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // The key uses the CHOSEN project's prefix.
    const text = await fileByTitle(tracker.root, "Explicit wins");
    expect(fmValue(text, "key")).toMatch(/^WEB-/);

    // And the other projects' counters are untouched.
    //
    // `state.yaml` keys each counter by the project's **ULID**, not by
    // its prefix — filtering on /WEB/ matches nothing and would make
    // this assertion compare two identical strings and pass for free.
    // So the Web project's own id is looked up and its block is the
    // only thing excluded.
    const projectsYaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "projects.yaml"),
      "utf8",
    );
    const webId = /id:\s*(\S+)\n\s*name:\s*Web\b/.exec(projectsYaml)?.[1];
    expect(webId, "the Web project should be on disk").toBeDefined();

    const after = await readFile(statePath, "utf8");
    const dropWebBlock = (t: string): string => {
      const lines = t.split("\n");
      const out: string[] = [];
      let skipping = false;
      for (const line of lines) {
        if (line.trim().startsWith(`${String(webId)}:`)) { skipping = true; continue; }
        // A less-indented line ends the block.
        if (skipping && /^\s{0,2}\S/.test(line)) skipping = false;
        if (!skipping) out.push(line);
      }
      return out.join("\n");
    };
    expect(dropWebBlock(after)).toBe(dropWebBlock(before));
    // Positive control: the Web counter DID move, so the comparison
    // above is excluding something real rather than nothing at all.
    expect(after).toContain(String(webId));
    expect(dropWebBlock(after)).not.toBe(after);
  });

  // @verifies NEW-17
  test("NEW-17: an archived project is not offered and cannot receive a task", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Archived One", "--prefix", "ARC"]);
    await tracker.run(["project", "archive", "Archived One"]);

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    // With one live project left, the field is the sole-project
    // control naming it — and the archived one is nowhere.
    const modal = page.getByTestId("create-task-modal");
    await expect(modal).not.toContainText("Archived One");
  });

  // @verifies NEW-28
  test("NEW-28: focus is trapped in the modal and restored on close", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    const trigger = page.getByTestId("header-new-task");
    await trigger.click();
    await expect(page.getByTestId("create-task-modal")).toBeVisible();

    // Tab many times; focus must never leave the dialog.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="create-task-modal"]');
        return dialog !== null && document.activeElement !== null
          && dialog.contains(document.activeElement);
      });
      expect(inside, `focus escaped the dialog after ${String(i + 1)} tabs`).toBe(true);
    }

    // On close, focus returns to the trigger.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  // @verifies NEW-22
  test("NEW-22: a 500-character title is stored intact and truncated only for display", async ({
    page,
    tracker,
  }) => {
    const long = "L".repeat(500);
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill(long);
    // What the user sees at submit time is the full string.
    await expect(page.getByTestId("create-title")).toHaveValue(long);
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // Stored intact — no silent server-side trim.
    const text = await fileByTitle(tracker.root, "L{100}");
    const stored = (fmValue(text, "title") ?? "").replace(/^["']|["']$/g, "");
    expect(stored).toHaveLength(500);
  });

  // @verifies NEW-24
  test("NEW-24: 25 labels wrap without pushing submit out of reach", async ({
    page,
    tracker,
  }) => {
    for (let i = 1; i <= 25; i++) {
      await tracker.run(["label", "create", `lbl-${String(i)}`]);
    }

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Many labels");

    const labels = page.getByTestId("create-labels");
    for (let i = 1; i <= 25; i++) {
      await labels.getByTestId("meta-add-label").click();
      const input = labels.getByTestId("meta-label-input");
      // An exact name: typing "lbl-1" also matches lbl-10..lbl-19, and
      // Enter attaches the *first* candidate — which would silently
      // attach the wrong label and still leave 25 on the task, so the
      // count assertion below would pass on the wrong data.
      await input.fill(`lbl-${String(i)}`);
      await labels.getByRole("option", { name: `lbl-${String(i)}`, exact: true }).click();
    }

    // The submit control is still reachable and clickable.
    const submit = page.getByTestId("create-submit");
    await expect(submit).toBeInViewport();
    await submit.click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // All 25 land on the task.
    const text = await fileByTitle(tracker.root, "Many labels");
    const labelBlock = /labels:\n((?:\s+-\s+\S+\n)+)/.exec(text)?.[1] ?? "";
    expect(labelBlock.trim().split("\n")).toHaveLength(25);
  });

  /**
   * The ticket's end-to-end journey: board → drag → timeline →
   * edge-drag → `n` → create.
   *
   * Its value is not any single assertion — each surface has its own
   * specs. It is that the three views and the modal survive being used
   * *in sequence in one page session*, which is how they are actually
   * used and which per-surface specs never exercise. The shortcut
   * firing on a route the user navigated to (rather than loaded cold),
   * after two drags have installed and removed their own window
   * listeners, is exactly the interaction that per-file tests miss.
   */
  // @verifies NEW-4
  test("E2E: board drag, timeline resize, then `n` creates a task", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Journey card", fields: { start_date: "2026-05-04", due_date: "2026-05-08" } },
    ]);
    const [card] = keys as [string];

    // --- /board: drag the card to another column ---------------------
    await page.goto(`${tracker.baseURL}/board`);
    await expect(page.getByTestId(`board-card-${card}`)).toBeVisible();

    const from = await page.getByTestId(`board-card-${card}`).boundingBox();
    const to = await page.getByTestId("board-column-in_progress").boundingBox();
    expect(from, "the card should have a box").not.toBeNull();
    expect(to, "the target column should have a box").not.toBeNull();
    if (from !== null && to !== null) {
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, {
        steps: 4,
      });
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
      await page.mouse.up();
    }
    // The far end, not the rendered column.
    await expect
      .poll(async () => fmValue(await fileByTitle(tracker.root, "Journey card"), "status"))
      .toBe("in_progress");

    // --- /timeline: edge-drag the bar to resize ----------------------
    await page.goto(`${tracker.baseURL}/timeline`);
    const bar = page.getByTestId(`timeline-bar-${card}`);
    await expect(bar).toBeVisible();
    const beforeDue = fmValue(await fileByTitle(tracker.root, "Journey card"), "due_date");

    // The end handle's OWN box, not an offset guessed off the bar.
    // flow-timeline.spec.ts records why: aiming at `x + width - 1` puts
    // `elementFromPoint` on the button rather than the handle, so the
    // gesture is silently read as a body-drag (which moves both dates)
    // instead of a resize. `scrollIntoViewIfNeeded` matters for the
    // same reason — the chart opens scrolled to today, and a drag aimed
    // at an off-screen box presses on nothing at all.
    await bar.scrollIntoViewIfNeeded();
    const endHandle = page.getByTestId(`timeline-handle-end-${card}`);
    const endBox = await endHandle.boundingBox();
    expect(endBox, "the end handle should have a box").not.toBeNull();
    if (endBox !== null) {
      const y = endBox.y + endBox.height / 2;
      const x = endBox.x + endBox.width / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 60, y, { steps: 10 });
      await page.mouse.up();
    }

    await expect
      .poll(async () => fmValue(await fileByTitle(tracker.root, "Journey card"), "due_date"))
      .not.toBe(beforeDue);

    // --- `n`: the shortcut still works after both drags --------------
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("n");
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
    await page.keyboard.type("Made at the end of the journey");
    await expect(page.getByTestId("create-title")).toHaveValue(
      "Made at the end of the journey",
    );
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // And it really landed.
    const made = await fileByTitle(tracker.root, "Made at the end of the journey");
    expect(fmValue(made, "key")).toMatch(/^T-\d+$/);
  });

  // @verifies NEW-7
  test("NEW-7: a label created inline is written and visible to other surfaces", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "existing-one"]);
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Inline label");

    const labels = page.getByTestId("create-labels");
    await labels.getByTestId("meta-add-label").click();

    // An existing label filters as you type.
    await labels.getByTestId("meta-label-input").fill("existing");
    await expect(labels.getByRole("option", { name: "existing-one" })).toBeVisible();

    // An unmatched string offers creation instead.
    await labels.getByTestId("meta-label-input").fill("brand-new-label");
    const create = labels.getByTestId("meta-create-label");
    await expect(create).toBeVisible();
    await create.click();

    // It is written to labels.yaml — the far end, not the chip.
    //
    // Polled rather than read once: the click returns as soon as the
    // request is sent, and the file is written by the server after
    // that. A bare read raced it and saw only the seeded label.
    await expect
      .poll(async () => readFile(
        path.join(tracker.root, ".loctt", "config", "labels.yaml"),
        "utf8",
      ))
      .toContain("brand-new-label");

    // And it is immediately visible to another surface without a
    // restart: the CLI reads the same file.
    const cliOut = await tracker.run(["label", "list"]);
    expect(cliOut).toContain("brand-new-label");

    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    // And it actually attached to the task.
    expect(await fileByTitle(tracker.root, "Inline label")).toMatch(/labels:/);
  });

  // @verifies NEW-8
  test("NEW-8: dates respect the calendar and store no timezone", async ({ page, tracker }) => {
    // A holiday and a weekend to mark. `timezone` is required by the
    // calendar schema — without it every request 400s on config, which
    // would make this pass for the wrong reason.
    await writeFile(
      path.join(tracker.root, ".loctt", "config", "calendar.yaml"),
      [
        "timezone: UTC",
        "working_days: [1, 2, 3, 4, 5]",
        "first_day_of_week: 1",
        "holidays:",
        "  - date: 2026-05-25",
        "    label: Spring Holiday",
      ].join("\n"),
    );

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Calendar aware");

    // 2026-05-23 is a Saturday: marked as non-working.
    await page.getByTestId("create-start").fill("2026-05-23");
    await expect(page.getByTestId("create-nonworking-start")).toContainText(/Saturday/);

    // The holiday's own label wins over the weekday.
    await page.getByTestId("create-due").fill("2026-05-25");
    await expect(page.getByTestId("create-nonworking-due")).toContainText("Spring Holiday");

    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // Stored as plain YYYY-MM-DD: no time component, no zone shift.
    const text = await fileByTitle(tracker.root, "Calendar aware");
    expect(fmValue(text, "start_date")).toBe("2026-05-23");
    expect(fmValue(text, "due_date")).toBe("2026-05-25");
    expect(text).not.toMatch(/start_date:.*T\d\d:/);
  });

  // @verifies NEW-8
  test("NEW-8: both date fields are optional", async ({ page, tracker }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("No dates");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    const text = await fileByTitle(tracker.root, "No dates");
    expect(text).not.toMatch(/^start_date:/m);
    expect(text).not.toMatch(/^due_date:/m);
  });

  // @verifies NEW-15
  test("NEW-15: the user's default_project beats the workspace default", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BE"]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);

    const projectsYaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "projects.yaml"),
      "utf8",
    );
    const webId = /id:\s*(\S+)\n\s*name:\s*Web\b/.exec(projectsYaml)?.[1];
    const backendId = /id:\s*(\S+)\n\s*name:\s*Backend\b/.exec(projectsYaml)?.[1];
    expect(webId).toBeDefined();
    expect(backendId).toBeDefined();

    // Workspace default = Backend.
    await writeFile(
      path.join(tracker.root, ".loctt", "config", "projects.yaml"),
      `${projectsYaml.split("\n").filter(l => !l.startsWith("default:")).join("\n")}\ndefault: ${String(backendId)}\n`,
    );
    // Per-user default = Web, which must win.
    const usersDir = path.join(tracker.root, ".loctt", "users");
    const userIds = await readdir(usersDir);
    const [userId] = userIds;
    expect(userId, "a user should exist").toBeDefined();
    await writeFile(
      path.join(usersDir, String(userId), "settings.yaml"),
      `default_project: ${String(webId)}\n`,
    );

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Per-user default");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();

    // The KEY is the proof — it comes from the resolved project's
    // prefix, and it is what the user is left holding.
    expect(fmValue(await fileByTitle(tracker.root, "Per-user default"), "key"))
      .toMatch(/^WEB-/);
  });

  // @verifies NEW-16
  test("NEW-16: a default naming a deleted project falls through silently", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BE"]);
    const projectsYaml = await readFile(
      path.join(tracker.root, ".loctt", "config", "projects.yaml"),
      "utf8",
    );
    const backendId = /id:\s*(\S+)\n\s*name:\s*Backend\b/.exec(projectsYaml)?.[1];
    expect(backendId).toBeDefined();
    await writeFile(
      path.join(tracker.root, ".loctt", "config", "projects.yaml"),
      `${projectsYaml.split("\n").filter(l => !l.startsWith("default:")).join("\n")}\ndefault: ${String(backendId)}\n`,
    );

    // The user's own preference points at a project that never existed.
    const usersDir = path.join(tracker.root, ".loctt", "users");
    const [userId] = await readdir(usersDir);
    expect(userId).toBeDefined();
    const settingsPath = path.join(usersDir, String(userId), "settings.yaml");
    await writeFile(settingsPath, "default_project: 01ARCHIVEMEDOESNOTEXIST00\n");

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);

    // No error is shown for the stale preference — the case is
    // explicit that this must not interrupt a create.
    await expect(page.getByTestId("create-error")).toHaveCount(0);
    await expect(page.getByTestId("create-project-required")).toHaveCount(0);

    await page.getByTestId("create-title").fill("Falls through");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    // It landed in the workspace default.
    expect(fmValue(await fileByTitle(tracker.root, "Falls through"), "key"))
      .toMatch(/^BE-/);

    // And the dangling preference was NOT silently rewritten — it
    // stays on disk for `loctt doctor` to report.
    expect(await readFile(settingsPath, "utf8"))
      .toContain("01ARCHIVEMEDOESNOTEXIST00");
  });

  // @verifies NEW-21
  test("NEW-21: changing project clears project-scoped picks, keeps workspace ones", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Backend", "--prefix", "BE"]);
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);
    await tracker.run(["milestone", "create", "v1"]);

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Switch project");

    // Workspace-level pick.
    await page.getByTestId("create-priority").getByRole("button").first().click();
    await page.getByRole("option").first().click();
    const priorityAfterPick = await page.getByTestId("create-priority").innerText();

    // Project-scoped pick.
    await page.getByTestId("create-milestone").getByRole("button").first().click();
    await page.getByRole("option", { name: "v1" }).click();
    await expect(page.getByTestId("create-milestone")).toContainText("v1");

    // Change the project.
    await page.getByTestId("create-project").getByRole("button").first().click();
    await page.getByRole("option").filter({ hasText: "Web" }).click();

    // The milestone is cleared rather than submitted and rejected...
    await expect(page.getByTestId("create-milestone")).not.toContainText("v1");
    // ...and priority, which is workspace-level, is NOT cleared.
    await expect(page.getByTestId("create-priority")).toHaveText(priorityAfterPick);

    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    const text = await fileByTitle(tracker.root, "Switch project");
    expect(fmValue(text, "key")).toMatch(/^WEB-/);
    expect(text).not.toMatch(/^milestone:/m);
    expect(text).toMatch(/^priority:/m);
  });

  // @verifies NEW-25
  test("NEW-25: a picker backed by 200 labels is searchable and complete", async ({
    page,
    tracker,
  }) => {
    // 200 labels: past the server's 100-row default page, which is the
    // exact window that used to hide the tail of the list and make the
    // form offer to create a duplicate of an existing label.
    const labelsPath = path.join(tracker.root, ".loctt", "config", "labels.yaml");
    const lines = ["labels:"];
    for (let i = 1; i <= 200; i++) {
      lines.push(`  - id: 01LBL${String(i).padStart(21, "0")}`);
      lines.push(`    name: lbl-${String(i)}`);
    }
    await writeFile(labelsPath, `${lines.join("\n")}\n`);

    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    const labels = page.getByTestId("create-labels");
    await labels.getByTestId("meta-add-label").click();

    // A label near the END of the list — inside the tail the default
    // page dropped. It must be offered as an existing label...
    await labels.getByTestId("meta-label-input").fill("lbl-190");
    await expect(labels.getByRole("option", { name: "lbl-190", exact: true })).toBeVisible();
    // ...and must NOT be offered for creation, which would duplicate it.
    await expect(labels.getByTestId("meta-create-label")).toHaveCount(0);

    // Filtering is real: an unmatched string offers creation instead.
    await labels.getByTestId("meta-label-input").fill("zzz-nothing-matches");
    await expect(labels.getByTestId("meta-create-label")).toBeVisible();
  });

  // @verifies NEW-30
  test("NEW-30: a status deleted under an open modal never reaches disk", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Stale status");

    // Select `in_progress` while it still exists.
    await page.getByTestId("create-status").getByRole("button").first().click();
    await page.getByRole("option").filter({ hasText: "In progress" }).click();

    // Now delete it from workflow.yaml, with the modal still open.
    await setStatuses(tracker.root, [
      { key: "backlog", label: "Backlog", default: true },
      { key: "done", label: "Done", category: "completed" },
    ]);

    await page.getByTestId("create-submit").click();

    // Either branch the case allows is fine; what is NOT allowed is a
    // task carrying a status key that no longer exists.
    await expect(page.getByTestId("create-error")).toBeVisible();
    await expect(page.getByTestId("create-error")).toContainText("in_progress");

    const files = await allTaskFiles(tracker.root);
    expect(files).toHaveLength(0);
  });

  // @verifies NEW-33
  test("NEW-33: an unwritable state.yaml is reported honestly and leaves no orphan", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Key allocation fails");

    const statePath = path.join(tracker.root, ".loctt", "state.yaml");
    const before = await readFile(statePath, "utf8");
    await chmod(statePath, 0o444);
    // Also lock the directory, so the atomic rename cannot replace it.
    const configDir = path.join(tracker.root, ".loctt");
    const dirMode = (await stat(configDir)).mode;
    await chmod(configDir, 0o555);

    try {
      await page.getByTestId("create-submit").click();

      const err = page.getByTestId("create-error");
      await expect(err).toBeVisible();
      await expect(err).toContainText(/Couldn't create the task/i);

      // No task directory left behind without a valid key.
      expect(await allTaskFiles(tracker.root)).toHaveLength(0);
    } finally {
      await chmod(configDir, dirMode);
      await chmod(statePath, 0o644);
    }

    // After releasing the lock, retrying succeeds and the key is the
    // next in sequence with no gap-plus-orphan.
    expect(await readFile(statePath, "utf8")).toBe(before);
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    expect(fmValue(await fileByTitle(tracker.root, "Key allocation fails"), "key"))
      .toBe("T-1");
  });

  // @verifies NEW-34
  test("NEW-34: creating into a project deleted mid-form fails specifically", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["project", "create", "Doomed", "--prefix", "DOOM"]);
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Orphaned project");
    await page.getByTestId("create-project").getByRole("button").first().click();
    await page.getByRole("option").filter({ hasText: "Doomed" }).click();

    // Delete it out from under the open modal.
    // Positional name, and `--yes` (not `--force`) to skip the prompt.
    await tracker.run(["project", "delete", "Doomed", "--yes"]);

    await page.getByTestId("create-submit").click();

    const err = page.getByTestId("create-error");
    await expect(err).toBeVisible();
    // The form content is preserved so only the project must be re-picked.
    await expect(page.getByTestId("create-title")).toHaveValue("Orphaned project");
    // Nothing was created.
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);
  });

  // @verifies NEW-35
  test("NEW-35: an archived milestone is rejected in its own terms", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["milestone", "create", "Doomed Milestone"]);
    await page.goto(`${tracker.baseURL}/list`);
    await openModal(page);
    await page.getByTestId("create-title").fill("Archived ref");
    await page.getByTestId("create-milestone").getByRole("button").first().click();
    await page.getByRole("option", { name: "Doomed Milestone" }).click();

    // Archive it while the modal holds it selected.
    await tracker.run(["milestone", "archive", "Doomed Milestone"]);

    await page.getByTestId("create-submit").click();

    const err = page.getByTestId("create-error");
    await expect(err).toBeVisible();
    // Named by its own label, and said to be archived.
    await expect(err).toContainText("Doomed Milestone");
    await expect(err).toContainText(/archiv/i);
    expect(await allTaskFiles(tracker.root)).toHaveLength(0);

    // Clearing the field and resubmitting succeeds.
    await page.getByTestId("create-milestone").getByRole("button").first().click();
    // The clear entry carries `role="option"`, not `button` — it sits
    // inside the picker's listbox alongside the real choices.
    await page.getByRole("option", { name: "None" }).click();
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    expect(await allTaskFiles(tracker.root)).toHaveLength(1);
  });

  // @verifies NEW-36
  test("NEW-36: a failed inline label creation leaves no phantom chip", async ({
    page,
    tracker,
  }) => {
    // A fresh tracker has no `labels.yaml` at all — the file appears
    // with the first label. Seeding one gives this test a real
    // before-state to compare against; without it the "unchanged"
    // assertion would be comparing two absences.
    await tracker.run(["label", "create", "already-here"]);
    const labelsPath = path.join(tracker.root, ".loctt", "config", "labels.yaml");
    const before = await readFile(labelsPath, "utf8");

    await page.goto(`${tracker.baseURL}/list`);
    await page.route("**/api/labels", async route => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "unknown",
          message: "labels.yaml could not be written",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        }),
      });
    });

    await openModal(page);
    await page.getByTestId("create-title").fill("Label write fails");
    const labels = page.getByTestId("create-labels");
    await labels.getByTestId("meta-add-label").click();
    await labels.getByTestId("meta-label-input").fill("never-created");
    await labels.getByTestId("meta-create-label").click();

    // The message names the label and says it could not be created.
    const labelErr = labels.getByTestId("meta-label-error");
    await expect(labelErr).toBeVisible();
    await expect(labelErr).toContainText("never-created");

    // No phantom chip on the form as if the label existed.
    await expect(labels.getByText("never-created", { exact: true })).toHaveCount(0);
    // labels.yaml is unchanged — no partial or duplicate entry.
    expect(await readFile(labelsPath, "utf8")).toBe(before);

    // The rest of the form is unaffected and the task still creates.
    //
    // The popup is dismissed by clicking the title, not by `Escape`:
    // the modal's own Escape handler runs in the capture phase (so the
    // discard prompt can claim it first), which would put the discard
    // confirmation over the form instead of just closing the popup.
    await page.getByTestId("create-title").click();
    await expect(page.getByTestId("create-title")).toHaveValue("Label write fails");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    const text = await fileByTitle(tracker.root, "Label write fails");
    expect(text).not.toMatch(/never-created/);
  });

  // @verifies NEW-38
  test("NEW-38: an unparseable success body admits the state is uncertain", async ({
    page,
    tracker,
  }) => {
    await page.goto(`${tracker.baseURL}/list`);
    await page.route("**/api/tasks", async route => {
      if (route.request().method() !== "POST") { await route.fallback(); return; }
      // A 201 whose body is truncated JSON.
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: '{"key":"T-1","tit',
      });
    });

    await openModal(page);
    await page.getByTestId("create-title").fill("Truncated reply");
    await page.getByTestId("create-submit").click();

    // It does NOT close silently as if it succeeded.
    await expect(page.getByTestId("create-task-modal")).toBeVisible();
    // And it does not claim a clean failure it cannot vouch for.
    const err = page.getByTestId("create-error");
    await expect(err).toBeVisible();
    // All three things NEW-38 requires: what was attempted, that the
    // state is uncertain, and what to do about it.
    await expect(err).toContainText(/creat/i);
    await expect(err).toContainText(/may or may not/i);
    await expect(err).toContainText(/reload/i);
    // No success toast.
    await expect(page.getByTestId("toast")).toHaveCount(0);
  });
});
