/**
 * Transcribed from docs/dev/ui-test-cases/flow-degradation.md — the
 * corruption surfaces on the task-detail meta panel (B3 Task-meta lane).
 *
 * DEG-29 (UX-7): a corrupt field must render with an inline warning and
 * its stored value, NOT a bare "—" that reads as "no value". And an
 * unrecognised preserved key must be visible in a client-rendered "Not
 * recognised" group — the DEG-7 client render (before this, DEG-7 was
 * proven only by a core round-trip test; no client showed the key).
 *
 * The corruption is seeded by writing raw YAML to the task.md — a
 * `loctt set` would reject `due_date: 42` and `jira_id`, which is exactly
 * why the tolerant *read* path is the thing under test. `tracker.seed`'s
 * `fields` are applied straight to disk, so an unquoted number and an
 * unknown key land verbatim.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** The frontmatter text of the task with this key, read off disk. */
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

test.describe("DEG-29 / DEG-7 — corruption on the task-detail meta panel", () => {
  // @verifies DEG-29
  test("a corrupt due_date shows its stored value with a warning, not a bare —", async ({
    page,
    tracker,
  }) => {
    // `due_date: 42` is wrong-typed (a number where a date string is
    // required); the tolerant parse lifts it into `health`, so a panel
    // reading only frontmatter would draw an empty Due row.
    const [key] = await tracker.seed([
      { title: "Corrupt due", fields: { due_date: "42" } },
    ]);
    if (key === undefined) throw new Error("seed returned no key");

    // Precondition: the bad value really is on disk.
    expect(await frontmatterOf(tracker.root, key)).toMatch(/^due_date:\s*42\s*$/m);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    const notice = page.getByTestId("meta-corrupt-due");
    await expect(notice).toBeVisible();
    // The raw stored value is shown — 42, not "—".
    await expect(page.getByTestId("meta-corrupt-raw-due")).toHaveText("42");
    await expect(notice).toContainText(/corrupt/i);
    // A Clear/repair affordance exists.
    await expect(page.getByTestId("meta-corrupt-clear-due")).toBeVisible();
  });

  // @verifies DEG-29
  test("clearing a corrupt field removes it from disk (repair, not silent drop)", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([
      { title: "Clearable corrupt", fields: { due_date: "42" } },
    ]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await page.getByTestId("meta-corrupt-clear-due").click();

    // The bad value leaves the file — the far end that a DOM-only
    // assertion could not prove.
    await expect
      .poll(async () => frontmatterOf(tracker.root, key))
      .not.toMatch(/^due_date:\s*42\s*$/m);
  });

  // @verifies DEG-7
  // @verifies DEG-29
  test("an unrecognised preserved key is visible in a 'Not recognised' group", async ({
    page,
    tracker,
  }) => {
    // `jira_id` is not a schema field; it round-trips via health (P7).
    // This is the DEG-7 client render — the group is the surface that
    // shows the key to the person editing the task.
    const [key] = await tracker.seed([
      { title: "Preserved key", fields: { jira_id: "ABC-123" } },
    ]);
    if (key === undefined) throw new Error("seed returned no key");

    expect(await frontmatterOf(tracker.root, key)).toMatch(/^jira_id:\s*ABC-123\s*$/m);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);

    const group = page.getByTestId("meta-unrecognised-group");
    await expect(group).toBeVisible();
    await expect(group).toContainText("Not recognised");
    const row = page.getByTestId("meta-unrecognised-jira-id");
    await expect(row).toContainText("jira_id");
    await expect(row).toContainText("ABC-123");
  });

  // @verifies DEG-7
  test("removing an unrecognised key clears it from disk", async ({ page, tracker }) => {
    const [key] = await tracker.seed([
      { title: "Removable key", fields: { jira_id: "ABC-123" } },
    ]);
    if (key === undefined) throw new Error("seed returned no key");

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await page.getByTestId("meta-unrecognised-remove-jira-id").click();

    await expect
      .poll(async () => frontmatterOf(tracker.root, key))
      .not.toMatch(/^jira_id:\s*ABC-123\s*$/m);
  });
});

test.describe("DEG-31 — the global integrity badge points at Diagnostics", () => {
  // @verifies DEG-31
  test("a corrupt task raises a header badge that links to Diagnostics", async ({
    page,
    tracker,
  }) => {
    // Seed one corrupt task (a wrong-typed due_date). The badge is a
    // whole-app affordance, so it must appear from an ordinary list view,
    // not only on the corrupt task's own page.
    const [key] = await tracker.seed([
      { title: "Corrupt for badge", fields: { due_date: "42" } },
    ]);
    if (key === undefined) throw new Error("seed returned no key");
    expect(await frontmatterOf(tracker.root, key)).toMatch(/^due_date:\s*42\s*$/m);

    await page.goto(`${tracker.baseURL}/list`);

    const badge = page.getByTestId("integrity-badge");
    await expect(badge).toBeVisible();
    // Standing context, not a toast/alert.
    await expect(badge).toHaveAttribute("role", "status");
    await expect(badge).toContainText(/data issue/i);

    // It routes to Diagnostics without three clicks behind a manual Run.
    await badge.click();
    await expect(page).toHaveURL(/\/settings\/diagnostics$/);
    await expect(page.getByTestId("diagnostics-panel")).toBeVisible();
  });

  // @verifies DEG-31
  test("a clean tracker shows no badge", async ({ page, tracker }) => {
    // A healthy task — nothing corrupt anywhere.
    await tracker.seed([{ title: "Perfectly fine" }]);
    await page.goto(`${tracker.baseURL}/list`);
    // Wait for the list to be present, then assert the badge is absent.
    await expect(page.getByTestId("header-new-task")).toBeVisible();
    await expect(page.getByTestId("integrity-badge")).toHaveCount(0);
  });
});
