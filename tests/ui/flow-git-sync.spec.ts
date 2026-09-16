/**
 * Transcribed from docs/dev/ui-test-cases/flow-git-sync.md — the
 * enable / publish / sync / status / disable cases that the built
 * GitSyncPanel actually supports. The reconciliation, rekey-summary,
 * task-and-field-granularity, filesystem-class-warning and
 * push-cause-distinction cases are recorded as unmet in decisions.md
 * A69/A70/A71 and known-gaps.md — there is no data model or error
 * channel behind them — so they are not tagged here.
 *
 * These specs assert the **far end**, never a toast alone:
 *  - after Enable, `.loctt/local/sync.yaml` carries `git.enabled: true`
 *    and `git.branch: loctt`;
 *  - after Publish, the bare remote's `loctt` ref holds the pushed
 *    commit and matches `last_synced_commit`;
 *  - after Sync, the pulled tasks are on disk under `.loctt/tasks/` and
 *    `last_synced_commit` has advanced to the remote head.
 *
 * The no-op-vs-success distinction (GIT-2, GIT-3, GIT-24) asserts the
 * *different* rendered outcome — `data-git-publish` /`data-git-sync`
 * flipping between `committed`/`nothing-to-publish` and
 * `updated`/`no-op` — not merely "some success".
 *
 * Every test installs a `pageerror` guard: a panel that threw renders
 * empty, and an empty panel passes a naive "the error block is absent"
 * assertion. The guard makes a crash fail loudly instead.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, forcePushRewriteRemote, publishFromOtherClone,test } from "./fixtures/git-tracker.ts";

function syncYamlPath(root: string): string {
  return path.join(root, ".loctt", "local", "sync.yaml");
}

/** The `last_synced_commit` recorded in `local/sync.yaml`, or undefined. */
async function lastSyncedCommit(root: string): Promise<string | undefined> {
  const text = await readFile(syncYamlPath(root), "utf8").catch(() => "");
  return /^\s*last_synced_commit:\s*(\S+)\s*$/m.exec(text)?.[1];
}

/** Fails the test on any uncaught page error — an empty panel is a crash. */
function guardPageErrors(page: import("@playwright/test").Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function gotoSync(page: import("@playwright/test").Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/settings/sync`);
  await expect(page.getByTestId("git-panel")).toBeVisible();
}

// ─────────────────────────────────────────────────────────────────────
// GIT-1 · Enabling git-backed mode says what it will do first.
// ─────────────────────────────────────────────────────────────────────

test("GIT-1: enable discloses what it does, then writes git.enabled/branch to sync.yaml", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-1
  const errors = guardPageErrors(page);
  await gotoSync(page, gitTracker.baseURL);

  // Initial state: off, and says LocTT works without it.
  const disabled = page.getByTestId("git-disabled");
  await expect(disabled).toBeVisible();
  await expect(disabled).toContainText("LocTT works fully without it");

  // Enable states — before running — the dedicated branch, the temporary
  // worktree, and the gitignore guarantee.
  await page.getByTestId("git-enable").click();
  const confirm = page.getByTestId("git-enable-confirm");
  await expect(confirm).toContainText("loctt");
  await expect(confirm).toContainText("temporary worktree");
  await expect(confirm).toContainText("local/");
  await expect(confirm).toContainText(".current-user");
  await expect(confirm).toContainText("users/<id>/settings.yaml");
  await expect(confirm).toContainText("never published");

  // sync.yaml must not exist until the user actually confirms — the
  // disclosure is before the write, not after it.
  expect(await lastSyncedCommit(gitTracker.root)).toBeUndefined();

  await page.getByTestId("git-enable-confirm-button").click();

  // Panel flips to the enabled layout; branch is displayed, not assumed.
  await expect(page.getByTestId("git-enabled")).toBeVisible();
  await expect(page.getByTestId("git-branch")).toHaveText("loctt");
  await expect(page.getByTestId("git-publish")).toBeVisible();
  await expect(page.getByTestId("git-sync")).toBeVisible();

  // Far end: sync.yaml records enabled + branch, and the CLI agrees.
  const yaml = await readFile(syncYamlPath(gitTracker.root), "utf8");
  expect(yaml).toMatch(/enabled:\s*true/);
  expect(yaml).toMatch(/branch:\s*loctt/);
  const cliStatus = await gitTracker.run(["git", "status"]);
  expect(cliStatus.toLowerCase()).toContain("loctt");

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-2 · Publish: nothing-to-publish is a DISTINCT outcome from a push,
// and a real push lands the commit on the bare remote.
//
// NOT tagged for its per-task/per-field naming or its commit-in-result
// bullets — core reports file counts, not task keys, and the publish
// result carries no commit (decisions.md A71). This asserts the two
// bullets the model supports: the distinct no-op outcome, and that a
// successful publish's commit reaches the remote and matches
// last_synced_commit.
// ─────────────────────────────────────────────────────────────────────

test("GIT-2: first publish pushes the commit to the bare remote; second says 'nothing to publish'", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-2
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.seed(["publishable task"]);

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-enabled")).toBeVisible();

  // Before any publish the branch has no ref on the remote.
  expect(await gitTracker.bareHasRef("loctt")).toBe(false);

  // First publish: a real push, reported as a committed outcome.
  await page.getByTestId("git-publish").click();
  const first = page.getByTestId("git-publish-result");
  await expect(first).toBeVisible();
  await expect(first).toHaveAttribute("data-git-publish", "committed");
  await expect(first).toContainText("Published to origin/loctt");

  // Far end: the bare remote's loctt ref now exists and equals the
  // commit sync.yaml recorded.
  const remoteCommit = await gitTracker.bareCommit("loctt");
  expect(remoteCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(await lastSyncedCommit(gitTracker.root)).toBe(remoteCommit);

  // Second publish with nothing changed: a DISTINCT outcome, not the
  // same success message.
  await page.getByTestId("git-publish").click();
  const second = page.getByTestId("git-publish-result");
  await expect(second).toHaveAttribute("data-git-publish", "nothing-to-publish");
  await expect(second).toContainText("Nothing to publish");
  await expect(second).not.toContainText("Published to origin/loctt");

  // Far end: the remote ref did not move — no empty commit was pushed.
  expect(await gitTracker.bareCommit("loctt")).toBe(remoteCommit);

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-3 · Sync: pulls remote tasks onto disk, advances last_synced_commit,
// and a no-move remote reports a no-op DISTINCT from a real sync.
//
// NOT tagged for created-vs-updated — SyncOutcome is one file-count
// bucket (decisions.md A71). This asserts what lands: the two remote
// tasks on disk, the advanced commit, the app serving them without a
// forced reload, and the explicit no-op on a second sync.
// ─────────────────────────────────────────────────────────────────────

test("GIT-3: sync writes the remote's new tasks to disk and advances last_synced_commit; a still remote is a no-op", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-3
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);

  // Another machine publishes two new tasks to the bare loctt branch.
  const remoteHead = await publishFromOtherClone(gitTracker.remoteRepo, [
    "remote alpha",
    "remote beta",
  ]);

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-enabled")).toBeVisible();

  await page.getByTestId("git-sync").click();
  const result = page.getByTestId("git-sync-result");
  // Sync is a real git pull — wait for the result element to render
  // before asserting its attribute, or a slow pull under load fails
  // with element-not-found rather than a wrong value.
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("data-git-sync", "updated");
  await expect(result).toContainText("Synced");

  // Far end on disk: both remote tasks are now present, and
  // last_synced_commit advanced to the remote head.
  const listAfter = await gitTracker.run(["list"]);
  expect(listAfter).toContain("remote alpha");
  expect(listAfter).toContain("remote beta");
  expect(await lastSyncedCommit(gitTracker.root)).toBe(remoteHead);

  // Without a page reload: navigate to the list through the app's own
  // client-side router (a <Link> click, not page.reload()) and the
  // pulled rows are there because the sync invalidated the tasks query.
  // `project-all` is the sidebar's "All projects" → /list link.
  await page.getByTestId("project-all").click();
  await expect(page).toHaveURL(/\/list/);
  await expect(page.getByRole("row").filter({ hasText: "remote alpha" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "remote beta" })).toBeVisible();

  // A second sync with the remote unmoved reports a no-op, DISTINCT from
  // the success above.
  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  const noop = page.getByTestId("git-sync-result");
  await expect(noop).toHaveAttribute("data-git-sync", "no-op");
  await expect(noop).toContainText("Already up to date");

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-21 · The loctt branch was force-pushed and no longer contains the
// last synced commit (K93). Sync must DETECT the rewrite and REFUSE,
// naming the missing commit, NOT as an ordinary conflict, and offering
// only user-does-in-git recovery — never a LocTT rebase/base-reset button.
// ─────────────────────────────────────────────────────────────────────

test("GIT-21: a force-pushed rewrite is refused, names the missing commit, and offers only git recovery — local state untouched", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-21
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.seed(["local work before the rewrite"]);
  await gitTracker.run(["git", "publish"]);
  const base = await lastSyncedCommit(gitTracker.root);
  expect(base).toBeDefined();

  // Another machine force-pushes a rewritten history: the last-synced
  // commit is no longer an ancestor of the new remote head.
  const newHead = await forcePushRewriteRemote(gitTracker.remoteRepo);
  expect(newHead).not.toBe(base);

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();

  // The dedicated refusal renders — NOT the generic sync-error/ErrorState.
  const refusal = page.getByTestId("git-sync-history-rewritten");
  await expect(refusal).toBeVisible();
  await expect(refusal).toHaveAttribute("data-git-refusal", "history-rewritten");
  // It names the branch history was rewritten and is not an ordinary conflict.
  await expect(refusal).toContainText("rewritten");
  await expect(refusal).toContainText("not an ordinary conflict");
  // Names the remote and the (short) missing commit.
  await expect(refusal).toContainText("origin");
  await expect(refusal).toContainText((base as string).slice(0, 8));
  // States local state is untouched and the base was not changed.
  await expect(refusal).toContainText("Nothing was written");
  // The two concrete next actions, both user-does-in-git.
  await expect(page.getByTestId("git-sync-history-rewritten-inspect")).toContainText("Inspect the branch in git");
  await expect(page.getByTestId("git-sync-history-rewritten-rebase")).toContainText("Re-establish a base explicitly in git");
  // No LocTT-automated recovery control (no Retry button in this refusal).
  await expect(refusal.getByRole("button")).toHaveCount(0);

  // Far end: nothing was written. The local task survives and
  // last_synced_commit is unchanged — no silent re-base.
  const listAfter = await gitTracker.run(["list"]);
  expect(listAfter).toContain("local work before the rewrite");
  expect(await lastSyncedCommit(gitTracker.root)).toBe(base);

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-4 · Status shows the last synced commit and two separate drift
// readouts, and says when it last checked.
//
// Remote drift is a boolean, not a count (decisions.md A70) — the case's
// "two counts" is met in substance (two separate readouts, never one
// combined "out of sync"), and that gap is recorded there.
// ─────────────────────────────────────────────────────────────────────

test("GIT-4: status names branch/remote/short commit and shows local and remote drift as two separate readouts", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-4
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);
  const commit = await lastSyncedCommit(gitTracker.root);
  expect(commit).toBeDefined();

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-enabled")).toBeVisible();

  await expect(page.getByTestId("git-branch")).toHaveText("loctt");
  await expect(page.getByTestId("git-remote")).toHaveText("origin");
  // Short form, not the full 40-char hash.
  await expect(page.getByTestId("git-last-synced")).toContainText((commit ?? "").slice(0, 8));
  await expect(page.getByTestId("git-last-synced")).not.toContainText(commit ?? "");

  // Two SEPARATE readouts, each with its own attribute — never one
  // combined "out of sync". Clean tree: local zero, remote unmoved.
  // The `data-git-*-drift` attribute is on the inner span the Row wraps.
  const local = page.getByTestId("git-local-drift");
  const remote = page.getByTestId("git-remote-drift");
  await expect(local.locator("[data-git-local-drift]")).toHaveAttribute(
    "data-git-local-drift",
    "0",
  );
  await expect(remote.locator("[data-git-remote-drift]")).toHaveAttribute(
    "data-git-remote-drift",
    "false",
  );
  await expect(local).toContainText("nothing to publish");
  await expect(remote).toContainText("up to date");

  // It says when it last checked, and Refresh re-checks on demand.
  await expect(page.getByTestId("git-checked-at")).toContainText("Last checked");
  await page.getByTestId("git-refresh").click();
  await expect(page.getByTestId("git-checked-at")).toContainText("Last checked");

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-20 · The CLI publishes while the UI's panel is open.
// ─────────────────────────────────────────────────────────────────────

test("GIT-20: a CLI publish while the panel is open shows the advanced commit and zero drift after refresh, and a UI publish is a no-op", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-20
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.seed(["task before cli publish"]);

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-enabled")).toBeVisible();
  // Panel opened before any publish: no commit yet, local drift present.
  await expect(page.getByTestId("git-last-synced")).toContainText("—");
  await expect(
    page.getByTestId("git-local-drift").locator("[data-git-local-drift]"),
  ).not.toHaveAttribute("data-git-local-drift", "0");

  // The CLI publishes out-of-band, in a terminal, while the panel is up.
  await gitTracker.run(["git", "publish"]);
  const cliCommit = await lastSyncedCommit(gitTracker.root);
  expect(cliCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(await gitTracker.bareCommit("loctt")).toBe(cliCommit);

  // The next refresh shows the advanced commit and drift back at zero —
  // it does not keep reporting phantom local drift.
  await page.getByTestId("git-refresh").click();
  await expect(page.getByTestId("git-last-synced")).toContainText((cliCommit ?? "").slice(0, 8));
  await expect(
    page.getByTestId("git-local-drift").locator("[data-git-local-drift]"),
  ).toHaveAttribute("data-git-local-drift", "0");

  // Clicking Publish anyway is the nothing-to-publish no-op, not an error.
  await page.getByTestId("git-publish").click();
  const result = page.getByTestId("git-publish-result");
  await expect(result).toHaveAttribute("data-git-publish", "nothing-to-publish");
  await expect(page.getByTestId("git-publish-error")).toHaveCount(0);
  // The remote ref is unchanged — no phantom re-publish.
  expect(await gitTracker.bareCommit("loctt")).toBe(cliCommit);

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-24 · A publish that only touches gitignored files is a no-op.
// ─────────────────────────────────────────────────────────────────────

test("GIT-24: touching only gitignored files leaves drift at zero and publish a no-op with no empty commit", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-24
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.seed(["real task"]);
  await gitTracker.run(["git", "publish"]);
  const committed = await lastSyncedCommit(gitTracker.root);
  const remoteBefore = await gitTracker.bareCommit("loctt");
  expect(committed).toBe(remoteBefore);

  // Change only a gitignored file: the per-checkout current-user pointer.
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(gitTracker.root, ".loctt", ".current-user"), "someone\n", "utf8");

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-enabled")).toBeVisible();

  // A gitignored-only change does not read as unpublished work.
  await expect(
    page.getByTestId("git-local-drift").locator("[data-git-local-drift]"),
  ).toHaveAttribute("data-git-local-drift", "0");

  await page.getByTestId("git-publish").click();
  const result = page.getByTestId("git-publish-result");
  await expect(result).toHaveAttribute("data-git-publish", "nothing-to-publish");
  await expect(result).toContainText("Nothing to publish");

  // Far end: no empty commit — last_synced_commit and the remote ref are
  // exactly as before.
  expect(await lastSyncedCommit(gitTracker.root)).toBe(committed);
  expect(await gitTracker.bareCommit("loctt")).toBe(remoteBefore);

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-27 · Git sync enabled on a repo with no remote.
// ─────────────────────────────────────────────────────────────────────

test("GIT-27: with no remote, enable warns local-only and status shows no remote instead of a name it lacks", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-27
  const errors = guardPageErrors(page);
  // Strip the origin the fixture wired, so the repo genuinely has none.
  await gitTracker.git(["remote", "remove", "origin"]);

  await gotoSync(page, gitTracker.baseURL);

  // Disabled state warns that enabling is allowed but local-only, and
  // names the command to add a remote — it does not hard-block.
  const warn = page.getByTestId("git-no-remote");
  await expect(warn).toBeVisible();
  await expect(warn).toContainText("local-only");
  await expect(warn).toContainText("git remote add origin");
  await expect(page.getByTestId("git-enable")).toBeEnabled();

  // Enable local-only, then status must not announce a remote it lacks.
  await page.getByTestId("git-enable").click();
  await page.getByTestId("git-enable-confirm-button").click();
  await expect(page.getByTestId("git-enabled")).toBeVisible();
  const remoteRow = page.getByTestId("git-remote");
  await expect(remoteRow).toContainText("none configured");
  await expect(remoteRow).not.toContainText("origin");

  // Publish states up front there is nowhere to push, rather than
  // claiming a successful push.
  await page.getByTestId("git-publish").click();
  const result = page.getByTestId("git-publish-result");
  await expect(result).toContainText("Not pushed");
  await expect(result).not.toContainText("Published to");

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-28 · The directory is not a git repository at all. Uses the plain
// (non-git) tracker fixture — its workspace is not `git init`-ed.
// ─────────────────────────────────────────────────────────────────────

test("GIT-28: outside a git repo, enable is disabled with a reason and names git init; nothing is created", async ({
  page,
  nonRepoTracker,
}) => {
  // @verifies GIT-28
  const errors = guardPageErrors(page);
  await page.goto(`${nonRepoTracker.baseURL}/settings/sync`);
  await expect(page.getByTestId("git-panel")).toBeVisible();

  const notRepo = page.getByTestId("git-not-a-repo");
  await expect(notRepo).toBeVisible();
  await expect(notRepo).toContainText("not a git repository");
  await expect(notRepo).toContainText("git init");
  // The enable control is present but disabled — the reason is stated,
  // not just the button greyed with no explanation.
  await expect(page.getByTestId("git-enable")).toBeDisabled();

  // Nothing was created by the failed check: no sync.yaml on disk.
  const syncText = await readFile(syncYamlPath(nonRepoTracker.root), "utf8").catch(() => "MISSING");
  expect(syncText).toBe("MISSING");

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-29 · Publish fails because the push cannot reach the remote.
//
// The panel must NOT enter a permanent error state (the local commit
// landed): it names the remote, states the commit is safe locally, and
// offers Retry. The auth-vs-non-fast-forward *distinction* is proven in
// GitSyncPanel.test.tsx (publishFailureLine) and push-fetch.test.ts
// (core classification) — a non-fast-forward rejection cannot be
// triggered end-to-end because the reconcile detector fetches and
// intercepts remote movement before the push (publish-sync.ts).
// ─────────────────────────────────────────────────────────────────────

test("GIT-29: a push that cannot reach the remote is a safe partial success — commit landed, remote named, Retry offered", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-29
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.seed(["task that will fail to push"]);

  // Point origin at a path that does not exist, so the push is rejected
  // (unreachable) while the local commit still lands.
  await gitTracker.git(["remote", "set-url", "origin", "/no/such/loctt/remote/path"]);

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-enabled")).toBeVisible();

  await page.getByTestId("git-publish").click();
  const result = page.getByTestId("git-publish-result");
  await expect(result).toBeVisible();
  // The commit is still reported as committed — not an error state.
  await expect(result).toHaveAttribute("data-git-publish", "committed");
  await expect(result).toHaveAttribute("data-push-failure", "unreachable");
  // Names the remote, says the commit is safe locally.
  await expect(result).toContainText("origin");
  await expect(result).toContainText("could not be reached");
  await expect(result).toContainText("safe locally");
  // Retry is offered; the hard-error block is NOT shown.
  await expect(page.getByTestId("git-publish-retry")).toBeVisible();
  await expect(page.getByTestId("git-publish-error")).toHaveCount(0);

  // Far end: the local commit persisted (last_synced_commit is set) even
  // though the remote never received it.
  const committed = await lastSyncedCommit(gitTracker.root);
  expect(committed).toMatch(/^[0-9a-f]{40}$/);
  expect(await gitTracker.bareCommit("loctt")).toBeUndefined();

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-30 · Sync fails because the remote is unreachable.
//
// Network down / host does not resolve: the panel names the remote, says
// it could not be reached (distinct from "nothing to sync"), states local
// state is untouched, and offers Retry — it does NOT enter a permanent
// error state that requires a reload after the network returns.
// ─────────────────────────────────────────────────────────────────────

test("GIT-30: sync against an unreachable remote names it, keeps local untouched, and offers Retry — not a permanent error", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-30
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.seed(["local task kept through a failed sync"]);
  await gitTracker.run(["git", "publish"]);
  const committed = await lastSyncedCommit(gitTracker.root);

  // Break the remote so the fetch inside sync fails.
  await gitTracker.git(["remote", "set-url", "origin", "/no/such/loctt/remote/path"]);

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-enabled")).toBeVisible();

  await page.getByTestId("git-sync").click();
  const result = page.getByTestId("git-sync-result");
  await expect(result).toBeVisible();
  // A success-shaped result (no-op against the local branch copy), NOT the
  // hard-error block — this is the "not a permanent error state" bullet.
  await expect(result).toHaveAttribute("data-fetch-failure", "unreachable");
  await expect(page.getByTestId("git-sync-error")).toHaveCount(0);

  // Names the remote, distinguishes from "nothing to sync", says local
  // state is untouched.
  const warning = page.getByTestId("git-sync-fetch-warning");
  await expect(warning).toContainText("origin");
  await expect(warning).toContainText("could not be reached");
  await expect(warning).toContainText("not modified");

  // Retry is offered inline.
  await expect(page.getByTestId("git-sync-retry")).toBeVisible();

  // Far end: local state untouched — last_synced_commit is exactly what it
  // was before the failed sync.
  expect(await lastSyncedCommit(gitTracker.root)).toBe(committed);

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-23 · A sync brings in many new tasks.
//
// The transient progress bar (bullet 1) and the per-file tick mechanics
// are proven deterministically at the server level
// (apps/web/src/server/git-errors.test.ts) and the hook level
// (useGit.test.tsx) — a Playwright assertion on the bar mid-sync is
// inherently racy (the sync completes in well under a frame for a small
// fixture) and would be a flake, not coverage. This spec covers the
// durable, observable halves of the case: the result summarises with
// counts and offers the full breakdown on expand rather than enumerating
// every key inline (bullet 2), and the list reflects the new population
// with an honest total (bullet 3).
// ─────────────────────────────────────────────────────────────────────

test("GIT-23: a many-task sync summarises with counts + expand, and the list reflects the new population", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-23
  const errors = guardPageErrors(page);
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);

  // Another machine publishes a batch of new tasks to the branch. Eight
  // is plenty to prove "counts, not enumerated keys" while keeping the
  // e2e fast; the write loop is identical at 500.
  const titles = Array.from({ length: 8 }, (_, i) => `bulk task ${String(i)}`);
  await publishFromOtherClone(gitTracker.remoteRepo, titles);

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-enabled")).toBeVisible();

  await page.getByTestId("git-sync").click();
  const result = page.getByTestId("git-sync-result");
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("data-git-sync", "updated");

  // Bullet 2: the summary states counts and does NOT enumerate every key
  // inline. The task keys are not printed in the collapsed summary.
  await expect(result).toContainText("file(s) taken from the branch");
  for (const t of titles) {
    await expect(result).not.toContainText(t);
  }

  // Bullet 2: the full breakdown is offered on expand — collapsed by
  // default, revealed on click, still counts (not 500 keys).
  const details = page.getByTestId("git-sync-details");
  await expect(details).toBeVisible();
  const breakdown = page.getByTestId("git-sync-breakdown");
  await expect(breakdown).toBeHidden();
  await details.getByText("Show full breakdown").click();
  await expect(breakdown).toBeVisible();
  await expect(breakdown).toContainText("taken from the branch");

  // Bullet 3: navigate to the list through the app's own router (no
  // reload) — all eight pulled tasks are there because the sync
  // invalidated the list feed query.
  await page.getByTestId("project-all").click();
  await expect(page).toHaveURL(/\/list/);
  for (const t of titles) {
    await expect(page.getByRole("row").filter({ hasText: t })).toBeVisible();
  }

  expect(errors).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────
// GIT-25 · Enabling git sync when a `loctt` branch already exists from a
// previous setup. Enable must state the branch was found, show its head,
// and ask adopt-or-stop rather than silently adopting. Adopting sets
// last_synced_commit to the branch head and reports whether local agrees.
//
// Precondition: a real LocTT-written `loctt` branch left behind from an
// earlier enable+publish, with git mode then turned off — the "previous
// setup" the case describes.
// ─────────────────────────────────────────────────────────────────────

test("GIT-25: an existing loctt branch is surfaced with its head and adopted only on confirm, reporting agreement", async ({
  page,
  gitTracker,
}) => {
  // @verifies GIT-25
  const errors = guardPageErrors(page);

  // A previous setup: enable, publish (creates the loctt branch), then
  // turn git mode off — the branch stays behind.
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);
  const branchHead = await gitTracker.bareCommit("loctt");
  expect(branchHead).toMatch(/^[0-9a-f]{40}$/);
  await gitTracker.run(["git", "disable"]);

  await gotoSync(page, gitTracker.baseURL);
  await expect(page.getByTestId("git-disabled")).toBeVisible();

  // Enable, then confirm the disclosure — this is where enable runs and
  // discovers the existing branch.
  await page.getByTestId("git-enable").click();
  await page.getByTestId("git-enable-confirm-button").click();

  // It does NOT silently adopt: the adopt-or-stop decision appears, names
  // the branch, and shows its head before adopting.
  const adopt = page.getByTestId("git-adopt-branch");
  await expect(adopt).toBeVisible();
  await expect(adopt).toContainText("loctt");
  await expect(adopt).toContainText("previous setup");
  await expect(page.getByTestId("git-adopt-head")).toContainText(branchHead!.slice(0, 12));

  // Nothing was written yet — the panel is still not enabled.
  await expect(page.getByTestId("git-enabled")).toBeHidden();

  // Adopt: the panel flips to enabled and last_synced_commit is set to the
  // branch head (the legitimate adopt write). Local was published from this
  // same state and unchanged since, so it agrees — no sync needed.
  await page.getByTestId("git-adopt-confirm-button").click();
  await expect(page.getByTestId("git-enabled")).toBeVisible();
  expect(await lastSyncedCommit(gitTracker.root)).toBe(branchHead);

  // Bullet 3: adopting reports whether local agrees with the branch, so the
  // user is not left guessing whether a sync is needed. Local was published
  // from this same state, so it agrees.
  const report = page.getByTestId("git-adopt-report");
  await expect(report).toBeVisible();
  await expect(report).toHaveAttribute("data-in-agreement", "true");
  await expect(report).toContainText("no sync needed");

  expect(errors).toEqual([]);
});
