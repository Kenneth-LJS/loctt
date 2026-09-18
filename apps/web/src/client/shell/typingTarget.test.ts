// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { isTypingTarget } from "./typingTarget.ts";

/**
 * NEW-4's third bullet, tested where it can actually fail.
 *
 * ## Why this is a unit test and not a browser test
 *
 * The natural browser test — open the create modal, press `n` in the
 * title, assert no second modal opened — **passes with this guard
 * deleted**. The modal's own dialog check (NEW-31) refuses the
 * shortcut whenever a dialog owns focus, so that test is satisfied by
 * a different mechanism than the one it claims to cover, and green
 * tells you nothing.
 *
 * The states that genuinely depend on this guard have no modal open at
 * all: the list's search box, an inline edit, a task's body editor.
 * Asserting the predicate directly makes each of those a separate,
 * falsifiable case.
 */
function make(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  const el = host.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error("bad fixture");
  return el;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("isTypingTarget", () => {
  it("is true for a text input — the search box case", () => {
    expect(isTypingTarget(make('<input type="text">'))).toBe(true);
  });

  it("is true for a textarea — the raw markdown editor", () => {
    expect(isTypingTarget(make("<textarea></textarea>"))).toBe(true);
  });

  it("is true for a select, where a letter jumps to an option", () => {
    expect(isTypingTarget(make("<select><option>n</option></select>"))).toBe(true);
  });

  it("is true for a contenteditable — the TipTap body editor", () => {
    // The case names the body editor explicitly, and TipTap renders a
    // contenteditable div, not a textarea. A guard written only as
    // `instanceof HTMLInputElement` would let `n` open the modal in
    // the middle of a sentence.
    expect(isTypingTarget(make('<div contenteditable="true">text</div>'))).toBe(true);
  });

  it("is true for a node nested inside a contenteditable", () => {
    // `isContentEditable` is inherited. The event target for a
    // keystroke deep inside the editor is the inner element, not the
    // one carrying the attribute.
    const root = make('<div contenteditable="true"><p><span id="deep">x</span></p></div>');
    const deep = root.querySelector("#deep");
    expect(deep).not.toBeNull();
    expect(isTypingTarget(deep)).toBe(true);
  });

  it("is false for a button — a shortcut must still work from one", () => {
    expect(isTypingTarget(make("<button>Go</button>"))).toBe(false);
  });

  it("is false for a plain div, the ordinary page background", () => {
    expect(isTypingTarget(make("<div>text</div>"))).toBe(false);
  });

  it("is false for an explicitly non-editable region", () => {
    expect(isTypingTarget(make('<div contenteditable="false">x</div>'))).toBe(false);
  });

  it("is false for null — a keystroke with no target", () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
