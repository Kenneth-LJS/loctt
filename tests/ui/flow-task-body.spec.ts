/**
 * Transcribed from tests/cases/ui-test-cases/flow-tasks.md — M2.3, the
 * body editor.
 *
 * Browser specs because what they assert is browser behaviour: an
 * idle timer measured against the wall clock, a blur, a real
 * contenteditable receiving real keystrokes, a CLI process writing the
 * same file underneath a live page.
 *
 * **The far end is the file**, read off disk or through `loctt body`,
 * never off the screen. A "Saved" indicator is the app's claim about
 * itself; `task.md` is the fact.
 *
 * **No `page.reload()` in the convergence assertions.** A reload
 * refetches everything regardless of client state, so it can mask the
 * deletion of the very mechanism under test — the defect that made
 * XS-1 vacuous.
 */

import { chmod, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/tracker.ts";

/**
 * The one key a single-task seed allocated.
 *
 * `seed` returns `string[]`, so destructuring gives `string |
 * undefined` and every use needs a non-null assertion. Failing loudly
 * here instead means a seed that silently returned nothing is a named
 * error rather than a confusing assertion three lines later.
 */
function onlyKey(keys: readonly string[]): string {
  const key = keys[0];
  if (key === undefined) throw new Error("seed returned no keys");
  return key;
}

/** The markdown body of the task with the given key, straight off disk. */
async function bodyOnDisk(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    let text: string;
    try {
      text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
    } catch {
      continue;
    }
    if (!new RegExp(`^key:\\s*${key}\\s*$`, "m").test(text)) continue;
    // Frontmatter is delimited by the opening `---` and the next one.
    const close = text.indexOf("\n---", 3);
    return text.slice(text.indexOf("\n", close + 1) + 1);
  }
  throw new Error(`no task on disk with key ${key}`);
}

/** The directory holding the task with the given key (…/tasks/<id>). */
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

/** The whole task.md file (frontmatter + body) for byte-equality checks. */
async function rawTaskFile(root: string, key: string): Promise<string> {
  return readFile(path.join(await taskDirOf(root, key), "task.md"), "utf8");
}

/**
 * Enters edit mode on the description (K33 / TSK-68..71).
 *
 * The description now renders read-only by default and only becomes an
 * editor when its rendered view is clicked. These specs all assert
 * *editing* behaviour (autosave, the mode toggle, conflict handling), so
 * each must enter edit first. The `body-editor` wrapper is present in both
 * states, so its visibility check still holds on load; the editor surfaces
 * (`rich-editor`/`markdown-editor`) exist only after this click.
 *
 * Idempotent: if the editor is already showing (a prior enterEdit, or a
 * forced-raw body that opens straight into edit), `body-rendered` is
 * absent and this is a no-op.
 */
async function enterEdit(page: Page): Promise<void> {
  // If the editor is already open (a prior enterEdit, or a forced-raw body
  // that opens straight into edit), the rich/markdown surface is present
  // and the rendered view is absent — nothing to do.
  const editing = page.getByTestId("body-editor").getByTestId("rich-editor");
  const rawEditing = page.getByTestId("body-editor").getByTestId("markdown-editor");
  if (await editing.count() > 0 || await rawEditing.count() > 0) return;
  // Otherwise wait for the read view to mount on this (possibly cold)
  // load, then use its explicit Edit button — a bare count() check races
  // the navigation.
  //
  // The gesture is `body-edit`, not a click on the rendered text: A247
  // deliberately removed click-to-edit from the content region so the
  // `<a>` and `<img>` inside a description are reachable and are not
  // nested inside an interactive ancestor (WCAG 4.1.2). An empty body
  // shows `body-rendered-placeholder`, which is its own button.
  await page.getByTestId("body-editor").waitFor({ state: "visible" });
  const placeholder = page.getByTestId("body-rendered-placeholder");
  if (await placeholder.count() > 0) {
    await placeholder.click();
    return;
  }
  const edit = page.getByTestId("body-edit");
  await edit.waitFor({ state: "visible" });
  await edit.click();
}

/** Types into whichever surface is showing (entering edit first). */
async function typeInBody(page: Page, text: string): Promise<void> {
  /**
   * Scoped to `body-editor`. A bare `getByTestId("rich-editor")` was
   * unambiguous while the body editor was the only rich surface; the
   * comment composer is a second one, so the bare locator resolves to two
   * and fails strict mode. The behaviour these specs cover is unchanged.
   */
  await enterEdit(page);
  const rich = page.getByTestId("body-editor").getByTestId("rich-editor");
  await rich.click();
  await page.keyboard.type(text);
}

const indicator = (page: Page) => page.getByTestId("save-indicator");

test.describe("TSK — the body editor", () => {
  // @verifies TSK-15
  test("TSK-15: one save fires ~1.5s after the last keystroke, not one per keystroke", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Editable" }]));

    // Count the writes the page actually makes. TSK-15's first bullet
    // is a statement about *how many* requests a burst produces, and
    // only counting can tell "one save after idle" apart from "a save
    // per keystroke that happens to end in the right text".
    const writes: string[] = [];
    await page.route(`**/api/tasks/*/body`, async route => {
      writes.push(route.request().postData() ?? "");
      await route.continue();
    });

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();

    /**
     * **Paced deliberately at 600ms per word, for 3.6s total.**
     *
     * Typing the burst at Playwright's default speed takes under a
     * second, so the whole thing lands inside one 1500ms window and a
     * *fixed-interval* save is indistinguishable from an *idle* one —
     * measured: replacing the debounce with "schedule only if none
     * pending" left this spec green. Six gaps of 600ms each are under
     * the window individually and 3.6s in total, so an idle timer that
     * re-arms fires **once, at the end**, while a fixed interval fires
     * twice or more. That difference is the case's first bullet.
     */
    await enterEdit(page);
    await page.getByTestId("body-editor").getByTestId("rich-editor").click();
    for (const word of ["A ", "paragraph ", "typed ", "at ", "human ", "pace."]) {
      await page.keyboard.type(word);
      await page.waitForTimeout(600);
    }

    // Still nothing: every keystroke re-armed the timer, and 3.6s of
    // continuous typing has elapsed — more than twice the window.
    expect(writes).toHaveLength(0);
    await expect(indicator(page)).toHaveAttribute("data-state", "unsaved");

    // Wait out the real idle window.
    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 6000 });

    // Exactly one request for the whole burst. A build that never
    // saves would have produced zero and never reached "saved", which
    // is what keeps this pair from being an absence on its own.
    expect(writes).toHaveLength(1);

    // The far end.
    expect(await bodyOnDisk(tracker.root, key)).toContain("A paragraph typed at human pace.");
  });

  // @verifies TSK-15
  test("TSK-15: clicking outside the editor saves immediately rather than waiting", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Blur saves" }]));
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();

    await typeInBody(page, "Saved on blur.");
    await expect(indicator(page)).toHaveAttribute("data-state", "unsaved");

    // Click something outside the editor, well inside the idle window.
    // Under K33 this blur both flushes the save AND returns to the
    // rendered view (the edit surface, and its save indicator, unmount),
    // so the proof that blur saved *immediately* is the disk write landing
    // inside a window shorter than the 1500ms idle timer — not the
    // indicator state, which no longer exists once we leave edit mode.
    await page.getByRole("heading", { level: 1 }).first().click();

    // The disk bound comes FIRST — before any default-timeout wait — or it
    // is vacuous. The write must land well under the 1500ms idle window:
    // had blur done nothing and only the idle timer saved (~1.5s), this
    // 1200ms poll would NOT converge. (This is the case's point — blur
    // saves immediately, not on the idle timer.) Polling the rendered view
    // first, with its 5s default timeout, would absorb that 1.5s delay and
    // make the bound meaningless.
    await expect
      .poll(async () => bodyOnDisk(tracker.root, key), { timeout: 1200, intervals: [50, 100, 200] })
      .toContain("Saved on blur.");

    // And the editor left edit: the rendered view shows the saved text.
    await expect(page.getByTestId("body-rendered")).toContainText("Saved on blur.");
  });

  // @verifies TSK-17
  test("TSK-17: the raw view shows the source for what was rendered, and edits round-trip", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Modes" }]));
    // Written through the CLI so the starting bytes are known exactly.
    await tracker.run(["body", key, "--set", "# Heading\n\nSome **bold** text.\n"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();

    // Rich mode renders it as a heading and a bold run, not as source.
    await enterEdit(page);
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor").getByRole("heading")).toContainText("Heading");
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor").locator("strong")).toContainText("bold");

    // Toggle to raw: the markdown source for what was rendered.
    await page.getByTestId("mode-raw").click();
    const raw = page.getByTestId("body-editor").getByTestId("markdown-editor");
    await expect(raw).toContainText("# Heading");
    await expect(raw).toContainText("**bold**");

    // Editing the raw source and toggling back renders the change.
    await raw.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type("\n\n## Added in source");
    await page.getByTestId("mode-rich").click();
    await expect(
      page.getByTestId("body-editor").getByTestId("rich-editor").getByRole("heading", { name: "Added in source" }),
    ).toBeVisible();

    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 6000 });
    expect(await bodyOnDisk(tracker.root, key)).toContain("## Added in source");
  });

  // @verifies TSK-17
  test("TSK-17: rich → raw → rich with no edits leaves the stored body byte-identical", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Round trip" }]));

    /**
     * Deliberately markdown a serializer would rewrite: underscore
     * emphasis, `+` bullets, a `1)` ordinal, and four blank lines. If
     * the toggle ever starts round-tripping through a serializer these
     * come back canonicalised and this test goes red — which is the
     * whole point. Canonical markdown here would pass against a
     * serializer and prove nothing.
     */
    const awkward = "Some _italic_ and __bold__.\n\n+ plus bullet\n+ another\n\n1) paren ordinal\n\n\n\nTrailing paragraph.\n";
    await tracker.run(["body", key, "--set", awkward]);
    const before = await bodyOnDisk(tracker.root, key);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();

    // Toggle back and forth several times, touching nothing.
    await enterEdit(page);
    for (let i = 0; i < 3; i++) {
      await page.getByTestId("mode-raw").click();
      await expect(page.getByTestId("body-editor").getByTestId("markdown-editor")).toBeVisible();
      await page.getByTestId("mode-rich").click();
      await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).toBeVisible();
    }

    // Give any autosave that *would* have fired time to land. The
    // assertion is that nothing was written at all — so waiting past
    // the idle window is what makes the absence meaningful rather
    // than merely early.
    await page.waitForTimeout(2500);

    expect(await bodyOnDisk(tracker.root, key)).toBe(before);
    /**
     * Paired positive, and the half that catches a normalizing
     * buffer.
     *
     * "Nothing was written" alone is satisfied by a build whose
     * buffer silently canonicalises on every toggle, because a
     * canonicalised buffer still is not *dirty* and so still triggers
     * no write — measured: replacing the buffer with an unconditional
     * `toMarkdown(fromMarkdown(...))` left the assertion above green.
     *
     * Appending one line in raw mode is what forces the buffer to
     * disk. Whatever it had quietly done to the *other* eight lines
     * then shows up in the file, and the spelling assertions below
     * are what see it.
     */
    await page.getByTestId("mode-raw").click();
    await page.getByTestId("body-editor").getByTestId("markdown-editor").click();
    // `Meta+End` / `Control+End` is not reliably end-of-document in
    // CodeMirror here — measured landing mid-list, where the ordinal
    // then auto-continued to "2)". Clicking the last line and using
    // End puts the caret somewhere the test can actually name.
    await page.getByText("Trailing paragraph.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Now edited.");
    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 6000 });

    const after = await bodyOnDisk(tracker.root, key);
    expect(after).toContain("Trailing paragraph. Now edited.");
    // The user's own spellings, untouched. A serializer would have
    // rewritten every one of these.
    expect(after).toContain("_italic_");
    expect(after).toContain("__bold__");
    expect(after).toContain("+ plus bullet");
    expect(after).toContain("1) paren ordinal");
    /**
     * Everything the user did not touch is byte-for-byte what it was.
     * Compared with the appended line removed rather than as a
     * prefix: CodeMirror's Control+End lands before the body's
     * trailing newline, so the insertion splices rather than appends,
     * and a prefix check would fail on that alone — which is a fact
     * about the key binding, not about normalization.
     */
    expect(after.replace(" Now edited.", "")).toBe(before);
  });

  // @verifies TSK-17
  test("TSK-17: a rich-mode edit does not rewrite the lines the user did not touch", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Rich edit" }]));
    /**
     * The rich path is the one a normalizing buffer actually reaches.
     * Editing in *raw* mode calls `reset`, which replaces the buffer
     * with the typed bytes and so bypasses any normalization on the
     * way to disk — measured, and it is why the sibling spec above
     * cannot see that mutation.
     *
     * Here the write comes from the visual editor, so whatever the
     * buffer does to the untouched lines is what lands in `task.md`.
     */
    const awkward = "First _italic_ line.\n\n+ plus bullet\n+ another\n\nLast paragraph.\n";
    await tracker.run(["body", key, "--set", awkward]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();

    // One word typed at the end, in rich mode.
    await enterEdit(page);
    await page.getByTestId("body-editor").getByTestId("rich-editor").getByText("Last paragraph.").click();
    await page.keyboard.press("End");
    await page.keyboard.type(" Appended.");

    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 6000 });
    const after = await bodyOnDisk(tracker.root, key);
    expect(after).toContain("Last paragraph. Appended.");

    /**
     * A rich edit *does* serialize the whole document — that is
     * unavoidable for any WYSIWYG surface over markdown, and it is
     * recorded as a known cost rather than claimed away. What must
     * still hold is that the serializer round-trips LocTT's own
     * spellings rather than mangling them: the bullets stay bullets
     * and the emphasis stays emphasis.
     */
    expect(after).toContain("plus bullet");
    expect(after).toContain("another");
    expect(after).toMatch(/[*_]italic[*_]/);
  });

  // @verifies TSK-18
  test("TSK-18: toolbar formatting reaches the raw markdown and shows active state", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Toolbar" }]));
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();

    await typeInBody(page, "make me bold");
    // Select the typed run inside the editor. `Control+A` in a
    // headless browser selects the *document*, not the contenteditable,
    // so the toolbar would apply the mark to an empty ProseMirror
    // selection and the test would fail for a reason the case is not
    // about.
    await page.keyboard.press("Shift+Home");
    await page.getByTestId("body-editor").getByTestId("fmt-bold").click();

    // Active state while the caret sits inside the formatting.
    await expect(page.getByTestId("body-editor").getByTestId("fmt-bold")).toHaveAttribute("aria-pressed", "true");

    // Reflected in the raw markdown after toggling modes — the case's
    // own wording, and the only check that the mark actually became
    // markdown rather than a styled div.
    await page.getByTestId("mode-raw").click();
    await expect(page.getByTestId("body-editor").getByTestId("markdown-editor")).toContainText("**make me bold**");

    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 6000 });
    expect(await bodyOnDisk(tracker.root, key)).toContain("**make me bold**");
  });

  // @verifies XS-11
  test("XS-11: a CLI append during editing is not lost — the write carries a base version", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Concurrent" }]));
    await tracker.run(["body", key, "--set", "Original paragraph.\n"]);

    // Observe that the write carries a precondition, which is the
    // case's first bullet ("a conditional write carrying a base
    // version").
    const payloads: string[] = [];
    await page.route(`**/api/tasks/*/body`, async route => {
      payloads.push(route.request().postData() ?? "");
      await route.continue();
    });

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();
    await typeInBody(page, "My addition. ");

    // The CLI writes before the idle flush.
    await tracker.run(["body", key, "--append", "Note from CLI"]);

    // The write is refused, and the user is shown both versions
    // rather than the CLI's paragraph being silently overwritten.
    await expect(page.getByTestId("body-conflict")).toBeVisible({ timeout: 8000 });
    expect(payloads.some(p => p.includes("expectedToken"))).toBe(true);

    // Nothing was written: the CLI's text is still what is on disk.
    expect(await bodyOnDisk(tracker.root, key)).toContain("Note from CLI");

    // Bullet 3, which had no assertion until now: when the two edits do
    // not overlap, the result contains BOTH texts and the user is told a
    // merge happened. Measured before this existed: replacing the merge
    // with `conflict.mine` — so "Keep both" silently drops the CLI's
    // paragraph, losing exactly what the option promises to keep — left
    // this file 11/11 green.
    //
    // Asserted on disk rather than in the preview, because the preview
    // showing both proves only that the dialog can render them.
    await page.getByRole("radio", { name: "Keep both" }).click();
    await page.getByTestId("conflict-apply").click();

    /**
     * The dialog unmounting is NOT the signal that the merge landed:
     * `resolve` closes the dialog synchronously and only then chains
     * the conditional write behind any in-flight flush, so reading the
     * file the instant the dialog is gone races the write and loses
     * ~2 runs in 10 (measured; the trace showed the 200 with the
     * correct merged body arriving a few ms AFTER the read). Polling
     * for "Note from CLI" is no signal either — the CLI put that on
     * disk before the conflict even appeared, so it matches at t=0.
     * The only text whose arrival proves the resolution wrote is the
     * editor's own: poll for it, then hold the merge to bullet 3.
     */
    await expect.poll(
      async () => await bodyOnDisk(tracker.root, key),
      { timeout: 8000 },
    ).toContain("My addition.");
    const merged = await bodyOnDisk(tracker.root, key);
    expect(merged).toContain("Note from CLI");
    expect(merged).toContain("My addition.");

    /**
     * The dialog stays closed after Apply. This was unassertable
     * until A59: the radio click blurs the editor, the blur-flush
     * went out with the stale token, and its 409 could land after
     * Apply and re-open the dialog over an already-resolved conflict
     * (4 in 10 runs once this assertion existed to catch it — the
     * known-gaps entry, now CLOSED).
     * A59 suppresses non-resolving writes while the dialog is open,
     * so the doomed flush never leaves and nothing can re-open it.
     * Asserted after the on-disk poll above, so the write chain has
     * demonstrably drained before this claims quiescence.
     */
    await expect(page.getByTestId("body-conflict")).not.toBeVisible();
  });

  // @verifies XS-12
  // @verifies TSK-35
  /**
   * XS-65 is **not** claimed here. Its re-entry bullet is asserted
   * below (dismiss, then reach the same surface again via Retry), but
   * its headline — a conflict surface whose *resolution write* then
   * fails — is not exercised, and tagging it would overstate what
   * this covers. See the report.
   */
  test("XS-12/TSK-35: a genuine conflict shows both versions and each choice does what it promised", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Conflict" }]));
    await tracker.run(["body", key, "--set", "Original.\n"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();
    await typeInBody(page, "My version of the text.");

    await tracker.run(["body", key, "--set", "Completely different text"]);

    const dialog = page.getByTestId("body-conflict");
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Both texts, in full, both visible — not a diff with no original.
    await expect(page.getByTestId("conflict-mine")).toContainText("My version of the text.");
    await expect(page.getByTestId("conflict-theirs")).toContainText("Completely different text");

    // The outcome of each choice is stated before clicking.
    await expect(dialog).toContainText("The other edit is lost");
    await expect(dialog).toContainText("Discards your text");

    // Dismissing writes nothing and keeps the user's text.
    await page.getByTestId("conflict-dismiss").click();
    await expect(dialog).not.toBeVisible();
    expect(await bodyOnDisk(tracker.root, key)).toBe("Completely different text\n");
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).toContainText("My version of the text.");
    // The indicator still says the text is not saved, so nothing
    // suggests the dismissal banked it (XS-65).
    await expect(indicator(page)).toHaveAttribute("data-state", "failed");

    /**
     * Re-enter the conflict — XS-65's "it can be re-entered; it does
     * not vanish leaving the user with no way back to their text". The
     * retry control on the failed indicator is that way back, and it
     * reaches the same surface rather than a bare error.
     */
    // `force` because the retry re-raises the conflict, and the
    // re-rendered dialog then covers the button Playwright is still
    // re-checking for actionability. The click lands; only the
    // post-click stability check sees the overlay.
    await page.getByTestId("save-retry").click({ force: true });
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // "Keep mine" produces exactly that content on disk.
    await page.getByTestId("conflict-choice-mine").click();
    await page.getByTestId("conflict-apply").click();

    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 8000 });
    const final = await bodyOnDisk(tracker.root, key);
    expect(final).toContain("My version of the text.");
    expect(final).not.toContain("Completely different text");
  });

  // @verifies XS-14
  test("XS-14: an idle editor does not re-write its stale buffer over a CLI change", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Idle" }]));

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();
    await typeInBody(page, "Typed by the user.");
    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 6000 });

    // The CLI empties the body. No further typing happens.
    await tracker.run(["body", key, "--set", ""]);

    // Well past several idle windows. An autosave that were not
    // dirty-flag driven would have re-posted the stale buffer by now
    // and restored the old text.
    await page.waitForTimeout(5000);

    expect(await bodyOnDisk(tracker.root, key).then(b => b.trim())).toBe("");
    /**
     * Paired positive, and it is the case's third bullet: the editor
     * "either adopts the CLI's empty body or raises the conflict
     * surface; it does not silently restore the old text."
     *
     * This build takes the second branch. The editor still holds the
     * token from its last read, so the user's next genuine edit is
     * *refused* rather than clobbering the CLI's change — and the
     * conflict surface is where they choose. That the page is alive
     * and still writing is what this half establishes; without it the
     * absence above would also be satisfied by a dead page.
     *
     * The cost is real and is recorded as a decision (A?, "the idle
     * editor does not poll for a fresher token"): a user who was not
     * competing with anyone still meets a conflict dialog on their
     * next keystroke. Adopting would need a read on the write path,
     * which is XS-13's residual-race question and larger than this
     * ticket.
     */
    await typeInBody(page, "Deliberate new text.");
    await expect(page.getByTestId("body-conflict")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("conflict-theirs")).toContainText("(empty)");
    await expect(page.getByTestId("conflict-mine")).toContainText("Deliberate new text.");

    // And choosing produces exactly what was promised, on disk.
    await page.getByTestId("conflict-choice-mine").click();
    await page.getByTestId("conflict-apply").click();
    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 8000 });
    expect(await bodyOnDisk(tracker.root, key)).toContain("Deliberate new text.");
  });

  // @verifies TSK-48
  test("TSK-48: a failed auto-save never shows saved and keeps the typed text", async ({
    page, tracker,
  }) => {
    const key = onlyKey(await tracker.seed([{ title: "Failing" }]));
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();

    // Fail the body write after the editor has loaded.
    await page.route(`**/api/tasks/*/body`, async route => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "io_failed",
          message: "No space left on device.",
          data_state: "not_saved",
        }),
      });
    });

    await typeInBody(page, "Words the user must not lose.");

    // An explicit failed state — not "saved", not back to idle.
    await expect(indicator(page)).toHaveAttribute("data-state", "failed", { timeout: 8000 });
    await expect(indicator(page)).toContainText("No space left on device");
    await expect(indicator(page)).toContainText("not been saved");

    // The typed content stays in the editor so it can be copied out.
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).toContainText("Words the user must not lose.");
    // And a retry control is offered, since freeing space and retrying
    // is the actual fix.
    await expect(page.getByTestId("save-retry")).toBeVisible();

    // The far end: nothing was written.
    expect(await bodyOnDisk(tracker.root, key)).not.toContain("must not lose");
  });

  // @verifies TSK-48
  test("TSK-48: BLUR with a failing save keeps the editor open, does not drop to a stale render", async ({
    page, tracker,
  }) => {
    // Fix-review HIGH #1: on blur, the editor flushed in a microtask but
    // the leave-effect saw the pre-flush "unsaved" state and unmounted the
    // edit surface BEFORE the POST started — so a failing save landed on an
    // unmounted component and the user's text was lost with no error shown.
    // The editor must STAY in edit (TSK-48) when the blur-triggered save
    // fails, keeping the typed text and showing the failure.
    const key = onlyKey(await tracker.seed([{ title: "Blur fail" }]));
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();
    // A DELAYED failure. The delay is what exercises the ordering bug: the
    // blur flushes, but the POST is still in flight when the leave-effect
    // runs — the old code saw the pre-`saving` `unsaved` state and left
    // (unmounting the editor) before the failure could come back, losing
    // the text. With the fix the editor stays until the save settles, so
    // the failure lands in a mounted editor.
    await page.route(`**/api/tasks/*/body`, async route => {
      await new Promise(r => setTimeout(r, 400));
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "io_failed", message: "Disk is full.", data_state: "not_saved" }),
      });
    });

    await typeInBody(page, "Blur must not lose this.");
    // Blur immediately (before the idle timer) by clicking outside.
    await page.getByRole("heading", { level: 1 }).first().click();

    // Still in edit — NOT dropped to the rendered view — with the text and
    // an explicit failure. (Before the fix: body-rendered showed the stale
    // body, no indicator, text gone.)
    await expect(indicator(page)).toHaveAttribute("data-state", "failed", { timeout: 8000 });
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).toContainText("Blur must not lose this.");
    await expect(page.getByTestId("body-rendered")).toHaveCount(0);
    expect(await bodyOnDisk(tracker.root, key)).not.toContain("must not lose");
  });

  // @verifies TSK-71
  test("TSK-71: Escape exits the editor keeping the text, and writes it exactly once", async ({
    page, tracker,
  }) => {
    // SUPERSEDED PREMISE — recorded rather than quietly rewritten.
    //
    // This case used to assert "Escape discards the edit and writes
    // nothing". K96 (Ken, 2026-09-19) deliberately REVERSED that: there
    // is no discard gesture, and Escape / Cmd-Enter / Cmd-S all EXIT
    // KEEPING the text. The rationale is in `editor/BodyEditor.tsx` —
    // revert-to-last-autosave silently threw away everything typed in
    // the idle window since, which was the data-loss bug the editor
    // review found.
    //
    // The durable requirement underneath is unchanged and is what is
    // asserted now: Escape leaves the editor, the user's text is NOT
    // lost, and the exit produces exactly ONE write (the old bug was a
    // stray second write from the unmount flush).
    const key = onlyKey(await tracker.seed([{ title: "Escape cancels" }]));
    await tracker.run(["body", key, "--set", "Original body.\n"]);
    const writes: string[] = [];
    await page.route(`**/api/tasks/*/body`, async route => {
      writes.push(route.request().postData() ?? "");
      await route.continue();
    });
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();

    await typeInBody(page, " Escaped edit.");
    await page.keyboard.press("Escape");

    // Back to the rendered read view — Escape leaves the editor.
    await expect(page.getByTestId("body-rendered")).toBeVisible();
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor"))
      .toHaveCount(0);

    // The text is kept, on screen and on disk — nothing the user typed
    // is lost, which is the whole point of the reversal.
    await expect(page.getByTestId("body-rendered")).toContainText("Original body.");
    await expect(page.getByTestId("body-rendered")).toContainText("Escaped edit.");
    await expect
      .poll(async () => bodyOnDisk(tracker.root, key))
      .toContain("Escaped edit.");

    // Exactly ONE write. The bug this case was originally written for was
    // a SECOND, stray write from the unmount flush; that half still has
    // to hold, and a count is what catches it.
    await page.waitForTimeout(500);
    expect(writes, writes.join("\n")).toHaveLength(1);
  });

  // @verifies TSK-40
  test("TSK-40: navigating to another task shows that task's body, never the first one's", async ({
    page, tracker,
  }) => {
    const seeded = await tracker.seed([{ title: "Task A" }, { title: "Task B" }]);
    const a = onlyKey(seeded);
    const b = seeded[1];
    if (b === undefined) throw new Error("seed returned one key, expected two");
    await tracker.run(["body", a, "--set", "Body of A.\n"]);
    await tracker.run(["body", b, "--set", "Body of B.\n"]);

    await page.goto(`${tracker.baseURL}/tasks/${a}`);
    await enterEdit(page);
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).toContainText("Body of A.");
    await typeInBody(page, " Edited in A.");

    /**
     * Navigate **in-app**, via the list, rather than with
     * `page.goto`. Two reasons, and the second is the one that makes
     * this test mean anything:
     *
     *  - a hard navigation tears the document down, so React's
     *    unmount effects — the flush that TSK-40's first bullet
     *    requires — are not reliably run. The case is about moving
     *    between two tasks in the app, which is a router transition.
     *  - a hard load refetches everything, so a leaked buffer and a
     *    clean one look identical afterwards. Exactly the reason
     *    XS-1 was vacuous.
     */
    await page.getByRole("link", { name: "All tasks" }).first().click();
    await expect(page).toHaveURL(/\/list/);
    await page.getByRole("row").filter({ hasText: "Task B" }).first().click();
    await expect(page.getByTestId("body-editor")).toBeVisible();

    await enterEdit(page);
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).toContainText("Body of B.");
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).not.toContainText("Edited in A.");
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).not.toContainText("Body of A.");

    // A's pending edit was flushed rather than silently discarded.
    await expect
      .poll(async () => bodyOnDisk(tracker.root, a), { timeout: 8000 })
      .toContain("Edited in A.");
  });
});

/* ================================================================== *
 * TSK-27 — a very large body loads and edits without freezing
 * ================================================================== */

test.describe("TSK — a very large body", () => {
  // @verifies TSK-27
  test("TSK-27: several thousand lines load interactively, edit at the bottom, and autosave once per idle window", async ({
    page, tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    const key = onlyKey(await tracker.seed([{ title: "War and peace" }]));

    // A genuinely large body: 4000 numbered lines, written through the
    // CLI so the starting bytes are known exactly and the size is real
    // rather than a token the app might special-case.
    const LINES = 4000;
    const big = Array.from({ length: LINES }, (_u, i) => `Line ${String(i + 1)} of the body.`)
      .join("\n") + "\n";
    await tracker.run(["body", key, "--set", big]);

    // Count the writes: bullet three is a statement about *how many*
    // requests a burst produces, and only counting tells "one save per
    // idle window" apart from "one save per keystroke on a huge doc",
    // which is the specific freeze this case guards against.
    const writes: string[] = [];
    await page.route(`**/api/tasks/*/body`, async route => {
      writes.push(route.request().postData() ?? "");
      await route.continue();
    });

    // First bullet: the editor becomes interactive without a
    // multi-second freeze. Measure from navigation to the editor being
    // ready to take input.
    const start = Date.now();
    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();
    // Raw mode is CodeMirror, which viewports the DOM — the honest
    // surface for a several-thousand-line document, and what the case
    // is about (a plain textarea or a fully-realised rich tree is
    // where the freeze would be).
    await enterEdit(page);
    await page.getByTestId("mode-raw").click();
    const editor = page.getByTestId("body-editor").getByTestId("markdown-editor");
    await expect(editor).toBeVisible();
    // Interactive: it can be focused and it holds the content. Bounded
    // generously — the assertion is "not a multi-second freeze", not a
    // microbenchmark, so 15s is a ceiling a frozen build blows through
    // while a working one clears in well under a second.
    await editor.click();
    const interactiveMs = Date.now() - start;
    expect(interactiveMs, `editor took ${String(interactiveMs)}ms to become interactive`)
      .toBeLessThan(15_000);

    // Second bullet: typing at the bottom does not scroll-jump to the
    // top. Go to the very end, note the scroll position, type, and
    // require the caret's line to still be what we typed — not the top
    // of the document.
    await page.keyboard.press("ControlOrMeta+End");
    const appended = "APPENDED-AT-BOTTOM-MARKER";
    await page.keyboard.type(`\n${appended}`);
    // The typed text is present and is the last line — a jump to the
    // top followed by insertion there would put it first instead.
    await expect(editor).toContainText(appended);

    // Bullet three: a paced burst produces exactly one write, at the
    // end of the idle window — not one per keystroke.
    for (const word of ["one ", "two ", "three ", "four ", "five ", "six."]) {
      await page.keyboard.type(word);
      await page.waitForTimeout(600);
    }
    // 3.6s of continuous typing, more than twice the 1500ms window, and
    // still nothing sent: each keystroke re-armed the timer.
    expect(writes).toHaveLength(0);
    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 6000 });
    // Exactly one request for the whole burst. Zero would mean it never
    // saved (and never reached "saved"); more than one would be the
    // per-keystroke resend this case forbids.
    expect(writes).toHaveLength(1);

    // The far end carries both the original bulk and the new text —
    // proving the large body was not truncated or replaced by the edit.
    const stored = await bodyOnDisk(tracker.root, key);
    expect(stored).toContain("Line 1 of the body.");
    expect(stored).toContain(`Line ${String(LINES)} of the body.`);
    expect(stored).toContain(`${appended}one two three four five six.`);

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});

test.describe("XS-65 — a conflict resolution that itself fails leaves the file untouched", () => {
  // @verifies XS-65
  /**
   * Transcribed from flow-cross-surface.md XS-65.
   *
   * The whole point of this case over TSK-48 (a failing *first* write)
   * is that the write which fails is the **resolution** of a conflict
   * the user is standing in front of, and that a failed resolution
   * must not leave a half-merged body behind. So the failure is
   * injected as a *real* filesystem write failure — the task directory
   * is made read-only, so core's atomic temp-write + rename in that
   * directory throws EACCES — rather than a mocked HTTP 500. That is
   * what actually exercises the byte-unchanged guarantee: the server
   * runs, attempts the write, and the atomic-write's temp file never
   * makes it into `task.md`. A route-mocked 500 would leave the file
   * unchanged trivially, because the server never touched it.
   *
   * Verified by scratch harness while writing: POST /api/tasks/:key/body
   * against a chmod 0o555 task dir returns 500 `io_failed`
   * (data_state: not_saved, path named), and task.md is byte-for-byte
   * identical afterward.
   *
   * Mutation shown to fail: replace `writeFileAtomically`'s
   * temp-file+rename (packages/core/src/utils/atomic-yaml.ts) with a
   * direct `writeFile(path, contents)` and the byte-unchanged
   * assertion goes red — a direct write truncates `task.md` to zero
   * before the permission error fires, so the file is left mangled.
   * The atomicity is the mechanism under test, and that is the edit
   * that removes it.
   */
  test("XS-65: a resolution write that fails on disk leaves task.md byte-for-byte unchanged", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));

    const key = onlyKey(await tracker.seed([{ title: "Conflict then fail" }]));
    await tracker.run(["body", key, "--set", "Theirs on disk.\n"]);

    await page.goto(`${tracker.baseURL}/tasks/${key}`);
    await expect(page.getByTestId("body-editor")).toBeVisible();
    await typeInBody(page, "Mine in the editor.");

    // Force the XS-12 conflict: the CLI rewrites the same body the
    // editor holds a stale token for.
    await tracker.run(["body", key, "--set", "Their newer text.\n"]);
    const dialog = page.getByTestId("body-conflict");
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Snapshot the exact bytes on disk now, before any resolution is
    // attempted. This is what must survive a failed resolution.
    const beforeBytes = await rawTaskFile(tracker.root, key);
    expect(beforeBytes).toContain("Their newer text.");

    // Make the resolution write fail for real: the task directory
    // goes read-only, so the atomic write's temp file cannot be
    // created there and the rename never happens.
    const taskDir = await taskDirOf(tracker.root, key);
    await chmod(taskDir, 0o555);
    try {
      // "Keep mine" → Apply. The resolution write leaves (resolve()
      // clears the conflict ref synchronously, so it is not the
      // suppressed-while-open kind), reaches the server, and fails on
      // the filesystem.
      await page.getByTestId("conflict-choice-mine").click();
      await page.getByTestId("conflict-apply").click();

      // The failure is explicit: not "saved", and it says the text was
      // not saved and names the path (both from the server's io_failed
      // envelope).
      await expect(indicator(page)).toHaveAttribute("data-state", "failed", { timeout: 8000 });
      await expect(indicator(page)).toContainText("not been saved");
      await expect(indicator(page)).toContainText("task.md");

      // The editor's content survives so the user can retry or copy it
      // out (XS-65 bullet 3).
      await expect(
        page.getByTestId("body-editor").getByTestId("rich-editor"),
      ).toContainText("Mine in the editor.");
      // And a way back is offered.
      await expect(page.getByTestId("save-retry")).toBeVisible();
    } finally {
      // Restore permissions no matter what, so teardown can clean up.
      await chmod(taskDir, 0o755);
    }

    // XS-65 bullet 1, the headline: the file on disk is byte-for-byte
    // what it was before the doomed resolution — no half-merged body.
    expect(await rawTaskFile(tracker.root, key)).toBe(beforeBytes);

    // XS-65 bullet 4: the surface "can be re-entered; it does not
    // vanish leaving the user with no way back to their text." A failed
    // *io* resolution (500), unlike a dismissed conflict, holds the
    // editor in the failed state with its Retry — that is the route
    // back. Prove it is still live *while the write still fails*: with
    // the directory read-only again, clicking Retry re-attempts and
    // lands back in the same explicit failed state, the text intact —
    // rather than silently succeeding or dropping to a dead page.
    await chmod(taskDir, 0o555);
    try {
      await page.getByTestId("save-retry").click();
      await expect(indicator(page)).toHaveAttribute("data-state", "failed", { timeout: 8000 });
      await expect(indicator(page)).toContainText("not been saved");
      await expect(page.getByTestId("save-retry")).toBeVisible();
      await expect(
        page.getByTestId("body-editor").getByTestId("rich-editor"),
      ).toContainText("Mine in the editor.");
    } finally {
      await chmod(taskDir, 0o755);
    }
    // Still byte-unchanged after the second failed attempt.
    expect(await rawTaskFile(tracker.root, key)).toBe(beforeBytes);

    expect(pageErrors, `unexpected page errors:\n${pageErrors.join("\n")}`).toEqual([]);
  });
});
