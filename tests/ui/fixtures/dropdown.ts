/**
 * E2E helpers for the K106 button-based `Dropdown` / `SelectCombobox`.
 *
 * The ~18 former native `<select>` sites are now button-triggered
 * listboxes whose panel is PORTALLED to `document.body` (K106 step 2, so
 * an inline panel is no longer clipped by an ancestor's `overflow` —
 * defect MENU-PORTAL). Two consequences for a spec:
 *
 *  - `page.selectOption(...)` throws ("Element is not a `<select>`");
 *    picking is open-then-click, because the options only exist in the
 *    DOM while the panel is open.
 *  - the panel is NOT a descendant of the dialog/container that owns its
 *    trigger, so a locator scoped to that dialog will not find the
 *    options. Every locator here is scoped to `page` on purpose.
 *
 * These mirror `apps/web/src/client/ui/selectComboboxTestUtils.ts`, which
 * is how the unit suite was migrated — same semantics, same throw-on-
 * missing-option contract.
 *
 * ## The weakening trap this exists to avoid
 *
 * `docs/dev/known-gaps.md`: a native `<select>`'s `.value` could only
 * report a value that HAD a matching `<option>`, but `data-value` echoes
 * draft state regardless. So porting `toHaveValue(x)` to
 * `toHaveAttribute("data-value", x)` SILENTLY WEAKENS the assertion — it
 * would now pass for a value the control does not even offer. Use
 * {@link expectComboValue}, which asserts BOTH: the value is selected AND
 * the option is actually offered.
 */

import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The open listbox belonging to `trigger`.
 *
 * Resolved through the trigger's `aria-controls` (set only while open),
 * then looked up from `page` — never from the trigger's own subtree,
 * because the panel is portalled to `document.body`.
 */
async function openListOf(page: Page, trigger: Locator): Promise<Locator> {
  const listId = await trigger.getAttribute("aria-controls");
  if (listId === null) {
    throw new Error("the dropdown did not open (no aria-controls on the trigger).");
  }
  const list = page.locator(`[id="${listId}"]`);
  await expect(list).toBeVisible();
  return list;
}

/** Opens `trigger`'s panel if it is not already open, and returns the list. */
async function ensureOpen(page: Page, trigger: Locator): Promise<Locator> {
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  return openListOf(page, trigger);
}


/** The stored keys the dropdown `testId` offers, in order. */
export async function comboValues(page: Page, testId: string): Promise<string[]> {
  return (await comboOptions(page, testId)).map(o => o.value);
}

/** The `{ value, label }` pairs the dropdown `testId` offers, in order. */
export async function comboOptions(
  page: Page,
  testId: string,
): Promise<{ value: string; label: string }[]> {
  const trigger = page.getByTestId(testId);
  const list = await ensureOpen(page, trigger);
  const listId = await list.getAttribute("id");
  const prefix = `${listId ?? ""}-opt-`;
  const rows = await list.getByRole("option").evaluateAll(
    nodes => nodes.map(n => ({ id: n.id, label: n.textContent ?? "" })),
  );
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  return rows.map(r => ({
    value: r.id.startsWith(prefix) ? decodeURIComponent(r.id.slice(prefix.length)) : "",
    label: r.label,
  }));
}



/** The row for `value` inside an already-open `list`. */
function optionRow(list: Locator, listId: string, value: string): Locator {
  return list.locator(`[id="${listId}-opt-${encodeURIComponent(value)}"]`);
}

/**
 * Picks `value` from a trigger already in hand: opens the panel, clicks
 * the option whose stored key matches, and leaves the panel closed
 * (single-select closes on pick).
 *
 * Throws naming the value when no such option is offered — the failure a
 * silent no-op would otherwise hide, since clicking nothing looks exactly
 * like a control that ignored the change.
 */
export async function pickComboOn(page: Page, trigger: Locator, value: string): Promise<void> {
  const list = await ensureOpen(page, trigger);
  const listId = (await list.getAttribute("id")) ?? "";
  const row = optionRow(list, listId, value);
  if ((await row.count()) === 0) {
    const offered = await list.getByRole("option").allTextContents();
    throw new Error(`pickCombo: no option for "${value}". Offered: [${offered.join(", ")}]`);
  }
  await row.click();
}

/** Picks `value` from the dropdown `testId`. */
export async function pickCombo(page: Page, testId: string, value: string): Promise<void> {
  try {
    await pickComboOn(page, page.getByTestId(testId), value);
  } catch (e) {
    throw new Error(`pickCombo("${testId}"): ${(e as Error).message}`);
  }
}

/**
 * The `<select>`-parity assertion: `value` is what the control reports
 * AND it is an option the control actually offers.
 *
 * The second half is not belt-and-braces — it is the half `data-value`
 * lost. See the module note.
 */
export async function expectComboValue(page: Page, testId: string, value: string): Promise<void> {
  const trigger = page.getByTestId(testId);
  await expect(trigger).toHaveAttribute("data-value", value);
  await expectComboOffers(page, testId, value);
}

/** As {@link expectComboValue}, for a trigger already in hand. */
export async function expectComboValueOn(
  page: Page,
  trigger: Locator,
  value: string,
): Promise<void> {
  await expect(trigger).toHaveAttribute("data-value", value);
  const list = await ensureOpen(page, trigger);
  const listId = (await list.getAttribute("id")) ?? "";
  await expect(optionRow(list, listId, value)).toHaveCount(1);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}

/** Asserts the dropdown `testId` offers an option with stored key `value`. */
export async function expectComboOffers(
  page: Page,
  testId: string,
  value: string,
): Promise<void> {
  const trigger = page.getByTestId(testId);
  const list = await ensureOpen(page, trigger);
  const listId = (await list.getAttribute("id")) ?? "";
  await expect(
    optionRow(list, listId, value),
    `dropdown "${testId}" reports ${value} but does not offer it as an option`,
  ).toHaveCount(1);
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
}
