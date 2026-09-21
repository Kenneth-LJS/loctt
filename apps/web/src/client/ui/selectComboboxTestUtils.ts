import { fireEvent, screen, within } from "@testing-library/react";

/**
 * Test helpers for the button-based `SelectCombobox` (K106).
 *
 * The ~18 former native `<select>` sites are now listbox dropdowns, so the
 * two things their tests used to do — read `.value`, and drive
 * `fireEvent.change` / `selectOptions` — no longer apply:
 *
 *  - a `<button>` has no `.value`; the selected key rides on `data-value`
 *    (`ComboboxButton`'s `dataValue`), which is the parity the prop was
 *    added for;
 *  - picking is open-then-click, because the options only exist in the DOM
 *    while the panel is open.
 *
 * Both helpers take the SAME `data-testid` the `<select>` carried, so no
 * testid changes and the e2e suite's selectors are untouched.
 */

/** The selected key, as `<select>.value` used to report it. */
export function comboValue(testId: string): string {
  return comboValueOf(screen.getByTestId(testId));
}

/**
 * As {@link comboValue}, for a trigger already in hand — the form a test
 * needs when it addresses one of several same-testid controls by index
 * (the query builder's per-row field/op pickers).
 */
export function comboValueOf(trigger: HTMLElement): string {
  return trigger.getAttribute("data-value") ?? "";
}

/** As {@link pickCombo}, for a trigger already in hand. */
export function pickComboOn(trigger: HTMLElement, value: string): void {
  fireEvent.click(trigger);
  const list = openListOf(trigger);
  const options = within(list).queryAllByRole("option");
  const match = options.find(o => o.id.endsWith(`-opt-${encodeURIComponent(value)}`));
  if (match === undefined) {
    const offered = options.map(o => o.textContent ?? "").join(", ");
    throw new Error(`pickComboOn: no option for "${value}". Offered: [${offered}]`);
  }
  fireEvent.click(match);
}

/** As {@link comboOptions}, for a trigger already in hand. */
export function comboOptionsOf(trigger: HTMLElement): { value: string; label: string }[] {
  fireEvent.click(trigger);
  const list = openListOf(trigger);
  const prefix = `${list.id}-opt-`;
  const rows = within(list).queryAllByRole("option").map(o => ({
    value: o.id.startsWith(prefix) ? decodeURIComponent(o.id.slice(prefix.length)) : "",
    label: o.textContent ?? "",
  }));
  fireEvent.click(trigger);
  return rows;
}

/** The values a trigger already in hand offers, in order. */
export function comboValuesOf(trigger: HTMLElement): string[] {
  return comboOptionsOf(trigger).map(o => o.value);
}

/** The open listbox belonging to `trigger`, or a throw naming why not. */
function openListOf(trigger: HTMLElement): HTMLElement {
  const listId = trigger.getAttribute("aria-controls");
  if (listId === null) throw new Error("the dropdown did not open.");
  const list = document.getElementById(listId);
  if (list === null) throw new Error(`its listbox ${listId} is not in the DOM.`);
  return list;
}

/**
 * Pick `value` from the dropdown `testId`: opens the panel, clicks the
 * option whose key matches, and leaves the panel closed (single-select
 * closes on pick).
 *
 * Throws naming both the testid and the value when no such option is
 * offered — the failure a silent no-op would otherwise hide, since
 * clicking nothing looks exactly like a control that ignored the change.
 */
export function pickCombo(testId: string, value: string): void {
  try {
    pickComboOn(screen.getByTestId(testId), value);
  } catch (e) {
    throw new Error(`pickCombo("${testId}"): ${(e as Error).message}`);
  }
}

/**
 * The `{ value, label }` pairs the dropdown `testId` offers, in order —
 * the replacement for reading `<option>`s off a native `<select>`.
 *
 * The stored key is recovered from the option's `id`, which `Combobox`
 * builds as `<listId>-opt-<encodeURIComponent(key)>`; the label is its
 * visible text. Opens the panel and closes it again, so the surrounding
 * test sees no state change.
 */
export function comboOptions(testId: string): { value: string; label: string }[] {
  return comboOptionsOf(screen.getByTestId(testId));
}

/** The values the dropdown `testId` offers, in order. */
export function comboValues(testId: string): string[] {
  return comboOptions(testId).map(o => o.value);
}

/** The visible label the dropdown `testId` shows for a stored `value`. */
export function comboOptionLabel(testId: string, value: string): string | null {
  return comboOptions(testId).find(o => o.value === value)?.label ?? null;
}

/**
 * The concatenated visible text of every option — for the "the raw token
 * is not shown to the user" half of a jargon red-proof, which used to
 * read `select.textContent`.
 */
export function comboOptionsText(testId: string): string {
  return comboOptions(testId).map(o => o.label).join(" ");
}
