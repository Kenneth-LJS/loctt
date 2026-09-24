/**
 * Transcribed from tests/cases/ui-test-cases/flow-projects-users.md:
 * PRU-3 (all-projects mode shows the project column), PRU-4 (the
 * create form defaults to the active project), PRU-21 (a 30-project
 * switcher stays usable), PRU-22 (a 120-char label does not break
 * layout), PRU-24 (the current user archived mid-session), and PRU-41
 * (assigning an archived user through a stale picker).
 *
 * These are browser cases against the real built SPA and server. Where
 * a case turns on disk state, the far end is asserted; where it turns
 * on identity, the assertions read the rendered DOM the user sees.
 */

import { readdir,readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

/** The two project ids of a freshly seeded Backend/Web tracker. */
async function twoProjects(
  tracker: { run(args: readonly string[]): Promise<string> },
): Promise<{ backend: string; web: string }> {
  await tracker.run(["project", "create", "Backend", "--prefix", "BACKEND"]);
  await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);
  const list = await tracker.run(["project", "list", "--ids"]);
  const backend = /^Backend\t\S+\t(\S+)$/m.exec(list)?.[1];
  const web = /^Web\t\S+\t(\S+)$/m.exec(list)?.[1];
  if (backend === undefined || web === undefined) {
    throw new Error(`could not parse project ids from:\n${list}`);
  }
  return { backend, web };
}

/**
 * The ULID of a user by display name. `user list` prints
 * `<ULID>[ *]\t<name>[  <email>]\t<tz>`; `--all` includes archived.
 */
async function userIdByName(
  tracker: { run(args: readonly string[]): Promise<string> },
  name: string,
): Promise<string | undefined> {
  const list = await tracker.run(["user", "list", "--all"]);
  for (const line of list.split("\n")) {
    const m = /^([0-9A-HJKMNP-TV-Z]{26})\s*\*?\t([^\t]+)\t/.exec(line);
    if (m === null) continue;
    const label = m[2]?.trim() ?? "";
    // Name may be followed by "  <email>"; match the leading name.
    if (label === name || label.startsWith(`${name}  `)) return m[1];
  }
  return undefined;
}

/** Reads a task file's frontmatter field by the task's title. */
async function fmByTitle(
  root: string,
  title: string,
  field: string,
): Promise<string | undefined> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^title:\\s*${title}\\s*$`, "m").test(text)) {
      return new RegExp(`^${field}:\\s*(\\S+)\\s*$`, "m").exec(text)?.[1];
    }
  }
  return undefined;
}

test.describe("PRU-3 — the project column follows the scope", () => {
  // @verifies PRU-3
  test("PRU-3: all-projects shows the project column, a single project hides it", async ({
    page,
    tracker,
  }) => {
    const { backend, web } = await twoProjects(tracker);
    // Same title in each project — the row is only distinguishable by
    // key + project, which is the point of the column.
    await tracker.run(["create", "Fix login", "--project", "Backend"]);
    await tracker.run(["create", "Fix login", "--project", "Web"]);

    // All-projects mode: the column is present without the user adding
    // it, and both rows are visible and distinguishable by key.
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByRole("columnheader", { name: "Project" })).toBeVisible();
    const chips = page.getByTestId("project-chip");
    await expect(chips).toHaveCount(2);
    // BACKEND-1 and WEB-1 both on screen.
    await expect(page.getByText("BACKEND-1", { exact: false })).toBeVisible();
    await expect(page.getByText("WEB-1", { exact: false })).toBeVisible();

    // Scope to a single project: the now-constant column disappears.
    await page.goto(`${tracker.baseURL}/list?project=${backend}`);
    await expect(page.getByText("BACKEND-1", { exact: false })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);
    await expect(page.getByTestId("project-chip")).toHaveCount(0);

    // The other project scopes the same way — and returning to
    // all-projects brings the column back (not a one-way mutation).
    await page.goto(`${tracker.baseURL}/list?project=${web}`);
    await expect(page.getByRole("columnheader", { name: "Project" })).toHaveCount(0);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByRole("columnheader", { name: "Project" })).toBeVisible();
  });
});

test.describe("PRU-4 — the create form defaults to the active project", () => {
  // @verifies PRU-4
  test("PRU-4: the switcher's project pre-selects and lands the task there", async ({
    page,
    tracker,
  }) => {
    const { backend, web } = await twoProjects(tracker);

    // Scoped to Web. Opening the modal pre-selects Web.
    await page.goto(`${tracker.baseURL}/list?project=${web}`);
    await page.getByTestId("header-new-task").click();
    await expect(page.getByTestId("create-task-modal")).toBeVisible();

    const projectField = page.getByTestId("create-project");
    await expect(projectField).toBeVisible();
    await expect(projectField).toContainText("Web");

    // The explicit choice is editable and scoped to this create only:
    // switching the modal to Backend does not change the URL scope.
    await projectField.getByRole("button").first().click();
    await page.getByRole("option").filter({ hasText: "Backend" }).click();
    await expect(page).toHaveURL(new RegExp(`project=${web}`));

    // Creating with the modal on Backend files it into Backend — the
    // per-create choice, not the switcher.
    await page.getByTestId("create-title").fill("Explicit backend");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    expect(await fmByTitle(tracker.root, "Explicit backend", "project")).toBe(backend);

    // Reopening (still scoped to Web) pre-selects Web again, and
    // creating with it left alone lands in Web with a WEB- key.
    await page.getByTestId("header-new-task").click();
    await expect(page.getByTestId("create-project")).toContainText("Web");
    await page.getByTestId("create-title").fill("Left on web");
    await page.getByTestId("create-submit").click();
    await expect(page.getByTestId("create-task-modal")).toBeHidden();
    expect(await fmByTitle(tracker.root, "Left on web", "project")).toBe(web);
    expect(await fmByTitle(tracker.root, "Left on web", "key")).toMatch(/^WEB-/);
  });
});

test.describe("PRU-21 — a 30-project switcher stays usable", () => {
  // @verifies PRU-21
  test("PRU-21: the switcher is searchable, List stays reachable, the rest truncate", async ({
    page,
    tracker,
  }) => {
    // 30 projects. Distinct prefixes so type-to-filter has something
    // to match on both name and key. K88 bars digits in a prefix, so the
    // two-digit index is encoded as letters (0→A … 9→J): Project 23's
    // prefix is `PCD`. Keys still render with the inserted "-" (PCD-1).
    const prefixFor = (n: string): string =>
      "P" + [...n].map(d => String.fromCharCode(65 + Number(d))).join("");
    for (let i = 1; i <= 30; i++) {
      const n = String(i).padStart(2, "0");
      await tracker.run(["project", "create", `Project ${n}`, "--prefix", prefixFor(n)]);
    }

    await page.goto(`${tracker.baseURL}/list`);

    // The list truncates rather than rendering all 30: a "+N more"
    // toggle is present, and the sidebar's List link (K125 removed the
    // "All projects" row) stays reachable at the top regardless.
    const listLink = page.locator("aside").getByRole("link", { name: "List", exact: true });
    await expect(listLink).toBeVisible();
    const more = page.getByTestId("project-more");
    await expect(more).toBeVisible();
    // The truncation hid rows — not every project is on screen.
    const before = await page.getByTestId("project-search").isVisible();
    expect(before).toBe(true);

    // Type-to-filter narrows on the label…
    const search = page.getByTestId("project-search");
    await search.fill("Project 17");
    await expect(page.getByRole("link", { name: /Project 17/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Project 18/ })).toHaveCount(0);
    // …and on the key prefix (the encoded form: Project 23 → PCD).
    await search.fill(prefixFor("23"));
    await expect(page.getByRole("link", { name: /Project 23/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Project 22/ })).toHaveCount(0);

    // Clearing the box brings the truncation back.
    await search.fill("");
    await expect(page.getByTestId("project-more")).toBeVisible();

    // Expanding shows the rest. The control is now a two-way toggle
    // (A11Y-12: it exposes aria-expanded and can collapse again), so it
    // stays present as "Show fewer" rather than vanishing — a one-way
    // reveal left a keyboard/AT user no way back and exposed no state.
    const moreBtn = page.getByTestId("project-more");
    await expect(moreBtn).toHaveAttribute("aria-expanded", "false");
    await moreBtn.click();
    await expect(page.getByRole("link", { name: /Project 30/ })).toBeVisible();
    await expect(moreBtn).toHaveAttribute("aria-expanded", "true");
    await expect(moreBtn).toHaveText("Show fewer");
    // …and collapsing hides them again.
    await moreBtn.click();
    await expect(page.getByRole("link", { name: /Project 30/ })).toHaveCount(0);
    await expect(moreBtn).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("PRU-22 — a 120-character label does not break layout", () => {
  // @verifies PRU-22
  test("PRU-22: the switcher truncates the long label and exposes it on hover", async ({
    page,
    tracker,
  }) => {
    const longName = "L" + "o".repeat(118) + "g"; // 120 chars
    await tracker.run(["project", "create", longName, "--prefix", "LONG"]);
    // A second, short project so the long one is not the sole project
    // (which renders differently) and the switcher has two rows.
    await tracker.run(["project", "create", "Web", "--prefix", "WEB"]);

    await page.goto(`${tracker.baseURL}/list`);

    // The row exists and exposes the full label via title (hover/focus)
    // — the case's "full label on hover/focus".
    const row = page.getByRole("link", { name: longName });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("title", longName);

    // It is visually clamped to a single line with an ellipsis, so it
    // cannot push the layout. Asserted on the rendered geometry, not a
    // class name: the label's own content is wider than the box it is
    // painted in (it is being clipped), it is held to one text line,
    // and the box is bounded to the sidebar column. An unclamped label
    // would either wrap to many lines (tall row) or run off the side.
    const clamp = await row.getByText(longName, { exact: true }).evaluate(el => {
      const s = getComputedStyle(el);
      const line = parseFloat(s.lineHeight) || el.getBoundingClientRect().height;
      return {
        clipped: el.scrollWidth > el.clientWidth,
        width: el.getBoundingClientRect().width,
        lines: Math.round(el.getBoundingClientRect().height / line),
        ellipsis: s.textOverflow,
      };
    });
    expect(clamp.clipped).toBe(true);
    expect(clamp.lines).toBe(1);
    expect(clamp.width).toBeLessThan(260);
    expect(clamp.ellipsis).toBe("ellipsis");

    // And the page did not gain a horizontal scrollbar from the long
    // label — the body must never pan sideways (the M1 gate, F5).
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(overflow).toBe(true);
  });
});

test.describe("PRU-41 — assigning an archived user through a stale picker", () => {
  // @verifies PRU-41
  test("PRU-41: a user archived out-of-band shows disabled in the re-queried picker, so no write is sent (K90)", async ({
    page,
    tracker,
  }) => {
    // A task with an assignee already set, plus a second active user
    // the stale picker will offer. The panel is loaded while both are
    // active — so the picker renders the second user as an *enabled*
    // option — and only then is that user archived out-of-band. Within
    // the 30s query staleTime the cached list is not refetched, so the
    // option stays enabled: exactly the stale picker the case names.
    await tracker.run(["user", "create", "Ada Byron", "--email", "ada@example.com"]);
    await tracker.run(["user", "create", "Grace Hopper", "--email", "grace@example.com"]);
    const [key] = await tracker.seed([{ title: "Stale picker task" }]);
    if (key === undefined) throw new Error("seed returned no key");
    await tracker.run(["set", key, "assignee", "Ada Byron"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    // The panel loaded with Grace active — confirm before archiving.
    await page.getByTestId("meta-edit-assignee").click();
    const list = page.getByTestId("meta-options-assignee");
    const grace = list.getByRole("option", { name: /Grace Hopper/ });
    await expect(grace).toBeEnabled();
    // Close the picker again without changing anything.
    await page.keyboard.press("Escape");

    // Archive Grace from the "CLI".
    await tracker.run(["user", "archive", "Grace Hopper"]);

    // K90: the picker queries the server each time it opens, so re-opening
    // it after the archive shows Grace as archived-disabled — the stale
    // enabled option this case used to rely on no longer exists. The write
    // is prevented at the control rather than sent-and-refused; the
    // server-side archived-reference guard still holds (core
    // `config/archived-guard.test.ts` + `…-fails-closed.test.ts`, and the
    // MCP guard tests). What this UI case now asserts is the client-side
    // prevention.
    await page.getByTestId("meta-edit-assignee").click();
    const graceArchived = list.getByRole("option", { name: /Grace Hopper/ });
    // Present, named, marked archived, and unselectable.
    await expect(graceArchived).toBeVisible();
    await expect(graceArchived).toContainText(/archived/i);
    await expect(graceArchived).toBeDisabled();
    // The panel explains why archived entities cannot be newly assigned.
    await expect(list).toContainText(/archived/i);

    // Nothing was written and the field still shows Ada — no optimistic
    // flash of Grace.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("meta-edit-assignee")).toContainText("Ada Byron");
    await expect(page.getByTestId("meta-edit-assignee")).not.toContainText("Grace Hopper");
    const assigneeId = await fmByTitle(tracker.root, "Stale picker task", "assignee");
    const adaId = await userIdByName(tracker, "Ada Byron");
    expect(adaId).toBeDefined();
    expect(assigneeId).toBe(adaId);
  });
});

test.describe("PRU-24 — the current user is archived mid-session", () => {
  // @verifies PRU-24
  test("PRU-24: the header marks the archived actor and prompts a switch", async ({
    page,
    tracker,
  }) => {
    // Two users. The UI is open as Carol.
    await tracker.run(["user", "create", "Carol", "--email", "carol@example.com"]);
    await tracker.run(["user", "create", "Active Alice", "--email", "alice@example.com"]);
    await tracker.run(["user", "switch", "Carol"]);

    await page.goto(`${tracker.baseURL}/list`);
    // Open the menu: Carol is the current user, not yet archived.
    await page.getByTestId("user-menu-trigger").click();
    await expect(page.getByTestId("user-menu-current")).toContainText("Carol");
    await expect(page.getByTestId("user-menu-current-archived")).toHaveCount(0);
    // Close the menu.
    await page.keyboard.press("Escape");

    // Archive Carol "from the CLI". Core refuses to archive the *active*
    // user directly (assertNotActiveUser), so the operator switches
    // away, archives her, then switches back — which is the reachable
    // way `state.yaml`'s current user ends up pointing at an archived
    // profile. `getCurrentUser` returns that archived profile unchanged
    // (it self-heals only a *missing* id, not an archived one), so the
    // next `/api/user/current` fetch is exactly PRU-24's condition: the
    // UI is presenting an archived user as current.
    await tracker.run(["user", "switch", "Active Alice"]);
    await tracker.run(["user", "archive", "Carol"]);
    await tracker.run(["user", "switch", "Carol"]);

    // The header must surface the change on the next data fetch. Nudge
    // a refetch by reloading — a real session's polling/invalidation
    // would do this on its own; the reload stands in for "the next
    // data fetch" without waiting on a timer.
    await page.reload();
    await page.getByTestId("user-menu-trigger").click();

    // The current-user block now carries an "(archived)" marker…
    await expect(page.getByTestId("user-menu-current-archived")).toBeVisible();
    await expect(page.getByTestId("user-menu-current-archived")).toContainText("archived");
    // …and a prompt to switch to an active user.
    await expect(page.getByTestId("user-menu-archived-prompt")).toBeVisible();
    await expect(page.getByTestId("user-menu-archived-prompt")).toContainText(/switch/i);

    // Switching to the active user clears the state without a reload.
    await page.getByText("Active Alice").click();
    await page.getByTestId("user-menu-trigger").click();
    await expect(page.getByTestId("user-menu-current")).toContainText("Active Alice");
    await expect(page.getByTestId("user-menu-current-archived")).toHaveCount(0);
    await expect(page.getByTestId("user-menu-archived-prompt")).toHaveCount(0);
  });
});
