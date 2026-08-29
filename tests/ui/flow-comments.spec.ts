/**
 * Transcribed from docs/dev/ui-test-cases/flow-comments-activity.md —
 * M2.4a, the Comments section (CMT-1..12).
 *
 * **The far end is `_comments.yaml`**, read off disk, never off the
 * screen. A comment appearing in the list is the app's claim about
 * itself; the file is the fact — and CMT-2 is explicit that "only the
 * failure path checked disk, so an accepted-and-dropped write passed
 * the happy path".
 *
 * **The author and every mention are ULIDs on disk.** So every
 * assertion about who wrote or who was mentioned names the *rendered
 * display name*. A test asserting a comment "appears" passes on a
 * ULID — that is LST-33, and it is the specific trap in this group.
 *
 * **No `page.reload()` except where a case asks for one.** CMT-2's
 * third bullet asks for exactly one, and says why. Everywhere else a
 * reload would refetch from the server regardless of client state and
 * mask the mechanism under test.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";
import { parse as parseYaml } from "yaml";

import type { TrackerFixture } from "./fixtures/tracker.ts";
import { expect, test } from "./fixtures/tracker.ts";

/* ------------------------------------------------------------------ *
 * Reading the far end
 * ------------------------------------------------------------------ */

interface StoredComment {
  readonly id: string;
  readonly author: string;
  readonly body: string;
  readonly created_at: string;
  readonly updated_at?: string;
  readonly edited?: true;
  readonly mentions?: string[];
  readonly editors?: string[];
}

/** The directory of the task with this key. */
async function taskDir(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) {
      return path.join(tasksDir, id);
    }
  }
  throw new Error(`no task on disk with key ${key}`);
}

/**
 * The task's comments **straight out of `_comments.yaml`**.
 *
 * Parsed rather than regexed so a body containing `id:` or a stray
 * newline cannot make the file look like something it is not — and so
 * a missing key is `undefined` rather than a silent no-match.
 */
async function commentsOnDisk(root: string, key: string): Promise<StoredComment[]> {
  const file = path.join(await taskDir(root, key), "_comments.yaml");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return []; // absent is a real state: nobody has commented
  }
  const parsed = parseYaml(text) as { comments?: StoredComment[] } | null;
  return parsed?.comments ?? [];
}

/* ------------------------------------------------------------------ *
 * Seeding people
 * ------------------------------------------------------------------ */

interface Person {
  readonly id: string;
  readonly name: string;
}

/** Creates a user and returns their allocated ULID. */
async function makeUser(
  tracker: TrackerFixture,
  name: string,
  email?: string,
): Promise<Person> {
  const out = await tracker.run([
    "user", "create", name,
    ...(email !== undefined ? ["--email", email] : []),
  ]);
  const id = /\(([0-9A-Z]{26})\)/.exec(out)?.[1];
  if (id === undefined) throw new Error(`could not parse a user id from: ${out}`);
  return { id, name };
}

/** The user `init` created, who owns everything written before a switch. */
async function currentUser(tracker: TrackerFixture): Promise<Person> {
  const out = await tracker.run(["user", "current"]);
  const id = /\b([0-9A-Z]{26})\b/.exec(out)?.[1];
  if (id === undefined) throw new Error(`could not parse the current user from: ${out}`);
  const list = await tracker.run(["user", "list"]);
  const row = list.split("\n").find(l => l.includes(id));
  // The row is `<id>[ *]\t<name>\t<tz>`; the name is the second column.
  const name = row?.split("\t")[1]?.trim() ?? "";
  return { id, name };
}

function onlyKey(keys: readonly string[]): string {
  const key = keys[0];
  if (key === undefined) throw new Error("seed returned no keys");
  return key;
}

/* ------------------------------------------------------------------ *
 * Driving the composer
 * ------------------------------------------------------------------ */

const composer = (page: Page): Locator => page.getByTestId("comment-composer");
const composerSurface = (page: Page): Locator =>
  composer(page).getByTestId("rich-editor");
const submit = (page: Page): Locator => page.getByTestId("comment-composer-submit");

/** Types into the composer and posts, waiting for the write to land. */
async function postComment(page: Page, text: string): Promise<void> {
  await composerSurface(page).click();
  await page.keyboard.type(text);
  await expect(submit(page)).toBeEnabled();
  const wrote = page.waitForResponse(
    r => /\/comments$/.test(r.url()) && r.request().method() === "POST",
  );
  await submit(page).click();
  await wrote;
}

/** The rendered author names, top to bottom. */
async function renderedAuthors(page: Page): Promise<string[]> {
  return page.getByTestId("comment-author").allInnerTexts();
}

/** The rendered comment bodies, top to bottom. */
async function renderedBodies(page: Page): Promise<string[]> {
  return (await page.getByTestId("comment-body").allInnerTexts())
    .map(t => t.trim());
}

/**
 * The edit surface, whichever mode it is in.
 *
 * An edit opens in **Markdown source** (CMT-3's second bullet), so the
 * surface is CodeMirror rather than ProseMirror. A test that hunted
 * only for `rich-editor` would time out here — and, worse, a test that
 * silently accepted either would not notice the mode defaulting the
 * wrong way, which is the thing CMT-3 turns on.
 */
const editSurface = (page: Page): Locator =>
  page.getByTestId("comment-edit-composer").getByTestId("markdown-editor");

/** Saves the open edit and waits for the write to land. */
async function saveEdit(page: Page): Promise<void> {
  const saved = page.waitForResponse(
    r => /\/comments\//.test(r.url()) && r.request().method() === "PUT",
  );
  await page.getByTestId("comment-edit-composer-submit").click();
  await saved;
}

/** Replaces the whole edit buffer with `text`. */
async function retypeEdit(page: Page, text: string): Promise<void> {
  await editSurface(page).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(text);
}

/**
 * Drives a real hidden → visible transition so `refetchOnWindowFocus`
 * refreshes the queries **in the page that is already open**.
 *
 * Not `page.reload()`, which is the XS-1 vacuity: a reload rebuilds the
 * whole JS context and refetches everything from the server regardless
 * of client state, so it masks the deletion of the mechanism under
 * test. Measured here: caching the mention resolution in a
 * module-level map — the shape of "storing a resolved name", which
 * CMT-10 forbids — left the reload-based version of CMT-10 green,
 * because the reload threw the cache away.
 *
 * The wait is part of the mechanism, not a sleep papering over a race:
 * `refetchOnWindowFocus` only refetches a **stale** query, and the
 * shared `staleTime` is 30 seconds, so refocusing inside that window
 * is correctly a no-op. Copied from `flow-task-failure.spec.ts`, which
 * established the pattern.
 */
async function refocus(page: Page): Promise<void> {
  await page.waitForTimeout(31_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden", configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible", configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function openTask(page: Page, tracker: TrackerFixture, key: string): Promise<void> {
  await page.goto(`${tracker.baseURL}/tasks/${key}`);
  await expect(page.getByTestId("task-key-chip")).toHaveText(key);
}

/* ================================================================== *
 * The cases
 * ================================================================== */

test.describe("CMT — comments", () => {
  // @verifies CMT-1
  test("CMT-1: comments list oldest-first, in the file's order, with author and time", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Threaded" }]));
    const ken = await currentUser(tracker);
    const ana = await makeUser(tracker, "Ana Lopez", "ana@example.com");

    // Five comments over three days. Written through the CLI so the
    // file's order is established independently of the UI.
    for (const body of ["one", "two", "three", "four", "five"]) {
      await tracker.run(["comment", key, body]);
    }
    // Backdate them so the relative times differ — a list that shows
    // five identical "just now" cannot demonstrate an ordering.
    const dir = await taskDir(tracker.root, key);
    const file = path.join(dir, "_comments.yaml");
    const raw = await readFile(file, "utf8");
    const days = [
      "2026-08-26T09:00:00.000Z", "2026-08-26T15:00:00.000Z",
      "2026-08-27T09:00:00.000Z", "2026-08-28T09:00:00.000Z",
      "2026-08-28T18:00:00.000Z",
    ];
    let i = 0;
    await writeFile(
      file,
      raw.replace(/created_at: .*/g, () => `created_at: ${days[i++] ?? days[0]}`),
      "utf8",
    );

    await openTask(page, tracker, key);

    const stored = await commentsOnDisk(tracker.root, key);
    expect(stored.map(c => c.body)).toEqual(["one", "two", "three", "four", "five"]);

    // The order on screen *is* the order in the file — the case's
    // third bullet. Asserted against what was just read off disk
    // rather than against the literals above, so a file the CLI
    // reordered would be caught rather than agreed with.
    await expect(page.getByTestId("comment")).toHaveCount(5);
    expect(await renderedBodies(page)).toEqual(stored.map(c => c.body));
    // Oldest at the top, newest at the bottom.
    expect(await renderedBodies(page)).toEqual(["one", "two", "three", "four", "five"]);

    // Author as a *name*, never the ULID that is actually stored.
    const authors = await renderedAuthors(page);
    expect(new Set(authors)).toEqual(new Set([ken.name]));
    expect(authors.join(" ")).not.toContain(ken.id);
    expect(stored[0]?.author).toBe(ken.id); // …and the file does hold the id

    /**
     * Initials, so there is an avatar rather than a blank circle.
     *
     * Asserted as *non-empty initials of this author's name* rather
     * than a computed literal: `ken.name.slice(0, 2)` happens to be
     * right only because the seeded user's name is one word, and would
     * have been quietly wrong for "Ana Lopez" (which initials as "AL",
     * not "AN"). A test that re-implements the helper it is checking
     * asserts the helper, not the case.
     */
    const avatar = page.getByTestId("comment-avatar").first();
    await expect(avatar).toHaveText(/^[A-Z]{1,2}$/);
    // And drawn from the *name*, not the id — a ULID's first letters
    // would also match the pattern above.
    const shown = await avatar.innerText();
    expect(ken.name.toUpperCase()).toContain(shown[0] ?? "");
    expect(shown).not.toBe(ken.id.slice(0, 2));

    // Relative time on the face, absolute available on hover.
    const first = page.getByTestId("comment-time").first();
    await expect(first).toContainText("ago");
    expect(await first.getAttribute("title")).toBe(days[0]);
    // Distinct times, so the "relative" claim is doing work.
    const times = await page.getByTestId("comment-time").allInnerTexts();
    expect(new Set(times).size).toBeGreaterThan(1);

    // Ana exists but has said nothing — so "every comment is by the
    // current user" is a fact about this thread, not the renderer
    // being unable to tell people apart.
    expect(authors).not.toContain(ana.name);
  });

  // @verifies CMT-2
  test("CMT-2: the composer posts without leaving the page, and the write reaches disk", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Commentable" }]));
    const ken = await currentUser(tracker);
    const ana = await makeUser(tracker, "Ana Lopez");

    await openTask(page, tracker, key);

    // Always visible without hunting: no disclosure to open first.
    await expect(composer(page)).toBeVisible();

    // Empty cannot be submitted, and says why.
    await expect(submit(page)).toBeDisabled();
    await expect(page.getByTestId("comment-composer-reason"))
      .toContainText("needs some text");

    // Whitespace-only is still empty.
    await composerSurface(page).click();
    await page.keyboard.type("   ");
    await expect(submit(page)).toBeDisabled();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");

    const urlBefore = page.url();
    await postComment(page, "first thought");

    // Appended to the bottom of the list, without navigating.
    expect(page.url()).toBe(urlBefore);
    await expect(page.getByTestId("comment")).toHaveCount(1);
    expect(await renderedBodies(page)).toEqual(["first thought"]);

    // The composer cleared and kept focus, so a second comment needs
    // no re-click. Typing straight away is the assertion — a `focus`
    // check on the wrong element would pass while the keystrokes went
    // nowhere.
    await expect(submit(page)).toBeDisabled();
    await page.keyboard.type("second thought");
    await expect(submit(page)).toBeEnabled();
    const wrote = page.waitForResponse(
      r => /\/comments$/.test(r.url()) && r.request().method() === "POST",
    );
    await submit(page).click();
    await wrote;
    await expect(page.getByTestId("comment")).toHaveCount(2);

    // **The far end.** Both comments are in the file, in order, with
    // the current user as author.
    let stored = await commentsOnDisk(tracker.root, key);
    expect(stored.map(c => c.body)).toEqual(["first thought", "second thought"]);
    expect(stored.map(c => c.author)).toEqual([ken.id, ken.id]);

    // The one reload the case asks for, and it asks for it by name:
    // "only the failure path checked disk, so an accepted-and-dropped
    // write passed the happy path".
    await page.reload();
    await expect(page.getByTestId("comment")).toHaveCount(2);
    expect(await renderedBodies(page)).toEqual(["first thought", "second thought"]);

    // Switching users re-attributes the *next* comment, not the
    // earlier ones.
    await tracker.run(["user", "switch", ana.id]);
    await page.reload();
    await postComment(page, "ana's turn");

    stored = await commentsOnDisk(tracker.root, key);
    expect(stored.map(c => c.body)).toEqual([
      "first thought", "second thought", "ana's turn",
    ]);
    expect(stored.map(c => c.author)).toEqual([ken.id, ken.id, ana.id]);
    // And the *names* on screen agree — the id assertion above is the
    // file, this is the P-4 half.
    expect(await renderedAuthors(page)).toEqual([ken.name, ken.name, "Ana Lopez"]);
  });

  // @verifies CMT-3
  test("CMT-3: bodies render markdown, and an edit reopens the source that was typed", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Formatted" }]));
    const source = "**bold** and *italic* and `code` — see [docs](https://example.com)";
    await tracker.run(["comment", key, source]);
    await tracker.run(["comment", key, "- one\n- two"]);

    await openTask(page, tracker, key);

    const body = page.getByTestId("comment-body").first();
    // The elements, not the text: "**bold**" reaching the page
    // unparsed would satisfy a text assertion.
    await expect(body.locator("strong")).toHaveText("bold");
    await expect(body.locator("em")).toHaveText("italic");
    await expect(body.getByTestId("comment-code")).toHaveText("code");
    await expect(body.locator("a")).toHaveAttribute("href", "https://example.com");
    await expect(page.getByTestId("comment-body").nth(1).locator("li"))
      .toHaveText(["one", "two"]);
    // The markers are gone rather than shown alongside.
    await expect(body).not.toContainText("**bold**");

    // The raw markdown is what is stored …
    const stored = await commentsOnDisk(tracker.root, key);
    expect(stored[0]?.body).toBe(source);

    // … and reopening for edit shows that source, not the rendered
    // HTML. Read out of the editor rather than off the rendered body,
    // which is no longer on screen.
    await page.getByTestId("comment-edit").first().click();
    // The edit opens in Markdown mode, so the source is on screen …
    await expect(page.getByTestId("comment-edit-composer-mode-raw"))
      .toHaveAttribute("aria-pressed", "true");
    await expect(editSurface(page)).toContainText("**bold**");
    await expect(editSurface(page)).toContainText("`code`");
    await expect(editSurface(page)).toContainText("[docs](https://example.com)");
    // … and it is genuinely the source, not the rendered output: no
    // <strong> and no <a> anywhere inside the editor.
    await expect(editSurface(page).locator("strong")).toHaveCount(0);
    await expect(editSurface(page).locator("a")).toHaveCount(0);

    // The rich surface is still one click away, so the picker (CMT-7)
    // has not been taken off the edit path — it is just not the
    // default, because CMT-3 asks for the source first.
    await page.getByTestId("comment-edit-composer-mode-rich").click();
    await expect(page.getByTestId("comment-edit-composer").getByTestId("rich-editor"))
      .toBeVisible();
  });

  // @verifies CMT-4
  test("CMT-4: edit and delete are offered on every comment, not only the current user's", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Shared thread" }]));
    const ken = await currentUser(tracker);
    const ana = await makeUser(tracker, "Ana Lopez");

    await tracker.run(["comment", key, "ken wrote this"]);
    await tracker.run(["user", "switch", ana.id]);
    await tracker.run(["comment", key, "ana wrote this"]);
    await tracker.run(["user", "switch", ken.id]);

    await openTask(page, tracker, key);

    // Two comments, two authors — established by name, so the two rows
    // are genuinely different people rather than one repeated.
    expect(await renderedAuthors(page)).toEqual([ken.name, "Ana Lopez"]);

    // Both rows carry both controls. CMT-4 previously asserted the
    // opposite; the ownership premise is gone.
    await expect(page.getByTestId("comment-edit")).toHaveCount(2);
    await expect(page.getByTestId("comment-delete")).toHaveCount(2);
    for (const i of [0, 1]) {
      await expect(page.getByTestId("comment").nth(i).getByTestId("comment-edit"))
        .toBeVisible();
      await expect(page.getByTestId("comment").nth(i).getByTestId("comment-delete"))
        .toBeVisible();
    }

    // Switching the active user changes attribution on a subsequent
    // edit, not which controls are present.
    await tracker.run(["user", "switch", ana.id]);
    await page.reload();
    await expect(page.getByTestId("comment-edit")).toHaveCount(2);
    await expect(page.getByTestId("comment-delete")).toHaveCount(2);
  });

  // @verifies CMT-5
  test("CMT-5: editing marks the comment edited, and cancelling changes nothing on disk", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Editable thread" }]));
    const ken = await currentUser(tracker);
    const ana = await makeUser(tracker, "Ana Lopez");

    await tracker.run(["comment", key, "ken's original"]);
    await tracker.run(["user", "switch", ana.id]);
    await tracker.run(["comment", key, "ana's original"]);
    await tracker.run(["user", "switch", ken.id]);

    await openTask(page, tracker, key);
    const before = await commentsOnDisk(tracker.root, key);

    /* --- Cancelling discards, and Esc cancels ------------------- */

    await page.getByTestId("comment-edit").first().click();
    await editSurface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" WRECKED");
    await page.getByTestId("comment-edit-composer-cancel").click();
    await expect(page.getByTestId("comment-edit-composer")).toHaveCount(0);

    expect(await commentsOnDisk(tracker.root, key)).toEqual(before);
    expect(await renderedBodies(page)).toEqual(["ken's original", "ana's original"]);

    // `Esc` cancels too.
    await page.getByTestId("comment-edit").first().click();
    await editSurface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" ALSO WRECKED");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("comment-edit-composer")).toHaveCount(0);
    expect(await commentsOnDisk(tracker.root, key)).toEqual(before);

    /* --- Ken edits his own: the bare "Edited" marker ------------ */

    await page.getByTestId("comment-edit").first().click();
    await editSurface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(", revised");
    await saveEdit(page);

    // **Verified by re-reading the file**, which the case names
    // explicitly — not only by the rendered list.
    let stored = await commentsOnDisk(tracker.root, key);
    expect(stored[0]?.body).toContain(", revised");
    expect(stored[0]?.edited).toBe(true);
    expect(stored[0]?.updated_at).toBeDefined();
    expect(stored[0]?.updated_at).not.toBe(stored[0]?.created_at);
    // A self-edit records no editor, so the marker is bare.
    expect(stored[0]?.editors).toBeUndefined();
    expect(stored[0]?.author).toBe(ken.id);

    const marker = page.getByTestId("comment").first().getByTestId("comment-edited");
    await expect(marker).toHaveText("(Edited)");
    expect(await marker.getAttribute("title")).toBe(stored[0]?.updated_at);

    /* --- Ken edits Ana's: "Edited by Ken", author still Ana ----- */

    await page.getByTestId("comment").nth(1).getByTestId("comment-edit").click();
    await editSurface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (touched)");
    await saveEdit(page);

    stored = await commentsOnDisk(tracker.root, key);
    // The original author is preserved; the editor is recorded beside.
    expect(stored[1]?.author).toBe(ana.id);
    expect(stored[1]?.editors).toEqual([ken.id]);

    // The two markers are *different renderings*, not alternatives —
    // the case is explicit about that, so both are on screen at once.
    await expect(page.getByTestId("comment").nth(0).getByTestId("comment-edited"))
      .toHaveText("(Edited)");
    await expect(page.getByTestId("comment").nth(1).getByTestId("comment-edited"))
      .toHaveText(`(Edited by ${ken.name})`);
    // The author shown is still Ana, primarily — a name, not a ULID.
    await expect(page.getByTestId("comment").nth(1).getByTestId("comment-author"))
      .toHaveText("Ana Lopez");
    const rendered = (await page.getByTestId("comments-list").innerText());
    expect(rendered).not.toContain(ken.id);
    expect(rendered).not.toContain(ana.id);
  });

  // @verifies CMT-6
  test("CMT-6: deleting confirms once, defaults to Cancel, and leaves the others in order", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Deletable" }]));
    for (const b of ["keep one", "delete me", "keep two"]) {
      await tracker.run(["comment", key, b]);
    }

    await openTask(page, tracker, key);
    await expect(page.getByTestId("comment")).toHaveCount(3);

    await page.getByTestId("comment").nth(1).getByTestId("comment-delete").click();
    const dialog = page.getByTestId("delete-comment-dialog");
    await expect(dialog).toBeVisible();

    // Names what is going: a preview and its timestamp.
    await expect(page.getByTestId("delete-comment-preview")).toHaveText("delete me");
    const stored = await commentsOnDisk(tracker.root, key);
    await expect(dialog).toContainText(stored[1]?.created_at ?? "");

    // No typed confirmation — a comment is a smaller blast radius than
    // a task, which does demand one.
    await expect(dialog.locator("input")).toHaveCount(0);
    await expect(page.getByTestId("delete-comment-confirm")).toBeEnabled();

    // Default focus is Cancel, not Delete. Asserted by *what a stray
    // Enter does*, which is the failure the rule prevents — a focus
    // check alone would not show that the wrong control fires.
    await expect(page.getByTestId("delete-comment-cancel")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toHaveCount(0);
    expect((await commentsOnDisk(tracker.root, key)).map(c => c.body))
      .toEqual(["keep one", "delete me", "keep two"]);

    // Now confirm for real.
    await page.getByTestId("comment").nth(1).getByTestId("comment-delete").click();
    const removed = page.waitForResponse(
      r => /\/comments\//.test(r.url()) && r.request().method() === "DELETE",
    );
    await page.getByTestId("delete-comment-confirm").click();
    await removed;

    await expect(page.getByTestId("comment")).toHaveCount(2);
    expect(await renderedBodies(page)).toEqual(["keep one", "keep two"]);
    // Gone from the file, and the survivors kept their order.
    expect((await commentsOnDisk(tracker.root, key)).map(c => c.body))
      .toEqual(["keep one", "keep two"]);
  });

  // @verifies CMT-7
  test("CMT-7: @mention autocomplete filters, navigates by keyboard, and stays out of code", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Mentioning" }]));
    const ana = await makeUser(tracker, "Ana Lopez", "ana@example.com");
    const ana2 = await makeUser(tracker, "Ana Lopez", "a.lopez@example.com");
    await makeUser(tracker, "Bo Reed");
    await makeUser(tracker, "Cyd Volt");

    await openTask(page, tracker, key);
    const menu = page.getByTestId("mention-menu");

    // `@` opens the picker.
    await composerSurface(page).click();
    await page.keyboard.type("cc @");
    await expect(menu).toBeVisible();
    const all = await menu.getByRole("option").count();
    expect(all).toBeGreaterThan(2);

    // Typing narrows it — and to the *right* rows, not merely fewer.
    await page.keyboard.type("an");
    await expect(menu.getByRole("option")).toHaveCount(2);
    expect((await menu.innerText())).not.toContain("Bo Reed");
    expect((await menu.innerText())).not.toContain("Cyd Volt");

    // Two users share the display name, so the picker must show
    // something else to tell them apart.
    await expect(menu.getByTestId(`mention-hint-${ana.id}`)).toHaveText("ana@example.com");
    await expect(menu.getByTestId(`mention-hint-${ana2.id}`)).toHaveText("a.lopez@example.com");

    // Arrows move the highlight …
    await expect(menu.getByRole("option").nth(0)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("option").nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(menu.getByRole("option").nth(0)).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("ArrowUp");
    await expect(menu.getByRole("option").nth(0)).toHaveAttribute("aria-selected", "true");

    // … Escape closes without inserting.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(composerSurface(page)).not.toContainText("@user:");

    // Enter inserts the highlighted user, and the *stored* form is the
    // id — which is what makes CMT-10 possible.
    await page.keyboard.type("a");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await postComment(page, " please look");

    let stored = await commentsOnDisk(tracker.root, key);
    expect(stored[0]?.body).toContain(`@user:${ana.id}`);
    expect(stored[0]?.mentions).toEqual([ana.id]);

    // Tab inserts too.
    await composerSurface(page).click();
    await page.keyboard.type("also @Bo");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(menu).toHaveCount(0);
    await postComment(page, "");
    stored = await commentsOnDisk(tracker.root, key);
    expect(stored[1]?.body).toMatch(/@user:[0-9A-Z]{26}/);

    /* --- No picker inside code -------------------------------- */

    await composerSurface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");

    /**
     * A *complete* code span, and the caret placed genuinely **inside**
     * it. Two measurements shaped this:
     *
     *  - TipTap's input rule only makes the `code` mark when the
     *    closing backtick arrives, so an unterminated `` `@ `` is
     *    plain text with a literal backtick — the picker firing there
     *    is correct, and a test asserting otherwise asserts the wrong
     *    thing.
     *  - Arrowing back from after the span lands *before* it, not in
     *    it. Clicking the `<code>` element is what actually puts the
     *    caret inside the mark, which is the position the case is
     *    about.
     */
    await page.keyboard.type("write `abc` after");
    await composerSurface(page).locator("code").click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("@");
    await expect(menu).toHaveCount(0);
    // The `@` really did land inside the span — otherwise the absence
    // above would be about a caret that went somewhere else entirely.
    await expect(composerSurface(page).locator("code")).toContainText("@");

    // A fenced block, likewise.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("```\n");
    await page.keyboard.type("cc @");
    await expect(menu).toHaveCount(0);

    // Paired positive on the same surface: in ordinary prose it does
    // fire, so the two absences above are the code rule rather than a
    // picker that has stopped working.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await composerSurface(page).click();
    await page.keyboard.type("plain @");
    await expect(menu).toBeVisible();
  });

  // @verifies CMT-8
  test("CMT-8: archived users are excluded from new mentions but existing ones still resolve", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Archiving" }]));
    const ana = await makeUser(tracker, "Ana Lopez");
    const zed = await makeUser(tracker, "Zed Archived");

    // An existing mention of Zed, written *before* he is archived.
    await tracker.run(["comment", key, `historic ping @user:${zed.id}`]);
    await tracker.run(["user", "archive", zed.id]);

    await openTask(page, tracker, key);
    const menu = page.getByTestId("mention-menu");

    // Not in the picker at all …
    await composerSurface(page).click();
    await page.keyboard.type("@");
    await expect(menu).toBeVisible();
    expect(await menu.innerText()).not.toContain("Zed Archived");
    // … and not surfaced by typing their exact display name.
    await page.keyboard.type("Zed Archived");
    await expect(menu).toHaveCount(0);
    // Paired positive: a live user *is* offered, so the absence above
    // is archiving rather than a broken filter.
    for (let i = 0; i < "Zed Archived".length; i++) await page.keyboard.press("Backspace");
    await page.keyboard.type("Ana");
    await expect(menu.getByTestId(`mention-option-${ana.id}`)).toBeVisible();
    await page.keyboard.press("Escape");

    // A token typed manually for a *nonexistent* user posts rather
    // than being rejected, and stays plain text.
    await composerSurface(page).click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await postComment(page, "hello @user:NoSuchUser0000000000000000");

    const stored = await commentsOnDisk(tracker.root, key);
    expect(stored).toHaveLength(2);
    expect(stored[1]?.body).toContain("@user:NoSuchUser0000000000000000");
    // Unresolvable, so core recorded no mention for it.
    expect(stored[1]?.mentions).toBeUndefined();

    const second = page.getByTestId("comment").nth(1);
    await expect(second.getByTestId("mention-plain")).toBeVisible();
    await expect(second.getByTestId("mention-chip")).toHaveCount(0);

    // The historic mention of the now-archived Zed still renders as a
    // chip, with his name and an archived treatment.
    const first = page.getByTestId("comment").nth(0);
    await expect(first.getByTestId("mention-chip")).toHaveText("@Zed Archived");
    await expect(first.getByTestId("mention-chip"))
      .toHaveAttribute("data-mention-archived", "true");
  });

  // @verifies CMT-9
  test("CMT-9: mentions render as chips that do one predictable thing", async ({
    page, tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Chip source" },
      { title: "Ana's task" },
    ]);
    const key = keys[0] ?? "";
    const ana = await makeUser(tracker, "Ana Lopez");
    await tracker.run(["set", keys[1] ?? "", "assignee", ana.id]);
    await tracker.run(["comment", key, `over to @user:${ana.id} and @user:ghost000`]);

    await openTask(page, tracker, key);

    const chip = page.getByTestId("mention-chip");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText("@Ana Lopez");
    // Distinguishable by more than colour: it is its own element with
    // a border, and the stored id is not what the reader sees.
    await expect(chip).toHaveAttribute("data-mention-id", ana.id);
    expect(await chip.innerText()).not.toContain(ana.id);
    expect(await chip.evaluate(el => getComputedStyle(el).borderStyle))
      .not.toBe("none");

    // The unresolvable token beside it is plain text, not a broken
    // chip — the pairing is what makes "a chip" mean something.
    await expect(page.getByTestId("mention-plain")).toHaveText("@user:ghost000");

    // Activating does something useful and predictable: it filters the
    // list to that user. Asserted by the *rows that come back*, not by
    // the URL — a filter that reaches the URL and narrows nothing is
    // the LST-16 gap.
    await chip.click();
    await expect(page).toHaveURL(/\/list\?/);
    await expect(page.getByRole("row").filter({ hasText: "Ana's task" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Chip source" }))
      .toHaveCount(0);
  });

  // @verifies CMT-10
  test("CMT-10: a mention survives renaming the mentioned user", async ({
    page, tracker,
  }) => {
    // `refocus` waits out the 30s staleness window — see its note. The
    // wait is the mechanism, so the budget accommodates it rather than
    // the test cutting it short.
    test.setTimeout(120_000);
    const key = onlyKey(await tracker.seed([{ title: "Rename survival" }]));
    const ana = await makeUser(tracker, "Ana Lopez");
    await tracker.run(["comment", key, `nice work @user:${ana.id}`]);

    await openTask(page, tracker, key);
    await expect(page.getByTestId("mention-chip")).toHaveText("@Ana Lopez");

    const before = await commentsOnDisk(tracker.root, key);
    expect(before[0]?.mentions).toEqual([ana.id]);

    // The rename, through the CLI — underneath a live page.
    await tracker.run(["user", "edit", ana.id, "--name", "Ana Ruiz"]);

    /**
     * **The stored bytes are unchanged.** This is the whole mechanism:
     * the reference resolves at render time, so nothing on disk had to
     * be rewritten. Asserted first, because a test that only checked
     * the chip would pass on an implementation that rewrote every
     * comment body — which is exactly what CMT-10 forbids.
     */
    const after = await commentsOnDisk(tracker.root, key);
    expect(after).toEqual(before);
    expect(after[0]?.mentions).toEqual([ana.id]);
    expect(after[0]?.body).toBe(`nice work @user:${ana.id}`);
    // The body still holds the id, and never held the old name.
    expect(after[0]?.body).not.toContain("Ana Lopez");

    /**
     * And on the next render the chip reads the new name — **without a
     * reload**.
     *
     * The reload this used to do made the test vacuous, and provably
     * so: caching the mention resolution in a module-level map (the
     * shape of "storing a resolved name", which CMT-10 forbids) left
     * this test green, because a reload rebuilds the whole JS context
     * and throws the cache away with it. That is the XS-1 defect
     * exactly — a reload refetches everything from the server
     * regardless of client state, so it can mask the deletion of the
     * very mechanism under test.
     *
     * Instead: a real hidden → visible transition, which fires
     * `refetchOnWindowFocus` and refreshes the user list *in the
     * page that is already open*. The comment list is never refetched
     * and the component is never remounted, so the chip's new text can
     * only have come from resolving the same stored id again.
     */
    await refocus(page);

    await expect(page.getByTestId("mention-chip")).toHaveText("@Ana Ruiz");
    await expect(page.getByTestId("comment-body")).not.toContainText("Ana Lopez");
    // Not the id either — the P-4 half.
    expect(await page.getByTestId("comment-body").innerText()).not.toContain(ana.id);
    // The page was never reloaded: the comment element is the same one
    // that was on screen before the rename.
    expect(page.url()).toContain(key);
  });

  // @verifies CMT-11
  test("CMT-11: multiple mentions all resolve, de-duplicated in document order", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Many mentions" }]));
    const ana = await makeUser(tracker, "Ana Lopez");
    const bo = await makeUser(tracker, "Bo Reed");
    const cyd = await makeUser(tracker, "Cyd Vance");

    // Three distinct, plus a repeat of the first.
    await tracker.run([
      "comment", key,
      `@user:${ana.id} and @user:${bo.id} and @user:${cyd.id}, plus @user:${ana.id} again`,
    ]);

    await openTask(page, tracker, key);

    // Three distinct mentions plus the repeat — four chips in the
    // body, because the body says the name four times.
    await expect(page.getByTestId("mention-chip")).toHaveCount(4);
    expect(await page.getByTestId("mention-chip").allInnerTexts()).toEqual([
      "@Ana Lopez", "@Bo Reed", "@Cyd Vance", "@Ana Lopez",
    ]);

    // But `mentions` holds each user once, in document order.
    const stored = await commentsOnDisk(tracker.root, key);
    expect(stored[0]?.mentions).toEqual([ana.id, bo.id, cyd.id]);
    expect(stored[0]?.mentions).toHaveLength(3);
  });

  // @verifies CMT-12
  test("CMT-12: editing a comment recomputes its mentions", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Recompute" }]));
    const ana = await makeUser(tracker, "Ana Lopez");
    const bo = await makeUser(tracker, "Bo Reed");

    await tracker.run(["comment", key, `only @user:${ana.id} here`]);
    await openTask(page, tracker, key);
    expect((await commentsOnDisk(tracker.root, key))[0]?.mentions).toEqual([ana.id]);

    /* --- Adding a mention during an edit adds it to `mentions` --- */

    await page.getByTestId("comment-edit").first().click();
    await editSurface(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(` and @user:${bo.id}`);
    await saveEdit(page);

    let stored = await commentsOnDisk(tracker.root, key);
    expect(stored[0]?.mentions).toEqual([ana.id, bo.id]);
    // The chips update to match.
    await expect(page.getByTestId("mention-chip")).toHaveCount(2);
    expect(await page.getByTestId("mention-chip").allInnerTexts())
      .toEqual(["@Ana Lopez", "@Bo Reed"]);

    /* --- Removing the only mention removes the key entirely ----- */

    await page.getByTestId("comment-edit").first().click();
    await retypeEdit(page, "nobody at all now");
    await saveEdit(page);

    stored = await commentsOnDisk(tracker.root, key);
    expect(stored[0]?.body).toBe("nobody at all now");
    // The *key* is gone, not an empty array left behind — the case is
    // explicit, and `[]` would satisfy a length check.
    expect(stored[0]?.mentions).toBeUndefined();
    expect("mentions" in (stored[0] ?? {})).toBe(false);
    // And the raw file has no `mentions:` line for it either.
    const raw = await readFile(
      path.join(await taskDir(tracker.root, key), "_comments.yaml"), "utf8",
    );
    expect(raw).not.toContain("mentions:");

    await expect(page.getByTestId("mention-chip")).toHaveCount(0);
    await expect(page.getByTestId("comment-body")).toHaveText("nobody at all now");
  });
});
