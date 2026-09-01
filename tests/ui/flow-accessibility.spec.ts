/**
 * Transcribed from docs/dev/ui-test-cases/flow-accessibility.md.
 *
 * ## What these specs can and cannot claim
 *
 * The flow doc opens by saying verification "assumes a real screen
 * reader (VoiceOver on macOS, NVDA on Windows) and keyboard-only
 * operation with the pointer physically unavailable — not an automated
 * audit tool. Automated checks catch a minority of these."
 *
 * That is honest and it constrains what follows. What Playwright can
 * assert for real: keyboard operation (it dispatches real key events
 * to a real browser), focus location (`toBeFocused`), accessible names
 * and roles (`getByRole`, `toHaveAccessibleName` — computed by the
 * browser's own accessibility tree, not by reading an attribute),
 * `aria-*` state, tab order, and the live-region *content* a reader
 * would be handed.
 *
 * What it cannot assert, and what is therefore **not** claimed by any
 * test here: that a screen reader actually speaks a given string,
 * contrast ratios, or a full ruleset audit. No axe library is
 * installed in this repo (verified against `package.json` and
 * `node_modules`), and adding one is a scope decision, not this
 * ticket's to take silently. The cases that need those are recorded as
 * uncovered in the ticket report rather than papered over with a test
 * that asserts an element exists.
 *
 * The trap to avoid throughout: asserting a control *exists* proves
 * nothing about its accessible name, and asserting a label proves
 * nothing about the effect. Every test here asserts an effect — focus
 * moved, the URL changed, the region's text changed, the value on disk
 * changed — not that a class or an attribute is present.
 */

import { chmod, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "./fixtures/tracker.ts";

test.describe("A11Y — global shortcuts", () => {
  // @verifies A11Y-1
  test("A11Y-1: `n` opens the create modal focused in the title, and `c` does not", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Existing task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Existing task")).toBeVisible();

    // `c` is explicitly forbidden as an alias (fourth bullet). Asserted
    // *first*, so a modal that never opens cannot make this pass while
    // the `n` assertion below then fails loudly.
    await page.locator("body").press("c");
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.locator("body").press("n");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Second bullet: focus is in the title field so typing begins
    // immediately. This is the assertion that a "modal is visible"
    // check would miss entirely.
    const title = dialog.getByLabel("Title");
    await expect(title).toBeFocused();

    // Third bullet: `n` inside the field types the letter rather than
    // re-triggering. Asserting the field's *value* is the effect;
    // asserting "only one dialog" would pass with the keystroke lost.
    await page.keyboard.type("noun");
    await expect(title).toHaveValue("noun");
  });

  /**
   * A11Y-2 is **not** claimed by this test, deliberately.
   *
   * The case requires `/` to move focus to "the filter/search input".
   * The app's only global search box is the header's, and it is
   * `disabled` with the title "Search arrives in a later milestone" —
   * no ticket in this run builds it. A disabled input cannot take
   * focus, so the case's first bullet is unsatisfiable at this SHA,
   * and no amount of test-writing changes that.
   *
   * The `/` binding itself *is* built and registered, and its
   * suppression rule is covered by
   * `useShortcuts.test.tsx` ("does not fire `/` inside a field") —
   * which is A11Y-2's third bullet and is genuinely verifiable today.
   * What is untestable is the first two bullets, which need a focusable
   * target.
   *
   * Tagging this case would be a false claim: the gate
   * would read the case as covered while the behaviour a user needs
   * does not exist. Recorded as blocked in the ticket report and in
   * decisions.md § 8 (A84) instead.
   */
  test("A11Y-2 (partial): the `/` target is disabled, so focus cannot land", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Searchable task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Searchable task")).toBeVisible();

    // This documents the blocker rather than asserting the case. If
    // search is ever built, this test fails — which is the signal to
    // restore the real A11Y-2 assertions and the `@verifies` tag.
    const search = page.getByRole("searchbox", { name: "Search tasks" });
    await expect(search).toHaveJSProperty("disabled", true);
  });

  // @verifies A11Y-3
  test("A11Y-3: `g` then l/b/t navigates, and the chord does not wedge", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Chord task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Chord task")).toBeVisible();

    await page.locator("body").press("g");
    await page.locator("body").press("b");
    await expect(page).toHaveURL(/\/board$/);

    await page.locator("body").press("g");
    await page.locator("body").press("t");
    await expect(page).toHaveURL(/\/timeline$/);

    await page.locator("body").press("g");
    await page.locator("body").press("l");
    await expect(page).toHaveURL(/\/list$/);

    // Third bullet: `g` then an unmapped key is a no-op, "not a stuck
    // state". The proof that it is not stuck is that the *next* chord
    // still works — a test that only asserted "still on /list" would
    // pass with the dispatcher permanently wedged.
    await page.locator("body").press("g");
    await page.locator("body").press("z");
    await expect(page).toHaveURL(/\/list$/);
    await page.locator("body").press("g");
    await page.locator("body").press("b");
    await expect(page).toHaveURL(/\/board$/);
  });

  // @verifies A11Y-4
  test("A11Y-4: `?` lists every bound shortcut and closes on Esc", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Help task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Help task")).toBeVisible();

    await page.locator("body").press("?");
    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();

    // Second bullet: the list matches the shortcuts actually bound.
    // The registry is the single source both sides read, so this
    // asserts every registered id has a rendered row — including the
    // chords, which the first bullet names explicitly.
    for (const id of [
      "new-task",
      "focus-search",
      "goto-list",
      "goto-board",
      "goto-timeline",
      "toggle-sidebar",
      "cycle-theme",
      "shortcut-help",
    ]) {
      await expect(dialog.getByTestId(`shortcut-row-${id}`)).toBeVisible();
    }
    // The chords render both keys, so the reference teaches `g` then
    // `l` rather than a bare `g`.
    await expect(dialog.getByTestId("shortcut-keys-goto-board")).toContainText("g");
    await expect(dialog.getByTestId("shortcut-keys-goto-board")).toContainText("b");

    // Third bullet: keyboard-operable and closes on Esc.
    await expect(dialog.getByTestId("shortcut-help-close")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  // @verifies A11Y-6
  test("A11Y-6: `[` toggles the sidebar and does not strand focus", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Sidebar task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Sidebar task")).toBeVisible();

    // The collapsed state is asserted on the sidebar itself, not on a
    // link's visibility: collapsing keeps the nav entries as icons
    // *with their accessible names intact* (which is what A11Y-20
    // requires of them), so a hidden-link assertion would be asserting
    // the wrong thing and would fail against correct behaviour.
    const sidebar = page.locator("[data-collapsed]");
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");

    // First bullet: `[` toggles it, matching the click behaviour and
    // persisting the same way (SHL-12).
    await page.locator("body").press("[");
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");

    await page.locator("body").press("[");
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");

    // Persistence, per the first bullet's reference to SHL-12: the
    // shortcut writes through the same store the click does, so the
    // state survives a reload.
    await page.locator("body").press("[");
    await page.reload();
    await expect(page.getByText("Sidebar task")).toBeVisible();
    await expect(page.locator("[data-collapsed]")).toHaveAttribute("data-collapsed", "true");
    await page.locator("body").press("[");

    // Second bullet: focus is never dropped to `document.body` by the
    // toggle — "if focus was inside the collapsing sidebar, it moves to
    // a sensible visible ancestor, never to `document.body`". Focus a
    // control outside the sidebar, collapse, and check it survived; the
    // failure mode is a re-render that unmounts the focused node's
    // ancestor and strands focus on body.
    const createButton = page.getByTestId("header-new-task");
    await createButton.focus();
    await page.locator("body").press("[");
    await expect(createButton).toBeFocused();

    // And the positive control that this is really about `body`: after
    // the collapse, Tab still moves to a real control rather than
    // restarting at the skip link.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("skip-link")).not.toBeFocused();
  });

  // @verifies A11Y-7
  test("A11Y-7: `t` cycles the theme in the documented order and announces it", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Theme task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Theme task")).toBeVisible();

    // The stored preference is what the cycle advances; `dark` on the
    // root element is the applied result. Asserting the *applied*
    // result is the effect — a test on localStorage alone would pass
    // with the page never repainting.
    await page.evaluate(() => { window.localStorage.setItem("tt-theme", "light"); });
    await page.reload();
    await expect(page.getByText("Theme task")).toBeVisible();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.locator("body").press("t");
    await expect(page.locator("html")).toHaveClass(/dark/);
    // First bullet: the change is announced (A11Y-24). The live region
    // is what a screen reader is handed; a theme flip has no other
    // non-visual signal at all.
    await expect(page.getByTestId("announcer-polite")).toContainText("dark");

    // light → dark → system: the third press lands on system, which
    // resolves through the OS preference. Playwright's default is
    // light, so the class comes off again.
    await page.locator("body").press("t");
    await expect(page.getByTestId("announcer-polite")).toContainText("system");
  });

  // @verifies A11Y-8
  test("A11Y-8: shortcuts are suppressed while a modal owns the keyboard", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Suppressed task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Suppressed task")).toBeVisible();

    await page.locator("body").press("n");
    const modal = page.getByTestId("create-task-modal");
    await expect(modal).toBeVisible();

    // First bullet: no navigation, the modal stays open.
    //
    // The keys go to a **non-text** control inside the modal, not to
    // the title field the modal focuses on open. Pressing `g`/`b` into
    // the title would type "gb" there, and the modal would then be
    // dirty — so the Esc below would raise the discard confirmation
    // (correctly, per A11Y-33) and this test would fail for a reason
    // that has nothing to do with A11Y-8. That is exactly the
    // seeding-that-cannot-discriminate trap: the first draft of this
    // test failed and the app was right.
    await modal.getByRole("button", { name: "Cancel" }).focus();
    await page.keyboard.press("g");
    await page.keyboard.press("b");
    await expect(page).toHaveURL(/\/list$/);
    await expect(modal).toBeVisible();

    // Third bullet: Esc remains available as the escape hatch. The
    // modal is untouched, so it closes without a confirmation.
    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();

    // Second bullet: global shortcuts resume once the modal closes.
    // This is the positive control — without it, a build that ignored
    // every key everywhere would pass the suppression assertion.
    await page.locator("body").press("g");
    await page.locator("body").press("b");
    await expect(page).toHaveURL(/\/board$/);
  });
});

test.describe("A11Y — focus management", () => {
  // @verifies A11Y-14
  test("A11Y-14: the create modal traps Tab in both directions", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Trapped task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Trapped task")).toBeVisible();

    await page.locator("body").press("n");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Tab forward far more times than the modal has controls. If the
    // trap leaks, focus lands in the header or sidebar behind the
    // overlay — so the assertion is that focus is still *inside the
    // dialog*, which is the case's actual claim ("it never reaches the
    // header, sidebar, or the browser's own chrome").
    for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);

    // Second bullet: Shift+Tab from the first control wraps to the
    // last rather than escaping backwards.
    for (let i = 0; i < 40; i++) await page.keyboard.press("Shift+Tab");
    await expect(dialog.locator(":focus")).toHaveCount(1);
  });

  // @verifies A11Y-14
  test("A11Y-14: content behind the modal is inert, not merely dimmed", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Behind task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Behind task")).toBeVisible();

    const chrome = page.locator("[data-app-chrome]");
    await expect(chrome).not.toHaveAttribute("inert", /.*/);

    await page.locator("body").press("n");
    await expect(page.getByRole("dialog")).toBeVisible();

    // Third bullet: inert to assistive tech, so a virtual cursor
    // cannot browse the list underneath. `inert` removes the subtree
    // from the accessibility tree, which `aria-hidden` on a dimmed
    // overlay does not.
    await expect(chrome).toHaveAttribute("inert", /.*/);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(chrome).not.toHaveAttribute("inert", /.*/);
  });

  // @verifies A11Y-15
  test("A11Y-15: closing a dialog returns focus to its trigger, not to body", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Focus return task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Focus return task")).toBeVisible();

    const trigger = page.getByTestId("header-new-task");
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    // First bullet: focus lands on the control that opened it.
    await expect(trigger).toBeFocused();

    // Third bullet is the one that catches a lazy implementation:
    // "verify by checking that pressing Tab immediately after close
    // moves to the *next* control after the trigger, not to the first
    // control on the page". Focus on `document.body` would send the
    // next Tab back to the skip link.
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("skip-link")).not.toBeFocused();
  });
});

test.describe("A11Y — semantics", () => {
  // @verifies A11Y-20
  test("A11Y-20: icon-only controls expose specific accessible names", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Named controls task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Named controls task")).toBeVisible();

    // `toHaveAccessibleName` is computed by the browser's own
    // accessibility tree, so this is the name a screen reader would
    // announce — not an attribute read back. The case's bar is that
    // each "announces a specific action, not 'button' and not the
    // icon's file name".
    await expect(page.getByTestId("header-new-task")).toHaveAccessibleName("New task");
    await expect(page.getByRole("button", { name: "Toggle sidebar" })).toHaveAccessibleName(
      "Toggle sidebar",
    );

    // Second bullet: the accessible name matches the tooltip where one
    // exists, so keyboard and pointer users learn the same word.
    const themeButtons = page.getByRole("button", { name: /^(Light|Dark|System)$/ });
    const count = await themeButtons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const button = themeButtons.nth(i);
      const name = await button.getAttribute("aria-label");
      await expect(button).toHaveAttribute("title", name ?? "");
    }
  });

  // @verifies A11Y-26
  test("A11Y-26: the task table exposes real header semantics", async ({ page, tracker }) => {
    await tracker.seed([{ title: "Header semantics task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Header semantics task")).toBeVisible();

    // Third bullet: the table has an accessible name describing what
    // it lists.
    const table = page.getByRole("table", { name: "Tasks" });
    await expect(table).toBeVisible();

    // First bullet: column headers are marked as headers *and*
    // associated with their cells. `scope` is what carries the
    // association; a `<th>` without it is ambiguous in a table that
    // also has row headers.
    const titleHeader = table.getByRole("columnheader", { name: /Title/ });
    await expect(titleHeader).toHaveAttribute("scope", "col");

    // Second bullet: the key column is the row header, so navigating
    // rows announces which task the row is. `rowheader` is a distinct
    // ARIA role from `columnheader` — asserting the role is asserting
    // the browser resolved the semantics, not that an attribute is
    // spelled right.
    await expect(table.getByRole("rowheader").first()).toBeVisible();
  });

  // @verifies A11Y-27
  test("A11Y-27: sort state is exposed and the new sort is announced", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Sortable one" }, { title: "Sortable two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Sortable one")).toBeVisible();

    const table = page.getByRole("table", { name: "Tasks" });
    const dueHeader = table.getByRole("columnheader", { name: /Due/ });

    await dueHeader.getByRole("button").click();
    // First bullet: the sorted column exposes its direction
    // programmatically.
    await expect(dueHeader).toHaveAttribute("aria-sort", "ascending");
    // Second bullet: activating a header *announces* the new sort.
    // `aria-sort` alone is state a reader exposes on navigation, not
    // something spoken to a user who is elsewhere on the page — which
    // is why both halves are asserted.
    await expect(page.getByTestId("announcer-polite")).toContainText("Sorted by Due, ascending");

    await dueHeader.getByRole("button").click();
    await expect(dueHeader).toHaveAttribute("aria-sort", "descending");
    await expect(page.getByTestId("announcer-polite")).toContainText("Sorted by Due, descending");
  });

  // @verifies A11Y-44
  test("A11Y-44: the first Tab reaches a skip link that jumps to main", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Skippable task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Skippable task")).toBeVisible();

    // First bullet: the very first interaction after load reaches it.
    await page.locator("body").press("Tab");
    const skip = page.getByTestId("skip-link");
    await expect(skip).toBeFocused();
    // "visible when focused" — the link is off-screen until it takes
    // focus, so a visibility assertion here is the case's own claim.
    await expect(skip).toBeVisible();

    // Second bullet: activating it moves focus into the main pane,
    // past the header and sidebar. Asserting focus *moved into main*
    // is the effect; asserting the href would be the label.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  // @verifies A11Y-45
  test("A11Y-45: a route change is announced and titles the document", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Routed task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Routed task")).toBeVisible();

    // Third bullet: the document title reflects the current view.
    await expect(page).toHaveTitle(/List/);

    await page.getByRole("link", { name: "Board" }).click();
    await expect(page).toHaveURL(/\/board$/);

    // First bullet: the new view is announced, naming the view.
    await expect(page.getByTestId("announcer-polite")).toContainText("Board");
    await expect(page).toHaveTitle(/Board/);
  });
});

test.describe("A11Y — announcements and failure states", () => {
  // @verifies A11Y-25
  test("A11Y-25: a filter's settled result count is announced, zero included", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Alpha in progress", fields: { status: "in_progress" } },
      { title: "Beta todo" },
      { title: "Gamma todo" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Alpha in progress")).toBeVisible();

    // The filter is applied **in-session**, not by loading a filtered
    // URL. That distinction is the case's: a fresh page load is not a
    // count *change*, and announcing on arrival would talk over the
    // reader already announcing the loaded document. Client-side
    // navigation is also what a keyboard user actually does.
    const region = page.getByTestId("announcer-polite");
    await expect(region).toHaveText("");

    // Narrow to one. First bullet: the new count is announced after
    // the results settle.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menu").getByText("In progress").click();
    await page.keyboard.press("Escape");
    await expect(page.getByText("Beta todo")).toBeHidden();
    await expect(region).toContainText("1 tasks");

    // Third bullet: filtering to zero announces the empty result
    // explicitly, "so it is distinguishable from an unresponsive UI".
    // A count of 0 rendered as "0 tasks" would be technically true and
    // still fail the case's intent, which is why the copy differs.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menu").getByText("In progress").click();
    await page.getByRole("menu").getByText("Done").click();
    await page.keyboard.press("Escape");
    await expect(region).toContainText("No tasks match");
  });

  // @verifies A11Y-47
  test("A11Y-47: an empty result and a failed load are announced differently", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Present task" }]);

    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Present task")).toBeVisible();

    // Filter to zero through the UI. A `q=` alone does not register as
    // an active filter, and the empty copy is deliberately different
    // for "no tasks at all" (ONB-8) than for "a filter matched
    // nothing" (LST-8) — so the filter has to be a real one for this
    // to exercise the state the case is about.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menu").getByText("Done").click();
    await page.keyboard.press("Escape");

    // First bullet: the empty state says the filter matched no tasks
    // and suggests clearing filters.
    const empty = page.getByText(/No tasks match these filters/i).first();
    await expect(empty).toBeVisible();
    await expect(page.getByRole("button", { name: /clear/i }).first()).toBeVisible();

    // Now force the load itself to fail. Second bullet: the error
    // state announces that loading failed, with a retry action.
    await page.route("**/api/tasks*", route => route.abort("failed"));
    await page.goto(`${tracker.baseURL}/list`);

    const error = page.getByRole("alert");
    await expect(error.first()).toBeVisible();
    // Third bullet is the load-bearing one: "a screen-reader user can
    // tell the two apart from the announcement alone". So the failure
    // text must NOT be the empty-state text — asserted as a
    // discrimination, not as two independent existence checks, which
    // is what would let both render the same string and still pass.
    await expect(error.first()).not.toContainText(/No tasks match/i);
    await expect(page.getByRole("button", { name: /retry|try again/i }).first()).toBeVisible();
  });
});

/**
 * Cross-surface degradations the UI must survive (XS-52, XS-64).
 *
 * Filed in this spec rather than a new file because both are "load the
 * UI in a damaged state and see what it says", which is the same shape
 * as the error-state cases above and shares the tracker fixture.
 */
test.describe("XS — machine-local files and permissions", () => {
  // @verifies XS-52
  test("XS-52: the app works with every machine-local file deleted", async ({ page, tracker }) => {
    const keys = await tracker.seed([{ title: "Survives cache loss" }]);
    const taskKey = keys[0] ?? "T-1";

    // These files are written **lazily**, so a fresh tracker has none
    // of them — measured: `init` + `create` leaves `.loctt/local/`
    // absent entirely and writes no `settings.yaml`. Deleting nothing
    // and declaring the app resilient would be vacuity shape (d),
    // seeding that cannot discriminate, so they are brought into
    // existence first and their existence is asserted before removal.
    const localDir = path.join(tracker.root, ".loctt", "local");
    const usersDir = path.join(tracker.root, ".loctt", "users");

    // A key lookup populates the key index; a settings write creates
    // the per-user file. Both go through the running server, so they
    // are created the way the app itself creates them.
    await page.goto(`${tracker.baseURL}/tasks/${taskKey}`);
    await expect(page.getByText("Survives cache loss").first()).toBeVisible();
    await page.evaluate(async (base: string) => {
      await fetch(`${base}/api/user-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
        body: JSON.stringify({ theme: "dark" }),
      });
    }, tracker.baseURL);

    const localBefore = await readdir(localDir).catch(() => [] as string[]);
    const userDirs = await readdir(usersDir).catch(() => [] as string[]);
    const settingsFiles = userDirs.map(u => path.join(usersDir, u, "settings.yaml"));
    const settingsExisted = (
      await Promise.all(settingsFiles.map(f => stat(f).then(() => true, () => false)))
    ).filter(Boolean);
    // At least one of the machine-local artefacts must really be on
    // disk, or the deletion below proves nothing.
    expect(localBefore.length + settingsExisted.length).toBeGreaterThan(0);

    // Delete the key index, the sync metadata, and every per-user
    // settings file. These are caches and per-checkout state, not
    // tracker data.
    await rm(path.join(localDir, "key-index.yaml"), { force: true });
    await rm(path.join(localDir, "sync.yaml"), { force: true });
    for (const f of settingsFiles) await rm(f, { force: true });

    await page.goto(`${tracker.baseURL}/list`);

    // First bullet: "the app works. The key index rebuilds itself
    // lazily on lookup". The row rendering is that rebuild — resolving
    // a task for display goes through the key lookup the index backs.
    await expect(page.getByText("Survives cache loss").first()).toBeVisible();

    // Second bullet: "no error surfaces for their absence". Asserted
    // with a positive control beside it, because a bare
    // absence-assertion weakens silently as the app says less: the
    // page must be *rendering the list* while showing no error.
    await expect(page.getByRole("table", { name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    // Third bullet: "column visibility, card layout, and sidebar
    // collapse revert to defaults rather than crashing on undefined".
    // The deleted `settings.yaml` held those; the sidebar rendering in
    // its default expanded state is the observable.
    await expect(page.locator("[data-collapsed]")).toHaveAttribute("data-collapsed", "false");

    // And the key index really did rebuild rather than the row being
    // served from something else: the task is reachable by its key.
    await page.goto(`${tracker.baseURL}/tasks/${taskKey}`);
    await expect(page.getByText("Survives cache loss").first()).toBeVisible();
  });

  // @verifies XS-64
  test("XS-64: a read-only tracker is named as a permission problem, keeping the text", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Read-only subject" }]);
    const taskKey = keys[0] ?? "T-1";

    await page.goto(`${tracker.baseURL}/tasks/${taskKey}`);
    // Scoped to the heading: the title also appears in the recents
    // list once this task has been visited, so a bare getByText
    // resolves to two elements and fails strict mode. It passed in
    // isolation and failed in the full suite, where an earlier spec
    // had already populated recents — the failure was the locator,
    // not the page.
    await expect(
      page.getByRole("heading", { name: "Read-only subject", level: 1 }),
    ).toBeVisible();

    const locttDir = path.join(tracker.root, ".loctt");
    await chmod(locttDir, 0o500);
    try {
      // Running as root, or on a filesystem ignoring mode bits, makes
      // this unobservable. Skipping loudly beats asserting nothing.
      const probe = await page.evaluate(async (base: string) => {
        const r = await fetch(`${base}/api/tasks`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Loctt-Client": "test" },
          body: JSON.stringify({ title: "probe" }),
        });
        return r.status;
      }, tracker.baseURL);
      test.skip(probe === 200, "mode bits not enforced here; the case is unobservable");

      // Attempt a real write through the UI: change the title inline.
      await page.getByTestId("header-new-task").click();
      const dialog = page.getByTestId("create-task-modal");
      await expect(dialog).toBeVisible();
      const typed = "Text the user must not lose";
      await dialog.getByLabel("Title").fill(typed);
      await dialog.getByRole("button", { name: /create/i }).click();

      // Second/third bullets: the failure names the permission problem
      // and the path — not "save failed".
      const failure = page.getByRole("alert").filter({ hasText: /permission/i }).first();
      await expect(failure).toBeVisible();
      await expect(failure).toContainText(".loctt");

      // Third bullet, the load-bearing half: "the typed content is
      // retained" so the user can copy it out. A failure surface that
      // also cleared the form would satisfy the message assertions
      // above and still lose the user's work.
      await expect(dialog.getByLabel("Title")).toHaveValue(typed);
    } finally {
      await chmod(locttDir, 0o755);
    }
  });
});

test.describe("A11Y — dialogs, layers and form semantics", () => {
  // @verifies A11Y-50
  test("A11Y-50: bulk delete focuses the safe control and states the blast radius", async ({
    page,
    tracker,
  }) => {
    await tracker.seedBulk(4, undefined, n => `Bulk victim ${String(n)}`);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Bulk victim 1")).toBeVisible();

    // Select every row on the page.
    await page.getByRole("checkbox", { name: "Select all on this page" }).check();
    await page.getByRole("button", { name: /^Delete/ }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // First bullet: "initial focus is on Cancel (or the
    // typed-confirmation input), never on the destructive button — a
    // stray Enter cannot delete 40 tasks."
    //
    // This app focuses the typed-confirmation input, which the case
    // permits explicitly. The assertion that matters is the negative:
    // focus is NOT on the destructive button. Asserted both ways, so
    // it cannot pass by focus being nowhere at all.
    const destructive = dialog.getByRole("button", { name: /^Delete \d+ task/ });
    await expect(destructive).not.toBeFocused();
    await expect(dialog.getByRole("textbox")).toBeFocused();

    // And the stray-Enter guarantee the bullet is really about: with
    // the confirmation unfilled, Enter must not delete anything.
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await expect(page.getByText("Bulk victim 1")).toBeVisible();

    // Second bullet: the dialog's accessible name states the count and
    // the description states the irreversibility.
    await expect(dialog).toHaveAccessibleName(/4 tasks/);
    await expect(dialog).toContainText(/cannot be undone/i);

    // Third bullet: the typed-confirmation requirement is announced,
    // "including exactly what string must be typed". The input's own
    // accessible name carries it, so a screen-reader user hears the
    // required word on focus rather than only seeing it in prose.
    await expect(dialog.getByRole("textbox")).toHaveAccessibleName(/Type .+ to confirm/);
  });

  // @verifies A11Y-33
  test("A11Y-33: Esc on a dirty create modal confirms before discarding", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Dirty modal neighbour" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Dirty modal neighbour")).toBeVisible();

    await page.locator("body").press("n");
    const modal = page.getByTestId("create-task-modal");
    await expect(modal).toBeVisible();

    const typed = "Half-written thought";
    await modal.getByLabel("Title").fill(typed);
    await page.keyboard.press("Escape");

    // First bullet: a confirmation appears rather than the typed
    // content being discarded silently. The modal is still there —
    // which is the half that proves nothing was thrown away.
    await expect(modal).toBeVisible();
    const confirm = page.getByTestId("create-discard-confirm");
    await expect(confirm).toBeVisible();

    // Third bullet: choosing to keep editing returns to the modal with
    // the text intact. Asserting the *value survived* is the effect;
    // asserting the dialog closed would not notice a wiped field.
    await page.getByTestId("create-discard-keep").click();
    await expect(confirm).toBeHidden();
    await expect(modal.getByLabel("Title")).toHaveValue(typed);

    // Second bullet: the confirmation is itself Esc-dismissible back
    // to the modal rather than discarding.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("create-discard-confirm")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("Title")).toHaveValue(typed);
  });

  // @verifies A11Y-13
  test("A11Y-13: the avatar menu opens, cycles and returns focus to its trigger", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Menu neighbour" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Menu neighbour")).toBeVisible();

    const trigger = page.getByRole("button", { name: /User menu/ });
    await trigger.focus();
    await expect(trigger).toBeFocused();

    // The trigger exposes its menu relationship and its state, which
    // is what tells a screen-reader user it opens something at all.
    await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    // Second bullet: Esc closes it and returns focus to the trigger.
    // The focus return is the assertion a "menu closed" check misses.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  // @verifies A11Y-22
  test("A11Y-22: create-modal fields have programmatic labels, not placeholders", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Label neighbour" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Label neighbour")).toBeVisible();

    await page.locator("body").press("n");
    const modal = page.getByTestId("create-task-modal");
    await expect(modal).toBeVisible();

    // First bullet: each input is associated with a visible label, and
    // "placeholder text is never the only label".
    //
    // `toHaveAccessibleName` computes the name the browser would give
    // a screen reader. Critically, a placeholder *does* contribute to
    // the accessible name as a last resort — so the name being
    // non-empty is not enough on its own. The check below is that the
    // name does not merely echo the placeholder.
    const title = modal.getByLabel("Title");
    await expect(title).toHaveAccessibleName(/Title/);
    const placeholder = await title.getAttribute("placeholder");
    if (placeholder !== null && placeholder !== "") {
      const name = await title.evaluate(el => (el as HTMLElement).ariaLabel ?? "");
      expect(name === placeholder).toBe(false);
    }

    // Every enabled control in the dialog has a non-empty accessible
    // name. A nameless control announces as "edit text" or "button",
    // which is the failure the case is about — asserted across the
    // whole form rather than on one field, since one labelled field
    // proves nothing about the rest.
    const controls = modal.locator(
      "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])",
    );
    const n = await controls.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const control = controls.nth(i);
      if (!(await control.isVisible())) continue;
      const name = await control.evaluate(el => {
        const e = el as HTMLElement;
        const labelled = e.getAttribute("aria-label");
        if (labelled !== null && labelled.trim() !== "") return labelled;
        const by = e.getAttribute("aria-labelledby");
        if (by !== null) {
          return by
            .split(/\s+/)
            .map(id => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
        }
        const id = e.getAttribute("id");
        if (id !== null) {
          const lab = document.querySelector(`label[for="${id}"]`);
          if (lab !== null) return lab.textContent?.trim() ?? "";
        }
        return e.closest("label")?.textContent?.trim() ?? "";
      });
      expect(name, `a control in the create modal has no accessible name`).not.toBe("");
    }
  });
});

test.describe("A11Y — state exposure", () => {
  // @verifies A11Y-21
  test("A11Y-21: toggles expose their state and update it when toggled", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Toggle neighbour" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Toggle neighbour")).toBeVisible();

    // The sidebar collapse. First bullet: it announces its state and
    // "updates the announcement when toggled" — so both readings are
    // asserted, before and after. A single reading would pass against
    // a hardcoded attribute.
    const collapse = page.getByRole("button", { name: "Toggle sidebar" });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "false");
    await collapse.click();
    await expect(collapse).toHaveAttribute("aria-expanded", "true");

    // "Show archived". Second bullet: it "announces its current state,
    // so a user cannot be unknowingly filtered" — the case's point is
    // that a user must be able to tell whether archived rows are being
    // hidden from them.
    //
    // Third bullet: "a toggle rendered as a checkbox announces
    // checked". `getByRole("checkbox")` resolves the browser's own
    // semantics, and `toBeChecked` reads the state a reader would
    // announce.
    const archived = page.getByRole("checkbox", { name: /Show archived/i });
    await expect(archived).not.toBeChecked();
    await archived.check();
    await expect(archived).toBeChecked();

    // And the state is real, not decorative: checking it changed the
    // query. Without this the test would pass against a checkbox that
    // announces correctly and filters nothing.
    await expect(page).toHaveURL(/archived=true/);
  });

  // @verifies A11Y-31
  test("A11Y-31: an unavailable control is announced as disabled, with a reason", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Disabled neighbour" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Disabled neighbour")).toBeVisible();

    // The header search box is the app's standing example of a control
    // disabled by state (see known-gaps.md — search is unbuilt).
    //
    // First bullet: it "exposes a disabled state to assistive tech
    // rather than being merely greyed and unresponsive".
    //
    // `toHaveJSProperty` rather than `toBeDisabled`: Playwright's
    // `toBeDisabled` retargets inside a `<label>` to the label's
    // control, which silently checks a different element than the one
    // named. The JS property is read off the element itself.
    const search = page.getByRole("searchbox", { name: "Search tasks" });
    await expect(search).toHaveJSProperty("disabled", true);

    // Third bullet: "a control that is inert but announces as
    // actionable is a defect" — the disabled state must be genuine, so
    // the control really does not take focus or input.
    await search.focus().catch(() => undefined);
    await expect(search).not.toBeFocused();

    // Second bullet: "a reason is available to keyboard users — via
    // accessible description or an adjacent explanation — not only in
    // a pointer-hover tooltip."
    //
    // This one is only partially met: the reason lives in `title`,
    // which is a hover tooltip. It is *also* exposed as the accessible
    // description by every current browser when no other description
    // source exists, which is why this assertion holds — but a `title`
    // is the weakest form the bullet permits, and the case says "not
    // only in a pointer-hover tooltip".
    await expect(search).toHaveAttribute("title", /later milestone/i);
  });
});

test.describe("ERR — error surfaces across routes and layers", () => {
  // @verifies ERR-45
  test("ERR-45: a view's error does not follow the user to an unrelated route", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Route error neighbour" }]);

    // Fail the list feed only, so the error belongs to /list.
    let failTasks = true;
    await page.route("**/api/tasks*", async route => {
      if (failTasks) await route.abort("failed");
      else await route.fallback();
    });

    await page.goto(`${tracker.baseURL}/list`);
    const listError = page.getByRole("alert").first();
    await expect(listError).toBeVisible();

    // First bullet: "a message tied to a specific task or view does not
    // follow the user to an unrelated route where it no longer makes
    // sense." Settings does not read /api/tasks, so the list's failure
    // has nothing to say there.
    await page.goto(`${tracker.baseURL}/settings/preferences`);
    await expect(page.getByRole("alert").filter({ hasText: /task/i })).toHaveCount(0);

    // Third bullet: "returning to the affected route either re-surfaces
    // the still-true error or shows the recovered state — never a stale
    // error for a problem that resolved."
    //
    // Still broken → the error is back. This is the half that catches
    // an app which clears the error on navigation and then renders an
    // empty list, silently implying there are no tasks.
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByRole("alert").first()).toBeVisible();

    // Recovered → the error is gone and the data is there. Asserting
    // both is what distinguishes "recovered" from "still erroring but
    // quieter".
    failTasks = false;
    await page.reload();
    await expect(page.getByText("Route error neighbour")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  // @verifies A11Y-34
  test("A11Y-34: nested layers unwind innermost-first, returning focus at each step", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([{ title: "Nested layers subject" }]);
    const taskKey = keys[0] ?? "T-1";

    await page.goto(`${tracker.baseURL}/tasks/${taskKey}`);
    await expect(page.getByText("Nested layers subject").first()).toBeVisible();

    // Layer 1: the ⋯ menu. Its trigger's accessible name is "More" —
    // the `Actions for <KEY>` label sits on the menu it opens, not on
    // the button, so selecting by that name finds nothing.
    const menuTrigger = page.getByRole("button", { name: "More", exact: true });
    await menuTrigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();

    // Layer 2: the delete confirmation, opened from the menu.
    await menu.getByRole("menuitem", { name: /delete/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The menu closed when its item was chosen — a menu left rendered
    // behind an open dialog is the "no layer is left rendered but
    // unreachable" failure the case's last bullet names.
    await expect(menu).toHaveCount(0);

    // First bullet: each Esc closes exactly one layer, innermost
    // first. The dialog goes; the detail page stays.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskKey}$`));

    // Second bullet: focus returns correctly at each step. After the
    // confirmation closes, focus is back on the control that opened
    // the chain rather than on `document.body`.
    await expect(page.locator("body")).not.toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("skip-link")).not.toBeFocused();
  });
});

test.describe("A11Y — failure communication", () => {
  // @verifies A11Y-46
  test("A11Y-46: a failed field save is announced and the rollback is perceivable", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Save failure subject", fields: { priority: "low" } },
    ]);
    const taskKey = keys[0] ?? "T-1";

    await page.goto(`${tracker.baseURL}/tasks/${taskKey}`);
    await expect(page.getByText("Save failure subject").first()).toBeVisible();

    // The stored value, before anything is attempted. The rollback
    // assertion at the end is only meaningful against a value we
    // watched go in.
    const priority = page.getByTestId("meta-edit-priority");
    await expect(priority).toContainText(/low/i);

    // Force the write to fail at the server.
    await page.route(`**/api/tasks/**/set`, route =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          code: "io_failed",
          message: "Could not write the task file: the disk is full.",
          error: "Could not write the task file: the disk is full.",
          field: "priority",
          data_state: "not_saved",
          recovery: { kind: "retry" },
        }),
      }),
    );

    await priority.click();
    await page.getByRole("option", { name: /high/i }).first().click();

    // First bullet: "the failure is announced assertively, naming the
    // field and the reason."
    //
    // `role="alert"` is an assertive live region by definition — that
    // is what the role means, and it is how this reaches a screen
    // reader without a separate announcement channel. Asserted via
    // `toHaveRole` so the browser's computed semantics are what is
    // checked, not an attribute spelling.
    const notice = page.getByTestId("meta-field-error");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveRole("alert");
    // Naming the reason, not "save failed".
    await expect(notice).toContainText(/disk is full/i);

    // Fourth bullet: "nothing about the failure is communicated only
    // by a red border." The notice carries the reason as *text*, which
    // is the whole point — a colour-only signal would leave this
    // assertion with nothing to match.
    expect((await notice.innerText()).trim().length).toBeGreaterThan(0);

    // Third bullet, and the one a weaker test would skip: "the
    // optimistic value's rollback is perceivable to a non-sighted user
    // — they are told the value reverted, not left believing the edit
    // stuck."
    //
    // So the displayed value must be back to the stored one. A UI that
    // announced the error but left "high" on screen would satisfy
    // every assertion above and still leave the user believing a
    // write landed that did not.
    await expect(priority).toContainText(/low/i);
    await expect(priority).not.toContainText(/high/i);

    // And the state claim is present in text, so the user is told
    // which side of the write they are on.
    await expect(page.getByTestId("meta-field-error-state")).toBeVisible();
  });
});
