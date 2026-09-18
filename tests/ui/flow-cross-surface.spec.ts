/**
 * Transcribed from docs/dev/ui-test-cases/flow-cross-surface.md.
 *
 * These are the cases whose subject is a *fact shared between
 * surfaces* — the CLI, the MCP server and the UI all read and write
 * the same `.loctt/` directory, and the case is that they agree. So
 * the far end is always the filesystem or the other surface, driven
 * through `tracker.run`, never the UI asserting about itself.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";
import { parse as parseYaml } from "yaml";

import { expect, test } from "./fixtures/tracker.ts";

/** The one key a single-task seed allocated. */
function onlyKey(keys: readonly string[]): string {
  const key = keys[0];
  if (key === undefined) throw new Error("seed returned no keys");
  return key;
}

/** The task directory (…/tasks/<id>) for a key. */
async function taskDirOf(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    const dir = path.join(tasksDir, id);
    let text: string;
    try {
      text = await readFile(path.join(dir, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) return dir;
  }
  throw new Error(`no task on disk with key ${key}`);
}

/** The parsed `_history.yaml` entries for a task, or [] if none yet. */
async function historyOf(root: string, key: string): Promise<Array<Record<string, unknown>>> {
  const file = path.join(await taskDirOf(root, key), "_history.yaml");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const parsed = parseYaml(text) as unknown;
  return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
}

/** The id half of `loctt user current`'s `id\tname` line. */
async function cliCurrentUserId(run: (a: readonly string[]) => Promise<string>): Promise<string> {
  const out = (await run(["user", "current"])).trim();
  const id = out.split(/\t/)[0]?.trim();
  if (id === undefined || id.length === 0) throw new Error(`could not parse user id from: ${out}`);
  return id;
}

/**
 * The client's global `staleTime` (queryClient.ts). A query younger
 * than this is not refetched on focus, so the tab must be backgrounded
 * at least this long for the return-to-tab refetch to actually fire.
 */
const STALE_TIME_MS = 30_000;

/**
 * Reproduces "the user tabbed away to a terminal, ran `loctt user
 * switch`, and came back" — a genuine hidden -> (wait past staleTime)
 * -> visible transition, which is what TanStack's `focusManager` and
 * `refetchOnWindowFocus: true` refetch on. This is XS-55's "after
 * refetch, without restarting": a real in-session refetch, NOT a
 * `page.reload()` (which would refetch regardless of client wiring and
 * so could mask a broken `refetchOnWindowFocus`, the XS-1 vacuity).
 *
 * The wait is load-bearing: within `staleTime` the focus refetch is a
 * no-op, so a nudge fired immediately would prove nothing about
 * whether the switch propagates on its own.
 */
async function nudgeRefetchAfterStale(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(STALE_TIME_MS + 1_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

test.describe("XS-55 — the current user is shared across surfaces", () => {
  // @verifies XS-55
  /**
   * `.loctt/.current-user` is the single source of truth, read by both
   * the server's `/api/user/current` and core's history attribution
   * (`readCurrentUserId`). This test drives the switch from each
   * surface in turn and asserts the *other* surface sees it.
   *
   * Mutation shown to fail: set `refetchOnWindowFocus: false` in
   * `queryClient.ts` (or drop the `["user","current"]` invalidation in
   * `useSwitchUser`) and the CLI->UI half goes red — the menu keeps
   * showing the old user because the focus refetch never fires. The
   * `_history.yaml` half is independent of the client entirely: it
   * fails if core stops stamping `actor`.
   */
  test("XS-55: a CLI switch reaches the UI on refetch, and UI writes are attributed on disk", async ({
    page,
    tracker,
  }) => {
    // The CLI->UI half deliberately backgrounds the tab past the 30s
    // staleTime before refetching (see nudgeRefetchAfterStale), so this
    // one test needs more than the 30s default.
    test.setTimeout(90_000);

    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    // Two real users. Start as Robin.
    await tracker.run(["user", "create", "Robin Reader", "--email", "robin@example.com"]);
    await tracker.run(["user", "create", "Alex Ample", "--email", "alex@example.com"]);
    await tracker.run(["user", "switch", "Robin Reader"]);
    const robinId = await cliCurrentUserId(a => tracker.run(a));

    const key = onlyKey(await tracker.seed([{ title: "Attributed task" }]));

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    // The menu opens as Robin.
    await page.getByTestId("user-menu-trigger").click();
    await expect(page.getByTestId("user-menu-current")).toContainText("Robin Reader");
    await page.keyboard.press("Escape");

    // --- Bullet 1: CLI switch -> UI reflects after a refetch, no restart.
    await tracker.run(["user", "switch", "Alex Ample"]);
    const alexId = await cliCurrentUserId(a => tracker.run(a));
    expect(alexId).not.toBe(robinId);

    await nudgeRefetchAfterStale(page);
    // The menu now names Alex — reached by the page's own refetch, not
    // a reload.
    await expect(async () => {
      await page.getByTestId("user-menu-trigger").click();
      await expect(page.getByTestId("user-menu-current")).toContainText("Alex Ample");
    }).toPass({ timeout: 15_000 });
    await page.keyboard.press("Escape");

    // --- Bullet 2: a UI action is now attributed to Alex on disk. The
    // task seeds at "Backlog", so move it to a *different* status —
    // picking the current one would be a no-op that records nothing.
    await page.getByTestId("meta-edit-status").click();
    await page
      .getByTestId("meta-options-status")
      .getByRole("option", { name: "In progress" })
      .click();
    await expect(page.getByTestId("meta-edit-status")).toContainText("In progress");

    // Poll the far end: a `field_change` entry stamped with Alex's id.
    await expect(async () => {
      const entries = await historyOf(tracker.root, key);
      const byAlex = entries.filter(e => e["actor"] === alexId && e["kind"] === "field_change");
      expect(byAlex.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
    // And no field change made after the switch is attributed to Robin.
    const entries = await historyOf(tracker.root, key);
    const robinChangesAfter = entries.filter(
      e => e["actor"] === robinId && e["kind"] === "field_change",
    );
    expect(robinChangesAfter).toEqual([]);

    // --- Bullet 3: the reverse. Switch back to Robin in the UI…
    await page.getByTestId("user-menu-trigger").click();
    await page.getByTestId(`user-switch-${robinId}`).click();
    await expect(async () => {
      await page.getByTestId("user-menu-trigger").click();
      await expect(page.getByTestId("user-menu-current")).toContainText("Robin Reader");
    }).toPass({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    // …and the CLI now reports Robin as current, read from the same file.
    await expect(async () => {
      expect(await cliCurrentUserId(a => tracker.run(a))).toBe(robinId);
    }).toPass({ timeout: 10_000 });

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});
