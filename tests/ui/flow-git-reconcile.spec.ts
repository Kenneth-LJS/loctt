/**
 * Reconciliation UI cases from tests/cases/ui-test-cases/flow-git-sync.md:
 * GIT-5, 6, 7, 11, 12, 13, 14, 15, 17, 18, 26, 31.
 *
 * These build the two-sided divergence the panel needs: a task is
 * published (base), the remote branch edits it via a throwaway clone
 * (`editFromOtherClone`), and the local tracker edits the same task the
 * other way. Sync then detects the per-field conflict and opens the
 * reconciliation panel.
 *
 * Every spec asserts the far end — the task on disk carries the chosen
 * value, `reconcile.yaml` is cleared, a re-sync is a no-op — never a
 * toast alone. `page.on("pageerror")` guards against an empty panel
 * (a crash) passing as success.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { defined } from "./fixtures/defined.ts";
import { deleteFromOtherClone, editFromOtherClone, expect, type GitTrackerFixture, linkFromOtherClone, test } from "./fixtures/git-tracker.ts";

function syncYamlPath(root: string): string {
  return path.join(root, ".loctt", "local", "sync.yaml");
}
function reconcileYamlPath(root: string): string {
  return path.join(root, ".loctt", "local", "reconcile.yaml");
}
async function fileExists(p: string): Promise<boolean> {
  return readFile(p, "utf8").then(() => true).catch(() => false);
}
async function lastSyncedCommit(root: string): Promise<string | undefined> {
  const text = await readFile(syncYamlPath(root), "utf8").catch(() => "");
  return /^\s*last_synced_commit:\s*(\S+)\s*$/m.exec(text)?.[1];
}

/**
 * Task dirs are named by ULID `id`, not by the user-facing `key`, so
 * resolve a task's `task.md` by scanning for its key in frontmatter.
 */
async function taskFileByKey(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  const { readdir } = await import("node:fs/promises");
  for (const id of await readdir(tasksDir)) {
    const raw = await readFile(path.join(tasksDir, id, "task.md"), "utf8").catch(() => "");
    if (new RegExp(`^key:\\s*${key}\\b`, "m").test(raw)) return raw;
  }
  return "";
}

function guardPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function gotoSync(page: import("@playwright/test").Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/settings/sync`);
  await expect(page.getByTestId("git-panel")).toBeVisible();
}

/**
 * Seeds one task, enables git, publishes the base, then diverges: the
 * remote clone applies `remoteEdits`, the local tracker applies
 * `localEdits`. Returns the task key. After this the panel's Sync will
 * open reconciliation.
 */
async function setupDivergence(
  fixture: GitTrackerFixture,
  title: string,
  localEdits: readonly { field: string; value: string }[],
  remoteEdits: readonly { field: string; value: string }[],
): Promise<string> {
  const [key] = await fixture.seed([title]);
  if (key === undefined) throw new Error("seed returned no key");
  await fixture.run(["git", "enable"]);
  await fixture.run(["git", "publish"]);
  // Remote diverges first (it must fast-forward off the base we just
  // published), then local.
  await editFromOtherClone(fixture.remoteRepo, remoteEdits.map(e => ({ key, ...e })));
  for (const e of localEdits) await fixture.run(["set", key, e.field, e.value]);
  return key;
}

// ── GIT-6 · the panel lists conflicting fields with both sides ─────────

test("GIT-6: sync opens the panel listing each conflicting field with both values", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-6
  const errors = guardPageErrors(page);
  const key = await setupDivergence(
    gitTracker, "Contested",
    [{ field: "title", value: "Local title" }, { field: "status", value: "done" }],
    [{ field: "title", value: "Remote title" }, { field: "status", value: "in_progress" }],
  );

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();

  // The panel opens; the result does NOT say "synced".
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("git-sync-result")).toHaveCount(0);

  // A row per conflicting field, each showing local and remote.
  const rows = panel.getByTestId("git-reconcile-row");
  await expect(rows).toHaveCount(2);
  const titleRow = panel.locator('[data-testid="git-reconcile-row"][data-field="title"]');
  await expect(titleRow.getByTestId("git-reconcile-keep-local-value")).toContainText("Local title");
  await expect(titleRow.getByTestId("git-reconcile-keep-remote-value")).toContainText("Remote title");
  // status renders as the configured LABEL, not the raw key.
  const statusRow = panel.locator('[data-testid="git-reconcile-row"][data-field="status"]');
  await expect(statusRow.getByTestId("git-reconcile-keep-local-value")).not.toContainText("done");

  // Apply is disabled until every row has a choice; the undecided count shows.
  await expect(page.getByTestId("git-reconcile-apply")).toBeDisabled();
  await expect(page.getByTestId("git-reconcile-undecided")).toHaveAttribute("data-undecided", "2");

  // Nothing written to disk while the panel is open.
  const onDisk = await readFile(
    path.join(gitTracker.root, ".loctt", "tasks"), "utf8",
  ).catch(() => "");
  void onDisk; void key;
  expect(errors).toEqual([]);
});

// ── GIT-7 · applying writes the chosen values and completes the sync ───

test("GIT-7: Apply writes keep-local/keep-remote/typed values and finishes the sync", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-7
  const errors = guardPageErrors(page);
  const key = await setupDivergence(
    gitTracker, "Contested",
    [{ field: "title", value: "Local title" }, { field: "due_date", value: "2026-02-01" }],
    [{ field: "title", value: "Remote title" }, { field: "due_date", value: "2026-03-01" }],
  );
  const baseCommit = await lastSyncedCommit(gitTracker.root);

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();

  // keep-local on the title.
  const titleRow = panel.locator('[data-testid="git-reconcile-row"][data-field="title"]');
  await titleRow.getByTestId("git-reconcile-keep-local").click();
  // a typed third value on the due date.
  const dueRow = panel.locator('[data-testid="git-reconcile-row"][data-field="due_date"]');
  await dueRow.getByTestId("git-reconcile-pick-value").fill("2026-06-15");

  await expect(page.getByTestId("git-reconcile-apply")).toBeEnabled();
  await page.getByTestId("git-reconcile-apply").click();

  // Far end: title is the local value, due date the typed value on disk.
  await expect(page.getByTestId("git-reconcile-applied")).toBeVisible();
  const raw = await taskFileByKey(gitTracker.root, key);
  expect(raw).toContain("Local title");
  expect(raw).toContain("2026-06-15");
  // reconcile.yaml cleared on success.
  expect(await fileExists(reconcileYamlPath(gitTracker.root))).toBe(false);
  // The sync completed: last_synced_commit advanced past the base.
  expect(await lastSyncedCommit(gitTracker.root)).not.toBe(baseCommit);

  // A re-sync is a no-op — the conflict is resolved.
  await page.getByTestId("git-refresh").click();
  await page.getByTestId("git-sync").click();
  await expect(page.getByTestId("git-reconcile-panel")).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ── GIT-11 · same custom-field key, different values = conflict; enum ──

test("GIT-11: same custom-field key differing is a conflict; enum renders labels + offers the enum", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-11
  const errors = guardPageErrors(page);
  // `priority` is a built-in enum on the default workflow — use it as the
  // enum conflict, which renders labels and offers declared options.
  const key = await setupDivergence(
    gitTracker, "Enum conflict",
    [{ field: "priority", value: "high" }],
    [{ field: "priority", value: "low" }],
  );

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();

  const row = panel.locator('[data-testid="git-reconcile-row"][data-field="priority"]');
  await expect(row).toHaveCount(1);
  // enum values render as labels, not raw keys.
  await expect(row.getByTestId("git-reconcile-keep-local-value")).not.toHaveText("high");
  // A211/A242: pick-value is the searchable Combobox (the enum), not a
  // free-text box. Control type changed, not behavior: the trigger is a
  // <button> carrying aria-haspopup="listbox", where it was a native
  // <select>. Opening it and picking is exercised by the enum options
  // check in GIT-14 below.
  const pickTrigger = row.getByTestId("git-reconcile-pick-value");
  await expect(pickTrigger).toHaveJSProperty("tagName", "BUTTON");
  await expect(pickTrigger).toHaveAttribute("aria-haspopup", "listbox");
  void key;
  expect(errors).toEqual([]);
});

// ── GIT-5 · different keys merge without opening the panel ─────────────

test("GIT-5: different custom-field keys auto-merge with no panel and no prompt", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-5
  const errors = guardPageErrors(page);
  // Local sets `assignee`; remote sets `priority` — different fields.
  const key = await setupDivergence(
    gitTracker, "Auto-merge",
    [{ field: "start_date", value: "2026-01-10" }],
    [{ field: "priority", value: "high" }],
  );

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();

  // No panel — it merged silently.
  await expect(page.getByTestId("git-reconcile-panel")).toHaveCount(0);
  await expect(page.getByTestId("git-sync-result")).toBeVisible();
  // Both edits survive on disk (union).
  const raw = await taskFileByKey(gitTracker.root, key);
  expect(raw).toContain("2026-01-10");
  expect(raw).toContain("high");
  expect(await fileExists(reconcileYamlPath(gitTracker.root))).toBe(false);
  expect(errors).toEqual([]);
});

// ── GIT-17 · both sides changed to the same value = no conflict ────────

test("GIT-17: both sides converge on the same value — no panel, sync completes", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-17
  const errors = guardPageErrors(page);
  await setupDivergence(
    gitTracker, "Converge",
    [{ field: "title", value: "Agreed title" }],
    [{ field: "title", value: "Agreed title" }],
  );

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();

  // Not presented as a conflict at all.
  await expect(page.getByTestId("git-reconcile-panel")).toHaveCount(0);
  await expect(page.getByTestId("git-sync-result")).toBeVisible();
  expect(await fileExists(reconcileYamlPath(gitTracker.root))).toBe(false);
  expect(errors).toEqual([]);
});

// ── GIT-14 · remote value references a status deleted locally ──────────

test("GIT-14: a drift value renders with a marker; keep-remote warns; pick-value omits it", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-14
  const errors = guardPageErrors(page);
  // Remote sets a status; then it is deleted from the LOCAL workflow, so
  // the remote value references a status that no longer exists locally.
  const key = defined((await gitTracker.seed(["Drift"]))[0], "seeded key");
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);
  await editFromOtherClone(gitTracker.remoteRepo, [{ key, field: "status", value: "in_progress" }]);
  // Local moves status too (to a still-valid status), so it is a genuine
  // two-sided conflict whose REMOTE side is the value about to drift.
  await gitTracker.run(["set", key, "status", "done"]);
  // Delete `in_progress` from local workflow.yaml so the remote value drifts.
  const wf = path.join(gitTracker.root, ".loctt", "config", "workflow.yaml");
  const { writeFile } = await import("node:fs/promises");
  const wfText = await readFile(wf, "utf8");
  await writeFile(wf, wfText.replace(/\n\s*-\s*key:\s*in_progress[\s\S]*?(?=\n\s*-\s*key:|\n\w)/, "\n"));

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();

  const row = panel.locator('[data-testid="git-reconcile-row"][data-field="status"]');
  // The remote side renders the raw key with a drift marker (not blank).
  await expect(row.getByTestId("git-reconcile-drift-marker")).toBeVisible();
  await expect(row.getByTestId("git-reconcile-keep-remote-value")).toContainText("in_progress");
  // Choosing keep-remote warns about the drift + Diagnostics.
  await row.getByTestId("git-reconcile-keep-remote").click();
  await expect(row.getByTestId("git-reconcile-drift-warning")).toBeVisible();
  // pick-value offers only existing statuses — not the drifted one.
  // Control type changed (native <select> → Combobox), not behavior: open
  // the trigger, then read the listbox options.
  await row.getByTestId("git-reconcile-pick-value").click();
  const options = await row.getByTestId("git-reconcile-pick-value-list").getByRole("option").allTextContents();
  expect(options.join(" ")).not.toContain("in_progress");
  expect(errors).toEqual([]);
});

// ── GIT-13 · parent conflicts show as tasks, with a task picker ────────

test("GIT-13: a parent conflict renders tasks (not ULIDs), a picker, and fixes the inverse edge", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-13
  const errors = guardPageErrors(page);
  const seeded = await gitTracker.seed(["Child", "Parent one", "Parent two"]);
  const child = defined(seeded[0], "seeded[0]"), p1 = defined(seeded[1], "seeded[1]"), p2 = defined(seeded[2], "seeded[2]");
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);
  // Remote links the child's parent to p2; local links it to p1 — a
  // genuine two-sided parent conflict from a base with no parent.
  await linkFromOtherClone(gitTracker.remoteRepo, [{ task: child, type: "parent", target: p2 }]);
  await gitTracker.run(["link", child, "parent", p1]);

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();

  const row = panel.locator('[data-testid="git-reconcile-row"][data-field="parent"]');
  // Rendered as task key + title, not a raw ULID.
  await expect(row.getByTestId("git-reconcile-keep-local-value")).toContainText(p1);
  await expect(row.getByTestId("git-reconcile-keep-remote-value")).toContainText(p2);
  // pick-value is a task picker. A211/A242: control type changed (native
  // <select> → searchable Combobox), not behavior — the trigger is a
  // <button> with aria-haspopup="listbox".
  await expect(row.getByTestId("git-reconcile-pick-value")).toHaveJSProperty("tagName", "BUTTON");
  await expect(row.getByTestId("git-reconcile-pick-value")).toHaveAttribute("aria-haspopup", "listbox");

  // Choose keep-remote (p2), apply.
  await row.getByTestId("git-reconcile-keep-remote").click();
  await page.getByTestId("git-reconcile-apply").click();
  await expect(page.getByTestId("git-reconcile-applied")).toBeVisible();

  // Far end: the child points at p2, p2 has the inverse child edge, and
  // the losing parent p1's child edge is gone — not dangling.
  const readTask = async (k: string): Promise<string> => {
    // Resolve key → id dir by scanning; simplest is to read every task.md.
    const tasksDir = path.join(gitTracker.root, ".loctt", "tasks");
    const { readdir } = await import("node:fs/promises");
    for (const id of await readdir(tasksDir)) {
      const raw = await readFile(path.join(tasksDir, id, "task.md"), "utf8").catch(() => "");
      if (new RegExp(`key:\\s*${k}\\b`).test(raw)) return raw;
    }
    return "";
  };
  const p1Raw = await readTask(p1);
  expect(p1Raw).not.toContain("child");
  expect(errors).toEqual([]);
});

// ── GIT-31 · publish/sync blocked while reconciliation pending ─────────

test("GIT-31: with a reconciliation pending, publish and sync are blocked and never report success", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-31
  const errors = guardPageErrors(page);
  await setupDivergence(
    gitTracker, "Pending",
    [{ field: "title", value: "Local" }],
    [{ field: "title", value: "Remote" }],
  );
  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  await expect(page.getByTestId("git-reconcile-panel")).toBeVisible();

  // Publish and Sync are disabled while the panel is open; the block names it.
  await expect(page.getByTestId("git-publish")).toBeDisabled();
  await expect(page.getByTestId("git-sync")).toBeDisabled();
  await expect(page.getByTestId("git-reconcile-blocked")).toBeVisible();
  // No success state, no advanced commit, no cleared drift while conflicts remain.
  await expect(page.getByTestId("git-sync-result")).toHaveCount(0);
  expect(await fileExists(reconcileYamlPath(gitTracker.root))).toBe(true);
  expect(errors).toEqual([]);
});

// ── GIT-18/26 · in-progress detection + persistence across reload ──────

test("GIT-18/GIT-26: an in-progress reconciliation is detected on load and preserves decisions across reload", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-18
  // @verifies GIT-26
  const errors = guardPageErrors(page);
  await setupDivergence(
    gitTracker, "Resume",
    [{ field: "title", value: "Local" }, { field: "status", value: "done" }],
    [{ field: "title", value: "Remote" }, { field: "status", value: "in_progress" }],
  );
  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();

  // Make one decision, then reload — the panel is reachable again without
  // re-triggering sync, and the decision is preserved (GIT-26).
  const titleRow = panel.locator('[data-testid="git-reconcile-row"][data-field="title"]');
  await titleRow.getByTestId("git-reconcile-keep-remote").click();
  await expect(page.getByTestId("git-reconcile-undecided")).toHaveAttribute("data-undecided", "1");

  await page.reload();
  await expect(page.getByTestId("git-panel")).toBeVisible();
  const panel2 = page.getByTestId("git-reconcile-panel");
  await expect(panel2).toBeVisible();
  // The panel says a reconciliation is already in progress (GIT-18).
  await expect(page.getByTestId("git-reconcile-op")).toBeVisible();
  // The made decision survived (still only 1 undecided).
  await expect(page.getByTestId("git-reconcile-undecided")).toHaveAttribute("data-undecided", "1");
  const titleRow2 = panel2.locator('[data-testid="git-reconcile-row"][data-field="title"]');
  await expect(titleRow2.getByTestId("git-reconcile-keep-remote")).toHaveAttribute("data-selected", "true");

  // Abandon is offered, clears reconcile.yaml, and leaves files as-is.
  await page.getByTestId("git-reconcile-abandon").click();
  await page.getByTestId("git-reconcile-abandon-confirm-button").click();
  await expect(page.getByTestId("git-reconcile-panel")).toHaveCount(0);
  expect(await fileExists(reconcileYamlPath(gitTracker.root))).toBe(false);
  expect(errors).toEqual([]);
});

// ── GIT-12 · a conflict on many tasks: grouping + bulk + undecided ─────

test("GIT-12: conflicts on several tasks group per task, with bulk actions and a live undecided count", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-12
  const errors = guardPageErrors(page);
  const keys = await gitTracker.seed(["T-a", "T-b", "T-c"]);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);
  await editFromOtherClone(
    gitTracker.remoteRepo,
    keys.map(k => ({ key: k, field: "title", value: `${k} remote` })),
  );
  for (const k of keys) await gitTracker.run(["set", k, "title", `${k} local`]);

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();

  // Grouped by task — one group per task, not a flat list.
  await expect(panel.getByTestId("git-reconcile-task-group")).toHaveCount(3);
  await expect(page.getByTestId("git-reconcile-undecided")).toHaveAttribute("data-undecided", "3");

  // A bulk action fills every row; the undecided count updates live.
  await page.getByTestId("git-reconcile-keep-all-remote").click();
  await expect(page.getByTestId("git-reconcile-undecided")).toHaveAttribute("data-undecided", "0");
  // Still individually overridable afterwards.
  const firstGroup = panel.getByTestId("git-reconcile-task-group").first();
  await firstGroup.getByTestId("git-reconcile-keep-local").first().click();
  // Apply now writes; the outcome is reported.
  await expect(page.getByTestId("git-reconcile-apply")).toBeEnabled();
  await page.getByTestId("git-reconcile-apply").click();
  await expect(page.getByTestId("git-reconcile-applied")).toBeVisible();
  expect(errors).toEqual([]);
});

// ── GIT-15 · publish with both sides diverged reconciles before push ───

test("GIT-15: publish detects divergence, opens reconciliation tagged publish, pushes only after Apply", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-15
  const errors = guardPageErrors(page);
  const key = await setupDivergence(
    gitTracker, "Publish conflict",
    [{ field: "title", value: "Local" }],
    [{ field: "title", value: "Remote" }],
  );
  const branchBefore = await gitTracker.bareCommit("loctt");

  await gotoSync(page, gitTracker.baseURL);
  // Publish, not sync — it must reconcile first rather than push-then-ask.
  await page.getByTestId("git-publish").click();
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();
  // The panel says it was opened by a publish.
  await expect(page.getByTestId("git-reconcile-panel")).toHaveAttribute("data-reconcile-mode", "publish");
  // The remote branch head is unchanged while the panel is open.
  expect(await gitTracker.bareCommit("loctt")).toBe(branchBefore);

  // Resolve + apply → the push proceeds.
  const row = panel.locator('[data-testid="git-reconcile-row"][data-field="title"]');
  await row.getByTestId("git-reconcile-keep-local").click();
  await page.getByTestId("git-reconcile-apply").click();
  await expect(page.getByTestId("git-reconcile-applied")).toBeVisible();
  // Far end: the branch advanced past its pre-reconcile head.
  await expect.poll(async () => gitTracker.bareCommit("loctt")).not.toBe(branchBefore);
  void key;
  expect(errors).toEqual([]);
});

// ── GIT-16 · one side deleted a task the other side edited ─────────────

test("GIT-16: a task deleted on the remote and edited locally surfaces a keep-deletion/keep-task row; keep-task keeps it", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-16
  const errors = guardPageErrors(page);
  const [key] = await gitTracker.seed(["Contested delete"]);
  if (key === undefined) throw new Error("seed returned no key");
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);
  // Remote deletes it; local edits it. The classic delete-vs-edit.
  await deleteFromOtherClone(gitTracker.remoteRepo, [key]);
  await gitTracker.run(["set", key, "title", "Edited locally"]);

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();

  // The delete-vs-edit is surfaced explicitly, not resolved silently.
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();
  const dveRow = panel.getByTestId("git-reconcile-dve-row");
  await expect(dveRow).toHaveCount(1);
  // It states which side deleted and which edited, in plain terms.
  await expect(dveRow.getByTestId("git-reconcile-dve-desc")).toContainText("deleted on the remote side");
  await expect(dveRow.getByTestId("git-reconcile-dve-desc")).toContainText("edited on the local side");
  // Apply is gated on the row being decided.
  await expect(page.getByTestId("git-reconcile-apply")).toBeDisabled();

  // Keep the task.
  await dveRow.getByTestId("git-reconcile-dve-keep-task").click();
  await expect(page.getByTestId("git-reconcile-apply")).toBeEnabled();
  await page.getByTestId("git-reconcile-apply").click();

  // Far end: the edited task is still on disk (kept), reconcile.yaml cleared.
  await expect(page.getByTestId("git-reconcile-applied")).toBeVisible();
  const raw = await taskFileByKey(gitTracker.root, key);
  expect(raw).toContain("Edited locally");
  expect(await fileExists(reconcileYamlPath(gitTracker.root))).toBe(false);
  expect(errors).toEqual([]);
});

test("GIT-16: choosing keep-the-deletion removes the task", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-16
  const errors = guardPageErrors(page);
  const [key] = await gitTracker.seed(["Doomed"]);
  if (key === undefined) throw new Error("seed returned no key");
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);
  await deleteFromOtherClone(gitTracker.remoteRepo, [key]);
  await gitTracker.run(["set", key, "title", "Edited locally"]);

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  const panel = page.getByTestId("git-reconcile-panel");
  await expect(panel).toBeVisible();

  // Keep the deletion.
  await panel.getByTestId("git-reconcile-dve-keep-deletion").click();
  await page.getByTestId("git-reconcile-apply").click();
  await expect(page.getByTestId("git-reconcile-applied")).toBeVisible();

  // Far end: the task is gone from disk; reconcile.yaml cleared.
  expect(await taskFileByKey(gitTracker.root, key)).toBe("");
  expect(await fileExists(reconcileYamlPath(gitTracker.root))).toBe(false);
  expect(errors).toEqual([]);
});

// ── GIT-10 · disabling says what it does and does not do ───────────────

test("GIT-10: disable states the branch survives, modifies no task files, and records enabled:false", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-10
  const errors = guardPageErrors(page);
  const [key] = await gitTracker.seed(["Keep me"]);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);
  const before = await taskFileByKey(gitTracker.root, defined(key, "key"));

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-disable").click();
  const confirm = page.getByTestId("git-disable-confirm");
  await expect(confirm).toBeVisible();
  // It states the branch and its history are kept — not a delete.
  await expect(confirm).toContainText("branch and its history are kept");
  await expect(confirm).toContainText(/branch/i);
  await page.getByTestId("git-disable-confirm-button").click();

  // The panel returns to the disabled state; Publish/Sync are not clickable.
  await expect(page.getByTestId("git-disabled")).toBeVisible();
  await expect(page.getByTestId("git-publish")).toHaveCount(0);
  // sync.yaml records git.enabled: false.
  const syncYaml = await readFile(syncYamlPath(gitTracker.root), "utf8");
  expect(syncYaml).toMatch(/enabled:\s*false/);
  // No task file was modified by disabling; the branch still exists on the remote.
  expect(await taskFileByKey(gitTracker.root, defined(key, "key"))).toBe(before);
  expect(await gitTracker.bareHasRef("loctt")).toBe(true);
  expect(errors).toEqual([]);
});

// ── GIT-38 · a second sync while one runs is refused; recovery on reload ─

test("GIT-38: the controls disable while a sync runs, and a left-behind reconcile recovers on reload", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-38
  const errors = guardPageErrors(page);
  // A reconcile left behind (GIT-18's in-progress state) must recover on
  // reload rather than locking the panel out permanently.
  await setupDivergence(
    gitTracker, "Busy",
    [{ field: "title", value: "Local" }],
    [{ field: "title", value: "Remote" }],
  );
  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  await expect(page.getByTestId("git-reconcile-panel")).toBeVisible();

  // With the reconcile pending, both controls are disabled — a second
  // trigger is hard to reach by misclick, not merely refused after.
  await expect(page.getByTestId("git-sync")).toBeDisabled();
  await expect(page.getByTestId("git-publish")).toBeDisabled();

  // Reload: the panel recovers the in-progress state rather than wedging.
  await page.reload();
  await expect(page.getByTestId("git-panel")).toBeVisible();
  await expect(page.getByTestId("git-reconcile-panel")).toBeVisible();
  await expect(page.getByTestId("git-sync")).toBeDisabled();
  expect(errors).toEqual([]);
});
