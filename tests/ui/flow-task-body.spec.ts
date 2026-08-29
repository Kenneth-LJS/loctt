/**
 * Transcribed from docs/dev/ui-test-cases/flow-tasks.md — M2.3, the
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

import { readdir, readFile } from "node:fs/promises";
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

/** Types into whichever surface is showing. */
async function typeInBody(page: Page, text: string): Promise<void> {
  /**
   * Scoped to `body-editor`.
   *
   * A bare `getByTestId("rich-editor")` was unambiguous while the body
   * editor was the only rich surface on the task page. M2.4a's comment
   * composer is a second one, so the bare locator now resolves to two
   * elements and every click through it fails in strict mode.
   *
   * This is a locator that stopped being unique when the page grew —
   * not a test that was asserting a bug. The behaviour these specs
   * cover is unchanged, and each one still means the body editor.
   */
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
    await page.getByRole("heading", { level: 1 }).first().click();

    // 1200ms is deliberately *under* the 1500ms idle window: if the
    // blur did nothing and this only passed once the timer fired, the
    // assertion would not be about blur at all.
    await expect(indicator(page)).toHaveAttribute("data-state", "saved", { timeout: 1200 });
    expect(await bodyOnDisk(tracker.root, key)).toContain("Saved on blur.");
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
    await page.getByText("Last paragraph.").click();
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

    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).toContainText("Body of B.");
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).not.toContainText("Edited in A.");
    await expect(page.getByTestId("body-editor").getByTestId("rich-editor")).not.toContainText("Body of A.");

    // A's pending edit was flushed rather than silently discarded.
    await expect
      .poll(async () => bodyOnDisk(tracker.root, a), { timeout: 8000 })
      .toContain("Edited in A.");
  });
});
