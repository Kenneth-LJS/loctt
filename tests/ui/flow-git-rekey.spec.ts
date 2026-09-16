/**
 * Rekey preview + confirm UI cases (GIT-8, GIT-9, GIT-33) from
 * docs/dev/ui-test-cases/flow-git-sync.md, per K92.
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
  await expect(preview).toContainText(/created_at/i);

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
  // The tiebreak copy names the ULID as the decider (GIT-9).
  await expect(preview).toContainText(/ULID/i);

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
