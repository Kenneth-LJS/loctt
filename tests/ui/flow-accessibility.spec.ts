/**
 * Transcribed from tests/cases/ui-test-cases/flow-accessibility.md.
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

import { chmod, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { AxeBuilder } from "@axe-core/playwright";

import { expect, test } from "./fixtures/tracker.ts";

/**
 * Reads one task's `task.md` from disk by key.
 *
 * A11Y-28 requires the keyboard move to be verified against the file,
 * not the DOM — "the keyboard path must not be verified more weakly
 * than the pointer path". Same shape as flow-board.spec.ts's helper,
 * which BRD-9 uses for the drag path.
 */
async function readTaskFile(root: string, key: string): Promise<string> {
  const tasksDir = path.join(root, ".loctt", "tasks");
  for (const id of await readdir(tasksDir)) {
    try {
      const text = await readFile(path.join(tasksDir, id, "task.md"), "utf8");
      if (new RegExp(`^key: ${key}$`, "m").test(text)) return text;
    } catch {
      continue;
    }
  }
  throw new Error(`no task.md for ${key}`);
}

/** Appends a `boards:` block to workflow.yaml. */
async function setBoards(root: string, yaml: string): Promise<void> {
  const file = path.join(root, ".loctt", "config", "workflow.yaml");
  const text = await readFile(file, "utf8");
  await writeFile(file, `${text}\n${yaml}\n`, "utf8");
}

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

  // @verifies A11Y-2
  /**
   * A11Y-2 is now claimed: SHL-46 built the header search box (it is no
   * longer disabled), so `/` has a focusable target. This also guards
   * A11Y-8 / the B2 fix-review's duplicate-`/`-binding bug: there is a
   * SINGLE owner of the `/` key (the shell's global shortcut registry).
   * Header used to add its own document `keydown` for `/` as well, so the
   * key was bound twice; the second listener bypassed the registry's
   * dialog guard. One press must move focus once and leave the box
   * holding a single caret — a double-fire would still land focus but is
   * the shape of the bug, so the meaningful assertion is that `/` did NOT
   * type a literal slash into the box (which a second, guard-bypassing
   * handler racing focus would allow).
   */
  test("A11Y-2 / A11Y-8: `/` focuses the search box once, no literal slash", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Searchable task" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Searchable task")).toBeVisible();

    // The header search is an autocomplete: it carries role="combobox"
    // (with a results listbox), which overrides the implicit searchbox
    // role, so select it by its stable testid. The `focus-search`
    // shortcut finds it by type="search", not by role, so `/` still works.
    const search = page.getByTestId("header-search");
    await expect(search).toBeEnabled();
    await expect(search).not.toBeFocused();

    await page.locator("body").press("/");
    await expect(search).toBeFocused();
    // The `/` press was consumed to focus the box, not typed into it. A
    // duplicate handler that focused mid-keystroke (the old bug) would
    // leave a literal "/" in the value.
    await expect(search).toHaveValue("");

    // Typing after focus lands in the box (a single, working caret).
    await search.pressSequentially("bug");
    await expect(search).toHaveValue("bug");
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

  /**
   * K71: the confirm/delete dialogs that used to hand-roll their overlay
   * (and skip the focus trap + inert + focus restoration) now route
   * through the shared `ConfirmDialog` (over `Modal`), so they inherit
   * the same apparatus A11Y-14/15 prove for the create modal. This
   * exercises a *migrated* dialog end-to-end: the bulk-delete
   * confirmation. Before K71 this dialog leaked Tab to the page behind
   * and did not restore focus on close.
   *
   * @verifies A11Y-15
   */
  test("K71: a migrated confirm dialog traps focus and restores it on close", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "K71 task one" }, { title: "K71 task two" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("K71 task one")).toBeVisible();

    const rows = page.getByRole("row");
    await rows.filter({ hasText: "K71 task one" }).getByRole("checkbox").check();

    const trigger = page.getByRole("button", { name: "Delete", exact: true });
    await trigger.focus();
    await trigger.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // aria-modal is set (it comes from Modal) — the apparatus is present.
    await expect(dialog).toHaveAttribute("aria-modal", "true");

    // Focus is inside the dialog (the typed-confirm input), never on the
    // page behind it.
    const inside = await dialog.evaluate(d => d.contains(document.activeElement));
    expect(inside).toBe(true);

    // Escape closes it and focus returns to the trigger (not to body).
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
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
  // @verifies A11Y-45
  //
  // Bullet 2 — "Focus moves to the start of the new main content … not
  // left on the sidebar link, and not dropped to `document.body`" —
  // was asserted by nothing. `useRouteAnnouncement` had zero focus
  // calls, while `AppShell.tsx:177`'s comment claimed "the route
  // announcement (A11Y-45) land[s] focus here". The pane was made
  // `tabIndex={-1}` for this case and then nothing focused it, and the
  // comment read as though the work were done.
  //
  // Measured before the fix: after List → Board, focus was still on
  // the sidebar's Board link — the exact element the case names.
  test("A11Y-45: a route change moves focus to the main content", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Anything" }]);
    await page.goto(`${tracker.baseURL}/list`);

    const boardLink = page.getByRole("link", { name: "Board", exact: true });
    await boardLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/board/);

    // The positive control: focus is on main, not merely off the link.
    // Asserting only "not the sidebar link" would pass on focus having
    // been dropped to document.body, which the case forbids by name.
    await expect(page.locator("#main-content")).toBeFocused();
  });

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
  //
  // Bullet 2 — "fires once for the settled result, not once per
  // intermediate loading state" — is the settled-only gate
  // (`!tasks.isFetching`) in ListView's announcement effect.
  //
  // A plain filter change cannot exercise that gate, and a test built
  // on one passes with the gate deleted. `keepPreviousData` means the
  // in-flight render carries the *last settled* total, and the effect's
  // own `previous === total` change-guard already swallows a value
  // equal to the last announced one — the two guards overlap exactly
  // there. The gate is only observable when the in-flight render's
  // total *differs* from the last announced total, i.e. when React
  // Query serves **stale cached data** for a revisited query key while
  // revalidating. So this test stages precisely that: visit a filter
  // (cache its count), leave it, change the true count behind the
  // inactive query's back (a bulk status set invalidates inactive keys
  // without refetching them), then revisit the filter with the network
  // held open. The stale render says "1", the settled result says "3" —
  // an ungated effect announces both, the gated one announces only the
  // settled "3 tasks".
  test("A11Y-25: a filter announces once, not once per loading state", async ({
    page,
    tracker,
  }) => {
    await tracker.seed(
      Array.from({ length: 12 }, (_, i) => ({
        title: `Task ${String(i)}`,
        ...(i === 0 ? { fields: { status: "in_progress" } } : {}),
      })),
    );
    await page.goto(`${tracker.baseURL}/list`);
    const region = page.getByTestId("announcer-polite");
    const rows = page.locator("tbody tr");
    await expect(page.getByText("Task 0")).toBeVisible();

    // Visit the In progress filter so its count (1) lands in the query
    // cache, then leave it. Both transitions are genuine count changes
    // and announce once each — that part is the existing A11Y-25
    // test's ground; here they only set the stage.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menu").getByText("In progress").click();
    await page.keyboard.press("Escape");
    await expect(region).toContainText("1 tasks");
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menu").getByText("In progress").click();
    await page.keyboard.press("Escape");
    await expect(region).toContainText("12 tasks");

    // Make the cached count stale: move two more tasks to In progress.
    // The bulk mutation invalidates the tasks feed, but inactive query
    // keys are only *marked* stale, not refetched — the cache for the
    // In progress filter still says total 1 while the truth is 3.
    await rows.filter({ hasText: "Task 3" }).getByRole("checkbox").check();
    await rows.filter({ hasText: "Task 4" }).getByRole("checkbox").check();
    await page.getByRole("button", { name: "Set status" }).click();
    await page.getByRole("menu", { name: "Set status" })
      .getByRole("menuitem", { name: "In progress" }).click();
    await expect(
      page.getByRole("region", { name: "Bulk actions" }).getByRole("status"),
    ).toHaveText("2 tasks updated");
    await expect(page.getByRole("cell", { name: "In progress" })).toHaveCount(3);

    // Record every distinct value the live region takes from here on,
    // rather than its end state — the final text is "3 tasks" whether
    // the stale "1 tasks" was announced on the way or not.
    const seen: string[] = [];
    await page.exposeFunction("recordAnnouncement", (text: string) => {
      if (text.trim() !== "" && seen[seen.length - 1] !== text) seen.push(text);
    });
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="announcer-polite"]');
      if (el === null) throw new Error("no announcer region");
      new MutationObserver(() => {
        void (window as unknown as {
          recordAnnouncement: (t: string) => void;
        }).recordAnnouncement(el.textContent ?? "");
      }).observe(el, { childList: true, subtree: true, characterData: true });
    });

    // Hold the revalidation open so the stale-cache render is a real,
    // painted loading state rather than a race the fetch usually wins.
    await page.route(/\/api\/tasks\?/, async route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("status") === "in_progress") {
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      await route.continue();
    });

    // Revisit the filter. React Query renders the cached page (total
    // 1, stale) immediately with isFetching=true, then settles at 3.
    await page.getByRole("button", { name: "Filter Status" }).click();
    await page.getByRole("menu").getByText("In progress").click();
    await page.keyboard.press("Escape");
    await expect(region).toContainText("3 tasks");

    // The settled result, once — and never the stale in-flight "1
    // tasks", which is "the previous filter's count" the case forbids
    // reading out.
    const counts = seen.filter(t => /^\d+ tasks$/.test(t.trim()));
    expect(counts).toEqual(["3 tasks"]);
  });

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

  // @verifies A11Y-17
  test("A11Y-17: focus survives async content replacement in the task list", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Focus subject", fields: { status: "in_progress" } },
      { title: "Neighbour" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Focus a row via its key-link anchor.
    const link = page.locator("[data-task-key]").first();
    await link.focus();
    const key = await link.getAttribute("data-task-key");
    await expect(link).toBeFocused();
    expect(key).not.toBeNull();
    const taskKey = key as string;

    // Simulate the async content replacement the case names — a refetch
    // that unmounts and re-mounts the focused row's node (the same DOM
    // churn a background poll or a board reflow produces). Removing the
    // <tr> drops focus to document.body; re-inserting it must not leave
    // focus stranded there, sending the next Tab back to the top of the
    // page. The restoration effect re-focuses the equivalent row.
    //
    // (A refetch that merely *keeps* the row is handled natively by
    // React's keyed reconciliation and needs no effect; the interesting,
    // and only non-vacuous, case is the unmount/remount — which is what
    // this exercises and what the effect exists for.)
    const landed = await page.evaluate((k): Promise<{ isBody: boolean; key: string | null }> => {
      const tr = document.querySelector(`[data-task-key="${k}"]`)?.closest("tr");
      const parent = tr?.parentElement ?? null;
      if (tr === null || tr === undefined || parent === null) {
        return Promise.resolve({ isBody: true, key: "SETUP-FAILED" });
      }
      const next = tr.nextSibling;
      parent.removeChild(tr);
      // focus is now on body — the failure the case guards against.
      parent.insertBefore(tr, next);
      return new Promise(resolve => {
        setTimeout(() => resolve({
          isBody: document.activeElement === document.body,
          key: document.activeElement?.getAttribute?.("data-task-key") ?? null,
        }), 100);
      });
    }, taskKey);

    // Focus landed back on the equivalent row, not on document.body.
    expect(landed).toEqual({ isBody: false, key: taskKey });
  });

  // @verifies A11Y-10
  test("A11Y-10: filtering is fully keyboard-operable — open, arrow-navigate, select, and remove a chip", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Open one", fields: { status: "in_progress" } },
      { title: "Backlog one" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–2 of 2")).toBeVisible();

    // Open the Status filter with the keyboard — the trigger is a real
    // button, so Enter opens it (no mouse).
    const statusFilter = page.getByRole("button", { name: "Filter Status" });
    await statusFilter.focus();
    await expect(statusFilter).toBeFocused();
    await page.keyboard.press("Enter");

    // The panel's options are arrow-navigable (roving focus over the
    // menuitemcheckbox items), not only Tab-reachable: on open the first
    // option holds focus, and ArrowDown moves it.
    const options = page.getByRole("menuitemcheckbox");
    await expect(options.first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(options.nth(1)).toBeFocused();

    // Select the focused option from the keyboard (Space toggles the
    // checkbox), which filters the list.
    const chosen = (await options.nth(1).textContent())?.trim() ?? "";
    await page.keyboard.press(" ");
    // Close the panel and let the filter apply.
    await page.keyboard.press("Escape");

    // A chip appears for the applied filter, and its remove control has
    // an accessible name that names the filter being removed.
    const chip = page.getByRole("button", { name: new RegExp(`Remove Status ${chosen}`, "i") });
    await expect(chip).toBeVisible();

    // Remove it with the keyboard alone.
    await chip.focus();
    await expect(chip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: new RegExp(`Remove Status ${chosen}`, "i") }),
    ).toHaveCount(0);
  });

  // @verifies A11Y-12
  test("A11Y-12: the sidebar is keyboard-navigable, its collapse toggle exposes state, and the inert entry is announced-as-unavailable", async ({
    page,
    tracker,
  }) => {
    // Enough projects to force the truncation toggle (PRU-21 collapse).
    // K88 bars digits in a prefix, so the two-digit index is encoded as
    // letters (0→A … 9→J): Project 01 → prefix `PAB`.
    for (let i = 1; i <= 12; i++) {
      const n = String(i).padStart(2, "0");
      const prefix = "P" + [...n].map(d => String.fromCharCode(65 + Number(d))).join("");
      await tracker.run(["project", "create", `Project ${n}`, "--prefix", prefix]);
    }
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByTestId("project-all")).toBeVisible();

    // Group entries are reachable by keyboard: the "All projects" entry
    // and a project link can hold focus (they are real links in tab
    // order, not click-only divs).
    const firstProject = page.getByRole("link", { name: /Project 01/ });
    await firstProject.focus();
    await expect(firstProject).toBeFocused();

    // The collapsible project group exposes expanded/collapsed state and
    // toggles on Enter — not a one-way reveal, and not state-less.
    const more = page.getByTestId("project-more");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "false");

    // CMT-10 / A183: "Mentions me" is now an active built-in filter
    // (`comment_mentions = currentUser()`) whenever a current user is set —
    // which `init` bootstraps, so it is the state here. It must therefore
    // be a real, keyboard-reachable link, not an inert text blob. (The
    // inert-when-unavailable pattern this case also covers — a user filter
    // with no current user — is exercised at the unit level in
    // Sidebar.test.tsx, where the null-user branch is reachable without the
    // server's self-healing recreating a user.)
    const mentions = page.getByRole("link", { name: "Mentions me" });
    await expect(mentions).toBeVisible();
    await mentions.focus();
    await expect(mentions).toBeFocused();
  });

  // @verifies A11Y-51
  test("A11Y-51: a partial bulk result announces the real numbers and its failures are keyboard-reachable", async ({
    page,
    tracker,
  }) => {
    await tracker.seedBulk(4, undefined, n => `Bulk row ${String(n)}`);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Bulk row 1")).toBeVisible();

    // Inject an unresolvable ref into the outgoing archive batch so the
    // server returns 200 with a populated `failed` — a genuine partial
    // result (some succeed, one fails), which is what A11Y-51 is about.
    await page.route(/\/api\/tasks\/bulk\/archive/, async route => {
      const body = route.request().postDataJSON() as { refs: string[] };
      await route.continue({
        postData: JSON.stringify({ ...body, refs: [...body.refs, "T-99999"] }),
      });
    });

    await page.getByRole("checkbox", { name: "Select all on this page" }).check();
    await page.getByRole("button", { name: "Archive", exact: true }).click();

    // First bullet: the announcement states the real numbers, never a
    // bare "Done", and it goes through the assertive live region (a
    // partial failure interrupts). `aria-atomic` there means the whole
    // string is read, so the failure detail is not truncated.
    const assertive = page.getByTestId("announcer-assertive");
    await expect(assertive).toContainText("4 tasks archived, 1 failed");
    await expect(assertive).toContainText("T-99999");
    await expect(assertive).not.toContainText(/^Done\.?$/);

    // Second bullet: the failed items are reachable by keyboard from the
    // result — each is a focusable list item naming the task, not an
    // inert text blob a keyboard user cannot land on.
    const failures = page.getByTestId("bulk-failure-item");
    await expect(failures).toHaveCount(1);
    await failures.first().focus();
    await expect(failures.first()).toBeFocused();
    await expect(failures.first()).toContainText("T-99999");
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
  });

  /**
   * K71: the DiscardDialog renders above the create modal but was outside
   * the modal's focus-trap scope, so Tab could reach the form behind it.
   * It now has its own trap. Focus starts inside it (on "Keep editing")
   * and stays within across Tab.
   *
   * @verifies A11Y-14
   */
  test("K71: the create discard confirmation traps focus to itself", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Trap neighbour" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Trap neighbour")).toBeVisible();

    await page.locator("body").press("n");
    const modal = page.getByTestId("create-task-modal");
    await expect(modal).toBeVisible();
    await modal.getByLabel("Title").fill("Dirty");
    await page.keyboard.press("Escape");

    const confirm = page.getByTestId("create-discard-confirm");
    await expect(confirm).toBeVisible();

    // Initial focus is inside the confirmation (the safe "Keep editing").
    const focusInConfirm = await confirm.evaluate(d => d.contains(document.activeElement));
    expect(focusInConfirm).toBe(true);

    // Tab a few times; focus must remain within the confirmation, never
    // the form fields behind it.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      const stillInside = await confirm.evaluate(d => d.contains(document.activeElement));
      expect(stillInside, `Tab #${String(i + 1)} left the discard confirmation`).toBe(true);
    }
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
  });

  // @verifies A11Y-31
  test("A11Y-31: an unavailable control is announced as disabled, with a reason", async ({
    page,
    tracker,
  }) => {
    // Subject: the Projects settings panel's Delete button for the sole
    // project. This case originally used the header search box as its
    // "control disabled by state", but B2/SHL-46 built search into a
    // live combobox autocomplete — its subject is gone. The delete
    // button is a better fit anyway: it is disabled by genuine state
    // (`isOnlyProject`, ProjectsPanel.tsx) rather than by an unbuilt
    // stub, and it carries a keyboard-available reason.
    //
    // A freshly `init`-ed tracker has exactly one project, so no setup
    // is needed to reach the disabled state — the only-project rule
    // holds the moment the panel loads. This makes the state stable and
    // non-brittle: nothing to delete down to one first.
    await page.goto(`${tracker.baseURL}/settings/projects`);

    // Wait for the panel's own table to render before selecting the row
    // control, so the assertion is not racing an empty list.
    await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
    // The row's actions moved behind a `RowActions` kebab (U26/K105):
    // the Delete item only exists while the menu is open, and since
    // K106 step 2 the panel is portalled to `document.body`, so it is
    // located from `page`. The trigger is scoped to `main` because the
    // sidebar carries a same-named `Actions for project "Tasks"` button.
    await page.getByRole("main")
      .getByRole("button", { name: /^Actions for project / }).first().click();
    const del = page.locator('[data-testid^="project-delete-"]');
    await expect(del).toHaveCount(1);

    // First bullet: it "exposes a disabled state to assistive tech
    // rather than being merely greyed and unresponsive".
    //
    // `toHaveJSProperty` rather than `toBeDisabled` for the same reason
    // the old test used it: `toBeDisabled` can retarget inside a label
    // and check a different element than the one named. The JS property
    // is read off the element itself. This is a real `<button disabled>`
    // (ProjectsPanel passes `disabled` through to the DOM button), so
    // the property is genuine, not an aria attribute painted on.
    await expect(del).toHaveJSProperty("disabled", true);

    // Third bullet: "a control that is inert but announces as
    // actionable is a defect" — the disabled state must be genuine, so
    // the control really does not take focus or input.
    await del.focus().catch(() => undefined);
    await expect(del).not.toBeFocused();

    // Second bullet: "a reason is available to keyboard users — via
    // accessible description or an adjacent explanation — not only in
    // a pointer-hover tooltip."
    //
    // Honest caveat, unchanged from the old subject: the reason lives in
    // `title`, which is primarily a pointer-hover tooltip. It is *also*
    // exposed as the accessible description by every current browser
    // when no other description source exists, which is why this
    // assertion holds — but `title` is the weakest form the bullet
    // permits, and the case says "not only in a pointer-hover tooltip".
    // A298 moved disabled reasons from `title` to `aria-describedby`
    // pointing at a permanent `sr-only` node. That is the STRONGER form
    // this very bullet asks for — the comment above already called
    // `title` "the weakest form the bullet permits", and the case says
    // the reason must reach the user "not only in a pointer-hover
    // tooltip". A hover-only reason is unreachable to a screen-reader
    // user, who never hovers.
    const describedBy = await del.getAttribute("aria-describedby");
    expect(describedBy, "disabled control must carry a description").toBeTruthy();
    await expect(page.locator(`#${describedBy as string}`))
      .toHaveText(/at least one project/i);
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
    const menuTrigger = page.getByRole("button", { name: "Task actions" });
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
  /**
   * A11Y-24: a field save's outcome is announced in the shell's live
   * region, so a non-sighted user knows the edit landed (or did not)
   * without inspecting the field. Both halves in one flow: a real
   * successful save, then the same field forced to fail.
   *
   * The two announcements go to different regions — success polite,
   * failure assertive — and the failure carries the same text the
   * anchored notice shows, so the channel and the notice never disagree.
   *
   * @verifies A11Y-24
   */
  test("A11Y-24: a field save's success and forced failure are both announced in a live region", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Announced save subject", fields: { priority: "low" } },
    ]);
    const taskKey = keys[0] ?? "T-1";

    await page.goto(`${tracker.baseURL}/tasks/${taskKey}`);
    await expect(page.getByText("Announced save subject").first()).toBeVisible();

    const polite = page.getByTestId("announcer-polite");
    const assertive = page.getByTestId("announcer-assertive");

    // (1) A real, successful save. First bullet: the success is announced
    // ("Priority saved") politely, and focus is NOT moved by the
    // announcement — the picker's own focus behaviour is unchanged.
    const priority = page.getByTestId("meta-edit-priority");
    await priority.click();
    await page.getByRole("option", { name: /high/i }).first().click();

    await expect(polite).toContainText(/priority saved/i);
    // A success is not an interruption, so the assertive channel is silent.
    await expect(assertive).not.toContainText(/saved/i);

    // (2) Now force the same field's write to fail. Second bullet: the
    // failure is announced ASSERTIVELY (interrupting) with the same
    // message the notice shows — a silent failure is A11Y-24's worst
    // case. Fourth bullet: a non-sighted user can tell the two apart —
    // here, the failure text lands in the assertive region, the success
    // never did.
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
    await page.getByRole("option", { name: /medium|low/i }).first().click();

    // The assertive region carries the reason (same words as the notice).
    await expect(assertive).toContainText(/disk is full/i);
    // And the notice shows the identical message, so the two agree.
    await expect(page.getByTestId("meta-field-error")).toContainText(/disk is full/i);
  });

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

test.describe("A11Y — keyboard-only end-to-end flows", () => {
  /**
   * A11Y-11: create a task with no pointer at all.
   *
   * Driven entirely through `page.keyboard`. Not one `.click()`
   * appears below, deliberately: the case says "all without a
   * pointer", and a `.click()`-driven test proves the handler runs,
   * not that the flow is reachable by a keyboard user. Every control
   * here is arrived at by `Tab` from wherever focus already was.
   *
   * The far end is the file on disk plus the announcement, not the
   * dialog closing — a modal that closed while the write failed would
   * satisfy a weaker test.
   */
  // @verifies A11Y-11
  test("A11Y-11: a task is created end to end with no pointer, and its key is announced", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Pre-existing row" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Pre-existing row")).toBeVisible();

    await page.locator("body").press("n");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Focus starts in the title, so typing begins immediately.
    await page.keyboard.type("Made with no pointer");

    /*
     * First bullet: "every field including the label multi-select, the
     * date pickers, and the body editor is reachable and editable by
     * keyboard."
     *
     * Walked as a real tab order rather than by focusing each control
     * directly — `locator.focus()` would reach a control that `Tab`
     * cannot, which is exactly the defect the case is about. The walk
     * records what it passed so the assertions below are about the
     * order a keyboard user actually traverses.
     */
    const seen: string[] = [];
    let labelTrigger = false;
    let dateInputs = 0;
    let editor = false;
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      const at = await page.evaluate(() => {
        const a = document.activeElement as HTMLElement | null;
        if (a === null) return { tag: "", name: "", type: "", editable: false };
        return {
          tag: a.tagName,
          name: a.getAttribute("aria-label") ?? a.textContent?.trim().slice(0, 30) ?? "",
          type: a.getAttribute("type") ?? "",
          editable: a.getAttribute("contenteditable") === "true",
        };
      });
      seen.push(`${at.tag}:${at.name}`);
      if (at.name.startsWith("Add a label")) labelTrigger = true;
      if (at.tag === "INPUT" && at.type === "date") dateInputs += 1;
      if (at.editable) { editor = true; break; }
    }

    // The label multi-select and the body editor were both reached by
    // Tab alone, and there are date inputs in the order.
    expect(labelTrigger).toBe(true);
    expect(editor).toBe(true);
    expect(dateInputs).toBeGreaterThan(0);

    /*
     * Second bullet, the blocker one: "the date picker allows typed
     * date entry — a calendar grid that can only be clicked is a
     * blocker."
     *
     * Asserting the input's *value* after typing is the effect. A
     * `type="date"` attribute check would pass for a readonly input
     * fronting a click-only calendar.
     */
    const dateField = dialog.locator('input[type="date"]').first();
    await dateField.focus();
    await expect(dateField).toBeFocused();
    // Eight digits typed as real keystrokes into the focused control's
    // segments, which this engine orders day, month, year. The value
    // only materialises once all three are filled, which is why the
    // assertion is on the completed value.
    //
    // Typed rather than `fill()`ed on purpose: `fill` sets the value
    // directly, bypassing the keyboard entirely, so a fill-based
    // assertion would say nothing about keyboard operability.
    //
    // Mutation-proven by adding `disabled` to the create modal's own
    // `FormDateField` input, which turns this red. Note the modal does
    // NOT use `task/editors/DateField.tsx` — it defines its own
    // `FormDateField` and imports only `nonWorkingNote` from that
    // module, so mutating `DateField` leaves this test green.
    await page.keyboard.type("17042026");
    await expect(dateField).toHaveValue("2026-04-17");

    /*
     * Third bullet: "the body editor is escapable: `Tab` inside it
     * either moves to the next control or a documented key does, so
     * the user is never trapped."
     *
     * Typed into first, so this is a Tab out of an editor with content
     * and a live selection — an empty editor can let Tab through while
     * a populated one swallows it for indentation.
     */
    const body = dialog.locator('[contenteditable="true"]');
    await body.focus();
    await page.keyboard.type("Body written by keyboard");
    await expect(body).toContainText("Body written by keyboard");
    await page.keyboard.press("Tab");
    // The positive assertion the brief warns to make: focus is on a
    // real control, not merely "not the editor" (which `document.body`
    // would satisfy while the user was in fact stranded).
    const escaped = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return {
        editable: a?.getAttribute("contenteditable") === "true",
        isBody: a === document.body || a === null,
        tag: a?.tagName ?? "",
      };
    });
    expect(escaped.editable).toBe(false);
    expect(escaped.isBody).toBe(false);
    expect(["INPUT", "BUTTON", "TEXTAREA", "SELECT", "A"]).toContain(escaped.tag);
    // And the dialog did not close as a side effect of escaping.
    await expect(dialog).toBeVisible();

    /*
     * Fourth bullet: "submit is reachable and the created task's key
     * is announced."
     *
     * Reached by Tab from where the editor exit left focus, then
     * activated with Enter — never clicked.
     */
    const submit = dialog.getByRole("button", { name: "Create task" });
    let reachedSubmit = false;
    for (let i = 0; i < 20; i += 1) {
      await page.keyboard.press("Tab");
      if (await submit.evaluate(el => el === document.activeElement)) {
        reachedSubmit = true;
        break;
      }
    }
    expect(reachedSubmit).toBe(true);
    await page.keyboard.press("Enter");

    // The key is announced in a live region — the thing a non-sighted
    // user is handed. Asserting the row appeared would not prove this.
    await expect(page.locator('[aria-live="polite"]', { hasText: /Created T-2/ }))
      .toBeVisible();

    // And the far end: the task is on disk with the body and the date
    // the keyboard put there. A dialog that closed on a failed write
    // would pass every assertion above and fail here.
    await expect
      .poll(async () => tracker.run(["list"]))
      .toContain("Made with no pointer");
    const shown = await tracker.run(["show", "T-2"]);
    expect(shown).toContain("Body written by keyboard");
    expect(shown).toContain("2026-04-17");
  });
});

test.describe("A11Y — drag affordances have keyboard alternatives", () => {
  /**
   * A11Y-29: neither ranked-relationship reorder nor timeline bar
   * adjustment is pointer-only.
   *
   * REL-15 and TML-40 each cover one half against its own flow doc.
   * This case is the cross-cutting claim that *both* hold — a
   * regression in either one is a blocker here — so it asserts both
   * ends rather than delegating to those tags.
   *
   * Both halves are driven with real key events on a focused control
   * (`press`), never a synthesised drag or a click.
   *
   * What this test does NOT assert, deliberately: that `Escape`
   * cancels an in-progress reorder. That is REL-15's third bullet, not
   * one of A11Y-29's three, and it is **broken** — the Escape branch
   * announces "Move cancelled" but performs no move, and every arrow
   * press has already written to disk. See known-gaps, "Escape does
   * not cancel a keyboard relationship reorder". Asserting it here
   * would fail; asserting the announcement instead would pass against
   * the bug.
   */
  // @verifies A11Y-29
  test("A11Y-29: ranked rows reorder by keyboard with the position announced, and timeline bars adjust by keyboard", async ({
    page,
    tracker,
  }) => {
    /* ---- Half one: ranked relationship reorder ---- */
    const [root, a, b] = await tracker.seed([
      { title: "Reorder root" },
      { title: "Ranked A" },
      { title: "Ranked B" },
    ]);
    await tracker.run(["link", root ?? "", "blocks", a ?? ""]);
    await tracker.run(["link", root ?? "", "blocks", b ?? ""]);

    await page.goto(`${tracker.baseURL}/tasks/${root ?? ""}`);
    await expect(page.getByTestId("relationships-panel")).toBeVisible();

    const rows = page.locator('[data-group="blocks"] [data-testid="relationship-row"]');
    const orderOf = async (): Promise<(string | undefined)[]> =>
      rows.evaluateAll(els => els.map(e => (e as HTMLElement).dataset["target"]));

    const before = await orderOf();
    expect(before).toHaveLength(2);
    const secondId = before[1] ?? "";

    // The handle is a real focusable control — not a `div` with
    // `draggable`, which is reachable by pointer only.
    const handle = page.locator(
      `[data-group="blocks"] [data-testid="relationship-row"][data-target="${secondId}"] `
      + `[data-testid="drag-handle"]`,
    );
    await handle.focus();
    await expect(handle).toBeFocused();

    // REL-15's pickup model: an arrow moves the row VISUALLY (a buffered
    // pickup, so Escape is a true cancel with no write), and the single
    // rerank is committed on Enter. Pressing only ArrowUp therefore
    // reorders the screen and leaves the file untouched — which is why
    // the reload assertion below needs the commit.
    await handle.press("ArrowUp");

    // First bullet, first half: the row moved on screen...
    await expect(rows.nth(0)).toHaveAttribute("data-target", secondId);

    // ...and it is announced while picked up, before any write.
    await expect(page.getByTestId("reorder-announcement"))
      .toContainText(`${b ?? ""} moved to position 1 of 2`);

    // Drop: the one write leaves here, and the drop is announced too.
    const reranked = page.waitForResponse(
      r => r.url().includes("/rerank") && r.request().method() === "POST",
      { timeout: 15_000 },
    );
    await handle.press("Enter");
    await reranked;
    await expect(page.getByTestId("reorder-announcement"))
      .toContainText(`${b ?? ""} dropped at position 1 of 2`);

    // The far end agrees, and survives a reload.
    await page.reload();
    await expect(page.getByTestId("relationships-panel")).toBeVisible();
    await expect(rows.nth(0)).toHaveAttribute("data-target", secondId);

    /* ---- Half two: timeline bar start and due, by keyboard ---- */
    const [bar1] = await tracker.seed([{ title: "Bar task" }]);
    const barKey = bar1 ?? "";
    await tracker.run(["set", barKey, "start_date", "2026-03-02"]);
    await tracker.run(["set", barKey, "due_date", "2026-03-06"]);

    await page.goto(`${tracker.baseURL}/timeline?zoom=day`);
    const bar = page.getByTestId(`timeline-bar-${barKey}`);
    await expect(bar).toBeVisible();

    // Second bullet: the bar itself is keyboard-reachable and carries
    // its live dates as its accessible name.
    await bar.focus();
    await expect(bar).toBeFocused();
    await expect(bar).toHaveAttribute("aria-label", /2026-03-02 to 2026-03-06/);

    // Due edge, by keyboard.
    await page.keyboard.press("Shift+ArrowRight");
    await expect(bar).toHaveAttribute("data-due", "2026-03-07");

    // Start edge, by keyboard. Both edges are required by the bullet
    // ("a bar's start and due dates are adjustable"), so asserting one
    // would leave the other free to be pointer-only.
    await page.keyboard.press("Alt+ArrowRight");
    await expect(bar).toHaveAttribute("data-start", "2026-03-03");

    // Third bullet — "neither feature is pointer-only" — proved at the
    // far end: both keyboard adjustments reached the file.
    await expect
      .poll(async () => tracker.run(["show", barKey]))
      .toContain("2026-03-07");
    const barShown = await tracker.run(["show", barKey]);
    expect(barShown).toContain("2026-03-03");
  });
});

test.describe("A11Y — text-only zoom", () => {
  // @verifies A11Y-39
  //
  // Text-only zoom is the user agent scaling text while leaving page zoom
  // alone (Firefox's "Zoom text only", a browser minimum/default
  // font-size). What it scales is the *root* font size, so a layout in
  // rem/em grows with it. The app now anchors its base to the root
  // (`html { font-size: 87.5% }`, body `1rem`) and sizes type in rem
  // (`--text-*` + `text-[…rem]`), so doubling the root doubles the text —
  // the point of the case. (This supersedes A95's "absolute scale, nothing
  // to act on" partial.)
  test("A11Y-39: text-only zoom to 200% scales the text and clips nothing", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([
      { title: "Text zoom subject with a reasonably long title to wrap" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    const cell = page.getByText("Text zoom subject with a reasonably long title to wrap");
    await expect(cell).toBeVisible();

    const bodyBefore = await page.evaluate(
      () => parseFloat(getComputedStyle(document.body).fontSize),
    );
    // Body resolves to the 14px design base at 100% zoom.
    expect(bodyBefore).toBeGreaterThan(13);
    expect(bodyBefore).toBeLessThan(15);

    // Simulate a user agent's text-only zoom: scale the root font size,
    // leaving page zoom untouched.
    await page.addStyleTag({ content: "html { font-size: 175% !important; }" });

    const bodyAfter = await page.evaluate(
      () => parseFloat(getComputedStyle(document.body).fontSize),
    );
    // The text actually grew — the bullet the old absolute scale failed.
    // 175% of the 87.5%-of-16px base is 2× the 14px body (≈28px); assert a
    // clear increase rather than an exact number (rounding, sub-pixel).
    expect(bodyAfter).toBeGreaterThan(bodyBefore * 1.5);

    // A concrete text element grew too, not just <body> — a real cell,
    // reading its own computed size.
    const cellPx = await cell.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(cellPx).toBeGreaterThan(bodyBefore * 1.3);

    // Nothing is clipped: the title cell's full text height fits within
    // its rendered box (a fixed-height overflow:hidden container would
    // make scrollHeight exceed clientHeight once the text grew). Checked
    // on the row-header cell that carries the title.
    const clipped = await cell.evaluate(el => {
      const box = el.closest("td, th") ?? el;
      return box.scrollHeight > box.clientHeight + 1;
    });
    expect(clipped, "the title text is clipped by a fixed-height box at 175% text zoom").toBe(false);

    // And the document did not gain a horizontal scrollbar from text that
    // could not reflow (WCAG 1.4.10-adjacent, and A11Y-39's "containers
    // grow / text reflows").
    const hScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hScroll, "the page scrolls horizontally at 175% text zoom").toBe(false);
  });
});

/**
 * ============================================================
 * Group 4 (built but untested) and Group 3 (needs axe).
 * ============================================================
 *
 * `@axe-core/playwright` is now installed, which unblocks the two
 * cases whose subject is contrast and focus-indicator *visibility* —
 * quantities a hand-written assertion cannot honestly measure.
 *
 * Every axe scan below is **scoped** (`.include()` plus
 * `.withRules([...])`). An unscoped "zero violations on the page"
 * assertion fails on something unrelated to the case it claims, and
 * becomes a test that gets re-run rather than fixed.
 */

test.describe("A11Y — layered dismissal", () => {
  // @verifies A11Y-5
  test("A11Y-5: Esc closes the dropdown inside the create modal first, then the modal", async ({
    page,
    tracker,
  }) => {
    // A second project makes the Project picker a real dropdown: with
    // one project the field renders as static text (`create-project-sole`)
    // and there is no layer to close, which would make the first Esc
    // close the modal and the test pass for the wrong reason.
    await tracker.run(["project", "create", "Second", "--prefix", "SEC"]);
    await tracker.seed([{ title: "Layered dismissal subject" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Layered dismissal subject")).toBeVisible();

    // Opened from a real trigger so the "returns focus to whatever
    // opened it" bullet has something to return to. Focusing the
    // element first is what makes that assertion meaningful — a modal
    // opened by `n` from `body` would restore to `body` and pass a
    // weaker test.
    const trigger = page.getByRole("button", { name: "New task" });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const picker = dialog.getByTestId("meta-edit-project");
    await picker.focus();
    await page.keyboard.press("Enter");
    // The dropdown is the topmost layer now.
    //
    // K106 step 2: the listbox PANEL is portalled to `document.body`, so
    // it is no longer a descendant of the dialog — only the trigger is.
    // Scoped to `page` for that reason. The layered-Escape proof is
    // untouched: the dialog is still asserted visible after the first
    // Escape, and focus still returns to the trigger INSIDE it.
    const options = page.getByTestId("meta-options-project");
    await expect(options).toBeVisible();
    await expect(picker).toHaveAttribute("aria-expanded", "true");

    // First Esc: the dropdown goes, the modal stays.
    await page.keyboard.press("Escape");
    await expect(options).toBeHidden();
    // The modal is still open — this is the assertion the case is
    // really about. A single Escape handler on `document` would have
    // closed both, and only this line would catch it.
    await expect(dialog).toBeVisible();
    // "...with focus back on the dropdown trigger."
    await expect(picker).toBeFocused();

    // Second Esc: the modal goes. The form is untouched, so NEW-27's
    // discard confirmation does not stand in the way (third bullet,
    // which defers to A11Y-33 for the dirty case).
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    // "...and returns focus to whatever opened it."
    await expect(trigger).toBeFocused();
  });
});

test.describe("A11Y — error association", () => {
  /**
   * A11Y-23 spans "every form". This test takes the two the case names
   * by hand — the init wizard's prefix (ONB-19) and a settings form —
   * plus the create modal, which is where the gap actually was: it
   * rendered `role="alert"` text beside three fields and associated
   * none of them, so a screen reader announced the error once as it
   * appeared and said nothing when focus later entered the field.
   *
   * `role="alert"` and `aria-describedby` are not interchangeable, and
   * that is the distinction the case's first bullet draws. An alert
   * fires once, at insertion. `aria-describedby` is what makes the
   * rule readable *on entering the field*, which is how a user who
   * tabbed away and came back finds out what is wrong.
   */
  /**
   * The create modal's two *reachable* blocked-submit paths.
   *
   * Not the empty-title one: the Create button is
   * `disabled={!titleFilled || ...}` and there is no `<form>`, so
   * `showTitleRequired` cannot be reached by any keyboard or pointer
   * route a user has. Its `aria-invalid` wiring is therefore present
   * but unexercised, and asserting it here would need
   * `dispatchEvent` on a disabled control — a test of React internals
   * rather than of the case. Recorded in known-gaps.md instead.
   */
  // @verifies A11Y-23
  test("A11Y-23: the create modal marks a blocked field invalid, describes it, and moves focus there", async ({
    page,
    tracker,
  }) => {
    // NEW-19's ask state, which is the only route to a blocked
    // project submit: several projects **and no default anywhere**.
    // With `init`'s default left in place the field is pre-filled,
    // the submit is never blocked, and this test would pass its
    // negative control and then find nothing to assert.
    await tracker.seed([{ title: "Error association subject" }]);
    await tracker.run(["project", "create", "Second", "--prefix", "SEC"]);
    // Cleared *after* seeding: with no default and two projects,
    // `loctt create` itself refuses without an explicit --project.
    await tracker.run(["project", "set-default", "-"]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Error association subject")).toBeVisible();

    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog.getByTestId("create-title").fill("A task that names no project");

    const picker = dialog.getByTestId("meta-edit-project");
    // Positive control: the picker is not marked invalid before the
    // blocked submit. Without this, a hardcoded `aria-invalid="true"`
    // would satisfy every assertion below.
    await expect(picker).not.toHaveAttribute("aria-invalid", "true");

    await dialog.getByRole("button", { name: "Create task", exact: true }).click();

    // Second bullet: marked invalid programmatically, not styled red
    // only. The control is a *button*, which nothing associates with
    // an error by default — this is the half most likely to regress.
    await expect(picker).toHaveAttribute("aria-invalid", "true");

    // First bullet: the description resolves to a real element whose
    // text states the rule. Asserting the attribute is merely present
    // would pass with an id pointing at nothing.
    const describedBy = await picker.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    const described = dialog.locator(`#${String(describedBy)}`);
    await expect(described).toBeVisible();
    // Fourth bullet, the P4 half: names what is missing, not "invalid".
    await expect(described).toContainText(/project/i);
    await expect(described).not.toContainText(/^invalid$/i);

    // Third bullet: on a blocked submit focus moves to the first
    // invalid field.
    await expect(picker).toBeFocused();
  });

  // @verifies A11Y-23
  test("A11Y-23: an out-of-order date range marks the due date invalid and describes the rule", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Date range subject" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Date range subject")).toBeVisible();

    await page.getByRole("button", { name: "New task" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const due = dialog.getByTestId("create-due");
    await expect(due).not.toHaveAttribute("aria-invalid", "true");

    await dialog.getByTestId("create-start").fill("2026-06-10");
    await due.fill("2026-06-01");

    await expect(due).toHaveAttribute("aria-invalid", "true");
    const describedBy = await due.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    await expect(dialog.locator(`#${String(describedBy)}`)).toContainText(/before/i);

    // The start date is *not* marked: one problem, one invalid field.
    // Marking both would tell a screen-reader user to fix a field
    // that is fine.
    await expect(dialog.getByTestId("create-start")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );

    // And it clears when the range is fixed.
    await due.fill("2026-06-20");
    await expect(due).not.toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("A11Y — keyboard board moves", () => {
  /**
   * A11Y-28's last bullet is the one that matters most: "**Re-read the
   * task file** to confirm the atomic write landed... the keyboard
   * path must not be verified more weakly than the pointer path."
   *
   * So this asserts the *disk*, not the DOM. A status-only write —
   * the plausible wrong implementation — leaves `board_rank`
   * unchanged, which the announcement and the re-rendered column would
   * both hide.
   */
  // @verifies A11Y-28
  test("A11Y-28: Ctrl+Arrow moves a card across columns, announces it, and writes status + board_rank atomically", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    // A component that throws on render and one that renders nothing
    // produce identical "element not found" output. This separates
    // them.
    page.on("pageerror", e => pageErrors.push(e.message));

    const [first, second] = await tracker.seed([
      { title: "Card to move", fields: { status: "backlog" } },
      { title: "Card that stays", fields: { status: "backlog" } },
    ]);
    await page.goto(`${tracker.baseURL}/board`);

    const card = page.getByTestId(`board-card-${String(first)}`);
    await expect(card).toBeVisible();
    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);

    const before = await readTaskFile(tracker.root, String(first));
    expect(before).toMatch(/^status: backlog$/m);

    // First bullet: the card is focusable and a documented key enters
    // the move. Driven by the keyboard only — a `.click()` here would
    // not verify the case.
    const cardButton = card.getByRole("button").first();
    await cardButton.focus();
    await expect(cardButton).toBeFocused();
    await page.keyboard.press("Control+ArrowRight");

    // Third bullet: committing announces the result, naming the task,
    // the destination and the position.
    const live = page.getByTestId("board-live-region");
    await expect(live).toContainText(String(first));
    await expect(live).toContainText(/position \d+/);

    // Fourth and fifth bullets: the resulting write is the same one
    // the drag produces — an atomic status + `board_rank` update, read
    // back off disk rather than trusted from the UI.
    await expect
      .poll(async () => readTaskFile(tracker.root, String(first)), { timeout: 5_000 })
      .not.toMatch(/^status: backlog$/m);

    const after = await readTaskFile(tracker.root, String(first));
    // A status-only write is the wrong implementation this bullet
    // exists to catch, and it is invisible from the DOM.
    expect(after, "the keyboard move wrote no board_rank").toMatch(/^board_rank:/m);

    // The other card was not touched — the move is to one task, not a
    // column-wide rewrite.
    const untouched = await readTaskFile(tracker.root, String(second));
    expect(untouched).toMatch(/^status: backlog$/m);

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });
});

test.describe("A11Y — dense rows stay navigable", () => {
  // @verifies A11Y-42
  test("A11Y-42: twenty labels collapse behind one focusable, counted affordance", async ({
    page,
    tracker,
  }) => {
    const names = Array.from({ length: 20 }, (_u, i) => `label-${String(i + 1)}`);
    for (const n of names) await tracker.run(["label", "create", n]);
    await tracker.seed([
      { title: "Twenty labels", fields: { labels: `[${names.join(", ")}]` } },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Twenty labels")).toBeVisible();

    // First bullet: an overflow affordance exists, is announced with
    // the count, and is itself focusable.
    const overflow = page.getByTestId("label-overflow-trigger");
    await expect(overflow).toBeVisible();
    // The accessible name carries the number — "button" alone tells a
    // screen-reader user nothing about what "+14" is for. Computed
    // from the browser's accessibility tree, not read off an
    // attribute.
    await expect(overflow).toHaveAccessibleName(/\d+ more labels?/);

    await overflow.focus();
    await expect(overflow).toBeFocused();

    // Second bullet: the row does not cost twenty tab stops. Counting
    // the *rendered pills* is the check — the case's concern is that
    // every label is individually tabbable, and the cap is what
    // prevents it.
    // No testid exists on the labels cell, so the cell is reached
    // through the overflow trigger it contains — the pills are its
    // sibling buttons.
    const labelsCell = page.locator("td").filter({ has: overflow });
    const pillCount = await labelsCell.getByRole("button").count();
    // 20 labels must not become 20 stops. The exact cap is the
    // component's business; that it *is* capped well below twenty is
    // the case's.
    expect(pillCount).toBeLessThan(20);

    // And the hidden ones are reachable — collapsed, not lost.
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("label-overflow-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button").first()).toBeVisible();
  });
});

test.describe("A11Y — persistent states and motion", () => {
  // @verifies A11Y-52
  test("A11Y-52: the server-unreachable state is a persistent region, not a transient toast", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Connectivity subject" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Connectivity subject")).toBeVisible();

    const banner = page.locator("[data-server-unreachable]");
    // Positive control: it is absent while the server answers. Without
    // this, a banner rendered unconditionally would satisfy every
    // assertion below.
    await expect(banner).toHaveCount(0);

    // Make every request fail, which is what SHL-41's stopped server
    // looks like to the client. Aborting rather than killing the
    // fixture's process keeps the tracker directory available for the
    // recovery half below.
    await page.route(/\/api\//, route => { void route.abort("connectionrefused"); });
    await page.reload();

    await expect(banner).toBeVisible({ timeout: 15_000 });

    // First bullet, the "announced" half: it is a live region, so its
    // appearance is spoken. `status` rather than `alert` is deliberate
    // (standing context, not an interruption) and is what the case's
    // "announced ... and remains discoverable" asks for.
    await expect(banner).toHaveAttribute("role", "status");

    // First bullet, the "persistent" half — the one that separates
    // this from a toast. A toast would be gone by now; this must not
    // be. Well past the 6s toast lifetime.
    await page.waitForTimeout(7_000);
    await expect(banner).toBeVisible();

    // Second bullet: the recovery instruction is readable text, not an
    // icon or a colour.
    await expect(banner).toContainText(/restart/i);
    await expect(banner).toContainText(/loctt ui/);

    // Third bullet: when connectivity returns the recovery is
    // announced too — the region goes, so the user knows they can
    // resume.
    await page.unroute(/\/api\//);
    await banner.getByRole("button", { name: "Try now" }).click();
    await expect(banner).toHaveCount(0, { timeout: 15_000 });
  });

  // @verifies A11Y-37
  test("A11Y-37: reduced motion suppresses the transition but not the outcome or its announcement", async ({
    page,
    tracker,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const [first] = await tracker.seed([
      { title: "Reduced motion card", fields: { status: "backlog" } },
    ]);
    await page.goto(`${tracker.baseURL}/board`);

    const card = page.getByTestId(`board-card-${String(first)}`);
    await expect(card).toBeVisible();

    // First and second bullets: nothing animates. Asserted against the
    // *computed* style of the elements actually on screen, which is
    // what a user experiences — not against the presence of a CSS
    // rule, which would pass even if a later selector overrode it.
    const motion = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const cs = getComputedStyle(el);
        const dur = (v: string): number =>
          Math.max(0, ...v.split(",").map(s => {
            const t = s.trim();
            return t.endsWith("ms") ? parseFloat(t) : parseFloat(t) * 1000;
          }).filter(n => Number.isFinite(n)));
        if (dur(cs.transitionDuration) > 1) offenders.push(`${el.tagName} transition ${cs.transitionDuration}`);
        if (dur(cs.animationDuration) > 1) offenders.push(`${el.tagName} animation ${cs.animationDuration}`);
        // Fourth bullet: no animation loops indefinitely.
        if (cs.animationIterationCount === "infinite") {
          offenders.push(`${el.tagName} animation-iteration-count: infinite`);
        }
      }
      return offenders;
    });
    expect(motion, motion.join("\n")).toHaveLength(0);

    // Third bullet, and the one a "nothing animates" test would miss
    // entirely: suppressing motion must not suppress the *outcome*.
    // The move still happens and is still announced.
    const cardButton = card.getByRole("button").first();
    await cardButton.focus();
    await page.keyboard.press("Control+ArrowRight");

    await expect(page.getByTestId("board-live-region")).toContainText(String(first));
    await expect
      .poll(async () => readTaskFile(tracker.root, String(first)), { timeout: 5_000 })
      .not.toMatch(/^status: backlog$/m);
  });

  // @verifies A11Y-41
  test("A11Y-41: a 300-character title keeps the row's semantics and its column widths", async ({
    page,
    tracker,
  }) => {
    const long = `Long ${"x".repeat(295)}`;
    expect(long).toHaveLength(300);
    const [longKey, shortKey] = await tracker.seed([
      { title: long },
      { title: "Short title" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByRole("link", { name: String(shortKey) })).toBeVisible();

    const longRow = page.locator("tbody tr").filter({ hasText: String(longKey) });
    const shortRow = page.locator("tbody tr").filter({ hasText: String(shortKey) });
    await expect(longRow).toHaveCount(1);

    // First bullet: the full title is available, not just the clipped
    // glyphs. The `title` attribute is what a user gets on hover and
    // what the accessible description carries.
    // The project chip also carries a `title`, so the title cell is
    // selected by its own text rather than by position.
    const titleText = longRow.locator("span").filter({ hasText: /^Long x+$/ }).first();
    await expect(titleText).toHaveAttribute("title", long);

    // ...and the row still announces the task identifiably: the key
    // link is intact rather than swallowed by the title's overflow.
    await expect(longRow.getByRole("link", { name: String(longKey) })).toBeVisible();

    // The title is *visually* truncated — the second bullet's "the
    // title truncates visually but the full title is available". This
    // is the assertion that catches a cap being removed: without it
    // the rendered span is as wide as 300 characters and the table
    // scrolls the page sideways, while row height and column
    // alignment can both still look fine on a wide viewport.
    const titleBox = await titleText.boundingBox();
    const shortTitleBox = await shortRow
      .locator("span")
      .filter({ hasText: /^Short title$/ })
      .first()
      .boundingBox();
    expect(titleBox).not.toBeNull();
    expect(shortTitleBox).not.toBeNull();
    // Bounded, not proportional to the character count. A 300-char
    // title at ~7px/char would be ~2100px unclamped.
    expect(titleBox!.width).toBeLessThan(600);

    // ...and the table does not push the document into a horizontal
    // scroll, which is what an unclamped title actually does to the
    // user.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, "a long title made the page scroll sideways").toBe(false);

    // Second bullet: row height does not grow to fill the viewport.
    // Compared against the short row rather than an absolute pixel
    // figure, so the assertion survives a type-scale change.
    const longBox = await longRow.boundingBox();
    const shortBox = await shortRow.boundingBox();
    expect(longBox).not.toBeNull();
    expect(shortBox).not.toBeNull();
    expect(longBox!.height).toBeLessThanOrEqual(shortBox!.height * 1.5);

    // ...and the remaining cells stay in their columns: the long row
    // has the same cell count as the short one, and its last cell
    // starts at the same x. A title that pushed the columns would move
    // it.
    expect(await longRow.locator("td").count()).toBe(await shortRow.locator("td").count());
    const longLast = await longRow.locator("td").last().boundingBox();
    const shortLast = await shortRow.locator("td").last().boundingBox();
    expect(Math.abs(longLast!.x - shortLast!.x)).toBeLessThan(2);
  });
});

/**
 * ## Where axe was used, and why it is not in the assertions
 *
 * `@axe-core/playwright` was used to *investigate* these two cases: a
 * scoped `color-contrast` scan on `/list` is what found the app's
 * palette defect (`--text-tertiary` at 3.67:1) and confirmed the
 * primary button's focus ring was invisible against its own fill.
 *
 * It is not in the final assertions, for two separate reasons, and
 * both are worth stating so the next agent does not "fix" this by
 * adding a scan back.
 *
 * 1. **A11Y-16's subject is a pair axe does not measure.** The bullet
 *    asks whether the *focus ring* is visible against the surface it
 *    sits on. `color-contrast` measures text against its background
 *    and reports nothing about outlines, so it cannot answer the
 *    question. The WCAG relative-luminance formula is applied
 *    directly to that pair instead.
 * 2. **A whole-page scan fails for a case it does not claim.** The
 *    contrast defect it finds belongs to **A11Y-40**, which is not one
 *    of the sixteen in this pass. Scanning here would fail A11Y-16 for
 *    someone else's defect; scoping the scan tightly enough to pass
 *    would be tuning it until it agrees, which is worse.
 *
 * A11Y-30 is about *meaning*, which axe cannot see at all: that a
 * status chip carries a text label, an archived row a badge, an
 * over-cap column a named warning. Those are asserted directly.
 */
test.describe("A11Y — colour and focus visibility", () => {
  /**
   * Both themes, because the case says so explicitly. The theme is
   * stored in `localStorage` under `tt-theme` and applied as a `dark`
   * class on `<html>`, so it is seeded before the app boots rather
   * than toggled through the settings UI — which would make this a
   * test of the settings form.
   */
  for (const theme of ["light", "dark"] as const) {
    // @verifies A11Y-16
    test(`A11Y-16: every focusable control on /list carries a visible focus indicator (${theme})`, async ({
      page,
      tracker,
    }) => {
      await tracker.seed([
        { title: "Focus indicator subject", fields: { status: "backlog", priority: "high" } },
      ]);
      await page.addInitScript(t => {
        window.localStorage.setItem("tt-theme", t);
      }, theme);
      await page.goto(`${tracker.baseURL}/list`);
      await expect(page.getByText("Focus indicator subject")).toBeVisible();

      // The theme really is applied — a positive control, because
      // every assertion below would pass in light mode if the seed
      // had silently failed.
      const isDark = await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      );
      expect(isDark).toBe(theme === "dark");

      // Fourth bullet: no control suppresses the browser default with
      // nothing in its place. Walked over every focusable on the page,
      // focusing each and comparing its *own* rendered style focused
      // against unfocused — which is what "an unambiguous focus
      // indicator" means and what reading a stylesheet cannot tell.
      const bad = await page.evaluate(() => {
        const sel = [
          "a[href]",
          "button:not([disabled])",
          "input:not([disabled])",
          "select:not([disabled])",
          "textarea:not([disabled])",
          '[tabindex]:not([tabindex="-1"])',
        ].join(",");
        const offenders: string[] = [];
        const describe = (el: Element): string =>
          `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") !== null ? `[${el.getAttribute("data-testid") ?? ""}]` : ""}` +
          `"${(el.textContent ?? "").trim().slice(0, 24)}"`;
        const snapshot = (el: Element): string => {
          const cs = getComputedStyle(el);
          // The properties any of this app's indicators could use.
          // Compared as a whole so a ring implemented as a box-shadow
          // counts exactly as much as one implemented as an outline.
          return [
            cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.outlineOffset,
            cs.boxShadow, cs.borderColor, cs.borderWidth, cs.backgroundColor,
          ].join("|");
        };
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const rect = el.getBoundingClientRect();
          // Off-screen and zero-size controls have no indicator to
          // show and no user who could see one.
          if (rect.width === 0 || rect.height === 0) continue;
          const before = snapshot(el);
          (el as HTMLElement).focus();
          if (document.activeElement !== el) continue; // refused focus
          const after = snapshot(el);
          (el as HTMLElement).blur();
          if (before === after) offenders.push(describe(el));
        }
        return offenders;
      });
      expect(bad, `no focus indicator on: ${bad.join(", ")}`).toHaveLength(0);
    });

    /**
     * The second bullet: the indicator "is visible against the
     * element's own background in both themes, **including on
     * coloured elements** (status chips, label pills, primary
     * buttons)".
     *
     * That is a contrast measurement between the *ring* and the
     * surface it is painted on — a pair no axe rule reports, because
     * `color-contrast` measures text against its background and says
     * nothing about outlines. So the WCAG relative-luminance formula
     * is applied directly to that pair below.
     *
     * axe was used to *find* this: a scoped `color-contrast` scan on
     * `main` is what surfaced the app's palette problem while this
     * case was being scoped. That finding —`--text-tertiary` (#7b8699)
     * at 3.67:1 on white — is **A11Y-40's** subject, not A11Y-16's,
     * and it is recorded in known-gaps.md rather than being smuggled
     * into this case's tag. Running that scan here would fail this
     * test for a defect it does not claim.
     */
    // @verifies A11Y-16
    test(`A11Y-16: the focus ring meets 3:1 against the control it surrounds, including coloured ones (${theme})`, async ({
      page,
      tracker,
    }) => {
      await tracker.seed([
        { title: "Contrast subject", fields: { status: "backlog", priority: "high" } },
      ]);
      await page.addInitScript(t => {
        window.localStorage.setItem("tt-theme", t);
      }, theme);
      await page.goto(`${tracker.baseURL}/list`);
      await expect(page.getByText("Contrast subject")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.classList.contains("dark")),
      ).toBe(theme === "dark");

      // The focus ring's colour is TRANSITIONED: every control carries
      // `transition-colors`, whose property list includes `outline-color`.
      // Reading `getComputedStyle` in the same tick as `.focus()` samples
      // the animation MID-FLIGHT — it returns the colour being
      // transitioned *from* (the control's previous outline, i.e. its own
      // text colour) rather than the settled `--text-primary`.
      //
      // That is what made this spec report `ring rgb(255,255,255) —
      // 1.00:1` on the header's primary button: the app's CSS is correct
      // and settles at `#0f172a`, but the measurement never waited for it.
      // Two separate attempts to "fix" the CSS failed because there was
      // nothing wrong with it.
      //
      // Disabling transitions for the scan measures the resting state,
      // which is what WCAG's 3:1 is about — a ring a user looks at, not a
      // frame of its fade-in.
      await page.addStyleTag({
        content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
      });

      const weak = await page.evaluate(() => {
        const parse = (css: string): [number, number, number, number] | null => {
          const m = /rgba?\(([^)]+)\)/.exec(css);
          if (m === null) return null;
          const parts = (m[1] ?? "").split(",").map(x => parseFloat(x.trim()));
          const [r, g, b] = parts;
          if (r === undefined || g === undefined || b === undefined) return null;
          return [r, g, b, parts[3] ?? 1];
        };
        const lum = ([r, g, b]: [number, number, number, number]): number => {
          const c = [r, g, b].map(v => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * (c[0] ?? 0) + 0.7152 * (c[1] ?? 0) + 0.0722 * (c[2] ?? 0);
        };
        const ratio = (a: [number, number, number, number], b: [number, number, number, number]): number => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
          return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
        };
        /**
         * The surface the ring is actually painted on.
         *
         * With a positive `outline-offset` the ring sits *outside*
         * the control, on whatever is behind it — so measuring it
         * against the control's own fill asks the wrong question and
         * fails a ring that is perfectly visible. With a zero or
         * negative offset the ring overlaps the control, and the
         * control's fill is the right background.
         *
         * Both are checked where the ring straddles the boundary, and
         * the *better* of the two is what the user perceives: a ring
         * only has to be distinguishable from one side to read as a
         * ring.
         */
        const surfacesFor = (el: Element): {
          own: [number, number, number, number];
          outside: [number, number, number, number];
        } => {
          const own = ((): [number, number, number, number] => {
            let cur: Element | null = el;
            while (cur !== null) {
              const c = parse(getComputedStyle(cur).backgroundColor);
              if (c !== null && c[3] > 0) return c;
              cur = cur.parentElement;
            }
            return [255, 255, 255, 1];
          })();
          const outside = ((): [number, number, number, number] => {
            let cur: Element | null = el.parentElement;
            while (cur !== null) {
              const c = parse(getComputedStyle(cur).backgroundColor);
              if (c !== null && c[3] > 0) return c;
              cur = cur.parentElement;
            }
            return [255, 255, 255, 1];
          })();
          // A ring drawn *outside* the control only ever sits on the
          // page behind it. A ring at zero or negative offset
          // overlaps the control, so it has to clear the bar against
          // the control's own fill — that is exactly the "including
          // on coloured elements" half of the bullet, and taking the
          // friendlier of the two surfaces would let an
          // accent-on-accent ring pass.
          return { own, outside };
        };
        const offenders: string[] = [];
        const sel = [
          "a[href]",
          "button:not([disabled])",
          "input:not([disabled])",
          '[tabindex]:not([tabindex="-1"])',
        ].join(",");
        for (const el of Array.from(document.querySelectorAll(`main ${sel}, aside ${sel}`))) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          (el as HTMLElement).focus();
          if (document.activeElement !== el) continue;
          const cs = getComputedStyle(el);
          // The ring is whichever of these the app actually paints.
          const ringCss =
            cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0
              ? cs.outlineColor
              : /rgba?\(/.exec(cs.boxShadow)?.[0] !== undefined
                ? (/rgba?\([^)]+\)/.exec(cs.boxShadow)?.[0] ?? "")
                : "";
          // Read while still focused: `outline-offset` only takes its
          // focused value while the element matches `:focus-visible`,
          // and reading it after `blur()` reports the resting value —
          // which sent every offset ring down the overlapping branch.
          const offset = parseFloat(cs.outlineOffset);
          (el as HTMLElement).blur();
          if (ringCss === "") continue; // no ring: the other test's subject
          const ring = parse(ringCss);
          if (ring === null || ring[3] === 0) continue;
          // 3:1 is the WCAG bar for a non-text indicator, against
          // every surface the ring is actually painted on.
          const { own, outside } = surfacesFor(el);
          const surfaces = offset > 0 ? [outside] : [own];
          const worst = Math.min(...surfaces.map(bg => ratio(ring, bg)));
          if (worst < 3) {
            offenders.push(
              `${el.tagName.toLowerCase()}"${(el.textContent ?? "").trim().slice(0, 20)}" ring ${ringCss} — ${worst.toFixed(2)}:1`,
            );
          }
        }
        return offenders;
      });

      expect(weak, weak.join("\n")).toHaveLength(0);
    });
  }

  // @verifies A11Y-30
  test("A11Y-30: status, priority, an archived task and the active route all carry a non-colour signal", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "urgent"]);
    // Frontmatter stores the label *id*, not its name — writing
    // `[urgent]` renders as "unknown label", which would have made the
    // fifth bullet's assertion pass against the wrong thing.
    const labelId = /^\s*-?\s*id:\s*(\S+)/m.exec(
      await readFile(path.join(tracker.root, ".loctt", "config", "labels.yaml"), "utf8"),
    )?.[1];
    expect(labelId, "could not read the seeded label's id").toBeDefined();
    const [live, archived] = await tracker.seed([
      { title: "Live task", fields: { status: "backlog", priority: "high", labels: `[${String(labelId)}]` } },
      { title: "Archived task", fields: { status: "backlog", priority: "low" } },
    ]);
    await tracker.run(["archive", String(archived)]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Live task")).toBeVisible();

    const liveRow = page.locator("tbody tr").filter({ hasText: String(live) });

    // First bullet: status and priority carry a *text label*, so a
    // greyscale screenshot stays readable. Asserted as text rather
    // than as "an element exists", because a coloured dot with no
    // label is exactly the failure this case names.
    await expect(liveRow).toContainText("Backlog");
    await expect(liveRow).toContainText("High");

    // Fifth bullet: a label pill always renders its text name, because
    // its colour is user-chosen and carries nothing reliable.
    await expect(page.locator("tbody tr").filter({ hasText: String(live) })).toContainText("urgent");

    // Fourth bullet: the active sidebar route is marked by more than a
    // colour change. `aria-current="page"` is the assistive-tech
    // signal the bullet names; the weight change is the visual one.
    // The router also stamps `aria-current` on the matching <a>, so
    // this targets the sidebar entry's own element — the one that
    // carries the weight change as well.
    const activeEntry = page.locator('span[aria-current="page"][data-active="true"]').first();
    await expect(activeEntry).toBeVisible();

    // Positive control: the marker is on *one* entry, not stamped on
    // every one. Without this the assertion would pass against a
    // sidebar that marked everything current, which distinguishes
    // nothing.
    const marked = await page.locator('span[aria-current="page"]').count();
    const allEntries = await page.locator("aside span[data-active], aside a span").count();
    expect(marked).toBeGreaterThan(0);
    expect(marked).toBeLessThan(allEntries);

    // ...and the visual half, so the distinction survives a greyscale
    // screenshot too: the active entry is bolder, not merely tinted.
    const activeWeight = Number(
      await activeEntry.evaluate(el => getComputedStyle(el).fontWeight),
    );
    const inactiveWeight = Number(
      // A sibling entry shell — matched by the same layout class the
      // active one has, so this compares like with like rather than
      // picking up a nested span inside the active row.
      await page
        .locator('aside a > span:not([data-active="true"])')
        .first()
        .evaluate(el => getComputedStyle(el).fontWeight),
    );
    expect(activeWeight).toBeGreaterThan(inactiveWeight);

    // Third bullet (amended, K121 #1): the list no longer shows archived
    // tasks, so the badge is read where one is still shown — its own
    // page, by direct link. A word, not only a dimmed header.
    await page.goto(`${tracker.baseURL}/tasks/${String(archived)}`);
    await expect(page.getByTestId("archived-badge")).toHaveText(/archived/i);
  });

  // @verifies A11Y-30
  test("A11Y-30: an over-cap column is identifiable without colour", async ({
    page,
    tracker,
  }) => {
    // A WIP cap of 1 with two tasks in the column is the over-cap
    // state; the third bullet asks for both the count and a named
    // warning glyph.
    await tracker.seed([
      { title: "Over cap one", fields: { status: "backlog" } },
      { title: "Over cap two", fields: { status: "backlog" } },
    ]);
    await setBoards(
      tracker.root,
      [
        "boards:",
        "  columns:",
        "    - key: todo",
        "      label: To do",
        "      statuses: [backlog]",
        "      wip: 1",
      ].join("\n"),
    );
    await page.goto(`${tracker.baseURL}/board`);

    const count = page.getByTestId("board-count-todo");
    await expect(count).toBeVisible();
    // "a count like 6 / 4" — both numbers, readable in greyscale.
    await expect(count).toHaveText(/2\s*\/\s*1/);
    await expect(count).toHaveAttribute("data-wip-state", "over");

    // "...and a warning glyph with an accessible name". The name is
    // the point: a bare ⚠ with `aria-hidden` would leave a screen
    // reader with only the numbers, and the numbers alone do not say
    // that 2/1 is a violation rather than a target.
    const warning = page.getByTestId("board-wip-warning-todo");
    await expect(warning).toBeVisible();
    await expect(warning).toHaveAccessibleName(/over wip limit/i);
  });
});

/**
 * A11Y-40: contrast holds across the app in both themes. The primary
 * gate is an axe-core `color-contrast` scan on the real rendered pages —
 * axe measures the computed foreground against the actual background
 * (opacity, layering, the lot), which a static palette check cannot. The
 * static token harness (`apps/web/src/client/styles/contrast.test.ts`) is
 * the fast supplement that pins the palette; this is the in-situ proof.
 *
 * The scan is deliberately whole-page here (not scoped) BECAUSE the case
 * asks for exactly that — contrast across header, sidebar, rows, chips,
 * pills, disabled, placeholder, banner. A whole-page color-contrast scan
 * that passes is the honest form of "contrast holds across the page".
 * The palette was brought to zero color-contrast violations 2026-09-11
 * (status-active/completed/success fg darkened to clear 4.5:1); this
 * keeps it there. See decisions.md A-CONTRAST.
 *
 * @verifies A11Y-40
 */
test.describe("A11Y — contrast in situ (A11Y-40)", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const path of ["/list", "/board", "/milestones", "/sprints", "/settings/workflow"]) {
      test(`A11Y-40: no color-contrast violations on ${path} (${theme})`, async ({
        page,
        tracker,
      }) => {
        await tracker.seed([
          { title: "Contrast A", fields: { status: "in_progress", priority: "high" } },
          { title: "Contrast B", fields: { status: "done", priority: "low" } },
        ]);
        await page.addInitScript(t => {
          try { window.localStorage.setItem("tt-theme", t); } catch { /* ignore */ }
        }, theme);
        await page.goto(`${tracker.baseURL}${path}`);
        // Let data-driven chips/rows render before scanning.
        await page.waitForTimeout(500);

        const results = await new AxeBuilder({ page })
          .withRules(["color-contrast"])
          .analyze();

        const summary = results.violations
          .flatMap(v => v.nodes.map(n => `${n.target.join(" ")}: ${n.failureSummary ?? ""}`))
          .join("\n");
        expect(results.violations, summary).toHaveLength(0);
      });
    }
  }
});

test.describe("A11Y — focus through change", () => {
  // @verifies A11Y-18
  test("A11Y-18: opening an inline editor moves focus into it, and closing returns focus to the trigger", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Inline editor subject" }]);
    await page.goto(`${tracker.baseURL}/tasks/${String(key)}`);
    await expect(page.getByTestId("meta-panel")).toBeVisible();

    // Driven from the keyboard: the trigger is reached and activated
    // with the keyboard, so this verifies the path a keyboard user
    // actually takes rather than a click's side effects.
    const trigger = page.getByTestId("meta-edit-estimate");
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("Enter");

    // First bullet: focus moves *into* the newly rendered input rather
    // than staying behind it. This is the assertion a "the input is
    // visible" check would miss entirely — an editor that renders and
    // leaves focus on the trigger is the exact failure the case names.
    const input = page.getByTestId("meta-input-estimate");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();

    // ...and it is really usable from there, without a further click.
    await page.keyboard.type("5");
    await expect(input).toHaveValue("5");

    // Second bullet: closing the inline editor returns focus to the
    // field's trigger row — not to `document.body`, which would send
    // the next Tab back to the top of the document.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("meta-input-estimate")).toBeHidden();
    // Asserted positively. "Focus is not on the input" would pass with
    // focus on `body`, which A11Y-45 forbids by name.
    await expect(page.getByTestId("meta-edit-estimate")).toBeFocused();
  });

  // @verifies A11Y-19
  test("A11Y-19: tab order follows visual order and uses no positive tabindex", async ({
    page,
    tracker,
  }) => {
    await tracker.seed([{ title: "Tab order subject" }]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Tab order subject")).toBeVisible();

    // Third bullet, asserted first because it is absolute: no positive
    // `tabindex` anywhere. A positive value forces an order that
    // fights the DOM and silently reorders everything else on the
    // page.
    const positives = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[tabindex]"))
        .map(el => ({ tag: el.tagName, ti: Number(el.getAttribute("tabindex")) }))
        .filter(x => x.ti > 0)
        .map(x => `${x.tag}[tabindex=${String(x.ti)}]`),
    );
    expect(positives, positives.join(", ")).toHaveLength(0);

    // First bullet: header → sidebar → main pane. Walked by pressing
    // Tab and recording which region each stop lands in, then checking
    // the regions appear in that order and never interleave — which is
    // what "matching what a sighted user reads" means, and what a test
    // that only counted stops would miss.
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    const regions: string[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 120; i += 1) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (el === null || el === document.body) return { region: "body", id: "" };
        const region =
          el.closest("header") !== null ? "header"
          : el.closest("aside") !== null ? "aside"
          : el.closest("main") !== null ? "main"
          : "other";
        // A stable-enough identity for one stop, to detect the wrap.
        //
        // `aria-label` is part of the identity: several header controls
        // are now icon-only with no text and no testid (the brand pass
        // and the responsive header), so without it two DIFFERENT
        // buttons collapse to the same key (`BUTTON||`), the walk reads
        // that as having wrapped, and it breaks inside the header —
        // recording one region instead of three and failing against the
        // app's correct tab order.
        return {
          region,
          id: [
            el.tagName,
            el.getAttribute("data-testid") ?? "",
            el.getAttribute("aria-label") ?? "",
            (el.textContent ?? "").trim().slice(0, 20),
          ].join("|"),
        };
      });
      if (stop.region === "body" || stop.region === "other") continue;
      // Tab cycles: once a stop repeats, the walk has wrapped to the
      // top and everything after it is the second lap. Without this
      // the recorded order reads header,aside,main,header,aside and
      // the assertion below fails on the app's *correct* behaviour.
      const stopKey = `${stop.region}:${stop.id}`;
      if (seen.has(stopKey)) break;
      seen.add(stopKey);
      if (regions[regions.length - 1] !== stop.region) regions.push(stop.region);
    }

    // Each region is entered once: a sequence like
    // header,aside,main,aside would mean the order interleaves.
    expect(regions, `tab order visited: ${regions.join(" → ")}`).toEqual(
      Array.from(new Set(regions)),
    );
    // ...and in the documented order.
    const expectedOrder = ["header", "aside", "main"].filter(r => regions.includes(r));
    expect(regions).toEqual(expectedOrder);
    // A positive control: the walk actually reached more than one
    // region, so an "order is correct" pass cannot come from a walk
    // that never left the header.
    expect(regions.length).toBeGreaterThan(1);
  });
});

test.describe("A11Y — undo without a pointer", () => {
  // @verifies A11Y-36
  test("A11Y-36: Undo after an archive is reachable and operable by keyboard, and does not expire", async ({
    page,
    tracker,
  }) => {
    const keys = await tracker.seed([
      { title: "Undo subject one" },
      { title: "Undo subject two" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Undo subject one")).toBeVisible();

    // Archive by keyboard throughout — the case says "reach Undo
    // without a pointer", and a `.click()`-driven test would not
    // verify it.
    for (const k of keys) {
      const box = page.getByRole("checkbox", { name: `Select ${String(k)}` });
      await box.focus();
      await page.keyboard.press("Space");
    }
    const archive = page
      .getByRole("region", { name: "Bulk actions" })
      .getByRole("button", { name: "Archive", exact: true });
    await archive.focus();
    await page.keyboard.press("Enter");

    const undo = page.getByRole("button", { name: "Undo" });
    await expect(undo).toBeVisible();

    // The archive really happened, so the Undo below has something to
    // undo. Read off disk — a UI-only check would let a no-op pass.
    await expect
      .poll(async () => readTaskFile(tracker.root, String(keys[0])), { timeout: 5_000 })
      .toMatch(/^archived: true$/m);

    // Second bullet: this affordance is not transient. It is still
    // here well past the 6s toast lifetime, so a keyboard user who
    // needed longer than a mouse user to reach it is not worse off —
    // which is exactly what the bullet protects.
    await page.waitForTimeout(7_000);
    await expect(undo).toBeVisible();

    // First bullet: reachable *by keyboard*, asserted by tabbing to it
    // rather than by calling `.focus()` — a control that is visible
    // but outside the tab order would pass the latter and fail the
    // case.
    let reached = false;
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press("Tab");
      if (await undo.evaluate(el => el === document.activeElement)) {
        reached = true;
        break;
      }
    }
    expect(reached, "Undo was never reached by Tab").toBe(true);

    // ...and it works from the keyboard, which is the whole point.
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => readTaskFile(tracker.root, String(keys[0])), { timeout: 10_000 })
      .not.toMatch(/^archived: true$/m);
  });
});

test.describe("A11Y — sidebar and full-cycle keyboard operation", () => {
  /**
   * A11Y-9: the list → open → change status → save → back cycle, driven
   * with no pointer. Real key events throughout — a `.click()` anywhere
   * in the open/traverse/commit path would prove nothing about keyboard
   * operability.
   *
   * Four of the case's five bullets are exercised here:
   *
   * 1. **Row keyboard-activatable, not click-only.** The row's key link
   *    is a real `<a>` and the row's single, ARIA-correct Tab target
   *    (no `tabIndex` on the `<tr>`, which would double the stop and
   *    make a reader announce the row twice). Focusing it and pressing
   *    Enter opens the task — the thing a bare `<tr onClick>` could not.
   * 2. **Status dropdown opens on Enter, options arrow-traversable,
   *    Enter commits.** The picker is `ui/Combobox` (via OptionPicker),
   *    whose keyboard model is proven in Combobox.test.tsx; here it is
   *    driven end to end and the committed value is checked *on disk*,
   *    so the keyboard path is verified no more weakly than the pointer
   *    one (the A11Y-28 discipline).
   * 5. **Return restores focus at/near the opened row.** Back lands
   *    focus on that row's key-link anchor, not on `document.body`.
   *
   * The fourth bullet — "the save outcome is announced (A11Y-24)" — is
   * now satisfied: A11Y-24 landed, and the field-save path announces the
   * outcome through the shell's live region. This test asserts the
   * successful status save IS announced ("Status saved") in the polite
   * region, which is what A11Y-9's fourth bullet requires; the flip from
   * the previous negative assertion is deliberate and is the day the
   * A11Y-9 note in known-gaps.md said to revisit.
   *
   * @verifies A11Y-9
   */
  test("A11Y-9: the list → open → change status → save → back cycle works with no pointer", async ({
    page,
    tracker,
  }) => {
    const [key] = await tracker.seed([{ title: "Keyboard cycle subject" }]);
    const taskKey = String(key);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Keyboard cycle subject")).toBeVisible();

    // (1) Reach the row and open it from the keyboard. The key link is
    // the row's keyboard-operable primary action; Enter on a real anchor
    // navigates natively.
    const rowLink = page.getByRole("link", { name: taskKey });
    await rowLink.focus();
    await expect(rowLink).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/tasks/${taskKey}$`));

    // The stored status before the edit, so the disk assertion later is
    // about a value we watched change.
    const before = await readTaskFile(tracker.root, taskKey);
    const statusBefore = /^status:\s*(\S+)\s*$/m.exec(before)?.[1];

    // (2) Open the status dropdown on Enter, traverse with ArrowDown,
    // commit with Enter — entirely from the keyboard.
    const trigger = page.getByTestId("meta-edit-status");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const listbox = page.getByTestId("meta-options-status");
    await expect(listbox).toBeVisible();

    // ArrowDown moves the active option and Enter picks it. The default
    // status set has several options under the search threshold, so the
    // trigger's ArrowDown moves focus into the list; a further ArrowDown
    // advances past the first option so the pick is a real change.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(listbox).toBeHidden();

    // The commit landed on disk — the keyboard path verified against the
    // file, not just the DOM (A11Y-28 discipline).
    await expect
      .poll(async () => {
        const text = await readTaskFile(tracker.root, taskKey);
        return /^status:\s*(\S+)\s*$/m.exec(text)?.[1];
      }, { timeout: 10_000 })
      .not.toBe(statusBefore);

    // Fourth bullet, now satisfied (A11Y-24 landed): the successful save
    // is announced politely in the shell's live region, so a non-sighted
    // user knows the edit landed. Naming the field ("Status saved"), and
    // in the polite region — a routine confirmation is not an interrupt.
    await expect(page.getByTestId("announcer-polite")).toContainText(/status saved/i);

    // (5) Return to the list; focus lands on the opened row's anchor,
    // not on document.body / the top of the page.
    await page.goBack();
    await expect(
      page.locator("tbody tr").filter({ hasText: "Keyboard cycle subject" }),
    ).toHaveCount(1);
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          return el?.getAttribute("data-task-key") ?? null;
        }), { timeout: 5_000 })
      .toBe(taskKey);
  });
});

test.describe("A11Y — zoom and blocking screens", () => {
  // @verifies A11Y-38
  test("A11Y-38: browser zoom to 200% keeps the list → open → edit → save flow usable", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    // A layout that throws at zoom and one that renders off-screen look
    // the same to a locator that times out. This separates them.
    page.on("pageerror", e => pageErrors.push(e.message));

    // The case says "a 1280px-wide window" zoomed to 200%. Browser zoom
    // scales CSS pixels: at 200% the layout sees half the CSS width, so
    // a 1280px window behaves as a 640px one. Playwright has no zoom
    // knob, so the emulation the harness supports is `zoom: 2` on the
    // document — which is what a Chromium "200%" actually applies — over
    // a 1280px viewport. The load-bearing observable (does the *page
    // body* scroll horizontally) is unaffected by which mechanism sets
    // the scale.
    await page.setViewportSize({ width: 1280, height: 800 });

    // A wide table is the thing most likely to force page-level
    // horizontal scroll, so seed enough rows and long titles to make
    // the table its natural full width before zooming.
    await tracker.seed([
      { title: "Zoom flow subject with a deliberately long title for width" },
      { title: "Second row also carrying a long descriptive title here" },
      { title: "Third row to give the table real content and width" },
    ]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(
      page.getByText("Zoom flow subject with a deliberately long title for width"),
    ).toBeVisible();

    // Apply the 200% zoom. `zoom` (not `transform: scale`) is what the
    // browser's own zoom control sets, and unlike a transform it feeds
    // back into layout and scrollWidth exactly as real zoom does.
    await page.evaluate(() => {
      (document.documentElement.style as unknown as { zoom: string }).zoom = "2";
    });

    // Core assertion, first bullet: the page body does not scroll
    // horizontally. Read after zoom, off the real layout. `+1` absorbs
    // sub-pixel rounding that Chromium can leave in scrollWidth.
    const bodyOverflow = await page.evaluate(() => {
      const b = document.body;
      return { scrollWidth: b.scrollWidth, clientWidth: b.clientWidth };
    });
    expect(
      bodyOverflow.scrollWidth,
      `body scrolls horizontally at 200% zoom: scrollWidth ${bodyOverflow.scrollWidth} > clientWidth ${bodyOverflow.clientWidth}`,
    ).toBeLessThanOrEqual(bodyOverflow.clientWidth + 1);

    // Positive control for that absence: the "no horizontal scroll"
    // check would pass on a blank page, so prove the content the case
    // is about is actually rendered at this zoom. The table is present
    // and its rows are laid out with real width — if the table were
    // gone, the body could not overflow and the assertion above would
    // be vacuous.
    const table = page.getByRole("table", { name: "Tasks" });
    await expect(table).toBeVisible();
    const tableWidth = await table.evaluate(el => el.scrollWidth);
    expect(tableWidth, "the table rendered with no width — nothing to overflow").toBeGreaterThan(0);

    // Second bullet: the header, sidebar toggle, and create button
    // remain reachable. "Reachable" is asserted as visible *and*
    // enabled at this zoom — a control pushed off-screen, disabled, or
    // under another layer is present-in-DOM but not reachable.
    await expect(page.getByRole("banner")).toBeVisible();
    const sidebarToggle = page.getByRole("button", { name: /Toggle sidebar/i });
    await expect(sidebarToggle).toBeEnabled();
    const createButton = page.getByTestId("header-new-task");
    await expect(createButton).toBeEnabled();

    // Third bullet: a modal fits or scrolls internally while its action
    // buttons stay reachable. Open the create modal — this is also the
    // "open" step verified at zoom — and confirm both the panel and its
    // Create button sit inside the viewport.
    await createButton.click();
    const modal = page.getByTestId("create-task-modal");
    await expect(modal).toBeVisible();

    // Fit and reachability are read inside one frame. Under CSS `zoom`,
    // `getBoundingClientRect` reports *visual* coordinates (already
    // multiplied by the zoom), while `innerHeight` stays the device
    // window height — so the visual viewport height is `innerHeight *
    // zoom`. Mixing Playwright's `boundingBox()` (visual frame) with
    // `viewportSize()` (device frame) is exactly the frame error that
    // makes a fitting modal read as overflowing, so every value below
    // is taken from the same `getBoundingClientRect`/`innerHeight`
    // computation in the page.
    const createSubmit = modal.getByRole("button", { name: "Create task" });
    await expect(createSubmit).toBeVisible();

    const fit = await page.evaluate(() => {
      const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const visualH = window.innerHeight * zoom;
      const m = document.querySelector('[data-testid="create-task-modal"]')!;
      const btn = [...m.querySelectorAll("button")].find(
        b => (b.textContent ?? "").trim() === "Create task",
      )!;
      const mr = m.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      return {
        visualH,
        modalTop: mr.top,
        modalBottom: mr.bottom,
        btnTop: br.top,
        btnBottom: br.bottom,
      };
    });
    // The panel is capped at calc(100vh-2rem) with an internal scroll,
    // so it fits within the (zoom-scaled) viewport top-to-bottom rather
    // than running off it.
    expect(fit.modalTop).toBeGreaterThanOrEqual(-1);
    expect(fit.modalBottom).toBeLessThanOrEqual(fit.visualH + 1);
    // Its action button stays within that same viewport, top and bottom
    // — the bullet's "keeping their action buttons reachable".
    expect(fit.btnTop).toBeGreaterThanOrEqual(0);
    expect(fit.btnBottom).toBeLessThanOrEqual(fit.visualH + 1);
    // And it is actually operable, not merely painted: the submit is
    // disabled on an empty form by design, so fill the title and
    // confirm it enables. A button that is visible and within the
    // viewport but permanently inert would not be "reachable" in the
    // sense the bullet means.
    await modal.getByLabel("Title").fill("Created under 200% zoom");
    await expect(createSubmit).toBeEnabled();

    // Close the modal and complete the flow's edit → save at zoom, so
    // the case's full "list → open → edit → save cycle" is exercised
    // under 200%, not just the list view. Clear the title first so the
    // form is pristine — a dirty form raises a discard confirmation,
    // which is that modal's own behaviour, not this case's subject.
    await modal.getByLabel("Title").fill("");
    await page.getByTestId("create-close").click();
    await expect(modal).toBeHidden();

    await page.getByText("Zoom flow subject with a deliberately long title for width").click();
    const heading = page.getByRole("heading", {
      name: "Zoom flow subject with a deliberately long title for width",
      level: 1,
    });
    await expect(heading).toBeVisible();

    // The detail pane must not force page-level horizontal scroll
    // either — re-read the body overflow now that a different, wider
    // view is mounted.
    const detailOverflow = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    }));
    expect(
      detailOverflow.scrollWidth,
      `detail pane scrolls the body horizontally at 200% zoom: ${detailOverflow.scrollWidth} > ${detailOverflow.clientWidth}`,
    ).toBeLessThanOrEqual(detailOverflow.clientWidth + 1);

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });

  // @verifies A11Y-49
  test("A11Y-49: the crashed-migration screen is announced as an alert with selectable recovery text and a steps list", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    // The blocking screen throwing on render and rendering nothing look
    // identical to a role query that finds no alert. This separates
    // them.
    page.on("pageerror", e => pageErrors.push(e.message));

    await tracker.seed([{ title: "Data behind the wall" }]);

    // SHL-37 / XS-37: the server reports `interrupted` when the sentinel
    // file is present, carrying its recorded from/to and backup path.
    // Write it exactly as schema-guard reads it — the same shape the
    // server test seeds.
    const backup = path.join(tracker.root, ".loctt.backup-v1-20260828-abc123");
    await writeFile(
      path.join(tracker.root, ".loctt", ".schema-migration-in-progress"),
      `from: 1\nto: 2\nbackup: ${backup}\n`,
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);

    // First bullet: the blocking screen is announced immediately as an
    // alert. `role="alert"` on the container, reachable early — asserted
    // via the browser's own accessibility tree.
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("data-kind", "interrupted");
    await expect(alert).toContainText(/did not finish/i);

    // Positive control: the ordinary shell is NOT behind it. If this
    // were the browsable banner instead of the blocking screen, the
    // sidebar toggle and the task list would be present — the case is
    // explicit that this is a distinct screen with nothing safe to
    // show.
    await expect(page.getByRole("button", { name: /Toggle sidebar/i })).toHaveCount(0);
    await expect(page.getByText("Data behind the wall")).toHaveCount(0);

    // Second bullet: the from/to versions and the backup path are
    // readable text — selectable and copyable, not an image and not
    // truncated. Assert the *rendered text* carries the real path in
    // full (a middle-truncated path would drop the substring), and that
    // it lives in a real text node the browser exposes, not an <img>.
    await expect(alert).toContainText("v1");
    await expect(alert).toContainText("v2");
    await expect(alert).toContainText(backup);

    // "Selectable and copyable" is the load-bearing half: the path is
    // real DOM text a user can select, not baked into an image or a
    // background. Locate the exact node and confirm its own textContent
    // holds the whole path, and that no ancestor is an <img>/SVG.
    const backupNode = alert.getByText(backup, { exact: false });
    await expect(backupNode).toBeVisible();
    const nodeReadable = await backupNode.first().evaluate((el, expected) => {
      const text = el.textContent ?? "";
      const tag = el.tagName.toLowerCase();
      // No user-select:none anywhere up the chain would block copying.
      let cur: HTMLElement | null = el as HTMLElement;
      let selectable = true;
      while (cur) {
        if (getComputedStyle(cur).userSelect === "none") selectable = false;
        cur = cur.parentElement;
      }
      return { hasFull: text.includes(expected), tag, selectable };
    }, backup);
    expect(nodeReadable.hasFull, "backup path is truncated in the DOM").toBe(true);
    expect(nodeReadable.tag, "backup path is rendered as an image, not text").not.toBe("img");
    expect(nodeReadable.selectable, "backup path is not selectable/copyable").toBe(true);

    // Third bullet: the recovery steps are structured as a list so they
    // can be navigated item-by-item — an <ol> of <li>, not a wall of
    // prose. Asserted through the accessibility tree (`role="list"`),
    // and that it holds more than one navigable step.
    const steps = alert.getByRole("list");
    await expect(steps).toBeVisible();
    const items = steps.getByRole("listitem");
    expect(await items.count()).toBeGreaterThan(1);
    // The first step names the backup as the route to the data — the
    // list is the recovery, not decoration.
    await expect(items.first()).toContainText(/backup/i);

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });

  // @verifies A11Y-49
  test("A11Y-49: when no backup was recorded, the screen shows the documented fallback, not a blank", async ({
    page,
    tracker,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));

    await tracker.seed([{ title: "Recoverable" }]);

    // A sentinel whose contents were lost (or never recorded a backup).
    // The file's *presence* is the fact that matters; its emptiness
    // must degrade to the documented fallback, never a blank where the
    // path would be. This is the "if the backup path is absent it shows
    // the documented fallback" clause.
    await writeFile(
      path.join(tracker.root, ".loctt", ".schema-migration-in-progress"),
      "garbage\n",
      "utf8",
    );

    await page.goto(`${tracker.baseURL}/list`);

    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("data-kind", "interrupted");

    // The backup readout falls back to the documented sentence rather
    // than printing "undefined" or leaving the field blank.
    await expect(alert).toContainText(/not recorded/i);
    await expect(alert).not.toContainText("undefined");
    // The sentinel path itself is still readable — it is the user's
    // pointer to the file that holds what the backup line could not.
    await expect(alert).toContainText(".schema-migration-in-progress");
    // The steps list survives a contentless sentinel.
    await expect(alert.getByRole("list").getByRole("listitem").first()).toBeVisible();

    expect(pageErrors, pageErrors.join("\n")).toHaveLength(0);
  });
});

test.describe("A11Y-55 — pointer targets are at least 24px (WCAG 2.5.8)", () => {
  // @verifies A11Y-55
  test("A11Y-55: the avatar button and a filtering label pill are at least 24px", async ({
    page,
    tracker,
  }) => {
    await tracker.run(["label", "create", "infra"]);
    await tracker.run(["create", "Tagged", "--label", "infra"]);
    await page.goto(`${tracker.baseURL}/list`);
    await expect(page.getByText("Showing 1–1 of 1")).toBeVisible();

    // Measured, not read off a class: the header avatar was 22×22 and a
    // list label pill 21.2px tall on padding alone (B4, K121).
    const avatar = await page.getByTestId("user-menu-trigger").boundingBox();
    expect(avatar?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(avatar?.height ?? 0).toBeGreaterThanOrEqual(24);

    // In the list the pill is a <button> that filters by its label
    // (LST-5), so it is a pointer target.
    const pill = page.locator("tbody tr").first().getByTitle("infra", { exact: true });
    await expect(pill).toBeVisible();
    expect(await pill.evaluate(el => el.tagName)).toBe("BUTTON");
    const box = await pill.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(24);
  });

  // @verifies A11Y-55
  test("A11Y-55: every pointer target on every Settings page is at least 24px", async ({
    page,
    tracker,
  }) => {
    // Enough content that the reorder handles, pin rows and toggles render.
    await tracker.run(["label", "create", "infra"]);
    await tracker.run(["create", "Tagged", "--label", "infra"]);
    await page.goto(`${tracker.baseURL}/settings/projects`);
    const sections = await page.locator('a[href^="/settings/"]').evaluateAll(
      els => [...new Set(els.map(e => e.getAttribute("href") ?? ""))],
    );
    const small: string[] = [];
    for (const href of sections) {
      await page.goto(`${tracker.baseURL}${href}`);
      await expect(page.getByTestId("settings-panel-title").or(page.locator("main h1")).first()).toBeVisible();
      const found = await page.evaluate(() => {
        const main = document.querySelector("main");
        const panel = main === null ? null : main.lastElementChild;
        if (panel === null) return [];
        return [...panel.querySelectorAll("button,a[href],[role=button],input[type=checkbox]")]
          .filter(e => (e as HTMLElement).offsetParent !== null)
          .map(e => ({ e, r: e.getBoundingClientRect() }))
          .filter(({ r }) => r.width < 24 || r.height < 24)
          .map(({ e, r }) => `${(e.getAttribute("aria-label") ?? e.textContent ?? "").trim().slice(0, 30)} ${r.width.toFixed(1)}x${r.height.toFixed(1)}`);
      });
      for (const f of found) small.push(`${href}: ${f}`);
    }
    // Before B4 this listed the drag handles (15x17), Pin, Hide/Show,
    // Reset and Delete view (17px tall) and the card-layout toggles (21px).
    expect(small).toEqual([]);
  });
});
