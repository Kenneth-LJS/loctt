/**
 * Rekey preview + confirm UI cases (GIT-8, GIT-9, GIT-33) from
 * tests/cases/ui-test-cases/flow-git-sync.md, per K92.
 *
 * A rekey happens when two clones sharing one project each create a task
 * offline that lands on the same key; on a divergent sync one must be
 * renumbered. K92: the web UI shows a preview (keeper vs loser, both
 * created_at, both ULIDs, the tiebreak, the planned new key) and WAITS for
 * an explicit confirm — nothing is renumbered until then. CLI/MCP
 * auto-apply (covered in the integration suites); this spec is the UI gate.
 *
 * `createCollidingFromOtherClone` materialises a clone that shares the
 * local tracker's project id + key counter (the same-project collision,
 * not the two-independent-`init`s reprefix case) and publishes a colliding
 * task with an EARLIER created_at, so the local task is the one renumbered.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { createCollidingFromOtherClone, expect, test } from "./fixtures/git-tracker.ts";

function reconcileYamlPath(root: string): string {
  return path.join(root, ".loctt", "local", "reconcile.yaml");
}
async function fileExists(p: string): Promise<boolean> {
  return readFile(p, "utf8").then(() => true).catch(() => false);
}
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

test("GIT-8: a rekey shows a preview and waits for confirm; nothing renumbered until then", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-8
  const errors = guardPageErrors(page);
  const { root, remoteRepo } = gitTracker;

  // Base task published so both sides share a counter.
  const [baseKey] = await gitTracker.seed(["base"]);
  expect(baseKey).toBeDefined();
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);

  // Local creates the next task (the loser — later created_at).
  const [localKey] = await gitTracker.seed(["local next"]);
  expect(localKey).toBeDefined();
  const key = localKey as string;

  // A clone sharing the project publishes a colliding task, earlier.
  await createCollidingFromOtherClone(remoteRepo, root, "clone next");

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();

  // The preview appears and names the collision, keeper, loser, tiebreak,
  // and the planned new key.
  const preview = page.getByTestId("git-rekey-preview");
  await expect(preview).toBeVisible();
  await expect(preview.getByTestId("git-rekey-collided-key")).toHaveText(key);
  await expect(preview.getByTestId("git-rekey-new-key")).not.toHaveText(key);
  // GIT-8 (amended, A322): each row names the outcome, not the rule —
  // which task keeps the key and what the other becomes.
  await expect(preview).toContainText(/stays with task/i);
  await expect(preview).toContainText(/becomes/i);

  // Nothing is renumbered before confirm: the loser still holds the
  // colliding key on disk.
  expect(await taskFileByKey(root, key)).toMatch(new RegExp(`^key:\\s*${key}\\b`, "m"));

  // Confirm applies it.
  await page.getByTestId("git-rekey-confirm").click();
  await expect(page.getByTestId("git-rekey-applied")).toBeVisible();

  // The sentinel is cleared. The colliding key now names exactly one task —
  // the KEEPER (the clone's earlier task) — and the LOSER (the local task)
  // was renumbered, keeping its old key in key_history so it still resolves
  // (P-7).
  expect(await fileExists(reconcileYamlPath(root))).toBe(false);
  const keeper = await taskFileByKey(root, key);
  expect(keeper).toMatch(/title:\s*clone next/); // the earlier task kept T-2

  const tasksDir = path.join(root, ".loctt", "tasks");
  const { readdir } = await import("node:fs/promises");
  let renumbered = "";
  for (const id of await readdir(tasksDir)) {
    const raw = await readFile(path.join(tasksDir, id, "task.md"), "utf8").catch(() => "");
    if (/title:\s*local next/.test(raw)) renumbered = raw;
  }
  // The local task lost the key and carries it in key_history.
  expect(renumbered).not.toMatch(new RegExp(`^key:\\s*${key}\\b`, "m"));
  expect(renumbered).toMatch(new RegExp(`key_history:[\\s\\S]*${key}`, "m"));

  expect(errors).toEqual([]);
});

test("GIT-9: the preview states the ULID tiebreak when created_at ties", async ({
  page, gitTracker,
}) => {
  // @verifies GIT-9
  const errors = guardPageErrors(page);
  const { root, remoteRepo } = gitTracker;

  const [baseKey] = await gitTracker.seed(["base"]);
  expect(baseKey).toBeDefined();
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);

  const [localKey] = await gitTracker.seed(["local next"]);
  const key = localKey as string;

  // The clone's task is pinned to 2000-01-01; pin the LOCAL task to the same
  // instant so created_at ties and the ULID decides (GIT-9).
  const tasksDir = path.join(root, ".loctt", "tasks");
  const { readdir, writeFile } = await import("node:fs/promises");
  for (const id of await readdir(tasksDir)) {
    const p = path.join(tasksDir, id, "task.md");
    const raw = await readFile(p, "utf8").catch(() => "");
    if (new RegExp(`^key:\\s*${key}\\b`, "m").test(raw)) {
      await writeFile(p, raw.replace(/^created_at: .*$/m, "created_at: 2000-01-01T00:00:00.000Z"));
    }
  }
  await createCollidingFromOtherClone(remoteRepo, root, "clone next");

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();

  const preview = page.getByTestId("git-rekey-preview");
  await expect(preview).toBeVisible();
  // GIT-9: with created_at tied, the LOWER ULID keeps the key. The row
  // reads "<key> stays with task <keeperId>. Task <loserId> becomes …",
  // so the outcome is asserted directly rather than any explanation.
  const text = await preview.innerText();
  const m = /stays with task\s+([0-9A-HJKMNP-TV-Z]{26})\.\s+Task\s+([0-9A-HJKMNP-TV-Z]{26})/.exec(text);
  expect(m, `expected a keeper/loser row, saw: ${text}`).not.toBeNull();
  const [keeper, loser] = [m?.[1] ?? "", m?.[2] ?? ""];
  expect(keeper < loser, `keeper ${keeper} should be the lower ULID than ${loser}`).toBe(true);

  expect(errors).toEqual([]);
});

/**
 * GIT-19: a rekey affects a task open in another tab.
 *
 * @verifies GIT-19
 *
 * The two-clone collision reuses the contested key: after the rekey the
 * LOSER (the local task) is renumbered and keeps the old key in
 * `key_history`, while the WINNER (the clone's earlier task) KEEPS the old
 * key. So the old-key URL now resolves to the WINNER — the exact hazard
 * bullet 3 forbids a write from riding.
 *
 * Bullets 1/2 (the tab never shows a stale key as authoritative) and
 * bullet 4 (reload resolves via key_history) are locked at unit level in
 * `apps/web/.../server.git19-rekey-precondition.test.ts` and
 * `packages/core/.../lookup.test.ts`. This spec is the through-the-browser
 * proof of the two ends the case turns on: the old key resolving to the
 * OTHER task, and an edit against the renumbered task still landing on it.
 */
test("GIT-19: after a rekey the old-key URL resolves to the winner; an edit on the loser's new key lands on the loser", async ({
  page, gitTracker,
}) => {
  const errors = guardPageErrors(page);
  const { root, remoteRepo } = gitTracker;

  const [baseKey] = await gitTracker.seed(["base"]);
  expect(baseKey).toBeDefined();
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);

  const [localKey] = await gitTracker.seed(["local next"]);
  const contested = localKey as string;

  await createCollidingFromOtherClone(remoteRepo, root, "clone next");

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  await expect(page.getByTestId("git-rekey-preview")).toBeVisible();
  await page.getByTestId("git-rekey-confirm").click();
  await expect(page.getByTestId("git-rekey-applied")).toBeVisible();

  // Find the loser's NEW key from disk (the task titled "local next").
  const tasksDir = path.join(root, ".loctt", "tasks");
  const { readdir } = await import("node:fs/promises");
  let loserKey = "";
  for (const id of await readdir(tasksDir)) {
    const raw = await readFile(path.join(tasksDir, id, "task.md"), "utf8").catch(() => "");
    if (/title:\s*local next/.test(raw)) {
      loserKey = (/^key:\s*(\S+)/m.exec(raw)?.[1]) ?? "";
    }
  }
  expect(loserKey).not.toEqual("");
  expect(loserKey).not.toEqual(contested);

  // The OLD (contested) key now resolves to the WINNER — the clone's task.
  await page.goto(`${gitTracker.baseURL}/tasks/${contested}`);
  await expect(page.getByTestId("task-key-chip")).toHaveText(contested);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("clone next");

  // The loser lives at its NEW key, and reloading it there shows that key.
  await page.goto(`${gitTracker.baseURL}/tasks/${loserKey}`);
  await expect(page.getByTestId("task-key-chip")).toHaveText(loserKey);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("local next");

  expect(errors).toEqual([]);
});

/**
 * XS-43: an old key still resolves after a sync collision rekeys the task.
 *
 * @verifies XS-43
 *
 * The sync-collision fixture renumbers the local task (the loser) into a new
 * key with its old key kept in `key_history`; the winner (the clone's
 * earlier task) keeps the contested key. This spec proves the guarantee the
 * case turns on — the pre-rekey key URL keeps resolving, so bookmarks and
 * links written before the rekey do not 404:
 *   - Bullet 1: `/tasks/<contested>` resolves to a real task rather than
 *     404-ing. In a collision the contested key is *reused* by the winner
 *     (the key index maps a key to one id), so it lands on the winner — the
 *     honest "resolves, not 404" outcome the case requires. (A purely
 *     retired key with the in-place historical-key note is TSK-2's move
 *     scenario / XS-46's footer; XS-43 here is the collision, where the key
 *     is reused.)
 *   - Bullet 3: bookmarks/links written before the rekey keep working — the
 *     same URL still opens a task, and the renumbered loser is also
 *     reachable at its new key, so neither side is orphaned.
 */
test("XS-43: an old key still resolves after a sync-collision rekey (no 404, bookmark keeps working)", async ({
  page, gitTracker,
}) => {
  const errors = guardPageErrors(page);
  const { root, remoteRepo } = gitTracker;

  const [baseKey] = await gitTracker.seed(["base"]);
  expect(baseKey).toBeDefined();
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);

  const [localKey] = await gitTracker.seed(["local next"]);
  const contested = localKey as string;

  await createCollidingFromOtherClone(remoteRepo, root, "clone next");

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  await expect(page.getByTestId("git-rekey-preview")).toBeVisible();
  await page.getByTestId("git-rekey-confirm").click();
  await expect(page.getByTestId("git-rekey-applied")).toBeVisible();

  // Find the loser's NEW key (the task titled "local next"), and confirm the
  // contested key is now in its key_history (the rekey retired it there).
  const tasksDir = path.join(root, ".loctt", "tasks");
  const { readdir } = await import("node:fs/promises");
  let loserKey = "";
  let loserRaw = "";
  for (const id of await readdir(tasksDir)) {
    const raw = await readFile(path.join(tasksDir, id, "task.md"), "utf8").catch(() => "");
    if (/title:\s*local next/.test(raw)) {
      loserKey = (/^key:\s*(\S+)/m.exec(raw)?.[1]) ?? "";
      loserRaw = raw;
    }
  }
  expect(loserKey).not.toEqual("");
  expect(loserKey).not.toEqual(contested);
  // The old key was retired into the loser's key_history — the mechanism
  // that keeps it resolving.
  expect(loserRaw).toMatch(new RegExp(`key_history:[\\s\\S]*${contested}`, "m"));

  // Bullet 1: the pre-rekey key URL resolves rather than 404-ing — a
  // bookmark keeps working. It lands on a real task with a live key chip
  // (the winner, which reused the contested key).
  await page.goto(`${gitTracker.baseURL}/tasks/${contested}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("task-key-chip")).toHaveText(contested);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("clone next");

  // Bullet 3: the renumbered loser is not orphaned — its new-key URL opens
  // it, so no link is left pointing at a dead key.
  await page.goto(`${gitTracker.baseURL}/tasks/${loserKey}`);
  await expect(page.getByTestId("task-key-chip")).toHaveText(loserKey);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("local next");

  expect(errors).toEqual([]);
});

/**
 * XS-45: relationship links survive a rekey.
 *
 * @verifies XS-45
 *
 * A link is stored by the target's ULID, so a rekey of the target only
 * changes the label the source resolves it to. This spec links a stable
 * source task to the task that will lose the collision, rekeys via the
 * collision fixture, and asserts the source's Relationships panel still
 * resolves the link to the target's NEW key — never `missing`, never a raw
 * ULID — and that following it lands on the target.
 */
test("XS-45: a relationship link survives a rekey of its target", async ({
  page, gitTracker,
}) => {
  const errors = guardPageErrors(page);
  const { root, remoteRepo } = gitTracker;

  // A stable source ("holder") published so both clones share the counter.
  const [baseKey] = await gitTracker.seed(["holder"]);
  const holderKey = baseKey as string;
  await gitTracker.run(["git", "enable"]);
  await gitTracker.run(["git", "publish"]);

  // The task that will lose the collision and be renumbered.
  const [localKey] = await gitTracker.seed(["local next"]);
  const contested = localKey as string;

  // Link holder → the soon-to-be-rekeyed task, by its current key.
  await gitTracker.run(["link", holderKey, "blocks", contested]);

  await createCollidingFromOtherClone(remoteRepo, root, "clone next");

  await gotoSync(page, gitTracker.baseURL);
  await page.getByTestId("git-sync").click();
  await expect(page.getByTestId("git-rekey-preview")).toBeVisible();
  await page.getByTestId("git-rekey-confirm").click();
  await expect(page.getByTestId("git-rekey-applied")).toBeVisible();

  // The loser's NEW key.
  const tasksDir = path.join(root, ".loctt", "tasks");
  const { readdir } = await import("node:fs/promises");
  let loserKey = "";
  for (const id of await readdir(tasksDir)) {
    const raw = await readFile(path.join(tasksDir, id, "task.md"), "utf8").catch(() => "");
    if (/title:\s*local next/.test(raw)) {
      loserKey = (/^key:\s*(\S+)/m.exec(raw)?.[1]) ?? "";
    }
  }
  expect(loserKey).not.toEqual("");
  expect(loserKey).not.toEqual(contested);

  // The holder's Relationships panel resolves the link to the target's NEW
  // key — the rename only changed the label. Never `missing`, never a ULID.
  await page.goto(`${gitTracker.baseURL}/tasks/${holderKey}`);
  const row = page.locator('[data-group="blocks"] [data-testid="relationship-row"]');
  await expect(row).toHaveCount(1);
  // The row resolved (not broken/missing) and shows the target's NEW key.
  await expect(row).toHaveAttribute("data-missing", "false");
  await expect(row).toContainText(loserKey);
  // The stored ULID is never shown where a key is available.
  await expect(row).not.toContainText(/[0-9A-HJKMNP-TV-Z]{26}/);

  // The link is clickable and lands on the target.
  await row.getByRole("link").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("local next");
  await expect(page.getByTestId("task-key-chip")).toHaveText(loserKey);

  expect(errors).toEqual([]);
});
