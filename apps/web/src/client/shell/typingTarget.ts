/**
 * Whether a keystroke landed somewhere the user is composing text.
 *
 * Single-letter shortcuts (`n` for new task, `[` for the sidebar) must
 * not fire while the user is typing — NEW-4's third bullet: "`n`
 * pressed while focus is inside a text input types the letter `n` and
 * does not open the modal".
 *
 * ## Why this is its own module with its own test
 *
 * The obvious place to test it is "open the modal, type `n` in the
 * title, assert no second modal". That test **passes with this guard
 * deleted** — the modal's own dialog guard (NEW-31) already refuses
 * the shortcut while a dialog owns focus, so the assertion is
 * satisfied by a different mechanism than the one under test. The
 * cases that actually depend on this guard are the ones with no modal
 * open at all: the list's search box, an inline edit, the body editor
 * on a task detail page.
 *
 * So the guard is a pure function over an `EventTarget`, tested
 * directly against each element kind, and the branch cannot be
 * satisfied by a bystander.
 *
 * `contentEditable` is checked because the body editor (TipTap) is a
 * contenteditable div, not a `<textarea>` — the case names the body
 * editor explicitly, and an `instanceof HTMLInputElement` check alone
 * would let `n` open the modal in the middle of a sentence.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // `isContentEditable` is inherited, so it is true for a text node's
  // parent deep inside the editor, not only on the element carrying
  // the attribute.
  //
  // Coerced rather than returned directly: the property is not
  // implemented in every DOM (jsdom leaves it `undefined`), and an
  // `undefined` return from a `boolean` signature is the kind of thing
  // that reads as false at one call site and as "not checked" at the
  // next. The `contenteditable` attribute is the fallback, which also
  // covers a host that has the attribute but not the property.
  if (typeof target.isContentEditable === "boolean") return target.isContentEditable;
  // Fallback: walk up looking for the nearest `contenteditable`, which
  // is what the property would have reported. Checking only the target
  // itself would miss the case that matters most — a keystroke lands
  // on the inner `<span>` of a TipTap paragraph, not on the editor
  // root that carries the attribute.
  const owner = target.closest("[contenteditable]");
  if (owner === null) return false;
  return owner.getAttribute("contenteditable") !== "false";
}
